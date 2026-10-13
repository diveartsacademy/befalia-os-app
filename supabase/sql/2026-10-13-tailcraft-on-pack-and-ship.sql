-- TailCraft orders on Pack and ship, 13 Oct 2026 23:00 WITA (applied the same evening)
-- ---------------------------------------------------------------------------
-- Befa: Ida Ayu Melati's order was missing because it is a TailCraft order.
-- Ruling: "Follow the invoice" (products come from tailcraft.invoice_lines, not
-- the TAILCRAFT DASHBOARD rows), and add paid TailCraft orders to Pack and
-- ship as a fifth shop.
--
-- Source of truth: tailcraft.projects (stage), tailcraft.invoices (paid or
-- deposit), tailcraft.invoice_lines (what goes in the box). No sheet copy.
-- Listed: invoice status paid or deposit_paid, project not archived, project
-- stage from deposit_paid to ready_ship. src is the pseudo tab 'TAILCRAFT',
-- row 0, slot = line position by sort order.
--
-- Actions:
--   pack      recorded in pack_marks (write_state 'tailcraft'); no sheet write,
--             the project stage is not changed (undo stays simple).
--   ship      "Already shipped, mark DONE": project stage -> shipped, the
--             previous stage kept in ship_marks.lines for undo.
--   contact   name, WhatsApp and shipping address from the confirmation form.
--   tick, note, handoff  as for the other shops.
-- The existing functions get a TailCraft branch at the top; nothing else in
-- them changes.
-- ---------------------------------------------------------------------------

create or replace function seadiva._tc_orders()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'invoice', i.invoice_no, 'customer', coalesce(i.customer_name, p.customer_name),
           'project', p.project_no, 'stage', p.stage_code, 'stage_label', st.label,
           'date', i.issue_date, 'country', p.country_city, 'pay', i.status, 'design', i.design_name,
           'lines', (select coalesce(jsonb_agg(jsonb_build_object('slot', x.n, 'title', x.description, 'qty', x.qty) order by x.n), '[]'::jsonb)
                       from (select l.description, l.qty, row_number() over (order by l.sort, l.id) n
                               from tailcraft.invoice_lines l where l.invoice_id = i.id) x)
         ) order by i.issue_date), '[]'::jsonb)
    from tailcraft.invoices i
    join tailcraft.projects p on p.id = i.project_id
    join tailcraft.stages st on st.code = p.stage_code
   where i.status in ('paid', 'deposit_paid')
     and not coalesce(p.is_archived, false)
     and st.sort between 110 and 160
$$;

create or replace function seadiva._tc_order(p_invoice text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select o from jsonb_array_elements(seadiva._tc_orders()) o where o->>'invoice' = btrim(p_invoice) limit 1
$$;

create or replace function seadiva._tc_pack_mark(p_by text, p_via text, p_invoice text, p_slots int[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o jsonb; s int; v_item text; v_click uuid := gen_random_uuid(); out jsonb := '[]'::jsonb;
begin
  o := seadiva._tc_order(p_invoice);
  if o is null then raise exception 'TailCraft invoice % is not a paid order in production.', p_invoice; end if;
  if p_slots is null or array_length(p_slots, 1) is null then raise exception 'No product chosen.'; end if;
  foreach s in array p_slots loop
    select l->>'title' into v_item from jsonb_array_elements(o->'lines') l where (l->>'slot')::int = s;
    if v_item is null then
      out := out || jsonb_build_object('slot', s, 'state', 'refused', 'why', 'no such product on the invoice'); continue;
    end if;
    if exists (select 1 from seadiva.pack_marks m where m.src = 'TAILCRAFT' and m.invoice = btrim(p_invoice) and m.slot = s and m.undone_at is null) then
      out := out || jsonb_build_object('slot', s, 'state', 'already', 'item', v_item); continue;
    end if;
    insert into seadiva.pack_marks (click_id, by_who, via, src, sheet_row, invoice, slot, item, prev_status, write_state, job_note, customer)
    values (v_click, p_by, p_via, 'TAILCRAFT', 0, btrim(p_invoice), s, v_item, o->>'stage_label', 'tailcraft',
            'TailCraft project ' || (o->>'project') || ', stage unchanged', o->>'customer');
    out := out || jsonb_build_object('slot', s, 'state', 'tailcraft', 'item', v_item);
  end loop;
  return jsonb_build_object('ok', true, 'click_id', v_click, 'lines', out,
    'marked', (select count(*) from seadiva.pack_marks where click_id = v_click));
end $$;

create or replace function seadiva._tc_contact(p_invoice text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_name text; v_phone text; v_addr text;
begin
  select coalesce(nullif(btrim(c.full_name), ''), i.customer_name, p.customer_name),
         coalesce(nullif(btrim(c.whatsapp), ''), nullif(btrim(p.whatsapp), '')),
         nullif(btrim(c.shipping_address), '')
    into v_name, v_phone, v_addr
    from tailcraft.invoices i
    join tailcraft.projects p on p.id = i.project_id
    left join tailcraft.confirmations c on c.id = i.confirmation_id
   where i.invoice_no = btrim(p_invoice) limit 1;
  if v_name is null then raise exception 'TailCraft invoice % not found.', p_invoice; end if;
  return jsonb_build_object('ok', true, 'from', 'TailCraft confirmation form',
    'name', v_name, 'phone', v_phone,
    'lines', (select coalesce(jsonb_agg(btrim(l)), '[]'::jsonb) from regexp_split_to_table(coalesce(v_addr, ''), E'\n') l where btrim(l) <> ''),
    'missing', (select coalesce(jsonb_agg(m), '[]'::jsonb) from unnest(array[
               case when v_addr is null then 'address' end, case when v_phone is null then 'phone' end]) m where m is not null));
end $$;

create or replace function seadiva._tc_ship(p_by text, p_via text, p_invoice text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o jsonb; v_id bigint; v_lines jsonb;
begin
  if exists (select 1 from seadiva.ship_marks m where m.src = 'TAILCRAFT' and m.invoice = btrim(p_invoice) and m.undone_at is null) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  o := seadiva._tc_order(p_invoice);
  if o is null then raise exception 'TailCraft invoice % is not a paid order in production.', p_invoice; end if;
  select coalesce(jsonb_agg(jsonb_build_object('slot', (l->>'slot')::int, 'item', l->>'title', 'write_state', 'tailcraft',
           'tc_project', o->>'project', 'tc_prev_stage', o->>'stage',
           'job_note', 'TailCraft project ' || (o->>'project') || ' moved to Shipped')), '[]'::jsonb)
    into v_lines from jsonb_array_elements(o->'lines') l;
  update tailcraft.projects set stage_code = 'shipped', updated_by = p_by || ' via ' || p_via
   where project_no = o->>'project';
  insert into seadiva.ship_marks (by_who, via, src, sheet_row, invoice, customer, lines)
  values (p_by, p_via, 'TAILCRAFT', 0, btrim(p_invoice), o->>'customer', v_lines)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'lines', v_lines);
end $$;

create or replace function seadiva.pack_tc_orders()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only Sea Diva staff can read TailCraft orders.'; end if;
  return seadiva._tc_orders();
end $$;

-- Branches injected at the top of the existing functions (done with a DO block
-- that rewrites each definition; see the apply notes in the PR):
--   _pack_mark:    if p_src = 'TAILCRAFT' then return seadiva._tc_pack_mark(p_by, p_via, p_invoice, p_slots); end if;
--   _pack_contact: if p_src = 'TAILCRAFT' then return seadiva._tc_contact(p_invoice); end if;
--   _ship_done:    if p_src = 'TAILCRAFT' then return seadiva._tc_ship(p_by, p_via, p_invoice); end if;
--   _ship_undo:    restores tailcraft.projects.stage_code from tc_prev_stage when m.src = 'TAILCRAFT'
--   _pack_tick, _pack_note, _pack_handoff: 'TAILCRAFT' added to the allowed tabs
--   befalia_business_feed: returns 'tailcraft', seadiva._tc_orders()

revoke execute on function seadiva._tc_orders(), seadiva._tc_order(text), seadiva._tc_pack_mark(text, text, text, int[]),
  seadiva._tc_contact(text), seadiva._tc_ship(text, text, text), seadiva.pack_tc_orders() from public, anon;
revoke execute on function seadiva._tc_orders(), seadiva._tc_order(text), seadiva._tc_pack_mark(text, text, text, int[]),
  seadiva._tc_contact(text), seadiva._tc_ship(text, text, text) from authenticated;
grant execute on function seadiva.pack_tc_orders() to authenticated;
