-- TailCraft design certificates, 8 Nov 2026
-- ---------------------------------------------------------------------------
-- Befa: "one dashboard ... to generate the certificate, especially for those
-- who buy out the design ... with their name and then send to their account."
-- Rulings the same day:
--   kinds  Personal, School, Brand (B2B), each with a term; the artwork exists
--          for 1 year and for lifetime (her two Slides templates).
--   where  Befalia OS Business tab and the TailCraft dashboard.
--   send   email and WhatsApp from the customer record, and shown in their
--          portals: student portal, customer portal (Brand Ambassador tab
--          included) and the ambassador page.
--   freeze lifted: "we launched the app".
--
-- What this adds
--   tailcraft.certificates   scope, territory, source line, recipient, portal
--                            profile, a secret view token, send stamps.
--   tailcraft.cert_issue     numbers (TC-IP-YYYY-NNN), saves, and puts the
--                            certificate in the person's portal when one
--                            portal profile matches their phone or email.
--   portal agency TailCraft  so it sits on the same trophy shelf.
--   public.tc_certificate_view(no, key)  the public certificate page. Anyone
--                            with the link (number and secret) can see it;
--                            nothing else is readable.
--   public.portal_my_certificate_links() the signed-in person's certificate
--                            links, for the portal pages.
--   befalia_pack actions     tc_cert_issue, tc_cert_sent, tc_cert_revoke,
--                            cert_contact (phone and email for the send);
--                            overlay returns tccerts and tccand.
--   tailcraft.cert_issue_staff(p)  the same for the TailCraft dashboard.
-- ---------------------------------------------------------------------------

alter type portal.agency add value if not exists 'TailCraft';

alter table tailcraft.certificates
  add column if not exists scope text,
  add column if not exists territory text,
  add column if not exists source_ref text,
  add column if not exists recipient_phone text,
  add column if not exists recipient_email text,
  add column if not exists profile_id uuid,
  add column if not exists view_token text,
  add column if not exists sent_whatsapp_at timestamptz,
  add column if not exists sent_email_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by text;
alter table tailcraft.certificates drop constraint if exists certificates_scope_chk;
alter table tailcraft.certificates add constraint certificates_scope_chk
  check (scope is null or scope in ('personal', 'school', 'brand'));
create unique index if not exists certificates_source_live_uq on tailcraft.certificates (source_ref)
  where source_ref is not null and revoked_at is null;

-- The address of the public certificate page.
create or replace function tailcraft._cert_url(p_no text, p_token text)
returns text language sql immutable as $$
  select 'https://befalia-os-app.vercel.app/certificate.html?n=' || p_no || '&k=' || p_token
$$;

create or replace function tailcraft.cert_issue(p_by text, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name   text := left(btrim(coalesce(p->>'customer_name', '')), 120);
  v_design text := left(btrim(coalesce(p->>'design_name', '')), 120);
  v_type   text := coalesce(p->>'cert_type', '');
  v_scope  text := coalesce(p->>'scope', '');
  v_terr   text := left(btrim(coalesce(p->>'territory', '')), 80);
  v_src    text := nullif(left(btrim(coalesce(p->>'source_ref', '')), 160), '');
  v_phone  text := portal.normalise_phone(nullif(btrim(coalesce(p->>'phone', '')), ''));
  v_email  text := lower(nullif(btrim(coalesce(p->>'email', '')), ''));
  v_date   date;
  v_no     text; v_tok text; v_id uuid; v_pid uuid; v_hits int; v_url text; v_level text;
begin
  if v_name = '' or v_design = '' then raise exception 'The name and the design name are both needed.'; end if;
  if v_type not in ('one_year', 'permanent') then raise exception 'Choose 1 year or lifetime.'; end if;
  if v_scope not in ('personal', 'school', 'brand') then raise exception 'Choose personal, school or brand.'; end if;
  if v_terr = '' then raise exception 'Say where the exclusivity applies, for example Worldwide or Indonesia.'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right.'; end if;
  begin
    v_date := coalesce(nullif(p->>'issue_date', '')::date, (now() at time zone 'Asia/Makassar')::date);
  exception when others then raise exception 'The date is not a date.'; end;
  if v_src is not null and exists (select 1 from tailcraft.certificates c where c.source_ref = v_src and c.revoked_at is null) then
    raise exception 'This buy out already has a certificate.';
  end if;

  perform pg_advisory_xact_lock(hashtext('tailcraft.cert_no'));
  v_no := tailcraft.next_cert_no(v_date);
  v_tok := encode(extensions.gen_random_bytes(12), 'hex');
  v_url := tailcraft._cert_url(v_no, v_tok);

  -- The portal profile, only when exactly one matches the phone or the email.
  select count(*), min(pr.id::text)::uuid into v_hits, v_pid
    from portal.profile pr
   where (v_phone is not null and pr.phone_hint = v_phone)
      or (v_email is not null and lower(pr.email_hint) = v_email);
  if v_hits <> 1 then v_pid := null; end if;

  insert into tailcraft.certificates (cert_no, project_id, invoice_no, customer_name, design_name, cert_type, rights_code,
         market_scope, term_years, term_start, term_end, issued_at, issued_by, status, notes,
         scope, territory, source_ref, recipient_phone, recipient_email, profile_id, view_token, pdf_url)
  values (v_no, nullif(p->>'project_id', '')::uuid, nullif(btrim(coalesce(p->>'invoice_no', '')), ''), v_name, v_design, v_type, 'C',
         v_terr, case when v_type = 'one_year' then 1 end, v_date,
         case when v_type = 'one_year' then (v_date + interval '1 year')::date end,
         now(), p_by, 'issued', nullif(left(btrim(coalesce(p->>'note', '')), 300), ''),
         v_scope, v_terr, v_src, v_phone, v_email, v_pid, v_tok, v_url)
  returning id into v_id;

  if v_pid is not null then
    v_level := 'Design exclusivity, ' || v_design || ', ' ||
               case v_scope when 'personal' then 'personal' when 'school' then 'school' else 'brand' end || ' licence, ' ||
               case when v_type = 'one_year' then '1 year' else 'lifetime' end || ', ' || v_terr;
    -- The portal needs a verifier on every issued certificate (cert_issued_needs_proof).
    -- Befa's own portal profile verifies all 117 issued certificates today, so it verifies these too.
    insert into portal.certificate (profile_id, issuing_body, certificate_number, status, issued_on, file_url, verified_by, note, import_key, agency_level)
    values (v_pid, 'TailCraft', v_no, 'issued', v_date, v_url, '4dca0156-d866-4e8f-8f6e-f2e7e6ef8382'::uuid, 'TailCraft design certificate', 'tc:' || v_no, left(v_level, 200));
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'cert_no', v_no, 'url', v_url, 'token', v_tok,
                            'in_portal', v_pid is not null, 'portal_matches', v_hits, 'phone', v_phone, 'email', v_email);
end $$;

create or replace function tailcraft.cert_revoke(p_by text, p_no text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update tailcraft.certificates set revoked_at = now(), revoked_by = p_by, status = 'revoked'
   where cert_no = btrim(p_no) and revoked_at is null;
  if not found then raise exception 'No live certificate %.', p_no; end if;
  update portal.certificate set status = 'revoked', updated_at = now() where import_key = 'tc:' || btrim(p_no);
  return jsonb_build_object('ok', true, 'cert_no', btrim(p_no));
end $$;

create or replace function tailcraft.cert_sent(p_no text, p_channel text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_channel = 'whatsapp' then
    update tailcraft.certificates set sent_whatsapp_at = now() where cert_no = btrim(p_no);
  elsif p_channel = 'email' then
    update tailcraft.certificates set sent_email_at = now() where cert_no = btrim(p_no);
  else raise exception 'Unknown channel.'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function tailcraft._cert_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'cert_no', c.cert_no, 'customer', c.customer_name, 'design', c.design_name, 'cert_type', c.cert_type,
           'scope', c.scope, 'territory', c.territory, 'issued_on', c.term_start, 'ends', c.term_end,
           'source_ref', c.source_ref, 'invoice_no', c.invoice_no, 'phone', c.recipient_phone, 'email', c.recipient_email,
           'in_portal', c.profile_id is not null, 'url', c.pdf_url, 'token', c.view_token,
           'sent_whatsapp_at', c.sent_whatsapp_at, 'sent_email_at', c.sent_email_at, 'revoked', c.revoked_at is not null)
         order by c.created_at desc), '[]'::jsonb)
    from tailcraft.certificates c
$$;

-- Paid TailCraft invoices with an exclusivity or buy out line, not yet certified.
create or replace function tailcraft._cert_candidates()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'source_ref', 'TAILCRAFT|' || i.invoice_no || '|' || x.n, 'invoice_no', i.invoice_no, 'project_id', p.id,
           'project', p.project_no, 'customer', coalesce(i.customer_name, p.customer_name), 'design', coalesce(i.design_name, p.design_name),
           'line', x.description, 'pay', i.status, 'date', i.issue_date,
           'phone', coalesce(nullif(btrim(cf.whatsapp), ''), nullif(btrim(p.whatsapp), '')),
           'email', coalesce(nullif(btrim(p.contact_email), ''), null), 'client_type', p.client_type)
         order by i.issue_date), '[]'::jsonb)
    from tailcraft.invoices i
    join tailcraft.projects p on p.id = i.project_id
    left join tailcraft.confirmations cf on cf.id = i.confirmation_id
    join lateral (select l.description, row_number() over (order by l.sort, l.id) n
                    from tailcraft.invoice_lines l where l.invoice_id = i.id) x on true
   where i.status in ('paid', 'deposit_paid')
     and x.description ~* '(exclusiv|buy ?out|ownership|licen[cs]e)'
     and not exists (select 1 from tailcraft.certificates c
                      where c.source_ref = 'TAILCRAFT|' || i.invoice_no || '|' || x.n and c.revoked_at is null)
$$;

-- Who to send a Sea Diva certificate to: the phone the box label uses (sheet,
-- then the contacts book) and the email from the sheet's Email column, then the
-- contacts book. Re-checks the row still holds the invoice. TailCraft
-- candidates already carry their contact.
create or replace function tailcraft._cert_contact(p_src text, p_row int, p_invoice text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; cells jsonb; v_col text; v_mail text; v_book text;
begin
  if p_src not in ('MANUAL (IG & WA) - OL', 'SHOPIFY-OL') then
    raise exception 'Certificates are sent from the Manual and Shopify tabs only.';
  end if;
  r := seadiva._pack_contact(p_src, p_row, p_invoice);
  if r->>'ok' is distinct from 'true' then return r; end if;
  select x.data->'cells' into cells from seadiva.sheet_raw x where x.source = p_src and x.row_no = p_row;
  begin
    v_col := seadiva._tab_col(p_src, array['email']);
    v_mail := nullif(btrim(coalesce(cells->v_col->>'d', cells->v_col->>'v', '')), '');
  exception when others then v_mail := null; end;
  if v_mail is null then
    select nullif(btrim(pc.emails[1]), '') into v_book
      from seadiva.orders o
      join seadiva.customers cu on cu.id = o.customer_id
      join public.contacts pc on pc.id = cu.contact_id
     where o.source_ref->>'tab' = p_src and coalesce(o.legacy_no, o.order_no) = btrim(p_invoice)
     limit 1;
    v_mail := v_book;
  end if;
  return jsonb_build_object('ok', true, 'name', r->'name', 'phone', r->'phone',
    'email', lower(substring(coalesce(v_mail, '') from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')),
    'from', r->'from');
end $$;

-- The public certificate page. Only the number together with its secret opens it.
create or replace function public.tc_certificate_view(p_no text, p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('ok', true, 'cert_no', c.cert_no, 'customer', c.customer_name,
            'design', c.design_name, 'cert_type', c.cert_type, 'scope', c.scope, 'territory', c.territory,
            'issued_on', c.term_start, 'ends', c.term_end, 'revoked', c.revoked_at is not null)
     from tailcraft.certificates c
    where c.cert_no = btrim(coalesce(p_no, '')) and c.view_token = btrim(coalesce(p_key, ''))
      and length(btrim(coalesce(p_key, ''))) = 24),
   jsonb_build_object('ok', false))
$$;
revoke execute on function public.tc_certificate_view(text, text) from public;
grant execute on function public.tc_certificate_view(text, text) to anon, authenticated;

-- For the portal pages: the signed-in person's certificates that have a link.
create or replace function public.portal_my_certificate_links()
returns table (issuing_body text, certificate_number text, agency_level text, issued_on date, status text, file_url text)
language sql stable security definer set search_path = 'portal', 'public', 'pg_temp' as $$
  select c.issuing_body::text, c.certificate_number, c.agency_level, c.issued_on, c.status::text, c.file_url
    from portal.certificate c
   where portal.owns_profile(c.profile_id) and c.file_url is not null and c.status = 'issued'
   order by c.issued_on desc nulls last
$$;
revoke execute on function public.portal_my_certificate_links() from public, anon;
grant execute on function public.portal_my_certificate_links() to authenticated;

-- TailCraft dashboard (staff sign in).
create or replace function tailcraft.cert_issue_staff(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only staff can issue certificates.'; end if;
  return tailcraft.cert_issue(coalesce(auth.jwt()->>'email', 'staff'), p);
end $$;
create or replace function tailcraft.cert_list_staff()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only staff can read certificates.'; end if;
  return jsonb_build_object('certs', tailcraft._cert_list(), 'candidates', tailcraft._cert_candidates());
end $$;

-- befalia_pack: three actions and two overlay lists, added without retyping the function.
do $do$
declare d text := pg_get_functiondef('seadiva.befalia_pack(text,jsonb)'::regprocedure);
begin
  if position('tc_cert_issue' in d) = 0 then
    d := replace(d, $x$  elsif a = 'ticks' then$x$,
$x$  elsif a = 'tc_cert_issue' then
    begin
      return tailcraft.cert_issue(v_by, p->'cert');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'tc_cert_sent' then
    begin
      return tailcraft.cert_sent(p->>'cert_no', p->>'channel');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'tc_cert_revoke' then
    begin
      return tailcraft.cert_revoke(v_by, p->>'cert_no');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'cert_contact' then
    begin
      return tailcraft._cert_contact(p->>'src', (p->>'row')::int, p->>'invoice');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'ticks' then$x$);
    d := replace(d, $x$'work', seadiva._work_list(), 'tcwork', seadiva._tc_work_list());$x$,
                    $x$'work', seadiva._work_list(), 'tcwork', seadiva._tc_work_list(),
                              'tccerts', tailcraft._cert_list(), 'tccand', tailcraft._cert_candidates());$x$);
    if position('tc_cert_issue' in d) = 0 or position('tccand' in d) = 0 then
      raise exception 'befalia_pack did not look as expected; nothing changed.';
    end if;
    execute d;
  end if;
end $do$;

revoke execute on function tailcraft._cert_url(text, text), tailcraft.cert_issue(text, jsonb), tailcraft.cert_revoke(text, text),
  tailcraft.cert_sent(text, text), tailcraft._cert_list(), tailcraft._cert_candidates(),
  tailcraft._cert_contact(text, int, text) from public, anon, authenticated;
revoke execute on function tailcraft.cert_issue_staff(jsonb), tailcraft.cert_list_staff() from public, anon;
grant execute on function tailcraft.cert_issue_staff(jsonb), tailcraft.cert_list_staff() to authenticated;
revoke execute on function seadiva.befalia_pack(text, jsonb) from public, anon, authenticated;
