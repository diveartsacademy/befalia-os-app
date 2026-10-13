-- Product notes, 13 Oct 2026 22:24 WITA (applied the same evening)
-- ---------------------------------------------------------------------------
-- Befa: "Maybe they change right after they check out the product. So add the
-- note for each product that they bought ... when we're packing, we can add the
-- note in the product."
-- One note per product line, shared by the Sea Diva Pack and ship page and the
-- Befalia OS Business tab. Saving an empty note clears it. Max 1000 characters.
-- befalia_pack gained the action 'note', and 'overlay' now also returns notes
-- (the full function text is the one in 2026-10-13-already-shipped.sql with
-- those two changes).
-- ---------------------------------------------------------------------------
create table if not exists seadiva.pack_notes (
  src        text not null,
  invoice    text not null,
  slot       int  not null check (slot between 1 and 12),
  note       text not null default '' check (length(note) <= 1000),
  changed_at timestamptz not null default now(),
  changed_by text not null,
  via        text not null check (via in ('befalia-os', 'seadiva')),
  primary key (src, invoice, slot)
);
alter table seadiva.pack_notes enable row level security;
create policy pack_notes_staff_read on seadiva.pack_notes for select to authenticated using (seadiva.is_staff());

create or replace function seadiva._pack_note(p_by text, p_via text, p_src text, p_invoice text, p_slot int, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v text := btrim(coalesce(p_note, ''));
begin
  if p_src not in ('MANUAL (IG & WA) - OL','SHOPIFY-OL','SHOPEE - OL','TOKOPEDIA/TIKTOK shop -OL') then raise exception 'Unknown order tab %', p_src; end if;
  if p_slot is null or p_slot < 1 or p_slot > 12 then raise exception 'No such product slot.'; end if;
  if coalesce(btrim(p_invoice), '') = '' then raise exception 'No invoice.'; end if;
  if length(v) > 1000 then raise exception 'A note can be at most 1000 characters.'; end if;
  insert into seadiva.pack_notes (src, invoice, slot, note, changed_at, changed_by, via)
  values (p_src, btrim(p_invoice), p_slot, v, now(), p_by, p_via)
  on conflict (src, invoice, slot) do update set note = excluded.note, changed_at = excluded.changed_at,
    changed_by = excluded.changed_by, via = excluded.via;
  return jsonb_build_object('ok', true, 'src', p_src, 'invoice', btrim(p_invoice), 'slot', p_slot, 'note', v);
end $$;

create or replace function seadiva._pack_notes_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('src', src, 'invoice', invoice, 'slot', slot, 'note', note, 'at', changed_at,
           'by', case when changed_by = seadiva._befa_email() then 'Befa' else changed_by end)), '[]'::jsonb)
    from seadiva.pack_notes where note <> ''
$$;

create or replace function seadiva.pack_note(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only Sea Diva staff can write a product note.'; end if;
  return seadiva._pack_note(coalesce(auth.jwt()->>'email', 'staff'), 'seadiva', p->>'src', p->>'invoice', (p->>'slot')::int, p->>'note');
end $$;

revoke execute on function seadiva._pack_note(text, text, text, text, int, text), seadiva._pack_notes_list(),
  seadiva.pack_note(jsonb), seadiva.befalia_pack(text, jsonb) from public, anon;
revoke execute on function seadiva._pack_note(text, text, text, text, int, text), seadiva._pack_notes_list(), seadiva.befalia_pack(text, jsonb) from authenticated;
grant execute on function seadiva.pack_note(jsonb) to authenticated;
