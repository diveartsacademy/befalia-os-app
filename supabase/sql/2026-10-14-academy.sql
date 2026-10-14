-- Befalia OS, Academy door (14 Oct 2026)
-- ---------------------------------------------------------------------------
-- Befa asked for the class session form on her To-Do: after each class, a
-- Google Drive link per session or per student, saved and emailed to the
-- student the same way the DiveArts OS Class video page does it.
--
-- Befalia OS runs on Vercel, outside Cloudflare Access, so it has no portal
-- login. It calls the befalia-academy edge function with the Befalia feed key
-- (the same key the Business tab uses, BIZ_FEED_KEY). That key is checked here,
-- by seadiva._befalia_key_ok, never in the edge function.
--
--   portal.befalia_academy(p_key, {action:'match', names:[...]})
--       For each name, up to 4 portal students that could be that person,
--       best first, with a score and whether an email is on file. The email
--       itself is never returned.
--   portal.befalia_academy(p_key, {action:'video', rows:[{profile_id, drive_url,
--       kind:'personal'|'session', lang:'id'|'en', class_date, class_label}]})
--       Queues one portal.class_video row per student. The hourly "Class video
--       sender" emails it, exactly as for the Class video page. A link already
--       queued for that student is skipped (unique profile_id + drive_url), so
--       nothing is ever sent twice. Only Google Drive or Docs links are taken.
-- ---------------------------------------------------------------------------

create or replace function portal.befalia_academy(p_key text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a text := coalesce(p->>'action', '');
  r jsonb;
  item jsonb;
  v_pid uuid;
  v_url text;
  v_prof record;
  n_new int := 0;
  n_dup int := 0;
  n_noemail int := 0;
  bad jsonb := '[]'::jsonb;
begin
  if not seadiva._befalia_key_ok(p_key) then
    return jsonb_build_object('ok', false, 'error', 'unauthorised');
  end if;

  if a = 'match' then
    if jsonb_typeof(p->'names') <> 'array' or jsonb_array_length(p->'names') > 20 then
      return jsonb_build_object('ok', false, 'error', 'names must be a list of at most 20');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('q', q.q, 'candidates', coalesce(c.list, '[]'::jsonb)) order by q.ord), '[]'::jsonb)
      into r
      from jsonb_array_elements_text(p->'names') with ordinality as q(q, ord)
      left join lateral (
        select jsonb_agg(jsonb_build_object('profile_id', s.profile_id, 'name', s.display_name,
                 'has_email', s.reachable_by_email, 'classes', s.classes_taken, 'score', s.score)
                 order by s.score desc, s.classes_taken desc) as list
          from (
            select v.profile_id, v.display_name, coalesce(v.reachable_by_email, false) as reachable_by_email,
                   coalesce(v.classes_taken, 0) as classes_taken,
                   case
                     when portal.name_key(v.display_name) = portal.name_key(q.q) then 100
                     when portal.name_key(q.q) is not null
                          and not exists (select 1 from unnest(string_to_array(portal.name_key(q.q), ' ')) w
                                           where position(w in coalesce(portal.name_key(v.display_name), '')) = 0) then 80
                     else (extensions.similarity(lower(v.display_name), lower(btrim(q.q))) * 70)::int
                   end as score
              from portal.v_student_picker v
             where length(btrim(q.q)) >= 2
               and (v.display_name ilike '%' || btrim(q.q) || '%'
                    or extensions.similarity(lower(v.display_name), lower(btrim(q.q))) > 0.35
                    or portal.name_key(v.display_name) = portal.name_key(q.q))
             order by 5 desc, 4 desc
             limit 4
          ) s
         where s.score >= 40
      ) c on true;
    return jsonb_build_object('ok', true, 'matches', r);

  elsif a = 'video' then
    if jsonb_typeof(p->'rows') <> 'array' or jsonb_array_length(p->'rows') = 0 or jsonb_array_length(p->'rows') > 20 then
      return jsonb_build_object('ok', false, 'error', 'rows must be a list of 1 to 20');
    end if;
    for item in select * from jsonb_array_elements(p->'rows') loop
      begin
        v_pid := (item->>'profile_id')::uuid;
      exception when others then
        bad := bad || jsonb_build_object('profile_id', item->>'profile_id', 'why', 'not a student id');
        continue;
      end;
      v_url := btrim(coalesce(item->>'drive_url', ''));
      if v_url !~ '^https://(drive|docs)\.google\.com/' then
        bad := bad || jsonb_build_object('profile_id', v_pid, 'why', 'not a Google Drive link');
        continue;
      end if;
      select v.profile_id, v.master_persona_id, v.display_name, v.email into v_prof
        from portal.v_student_picker v where v.profile_id = v_pid;
      if not found then
        bad := bad || jsonb_build_object('profile_id', v_pid, 'why', 'no such student in the portal');
        continue;
      end if;
      insert into portal.class_video (profile_id, master_persona_id, student_name, drive_url, kind, lang,
                                      class_date, class_label, note, email_to, send_email, send_whatsapp, created_by)
      values (v_prof.profile_id, v_prof.master_persona_id, v_prof.display_name, v_url,
              case when item->>'kind' = 'session' then 'session' else 'personal' end,
              case when item->>'lang' = 'en' then 'en' else 'id' end,
              coalesce(nullif(item->>'class_date', '')::date, (now() at time zone 'Asia/Makassar')::date),
              nullif(left(btrim(coalesce(item->>'class_label', '')), 150), ''),
              nullif(left(btrim(coalesce(item->>'note', '')), 300), ''),
              v_prof.email, true, false, 'befalia-os')
      on conflict do nothing;
      if found then
        n_new := n_new + 1;
        if v_prof.email is null then n_noemail := n_noemail + 1; end if;
      else
        n_dup := n_dup + 1;
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'queued', n_new, 'already', n_dup, 'no_email', n_noemail, 'refused', bad);
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown action');
end $$;

revoke all on function portal.befalia_academy(text, jsonb) from public, anon, authenticated;
-- (service_role reaches it only through seadiva.befalia_academy below)

-- The edge function reaches the database the same way befalia-business does:
-- through the seadiva schema, which the service role may use. portal stays
-- closed to it. This wrapper only forwards; portal.befalia_academy checks the key.
create or replace function seadiva.befalia_academy(p_key text, p jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select portal.befalia_academy(p_key, p) $$;

revoke all on function seadiva.befalia_academy(text, jsonb) from public, anon, authenticated;
grant execute on function seadiva.befalia_academy(text, jsonb) to service_role;
revoke all on function portal.befalia_academy(text, jsonb) from service_role;
