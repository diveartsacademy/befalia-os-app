-- Pickup or send, 13 Oct 2026 22:27 WITA (applied the same evening)
-- ---------------------------------------------------------------------------
-- Befa: "once I already click it and I already pack it, I want to have the
-- option ... it's going to be pick up or ... we send it to them." Pickup
-- orders leave the Befalia OS Business tab and are shown only on the Sea Diva
-- dashboard, under Waiting for pickup. Send orders go to a To send list with
-- name, phone and address.
-- One choice per order (src + invoice). 'none' clears it. The choice only
-- changes where a fully packed order is listed; "Already shipped, mark DONE"
-- still finishes the order as before.
-- befalia_pack gained the action 'handoff', and 'overlay' now also returns
-- handoff (the full function text is the one in 2026-10-13-already-shipped.sql
-- with the note and handoff branches added).
-- ---------------------------------------------------------------------------
create table if not exists seadiva.pack_handoff (
  src        text not null,
  invoice    text not null,
  method     text not null check (method in ('pickup', 'send', 'none')),
  changed_at timestamptz not null default now(),
  changed_by text not null,
  via        text not null check (via in ('befalia-os', 'seadiva')),
  primary key (src, invoice)
);
alter table seadiva.pack_handoff enable row level security;
create policy pack_handoff_staff_read on seadiva.pack_handoff for select to authenticated using (seadiva.is_staff());

create or replace function seadiva._pack_handoff(p_by text, p_via text, p_src text, p_invoice text, p_method text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_src not in ('MANUAL (IG & WA) - OL','SHOPIFY-OL','SHOPEE - OL','TOKOPEDIA/TIKTOK shop -OL') then raise exception 'Unknown order tab %', p_src; end if;
  if p_method not in ('pickup', 'send', 'none') then raise exception 'Choose pickup or send.'; end if;
  if coalesce(btrim(p_invoice), '') = '' then raise exception 'No invoice.'; end if;
  insert into seadiva.pack_handoff (src, invoice, method, changed_at, changed_by, via)
  values (p_src, btrim(p_invoice), p_method, now(), p_by, p_via)
  on conflict (src, invoice) do update set method = excluded.method, changed_at = excluded.changed_at,
    changed_by = excluded.changed_by, via = excluded.via;
  return jsonb_build_object('ok', true, 'src', p_src, 'invoice', btrim(p_invoice), 'method', p_method);
end $$;

create or replace function seadiva._pack_handoff_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('src', src, 'invoice', invoice, 'method', method, 'at', changed_at,
           'by', case when changed_by = seadiva._befa_email() then 'Befa' else changed_by end)), '[]'::jsonb)
    from seadiva.pack_handoff where method <> 'none'
$$;

create or replace function seadiva.pack_handoff_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only Sea Diva staff can set pickup or send.'; end if;
  return seadiva._pack_handoff(coalesce(auth.jwt()->>'email', 'staff'), 'seadiva', p->>'src', p->>'invoice', p->>'method');
end $$;

-- In befalia_pack (key checked first, as for every action):
--   elsif a = 'handoff' then
--     begin
--       return seadiva._pack_handoff(v_by, 'befalia-os', p->>'src', p->>'invoice', p->>'method');
--     exception when others then
--       return jsonb_build_object('ok', false, 'error', sqlerrm);
--     end;
--   elsif a = 'overlay' then
--     return jsonb_build_object('ok', true, 'ticks', seadiva._pack_ticks_list(), 'shipped', seadiva._ship_list(),
--                               'notes', seadiva._pack_notes_list(), 'handoff', seadiva._pack_handoff_list());

revoke execute on function seadiva._pack_handoff(text, text, text, text, text), seadiva._pack_handoff_list(),
  seadiva.pack_handoff_set(jsonb), seadiva.befalia_pack(text, jsonb) from public, anon;
revoke execute on function seadiva._pack_handoff(text, text, text, text, text), seadiva._pack_handoff_list(), seadiva.befalia_pack(text, jsonb) from authenticated;
grant execute on function seadiva.pack_handoff_set(jsonb) to authenticated;
