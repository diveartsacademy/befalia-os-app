-- Befalia OS, Academy certificates (14 Oct 2026)
-- ---------------------------------------------------------------------------
-- Befa asked for her instructor dashboard in Befalia OS, Business, DiveArts
-- Academy: courses finished but still needing a certificate, with buttons to
-- make the DiveArts (DAA) certificate and to process the PADI or MFI one, and
-- every certificate showing in the student's portal.
--
-- Her choices (14 Oct 2026, 17:50 WITA):
--   PADI / MFI: track it, then show it. Mark it submitted to the agency, then
--               type the real number when the agency sends it. Only then does
--               the portal read ISSUED.
--   DAA:        her existing certificate design, generated in Befalia OS,
--               stored here, shown in the portal with the image.
--
-- This adds, behind the same key check as the rest of the door
-- (seadiva._befalia_key_ok):
--
--   portal.befalia_certs(p_key, {action:'ping'})
--       {ok:true} if the key is right. The edge function asks this before it
--       stores an uploaded certificate image, so a wrong key stores nothing.
--   portal.befalia_certs(p_key, {action:'certs', invoices:[...]})
--       The certificates Befalia OS made for those invoices, one per agency.
--   portal.befalia_certs(p_key, {action:'cert_set', step, invoice_no, agency,
--       profile_id, course_name, number, issued_on, file_url})
--       step 'submit'   PADI/MFI/AIDA/EFR: status submitted_to_agency, today.
--       step 'unsubmit' back to not_yet_submitted, only if not issued.
--       step 'issue'    a real number and a real date, not in the future.
--                       verified_by is Befa's own portal profile, because the
--                       only person holding the Befalia OS key is Befa.
--                       DiveArts certificates may carry the stored image.
--       One row per invoice and agency (import_key 'bos:<invoice>:<agency>'),
--       so a second tap updates, never duplicates.
--
-- The rule from the portal design still holds and is enforced by the table's
-- own constraint: ISSUED needs a number, a date and a named verifier.
--
-- Also:
--   * storage bucket "certificates", public read, images only, 3 MB, so the
--     portal can show the DAA certificate. Paths are <profile uuid>/<random
--     uuid>.jpg, unguessable but not secret. Same model as demo-media.
--   * portal.my_room now also returns file_url and the course name with each
--     certificate, so the student app can show and download the DAA image.
--   * seadiva.befalia_academy forwards the certificate actions here.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificates', 'certificates', true, 3145728, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

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
    if jsonb_typeof(p->'invoices') <> 'array' or jsonb_array_length(p->'invoices') > 80 then
      return jsonb_build_object('ok', false, 'error', 'invoices must be a list of at most 80');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'invoice_no', split_part(ce.import_key, ':', 2),
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
               from jsonb_array_elements_text(p->'invoices') i,
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

  v_key := 'bos:' || v_inv || ':' || v_ag;
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
             course_id = coalesce(v_course, course_id), updated_at = now()
       where id = c.id;
    else
      insert into portal.certificate (profile_id, course_id, issuing_body, status, submitted_on, import_key, note)
      values (v_pid, v_course, v_ag::portal.agency, 'submitted_to_agency', v_today, v_key, 'Befalia OS, invoice ' || v_inv);
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
        or v_file !~ '^https://gszjrsvvpajznwdrtjva\.supabase\.co/storage/v1/object/public/certificates/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$') then
      return jsonb_build_object('ok', false, 'error', 'That certificate image is not one stored by Befalia OS.');
    end if;
    select id into v_befa from portal.profile where master_persona_id = 'DAE-PER-00076';
    if v_befa is null then
      return jsonb_build_object('ok', false, 'error', 'Befa''s own portal profile (DAE-PER-00076) is missing, so nobody can be named as the verifier.');
    end if;
    if c.id is not null then
      update portal.certificate
         set status = 'issued', certificate_number = v_num, issued_on = v_date, verified_by = v_befa,
             profile_id = v_pid, course_id = coalesce(v_course, course_id),
             file_url = coalesce(v_file, file_url), updated_at = now()
       where id = c.id;
    else
      insert into portal.certificate (profile_id, course_id, issuing_body, certificate_number, status,
                                      issued_on, verified_by, file_url, import_key, note)
      values (v_pid, v_course, v_ag::portal.agency, v_num, 'issued', v_date, v_befa, v_file, v_key,
              'Befalia OS, invoice ' || v_inv);
    end if;
    perform portal.award_certificate_badges();
  end if;

  select jsonb_build_object('invoice_no', v_inv, 'agency', ce.issuing_body, 'status', ce.status,
           'number', ce.certificate_number, 'submitted_on', ce.submitted_on, 'issued_on', ce.issued_on,
           'file_url', ce.file_url, 'profile_id', ce.profile_id, 'name', pr.display_name)
    into r
    from portal.certificate ce join portal.profile pr on pr.id = ce.profile_id
   where ce.import_key = v_key;
  return jsonb_build_object('ok', true, 'cert', r);
end $$;

revoke all on function portal.befalia_certs(text, jsonb) from public, anon, authenticated, service_role;

-- The edge function's one entry point now forwards the certificate actions.
create or replace function seadiva.befalia_academy(p_key text, p jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select case when coalesce(p->>'action', '') in ('ping', 'certs', 'cert_set')
              then portal.befalia_certs(p_key, p)
              else portal.befalia_academy(p_key, p) end
$$;

revoke all on function seadiva.befalia_academy(text, jsonb) from public, anon, authenticated;
grant execute on function seadiva.befalia_academy(text, jsonb) to service_role;

-- The student's Trophy Room: each certificate also carries its image and course.
do $do$
declare
  def text := pg_get_functiondef('portal.my_room(uuid)'::regprocedure);
  old text := '(select issuing_body, agency_level, status, certificate_number, issued_on
                from portal.certificate where profile_id = p_profile)';
  new text := '(select ce.issuing_body, ce.agency_level, ce.status, ce.certificate_number, ce.issued_on,
                     ce.file_url, co.name as course
                from portal.certificate ce left join portal.course co on co.id = ce.course_id
               where ce.profile_id = p_profile)';
begin
  if (length(def) - length(replace(def, old, ''))) / length(old) <> 1 then
    raise exception 'my_room certificate block not found exactly once, nothing changed';
  end if;
  execute replace(def, old, new);
end $do$;
