-- Befalia OS, Academy certificates: packages and PDF (14 Oct 2026, 23:30 WITA)
-- ---------------------------------------------------------------------------
-- Befa: a package (Zero to Hero, Mermaid Instructor + EFR) is several courses,
-- and every course in it gets its own certificate, the DAA one and the agency
-- one. And the DAA certificate is kept as a PDF, which she sends to the student
-- on WhatsApp herself.
--
--   * ref may now end in .<part key> (e.g. 51c25aac3489fa41.uwdi), so each
--     course inside a package has its own row: bos:<invoice>:<ref>.<key>:<agency>.
--     A single course keeps the plain ref, so certificates already made (Naomi
--     Wiliady, DAAJUL26-5) are found exactly as before.
--   * a stored certificate may be a .pdf; the bucket takes application/pdf.
--
-- Applied to the database on 14 Oct 2026 (migration befalia_certs_packages_and_pdf).
-- Safe to run again: it replaces the function whole and sets the bucket list.
-- 2026-10-14-academy-certificates.sql stays as it went live and is not re-run.
-- ---------------------------------------------------------------------------

update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
 where id = 'certificates';

create or replace function portal.befalia_certs(p_key text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        text := coalesce(p->>'action', '');
  v_step   text := coalesce(p->>'step', '');
  v_inv    text := btrim(coalesce(p->>'invoice_no', ''));
  v_ag     text := btrim(coalesce(p->>'agency', ''));
  v_ref    text := btrim(coalesce(p->>'ref', ''));
  v_level  text := nullif(left(btrim(coalesce(p->>'level', '')), 120), '');
  v_key    text;
  v_pid    uuid;
  v_course uuid;
  v_num    text := nullif(btrim(coalesce(p->>'number', '')), '');
  v_date   date;
  v_file   text := nullif(btrim(coalesce(p->>'file_url', '')), '');
  v_today  date := (now() at time zone 'Asia/Makassar')::date;
  v_befa   uuid;
  c        record;
  r        jsonb;
begin
  if not seadiva._befalia_key_ok(p_key) then
    return jsonb_build_object('ok', false, 'error', 'unauthorised');
  end if;

  if a = 'ping' then
    return jsonb_build_object('ok', true);
  end if;

  if a = 'certs' then
    if coalesce(jsonb_typeof(p->'keys'), '') <> 'array' or jsonb_array_length(p->'keys') > 120 then
      return jsonb_build_object('ok', false, 'error', 'keys must be a list of at most 120');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'invoice_no', split_part(ce.import_key, ':', 2),
             'ref', split_part(ce.import_key, ':', 3), 'level', ce.agency_level,
             'agency', ce.issuing_body, 'status', ce.status,
             'number', ce.certificate_number, 'submitted_on', ce.submitted_on,
             'issued_on', ce.issued_on, 'file_url', ce.file_url,
             'profile_id', ce.profile_id, 'name', pr.display_name,
             'course', co.name) order by ce.import_key), '[]'::jsonb)
      into r
      from portal.certificate ce
      join portal.profile pr on pr.id = ce.profile_id
      left join portal.course co on co.id = ce.course_id
     where ce.import_key in (
             select 'bos:' || btrim(i) || ':' || ag
               from jsonb_array_elements_text(p->'keys') i,
                    unnest(array['PADI','MFI','AIDA','EFR','DiveArts']) ag);
    return jsonb_build_object('ok', true, 'certs', r);
  end if;

  if a <> 'cert_set' then
    return jsonb_build_object('ok', false, 'error', 'unknown action');
  end if;

  -- What every step needs.
  if v_inv !~ '^[A-Za-z0-9][A-Za-z0-9/_-]{2,39}$' then
    return jsonb_build_object('ok', false, 'error', 'The invoice number is missing or not an invoice number.');
  end if;
  if v_ref !~ '^[0-9a-f]{16}(-[0-9]{1,2})?(\.[a-z0-9]{1,8})?$' then
    return jsonb_build_object('ok', false, 'error', 'Which course? Refresh and try again.');
  end if;
  if v_ag not in ('PADI', 'MFI', 'AIDA', 'EFR', 'DiveArts') then
    return jsonb_build_object('ok', false, 'error', 'Unknown agency "' || left(v_ag, 20) || '".');
  end if;
  if v_step not in ('submit', 'unsubmit', 'issue') then
    return jsonb_build_object('ok', false, 'error', 'Unknown step.');
  end if;
  if v_ag = 'DiveArts' and v_step <> 'issue' then
    return jsonb_build_object('ok', false, 'error', 'A DiveArts certificate is issued directly, there is no agency to submit it to.');
  end if;
  begin
    v_pid := (p->>'profile_id')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'Pick the student in the portal first.');
  end;
  if v_pid is null or not exists (select 1 from portal.profile where id = v_pid) then
    return jsonb_build_object('ok', false, 'error', 'That student is not in the portal.');
  end if;

  v_key := 'bos:' || v_inv || ':' || v_ref || ':' || v_ag;
  select * into c from portal.certificate where import_key = v_key for update;

  if found and c.profile_id <> v_pid and c.status = 'issued' then
    return jsonb_build_object('ok', false, 'error', 'This certificate is already issued to another portal student. Nothing changed.');
  end if;

  -- From here on test c.id, not FOUND: this lookup resets FOUND.
  select co.id into v_course from portal.course co
   where lower(btrim(co.name)) = lower(btrim(coalesce(p->>'course_name', ''))) limit 1;

  if v_step = 'submit' then
    if c.id is not null and c.status = 'issued' then
      return jsonb_build_object('ok', false, 'error', 'Already issued, number ' || coalesce(c.certificate_number, '') || '. Nothing changed.');
    end if;
    if c.id is not null then
      update portal.certificate
         set status = 'submitted_to_agency', submitted_on = v_today, profile_id = v_pid,
             course_id = coalesce(v_course, course_id), agency_level = coalesce(v_level, agency_level), updated_at = now()
       where id = c.id;
    else
      insert into portal.certificate (profile_id, course_id, issuing_body, agency_level, status, submitted_on, import_key, note)
      values (v_pid, v_course, v_ag::portal.agency, v_level, 'submitted_to_agency', v_today, v_key, 'Befalia OS, invoice ' || v_inv);
    end if;

  elsif v_step = 'unsubmit' then
    if c.id is null then
      return jsonb_build_object('ok', false, 'error', 'Nothing to undo.');
    end if;
    if c.status = 'issued' then
      return jsonb_build_object('ok', false, 'error', 'Already issued. An issued certificate is not undone from here.');
    end if;
    update portal.certificate set status = 'not_yet_submitted', submitted_on = null, updated_at = now() where id = c.id;

  else -- issue
    if v_num is null or length(v_num) > 60 then
      return jsonb_build_object('ok', false, 'error', 'Type the real certificate number.');
    end if;
    begin
      v_date := (p->>'issued_on')::date;
    exception when others then
      v_date := null;
    end;
    if v_date is null then
      return jsonb_build_object('ok', false, 'error', 'The issue date is missing.');
    end if;
    if v_date > v_today then
      return jsonb_build_object('ok', false, 'error', 'The issue date is in the future.');
    end if;
    if v_file is not null and (v_ag <> 'DiveArts'
        or v_file !~ '^https://gszjrsvvpajznwdrtjva\.supabase\.co/storage/v1/object/public/certificates/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf)$') then
      return jsonb_build_object('ok', false, 'error', 'That certificate image is not one stored by Befalia OS.');
    end if;
    select id into v_befa from portal.profile where master_persona_id = 'DAE-PER-00076';
    if v_befa is null then
      return jsonb_build_object('ok', false, 'error', 'Befa''s own portal profile (DAE-PER-00076) is missing, so nobody can be named as the verifier.');
    end if;
    if c.id is not null then
      update portal.certificate
         set status = 'issued', certificate_number = v_num, issued_on = v_date, verified_by = v_befa,
             profile_id = v_pid, course_id = coalesce(v_course, course_id), agency_level = coalesce(v_level, agency_level),
             file_url = coalesce(v_file, file_url), updated_at = now()
       where id = c.id;
    else
      insert into portal.certificate (profile_id, course_id, issuing_body, agency_level, certificate_number, status,
                                      issued_on, verified_by, file_url, import_key, note)
      values (v_pid, v_course, v_ag::portal.agency, v_level, v_num, 'issued', v_date, v_befa, v_file, v_key,
              'Befalia OS, invoice ' || v_inv);
    end if;
    perform portal.award_certificate_badges();
  end if;

  select jsonb_build_object('invoice_no', v_inv, 'ref', v_ref, 'level', ce.agency_level, 'agency', ce.issuing_body, 'status', ce.status,
           'number', ce.certificate_number, 'submitted_on', ce.submitted_on, 'issued_on', ce.issued_on,
           'file_url', ce.file_url, 'profile_id', ce.profile_id, 'name', pr.display_name)
    into r
    from portal.certificate ce join portal.profile pr on pr.id = ce.profile_id
   where ce.import_key = v_key;
  return jsonb_build_object('ok', true, 'cert', r);
end $$;

revoke all on function portal.befalia_certs(text, jsonb) from public, anon, authenticated, service_role;
