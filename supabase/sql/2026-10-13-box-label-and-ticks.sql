-- Box label and "in the box" ticks, 13 Oct 2026
-- ---------------------------------------------------------------------------
-- Befa, 13 Oct 22:00 WITA: "put the address there so that I can write down the
-- address and name and phone number on the box ... and also give the tick box
-- in each product so that I can tick which product already in the box."
--
-- 1. Name, phone and address for ONE order at a time, asked for when a card's
--    "Address & phone" button is pressed. The bulk feed still carries no
--    contact details. Sources:
--      SHOPIFY-OL   Shipping Name / Address1 / Address2 / Company / City / Zip /
--                   Province Name / Country / Shipping Phone (else Billing Phone)
--      MANUAL       Name (C), Phone Number (F), Address (H). Phone falls back to
--                   the customer's WhatsApp in the contacts book. The sheet
--                   rarely holds an address (1 of the last 74 rows on 13 Oct),
--                   so the card says so instead of showing nothing.
--      SHOPEE/TOKO  none: the marketplace prints the label with the address.
-- 2. One tick per product line, shared by both dashboards, undoable.
-- ---------------------------------------------------------------------------

-- First column whose header (rows 1 to 6) is one of p_names, by name order.
create or replace function seadiva._tab_col(p_src text, p_names text[])
returns text language sql stable set search_path = '' as $$
  select k
    from seadiva.sheet_raw r, jsonb_object_keys(r.data->'cells') k
   where r.source = p_src and r.row_no <= 6
     and lower(regexp_replace(btrim(coalesce(r.data->'cells'->k->>'d', r.data->'cells'->k->>'v', '')), '\s+', ' ', 'g')) = any(p_names)
   order by array_position(p_names, lower(regexp_replace(btrim(coalesce(r.data->'cells'->k->>'d', r.data->'cells'->k->>'v', '')), '\s+', ' ', 'g'))),
            seadiva._col_num(k)
   limit 1
$$;

create or replace function seadiva._pack_contact(p_src text, p_row int, p_invoice text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  lay jsonb; cells jsonb; v_inv_col text; v_on_row text;
  c jsonb := '{}'::jsonb; v_phone text; v_from text := 'sheet';
  f text;
begin
  if p_src in ('SHOPEE - OL', 'TOKOPEDIA/TIKTOK shop -OL') then
    return jsonb_build_object('ok', true, 'marketplace', true,
      'note', 'The marketplace prints the shipping label with the buyer''s name, phone and address. Print it from the seller app.');
  end if;
  if p_src not in ('MANUAL (IG & WA) - OL', 'SHOPIFY-OL') then raise exception 'Unknown order tab %', p_src; end if;

  lay := seadiva._tab_layout(p_src);
  v_inv_col := lay->>'inv';
  select r.data->'cells' into cells from seadiva.sheet_raw r where r.source = p_src and r.row_no = p_row;
  v_on_row := btrim(coalesce(cells->v_inv_col->>'d', cells->v_inv_col->>'v', ''));
  if cells is null or v_on_row is distinct from btrim(p_invoice) then
    raise exception 'Row % of % no longer holds %. Reload and try again.', p_row, p_src, p_invoice;
  end if;

  if p_src = 'SHOPIFY-OL' then
    foreach f in array array['shipping name','shipping company','shipping address1','shipping address2','shipping city',
                             'shipping zip','shipping province name','shipping country','shipping phone','billing phone'] loop
      c := c || jsonb_build_object(f, btrim(coalesce(cells->seadiva._tab_col(p_src, array[f])->>'d', cells->seadiva._tab_col(p_src, array[f])->>'v', '')));
    end loop;
    v_phone := coalesce(nullif(c->>'shipping phone', ''), nullif(c->>'billing phone', ''));
    return jsonb_build_object('ok', true, 'from', 'Shopify (sheet copy)',
      'name', nullif(c->>'shipping name', ''),
      'phone', v_phone,
      'lines', (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(array[
                 nullif(c->>'shipping company', ''),
                 nullif(c->>'shipping address1', ''),
                 nullif(c->>'shipping address2', ''),
                 nullif(btrim(concat_ws(' ', nullif(c->>'shipping city', ''), nullif(c->>'shipping zip', ''))), ''),
                 nullif(c->>'shipping province name', ''),
                 nullif(c->>'shipping country', '')]) x where x is not null),
      'missing', (select coalesce(jsonb_agg(m), '[]'::jsonb) from unnest(array[
                 case when nullif(c->>'shipping address1', '') is null then 'address' end,
                 case when v_phone is null then 'phone' end]) m where m is not null));
  end if;

  -- MANUAL
  c := jsonb_build_object(
    'name',    btrim(split_part(split_part(coalesce(cells->(lay->>'name')->>'d', cells->(lay->>'name')->>'v', ''), E'\n', 1), ' Mail:', 1)),
    'phone',   btrim(coalesce(cells->seadiva._tab_col(p_src, array['phone number'])->>'d', cells->seadiva._tab_col(p_src, array['phone number'])->>'v', '')),
    'address', btrim(coalesce(cells->seadiva._tab_col(p_src, array['address'])->>'d', cells->seadiva._tab_col(p_src, array['address'])->>'v', '')));
  v_phone := nullif(c->>'phone', '');
  if v_phone is null then
    select coalesce(nullif(btrim(pc.whatsapp), ''), nullif(btrim(pc.phones[1]), '')) into v_phone
      from seadiva.orders o
      join seadiva.customers cu on cu.id = o.customer_id
      join public.contacts pc on pc.id = cu.contact_id
     where o.source_ref->>'tab' = p_src and coalesce(o.legacy_no, o.order_no) = btrim(p_invoice)
     limit 1;
    if v_phone is not null then v_from := 'sheet, phone from the contacts book'; end if;
  end if;
  return jsonb_build_object('ok', true, 'from', v_from,
    'name', nullif(c->>'name', ''),
    'phone', v_phone,
    'lines', (select coalesce(jsonb_agg(btrim(l)), '[]'::jsonb) from regexp_split_to_table(coalesce(c->>'address', ''), E'\n') l where btrim(l) <> ''),
    'missing', (select coalesce(jsonb_agg(m), '[]'::jsonb) from unnest(array[
               case when nullif(c->>'address', '') is null then 'address' end,
               case when v_phone is null then 'phone' end]) m where m is not null));
end $$;

create table if not exists seadiva.pack_ticks (
  src        text not null,
  invoice    text not null,
  slot       int  not null check (slot between 1 and 12),
  ticked     boolean not null default true,
  changed_at timestamptz not null default now(),
  changed_by text not null,
  via        text not null check (via in ('befalia-os', 'seadiva')),
  primary key (src, invoice, slot)
);
comment on table seadiva.pack_ticks is
  'In the box: one row per product line, ticked while packing. Shared by the Sea Diva Pack and ship page and the Befalia OS Business tab.';
alter table seadiva.pack_ticks enable row level security;
create policy pack_ticks_staff_read on seadiva.pack_ticks for select to authenticated using (seadiva.is_staff());

create or replace function seadiva._pack_tick(p_by text, p_via text, p_src text, p_invoice text, p_slot int, p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_src not in ('MANUAL (IG & WA) - OL','SHOPIFY-OL','SHOPEE - OL','TOKOPEDIA/TIKTOK shop -OL') then raise exception 'Unknown order tab %', p_src; end if;
  if p_slot is null or p_slot < 1 or p_slot > 12 then raise exception 'No such product slot.'; end if;
  if coalesce(btrim(p_invoice), '') = '' then raise exception 'No invoice.'; end if;
  insert into seadiva.pack_ticks (src, invoice, slot, ticked, changed_at, changed_by, via)
  values (p_src, btrim(p_invoice), p_slot, p_on, now(), p_by, p_via)
  on conflict (src, invoice, slot) do update set ticked = excluded.ticked, changed_at = excluded.changed_at,
    changed_by = excluded.changed_by, via = excluded.via;
  return jsonb_build_object('ok', true, 'src', p_src, 'invoice', btrim(p_invoice), 'slot', p_slot, 'ticked', p_on);
end $$;

create or replace function seadiva._pack_ticks_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('src', src, 'invoice', invoice, 'slot', slot, 'at', changed_at,
           'by', case when changed_by = seadiva._befa_email() then 'Befa' else changed_by end)), '[]'::jsonb)
    from seadiva.pack_ticks where ticked and changed_at > now() - interval '120 days'
$$;

-- Sea Diva dashboard: signed-in staff.
create or replace function seadiva.pack_contact(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only Sea Diva staff can see a customer address.'; end if;
  return seadiva._pack_contact(p->>'src', (p->>'row')::int, p->>'invoice');
end $$;
create or replace function seadiva.pack_tick(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only Sea Diva staff can tick products.'; end if;
  return seadiva._pack_tick(coalesce(auth.jwt()->>'email', 'staff'), 'seadiva', p->>'src', p->>'invoice', (p->>'slot')::int, coalesce((p->>'on')::boolean, true));
end $$;

-- Befalia OS door: the same key-gated function, three new actions.
create or replace function seadiva.befalia_pack(p_key text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare a text := coalesce(p->>'action', ''); v_by text := seadiva._befa_email(); r jsonb; i jsonb;
begin
  if not seadiva._befalia_key_ok(p_key) then
    return jsonb_build_object('ok', false, 'error', 'unauthorised');
  end if;

  if a = 'mark' then
    begin
      return seadiva._pack_mark(v_by, 'befalia-os', p->>'src', (p->>'row')::int, p->>'invoice',
        array(select jsonb_array_elements_text(p->'slots')::int));
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'undo' then
    return seadiva._pack_undo(v_by, nullif(p->>'click_id', '')::uuid, nullif(p->>'mark_id', '')::bigint);

  elsif a = 'todo_claim' then
    with c as (
      update seadiva.pack_marks m
         set todo_state = 'claimed', todo_claimed_at = now()
       where m.by_who = v_by and m.undone_at is null and m.todo_page_id is null
         and (m.todo_state is null or (m.todo_state = 'claimed' and m.todo_claimed_at < now() - interval '10 minutes'))
         and m.created_at > now() - interval '14 days'
      returning m.click_id, m.created_at, m.src, m.invoice, m.customer, m.item, m.via, m.slot
    )
    select coalesce(jsonb_agg(x order by x->>'at'), '[]'::jsonb) into r from (
      select jsonb_build_object('click_id', click_id, 'at', min(created_at), 'src', min(src), 'invoice', min(invoice),
                                'customer', min(customer), 'via', min(via),
                                'items', jsonb_agg(item order by slot)) x
        from c group by click_id) t;
    return jsonb_build_object('ok', true, 'clicks', r,
      'orphans', coalesce((select jsonb_agg(distinct m.todo_page_id) from seadiva.pack_marks m
                            where m.by_who = v_by and m.undone_at is not null and m.todo_state = 'logged' and m.todo_page_id is not null
                              and not exists (select 1 from seadiva.pack_marks k where k.todo_page_id = m.todo_page_id and k.undone_at is null)), '[]'::jsonb));

  elsif a = 'todo_set' then
    for i in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
      update seadiva.pack_marks set todo_page_id = i->>'page_id', todo_state = 'logged'
       where click_id = (i->>'click_id')::uuid and by_who = v_by;
    end loop;
    return jsonb_build_object('ok', true);

  elsif a = 'todo_archived' then
    update seadiva.pack_marks set todo_state = 'archived'
     where by_who = v_by and undone_at is not null
       and todo_page_id in (select jsonb_array_elements_text(coalesce(p->'page_ids', '[]'::jsonb)));
    return jsonb_build_object('ok', true);

  elsif a = 'todo_release' then
    update seadiva.pack_marks set todo_state = null, todo_claimed_at = null
     where by_who = v_by and todo_page_id is null
       and click_id in (select (jsonb_array_elements_text(coalesce(p->'click_ids', '[]'::jsonb)))::uuid);
    return jsonb_build_object('ok', true);

  elsif a = 'contact' then
    begin
      return seadiva._pack_contact(p->>'src', (p->>'row')::int, p->>'invoice');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'tick' then
    begin
      return seadiva._pack_tick(v_by, 'befalia-os', p->>'src', p->>'invoice', (p->>'slot')::int, coalesce((p->>'on')::boolean, true));
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'ticks' then
    return jsonb_build_object('ok', true, 'ticks', seadiva._pack_ticks_list());
  end if;
  return jsonb_build_object('ok', false, 'error', 'unknown action');
end $$;

-- Grants (run as its own statement).
revoke execute on function seadiva._tab_col(text, text[]), seadiva._pack_contact(text, int, text),
  seadiva._pack_tick(text, text, text, text, int, boolean), seadiva._pack_ticks_list(),
  seadiva.pack_contact(jsonb), seadiva.pack_tick(jsonb), seadiva.befalia_pack(text, jsonb) from public, anon;
revoke execute on function seadiva._tab_col(text, text[]), seadiva._pack_contact(text, int, text),
  seadiva._pack_tick(text, text, text, text, int, boolean), seadiva._pack_ticks_list(), seadiva.befalia_pack(text, jsonb) from authenticated;
grant execute on function seadiva.pack_contact(jsonb), seadiva.pack_tick(jsonb) to authenticated;
