-- Fulfil-from decision and Ready to Buy links (25 Nov 2026)
-- ---------------------------------------------------------------------------
-- Befa approved this on 25 Nov 2026. Apply in the SQL editor. Do not run it
-- from a deploy. It writes no sheet cell by itself.
--
-- Data contract, identical for DiveArts OS (the SDT section) and this app.
--
-- Read, from seadiva.sheet_raw, added to befalia_business_feed:
--   catalog[]   PRODUCT LIST SDT rows that have a SKU. Fields: sku, product,
--               sourceCategory (SOURCE CATEGORY 1, carried down the block),
--               store, link, store2, link2 (SOURCE STORE / LINK 1 and 2).
--               This is v_product_source_links plus the SKU and the category.
--               sourceCategory "3rd party" is the only third-party test.
--   stockTab    true only when READY STOCK - STUDIO TABANAN is in the copy
--               and has a sku column and a quantity column. Quantity headers,
--               first match: available, on hand, qty, qty (edit here), quantity.
--   stock[]     { sku, qty } from that tab. A SKU with no row is zero only
--               when stockTab is true. The counts are never written here.
--   toDecideTab true when ORDER ITEMS TO DECIDE has Invoice No, Slot and
--               Suggested.
--   toDecide[]  { invoice, slot, suggested, sku } from that tab.
--
-- Write, only from a Ready stock Tabanan choice (Status Produksi "Ready Stock"):
--   seadiva.stock_outs  one row, direction 'out', store 'TABANAN'.
--   STOCK LOG - STUDIO  one new row, queued in sheet_writes only when that
--               tab is already in the copy and its header row has the columns
--               below. The row chosen is the first copy row whose SKU cell is
--               empty, so a filled row is not overwritten.
--               Headers, first match: date|tanggal, direction|in out|type,
--               sku, qty|quantity, invoice|invoice no, slot, item|product|item text,
--               note|notes. Direction is the word "out".
--   READY STOCK - STUDIO TABANAN is never a sheet_writes tab. A queued write
--               to that tab raises and rolls the decision back.
--
-- Status Produksi, the closed list, same words as WORK_FROM in api/_sd-business.js:
--   (blank), Pending, Need to Create
--     -> Ready Stock | Ready to be shipped | Design Needs to Be Made | Order from 3rd Party
--   Ready stock Tabanan / Other source / Make new / Buy from third party.
-- ---------------------------------------------------------------------------

create table if not exists seadiva.stock_outs (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  by_who        text not null,
  via           text not null,
  src           text not null,
  invoice       text not null,
  slot          int  not null,
  sku           text not null,
  qty           int  not null check (qty > 0),
  item          text,
  direction     text not null default 'out' check (direction = 'out'),
  store         text not null default 'TABANAN' check (store = 'TABANAN'),
  work_mark_id  bigint,
  write_state   text,
  log_row       int,
  undone_at     timestamptz,
  undone_by     text
);
create index if not exists stock_outs_line on seadiva.stock_outs (src, invoice, slot) where undone_at is null;
alter table seadiva.stock_outs enable row level security;
drop policy if exists stock_outs_staff_read on seadiva.stock_outs;
create policy stock_outs_staff_read on seadiva.stock_outs for select to authenticated using (seadiva.is_staff());

comment on table seadiva.stock_outs is
  'Out lines for STOCK LOG - STUDIO when a line is fulfilled from Ready stock Tabanan. Never a change to READY STOCK counts. 25 Nov 2026.';

-- One column of a mirrored tab, by header text. p_names is preference order.
create or replace function seadiva._sheet_col(p_src text, p_names text[])
returns text language sql stable security definer set search_path = '' as $$
  select h.col from (
    select e.key as col,
           lower(regexp_replace(btrim(coalesce(e.value->>'d', e.value->>'v', '')), '\s+', ' ', 'g')) as t,
           r.row_no,
           seadiva._col_num(e.key) as n
    from seadiva.sheet_raw r, jsonb_each(r.data->'cells') e
    where r.source = p_src and r.row_no <= 8
  ) h
  join unnest(p_names) with ordinality u(name, ord) on h.t = u.name
  order by u.ord, h.row_no, h.n
  limit 1
$$;

create or replace function seadiva._cell_text(p jsonb)
returns text language sql immutable as $$
  select btrim(regexp_replace(coalesce(nullif(btrim(p->>'d'), ''), nullif(btrim(p->>'v'), ''), ''), '\s+', ' ', 'g'))
$$;

-- null: the Tabanan tab is absent or its headers are not the contract (unknown).
-- 0: the tab was read and this SKU has no numeric row.
create or replace function seadiva._tabanan_on_hand(p_sku text)
returns int language plpgsql stable security definer set search_path = '' as $$
declare
  src text := 'READY STOCK - STUDIO TABANAN';
  c_sku text; c_qty text; hdr int; q int; seen boolean;
begin
  if not exists (select 1 from seadiva.sheet_raw where source = src) then return null; end if;
  c_sku := seadiva._sheet_col(src, array['sku']);
  c_qty := seadiva._sheet_col(src, array['available', 'on hand', 'qty', 'qty (edit here)', 'quantity']);
  if c_sku is null or c_qty is null then return null; end if;
  select max(r.row_no) into hdr
    from seadiva.sheet_raw r, jsonb_each(r.data->'cells') e
   where r.source = src and r.row_no <= 8
     and lower(regexp_replace(btrim(coalesce(e.value->>'d', e.value->>'v', '')), '\s+', ' ', 'g')) = 'sku';
  select coalesce(sum(n), 0), count(*) > 0 into q, seen
    from (
      select seadiva._cell_text(r.data->'cells'->c_qty) as raw,
             upper(seadiva._cell_text(r.data->'cells'->c_sku)) as sku
        from seadiva.sheet_raw r
       where r.source = src and r.row_no > coalesce(hdr, 1)
    ) x
    cross join lateral (
      select case when raw ~ '^[0-9]+(\.0+)?$' then raw::numeric::int else null end as n
    ) qn
   where sku = upper(btrim(p_sku)) and n is not null;
  if not coalesce(seen, false) then return 0; end if;
  return q;
end $$;

-- Queue one STOCK LOG - STUDIO row. Never touches READY STOCK - STUDIO TABANAN.
create or replace function seadiva._queue_stock_log(
  p_id bigint, p_sku text, p_qty int, p_invoice text, p_slot int, p_item text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  src text := 'STOCK LOG - STUDIO';
  ready text := 'READY STOCK - STUDIO TABANAN';
  c_date text; c_dir text; c_sku text; c_qty text; c_inv text; c_slot text; c_item text; c_note text;
  v_row int; v_reason text := 'stock out ' || p_id::text;
  pair record;
begin
  if not exists (select 1 from seadiva.sheet_raw where source = src) then
    update seadiva.stock_outs set write_state = 'waiting_mirror' where id = p_id;
    return 'Out ' || p_qty || ' of ' || p_sku || ' recorded. STOCK LOG - STUDIO is not in the sheet copy yet, so the log line waits. Ready stock counts were not edited.';
  end if;
  c_date := seadiva._sheet_col(src, array['date', 'tanggal']);
  c_dir  := seadiva._sheet_col(src, array['direction', 'in out', 'type']);
  c_sku  := seadiva._sheet_col(src, array['sku']);
  c_qty  := seadiva._sheet_col(src, array['qty', 'quantity']);
  c_inv  := seadiva._sheet_col(src, array['invoice', 'invoice no']);
  c_slot := seadiva._sheet_col(src, array['slot']);
  c_item := seadiva._sheet_col(src, array['item', 'product', 'item text']);
  c_note := seadiva._sheet_col(src, array['note', 'notes']);
  if c_dir is null or c_sku is null or c_qty is null then
    update seadiva.stock_outs set write_state = 'no_headers' where id = p_id;
    return 'Out ' || p_qty || ' of ' || p_sku || ' recorded. STOCK LOG - STUDIO has no Direction, SKU and Qty headers, so the sheet was not written. Ready stock counts were not edited.';
  end if;

  perform pg_advisory_xact_lock(hashtext(src));
  select coalesce(max(row_no), 1) + 1 into v_row from seadiva.sheet_raw where source = src;
  -- Do not land on a row the copy already uses for a SKU.
  while exists (
    select 1 from seadiva.sheet_raw r
     where r.source = src and r.row_no = v_row
       and seadiva._cell_text(r.data->'cells'->c_sku) <> ''
  ) loop
    v_row := v_row + 1;
  end loop;

  for pair in
    select * from (values
      (c_date, to_char(now() at time zone 'Asia/Makassar', 'YYYY-MM-DD')),
      (c_dir,  'out'),
      (c_sku,  p_sku),
      (c_qty,  p_qty::text),
      (c_inv,  btrim(p_invoice)),
      (c_slot, p_slot::text),
      (c_item, left(coalesce(p_item, ''), 300)),
      (c_note, 'Ready stock Tabanan for ' || btrim(p_invoice) || ' slot ' || p_slot)
    ) as t(col, val)
    where t.col is not null
  loop
    if pair.col is not null and seadiva._col_num(pair.col) is not null then
      -- No expect guard: the SKU cell of this row was empty in the copy, and
      -- the value written into it is the SKU itself. A guard on that cell
      -- would refuse every column after the SKU.
      insert into seadiva.sheet_writes (tab, row_no, col_no, value, reason)
      values (src, v_row, seadiva._col_num(pair.col), pair.val, v_reason);
    end if;
  end loop;

  if exists (select 1 from seadiva.sheet_writes w where w.reason = v_reason and w.tab = ready) then
    raise exception 'Ready stock counts are not edited from here.';
  end if;

  update seadiva.stock_outs set write_state = 'queued', log_row = v_row where id = p_id;
  return 'Out ' || p_qty || ' of ' || p_sku || ' queued for STOCK LOG - STUDIO. Ready stock counts were not edited.';
end $$;

-- Called after the work mark exists. Raises (and rolls the decision back)
-- when Tabanan was read and does not have the quantity.
create or replace function seadiva._ready_stock_out(
  p_by text, p_via text, p_src text, p_invoice text, p_slot int,
  p_item text, p_cells jsonb, p_item_col text, p_mark bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_qty int := 1;
  v_qty_col text;
  v_qtxt text;
  v_sku text;
  v_on_hand int;
  v_id bigint;
  v_msg text;
begin
  select k into v_qty_col from jsonb_object_keys(p_cells) k
   where seadiva._col_num(k) = seadiva._col_num(p_item_col) + 1
   limit 1;
  if v_qty_col is not null and exists (
    select 1 from seadiva.sheet_raw r
     where r.source = p_src and r.row_no <= 6
       and lower(regexp_replace(btrim(coalesce(r.data->'cells'->v_qty_col->>'d', r.data->'cells'->v_qty_col->>'v', '')), '\s+', ' ', 'g')) = 'qty'
  ) then
    v_qtxt := seadiva._cell_text(p_cells->v_qty_col);
    if v_qtxt ~ '^[0-9]+(\.0+)?$' then v_qty := v_qtxt::numeric::int; end if;
  end if;
  if v_qty is null or v_qty < 1 then v_qty := 1; end if;

  v_sku := upper((regexp_match(p_item, 'SKU[[:space:]]+([A-Za-z0-9][A-Za-z0-9._-]{2,60})', 'i'))[1]);
  if coalesce(v_sku, '') = '' then
    select s.sku into v_sku
      from (
        select upper(btrim(coalesce(r.data->'cells'->c.col->>'v', r.data->'cells'->c.col->>'d', ''))) as sku
          from seadiva.sheet_raw r
          cross join lateral (
            select seadiva._sheet_col('PRODUCT LIST SDT', array['sku']) as col
          ) c
         where r.source = 'PRODUCT LIST SDT' and r.row_no > 4 and c.col is not null
           and length(btrim(coalesce(r.data->'cells'->c.col->>'v', r.data->'cells'->c.col->>'d', ''))) >= 6
      ) s
     where p_item ~* ('(^|[^A-Za-z0-9])' || regexp_replace(s.sku, '([.^$|*+?(){}\[\]\\])', '\\\1', 'g') || '([^A-Za-z0-9]|$)')
     order by length(s.sku) desc
     limit 1;
  end if;

  if coalesce(v_sku, '') = '' then
    return 'No SKU in the item text, so nothing was written to STOCK LOG - STUDIO. Ready stock counts were not edited.';
  end if;

  v_on_hand := seadiva._tabanan_on_hand(v_sku);
  if v_on_hand is not null and v_on_hand < v_qty then
    raise exception 'Ready stock Tabanan has % of %, and this line needs %. Nothing was changed.', v_on_hand, v_sku, v_qty;
  end if;

  insert into seadiva.stock_outs (by_who, via, src, invoice, slot, sku, qty, item, direction, store, work_mark_id, write_state)
  values (p_by, p_via, p_src, btrim(p_invoice), p_slot, v_sku, v_qty, left(p_item, 300), 'out', 'TABANAN', p_mark, 'recorded')
  returning id into v_id;

  v_msg := seadiva._queue_stock_log(v_id, v_sku, v_qty, p_invoice, p_slot, p_item);
  return v_msg;
end $$;

create or replace function seadiva._stock_out_undo(p_by text, p_mark bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare s seadiva.stock_outs; written boolean;
begin
  select * into s from seadiva.stock_outs
   where work_mark_id = p_mark and undone_at is null
   order by id desc limit 1;
  if s.id is null then return ''; end if;
  update seadiva.sheet_writes set error = 'undone stock out', voided = true
   where reason = 'stock out ' || s.id::text and written_at is null and error is null;
  written := exists (
    select 1 from seadiva.sheet_writes
     where reason = 'stock out ' || s.id::text and written_at is not null and coalesce(voided, false) = false
  );
  update seadiva.stock_outs set undone_at = now(), undone_by = p_by where id = s.id;
  if written then
    return ' The out line is already on STOCK LOG - STUDIO and was left there. Ready stock counts were not edited.';
  end if;
  return ' The out line was cancelled before it reached the sheet. Ready stock counts were not edited.';
end $$;

create or replace function seadiva.bridge_managed_word(p text)
returns boolean language sql immutable as $$
  select coalesce(btrim(p), '') = '' or btrim(p) in (
    'Design Needs to Be Made','Design in Progress','Printing','Order from 3rd Party',
    'FLUKE FILLER MAKING','Sewing / Building','Ready to be shipped','Shipping Process','DONE',
    'Design Making','Ordering from 3rdParty','Ordered',
    'Need to Create','Ready Stock','Pending')
$$;

create or replace function seadiva._work_allowed(p_from text, p_to text)
returns boolean language sql immutable as $$
  select p_to = any(case lower(btrim(coalesce(p_from, '')))
    when 'design needs to be made' then array['Design in Progress', 'Printing']
    when 'design making'           then array['Design in Progress', 'Printing']
    when 'design in progress'      then array['Printing']
    when 'order from 3rd party'    then array['Ordered']
    when 'ordering from 3rdparty'  then array['Ordered']
    when 'ordered'                 then array['Ready to be shipped']
    when 'fluke filler making'     then array['Ready to be shipped']
    when 'in the making'           then array['Ready to be shipped']
    when ''                        then array['Ready Stock', 'Ready to be shipped', 'Design Needs to Be Made', 'Order from 3rd Party']
    when 'pending'                 then array['Ready Stock', 'Ready to be shipped', 'Design Needs to Be Made', 'Order from 3rd Party']
    when 'need to create'          then array['Ready Stock', 'Ready to be shipped', 'Design Needs to Be Made', 'Order from 3rd Party']
    when 'printing'                then array['Sewing / Building', 'Ready to be shipped']
    when 'sewing / building'       then array['Ready to be shipped']
    else array[]::text[] end)
$$;

create or replace function seadiva._work_stage(p_word text)
returns text language sql immutable as $$
  select case lower(btrim(coalesce(p_word, '')))
    when 'design in progress'  then 'design_progress'
    when 'design needs to be made' then 'designer'
    when 'design making'       then 'designer'
    when 'printing'            then 'printing'
    when 'order from 3rd party' then 'third_party'
    when 'ordering from 3rdparty' then 'third_party'
    when 'ordered'             then 'third_party_ordered'
    when 'fluke filler making' then 'fluke_filler'
    when 'sewing / building'   then 'sewing'
    when 'ready to be shipped' then 'qc'
    when 'ready stock'         then 'qc'
    else null end
$$;

create or replace function seadiva._work_move(p_by text, p_via text, p_src text, p_row int, p_invoice text, p_slot int, p_from text, p_to text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  lay jsonb; cells jsonb; v_inv_col text; v_on_row text; v_stat_col text; v_item_col text;
  v_item text; v_sheet text; v_now text; v_cust text;
  v_job uuid; v_prev text; v_code text; v_stage uuid; v_note text;
  v_col int; v_write bigint; v_state text; v_id bigint; v_stock text := '';
begin
  if p_src not in ('MANUAL (IG & WA) - OL','SHOPIFY-OL','SHOPEE - OL','TOKOPEDIA/TIKTOK shop -OL') then
    raise exception 'Unknown order tab %', p_src;
  end if;
  if p_slot is null or p_slot < 1 then raise exception 'No product chosen.'; end if;
  if not seadiva._work_allowed(p_from, p_to) then
    raise exception 'Moving "%" to "%" is not a step this button makes.', p_from, p_to;
  end if;

  lay := seadiva._tab_layout(p_src);
  v_inv_col := lay->>'inv';
  if v_inv_col is null or jsonb_array_length(coalesce(lay->'status','[]')) = 0
     or jsonb_array_length(coalesce(lay->'status','[]')) <> jsonb_array_length(coalesce(lay->'item','[]')) then
    raise exception 'The % layout could not be read, so nothing was changed.', p_src;
  end if;
  if p_slot > jsonb_array_length(lay->'status') then raise exception 'No such product slot.'; end if;

  select r.data->'cells' into cells from seadiva.sheet_raw r where r.source = p_src and r.row_no = p_row;
  v_on_row := btrim(coalesce(cells->v_inv_col->>'d', cells->v_inv_col->>'v', ''));
  if cells is null or v_on_row is distinct from btrim(p_invoice) then
    raise exception 'Row % of % no longer holds %, it holds "%". Refresh and try again.', p_row, p_src, p_invoice, v_on_row;
  end if;

  v_stat_col := lay->'status'->>(p_slot - 1);
  v_item_col := lay->'item'->>(p_slot - 1);
  v_item  := btrim(coalesce(cells->v_item_col->>'d', cells->v_item_col->>'v', ''));
  v_sheet := btrim(coalesce(cells->v_stat_col->>'d', cells->v_stat_col->>'v', ''));
  if v_item = '' then raise exception 'That product slot is empty.'; end if;
  v_cust := btrim(split_part(split_part(coalesce(cells->(lay->>'name')->>'d', cells->(lay->>'name')->>'v', ''), E'\n', 1), ' Mail:', 1));

  v_now := seadiva._work_now(p_src, p_invoice, p_slot, v_sheet);
  if lower(btrim(v_now)) <> lower(btrim(p_from)) then
    raise exception 'This product now says "%", not "%". Refresh and try again.', v_now, p_from;
  end if;
  if exists (select 1 from seadiva.pack_marks m where m.src = p_src and m.invoice = btrim(p_invoice) and m.slot = p_slot and m.undone_at is null) then
    raise exception 'This product is already packed.';
  end if;
  if exists (select 1 from seadiva.ship_marks m where m.src = p_src and m.invoice = btrim(p_invoice) and m.undone_at is null) then
    raise exception 'This order is already marked shipped.';
  end if;

  select j.id, st.code into v_job, v_prev
    from seadiva.production_jobs j
    join seadiva.order_lines l on l.id = j.order_line_id
    join seadiva.orders o on o.id = l.order_id
    join seadiva.production_stages st on st.id = j.current_stage_id
   where o.source_ref->>'tab' = p_src
     and coalesce(o.legacy_no, o.order_no) = btrim(p_invoice)
     and (l.source_ref->>'slot')::int = p_slot
     and j.status is distinct from 'cancelled'
   order by j.updated_at desc nulls last limit 1;
  v_code := seadiva._work_stage(p_to);
  if v_job is not null and v_code is not null and v_prev is distinct from v_code then
    select id into v_stage from seadiva.production_stages where code = v_code;
    begin
      update seadiva.production_jobs
         set current_stage_id = v_stage, updated_by = p_by || ' via ' || p_via, note = 'Moved to ' || p_to
       where id = v_job;
      v_note := 'board job moved to ' || v_code;
      update seadiva.sheet_writes
         set error = 'superseded by a work click at the live row ' || p_row, voided = true
       where job_id = v_job and written_at is null and error is null and row_no <> p_row;
    exception when others then
      v_note := 'board job not moved: ' || sqlerrm;
    end;
  elsif v_job is not null then
    v_note := 'board job already at ' || coalesce(v_prev, '?');
  end if;

  if p_src = 'MANUAL (IG & WA) - OL' then
    v_col := seadiva._col_num(v_stat_col);
    update seadiva.sheet_writes
       set error = 'replaced by a work click', voided = true
     where tab = p_src and row_no = p_row and col_no = v_col and written_at is null and error is null;
    insert into seadiva.sheet_writes (tab, row_no, col_no, value, reason, expect_col, expect_value)
    values (p_src, p_row, v_col, p_to, 'moved to ' || p_to || ' by ' || p_by || ' via ' || p_via,
            seadiva._col_num(v_inv_col), btrim(p_invoice))
    returning id into v_write;
    v_state := 'queued';
  else
    v_state := 'by_hand';
  end if;

  insert into seadiva.work_marks (by_who, via, src, sheet_row, invoice, slot, item, customer, from_word, to_word,
                                  write_state, write_id, job_id, prev_stage_code, job_note)
  values (p_by, p_via, p_src, p_row, btrim(p_invoice), p_slot, v_item, nullif(v_cust, ''), v_now, p_to,
          v_state, v_write, v_job, v_prev, v_note)
  returning id into v_id;

  if p_to = 'Ready Stock' then
    v_stock := seadiva._ready_stock_out(p_by, p_via, p_src, p_invoice, p_slot, v_item, cells, v_item_col, v_id);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'item', v_item, 'from', v_now, 'to', p_to,
                            'write', v_state, 'job', v_note, 'stock', v_stock);
end $$;

create or replace function seadiva._work_undo(p_by text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k seadiva.work_marks; lay jsonb; cells jsonb; v_row int; v_sheet text; v_col int; v_note text := '';
  v_stage uuid; v_written boolean; v_hits int;
begin
  select * into k from seadiva.work_marks where id = p_id;
  if k.id is null or k.undone_at is not null then raise exception 'Nothing to undo.'; end if;
  if exists (select 1 from seadiva.work_marks m where m.src = k.src and m.invoice = k.invoice and m.slot = k.slot
              and m.undone_at is null and m.id > k.id) then
    raise exception 'A later step on this product has to be undone first.';
  end if;

  if k.src = 'TAILCRAFT' then
    if exists (select 1 from tailcraft.projects where project_no = k.invoice and stage_code = k.to_word) then
      update tailcraft.projects set stage_code = k.from_word, updated_by = p_by || ' (undo)' where project_no = k.invoice;
      v_note := 'TailCraft project back to ' || k.from_word;
    else
      v_note := 'TailCraft project has moved on since, left as it is';
    end if;
  else
    if exists (select 1 from seadiva.pack_marks m where m.src = k.src and m.invoice = k.invoice and m.slot = k.slot and m.undone_at is null) then
      raise exception 'This product is packed. Undo the pack first.';
    end if;
    if k.job_id is not null and k.prev_stage_code is not null and k.job_note like 'board job moved%' then
      select id into v_stage from seadiva.production_stages where code = k.prev_stage_code;
      begin
        update seadiva.production_jobs set current_stage_id = v_stage, updated_by = p_by || ' (undo)' where id = k.job_id;
        update seadiva.sheet_writes set error = 'replaced by an undo', voided = true
         where job_id = k.job_id and written_at is null and error is null;
      exception when others then
        v_note := 'board job not moved back: ' || sqlerrm || '; ';
      end;
    end if;
    if k.write_id is not null then
      update seadiva.sheet_writes set error = 'undone by ' || p_by, voided = true
       where id = k.write_id and written_at is null and error is null;
      v_written := exists (select 1 from seadiva.sheet_writes where id = k.write_id and written_at is not null);
      if v_written then
        lay := seadiva._tab_layout(k.src);
        select count(*), min(r.row_no) into v_hits, v_row from seadiva.sheet_raw r
         where r.source = k.src and r.row_no > 3
           and btrim(coalesce(r.data->'cells'->(lay->>'inv')->>'d', r.data->'cells'->(lay->>'inv')->>'v', '')) = k.invoice;
        if v_hits = 1 then
          select r.data->'cells' into cells from seadiva.sheet_raw r where r.source = k.src and r.row_no = v_row;
          v_sheet := btrim(coalesce(cells->(lay->'status'->>(k.slot - 1))->>'d', cells->(lay->'status'->>(k.slot - 1))->>'v', ''));
          v_col := seadiva._col_num(lay->'status'->>(k.slot - 1));
          if lower(v_sheet) = lower(k.to_word) or lower(v_sheet) = lower(k.from_word) then
            update seadiva.sheet_writes set error = 'replaced by an undo', voided = true
             where tab = k.src and row_no = v_row and col_no = v_col and written_at is null and error is null;
            insert into seadiva.sheet_writes (tab, row_no, col_no, value, reason, expect_col, expect_value)
            values (k.src, v_row, v_col, k.from_word, 'undo by ' || p_by, seadiva._col_num(lay->>'inv'), k.invoice);
            v_note := v_note || 'sheet set back to ' || k.from_word || ' within the hour';
          else
            v_note := v_note || 'the sheet now says ' || v_sheet || ', left as it is';
          end if;
        else
          v_note := v_note || 'invoice not found once in the sheet copy, sheet left as it is';
        end if;
      else
        v_note := v_note || 'sheet write cancelled before it was made';
      end if;
    elsif k.write_state = 'by_hand' then
      v_note := v_note || 'this tab is set by hand: put it back to ' || k.from_word || ' if you changed it';
    end if;
    if k.to_word = 'Ready Stock' then
      v_note := v_note || seadiva._stock_out_undo(p_by, k.id);
    end if;
  end if;

  update seadiva.work_marks set undone_at = now(), undone_by = p_by, undo_note = nullif(v_note, '') where id = k.id;
  return jsonb_build_object('ok', true, 'id', k.id, 'note', v_note);
end $$;

create or replace function seadiva._feed_catalog()
returns jsonb language sql stable security definer set search_path = '' as $$
  with h as (
    select e.key as col,
           lower(regexp_replace(btrim(coalesce(e.value->>'d', e.value->>'v', '')), '\s+', ' ', 'g')) as t
    from seadiva.sheet_raw r, jsonb_each(r.data->'cells') e
    where r.source = 'PRODUCT LIST SDT' and r.row_no between 2 and 4
  ), m as (
    select
      (select min(col) from h where t = 'sku') as c_sku,
      (select min(col) from h where t = 'name of the product') as c_name,
      (select min(col) from h where t = 'source category 1') as c_cat,
      (select min(col) from h where t = 'source store 1') as c_s1,
      (select min(col) from h where t = 'source link 1') as c_l1,
      (select min(col) from h where t = 'source store 2') as c_s2,
      (select min(col) from h where t = 'source link 2') as c_l2
  ), raw as (
    select r.row_no,
      nullif(btrim(coalesce(r.data->'cells'->m.c_sku->>'d', r.data->'cells'->m.c_sku->>'v', '')), '') as sku,
      nullif(btrim(regexp_replace(coalesce(r.data->'cells'->m.c_name->>'d', r.data->'cells'->m.c_name->>'v', ''), '\s+', ' ', 'g')), '') as own_name,
      nullif(btrim(coalesce(r.data->'cells'->m.c_cat->>'d', r.data->'cells'->m.c_cat->>'v', '')), '') as own_cat,
      nullif(btrim(coalesce(r.data->'cells'->m.c_s1->>'d', r.data->'cells'->m.c_s1->>'v', '')), '') as store,
      nullif(btrim(coalesce(r.data->'cells'->m.c_l1->>'d', r.data->'cells'->m.c_l1->>'v', '')), '') as link,
      nullif(btrim(coalesce(r.data->'cells'->m.c_s2->>'d', r.data->'cells'->m.c_s2->>'v', '')), '') as store2,
      nullif(btrim(coalesce(r.data->'cells'->m.c_l2->>'d', r.data->'cells'->m.c_l2->>'v', '')), '') as link2
    from seadiva.sheet_raw r, m
    where r.source = 'PRODUCT LIST SDT' and r.row_no > 4 and m.c_sku is not null
  ), grp as (
    select raw.*, count(own_name) over (order by row_no) as g from raw
  ), carried as (
    select grp.*,
      coalesce(own_name, first_value(own_name) over (partition by g order by row_no)) as product,
      coalesce(own_cat, first_value(own_cat) over (partition by g order by row_no)) as source_category
    from grp
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', sku, 'product', coalesce(product, ''), 'sourceCategory', coalesce(source_category, ''),
           'store', coalesce(store, ''), 'link', coalesce(link, ''),
           'store2', coalesce(store2, ''), 'link2', coalesce(link2, '')) order by row_no), '[]'::jsonb)
    from carried
   where sku is not null
$$;

create or replace function seadiva._feed_stock()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  src text := 'READY STOCK - STUDIO TABANAN';
  c_sku text; c_qty text; hdr int;
begin
  c_sku := seadiva._sheet_col(src, array['sku']);
  c_qty := seadiva._sheet_col(src, array['available', 'on hand', 'qty', 'qty (edit here)', 'quantity']);
  if c_sku is null or c_qty is null then return '[]'::jsonb; end if;
  select max(r.row_no) into hdr
    from seadiva.sheet_raw r, jsonb_each(r.data->'cells') e
   where r.source = src and r.row_no <= 8
     and lower(regexp_replace(btrim(coalesce(e.value->>'d', e.value->>'v', '')), '\s+', ' ', 'g')) = 'sku';
  return coalesce((
    select jsonb_agg(jsonb_build_object('sku', sku, 'qty', qty))
      from (
        select upper(seadiva._cell_text(r.data->'cells'->c_sku)) as sku,
               seadiva._cell_text(r.data->'cells'->c_qty) as raw
          from seadiva.sheet_raw r
         where r.source = src and r.row_no > coalesce(hdr, 1)
      ) x
      cross join lateral (
        select case when raw ~ '^[0-9]+(\.0+)?$' then raw::numeric::int else null end as qty
      ) q
     where sku <> '' and qty is not null
  ), '[]'::jsonb);
end $$;

create or replace function seadiva._feed_to_decide()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  src text := 'ORDER ITEMS TO DECIDE';
  c_inv text; c_slot text; c_sug text; c_sku text; hdr int;
begin
  c_inv  := seadiva._sheet_col(src, array['invoice no', 'invoice']);
  c_slot := seadiva._sheet_col(src, array['slot']);
  c_sug  := seadiva._sheet_col(src, array['suggested']);
  c_sku  := seadiva._sheet_col(src, array['sku']);
  if c_inv is null or c_slot is null or c_sug is null then return '[]'::jsonb; end if;
  select max(r.row_no) into hdr
    from seadiva.sheet_raw r
   where r.source = src and r.row_no <= 8
     and lower(seadiva._cell_text(r.data->'cells'->c_sug)) = 'suggested';
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'invoice', inv, 'slot', slot, 'suggested', suggested, 'sku', sku) order by row_no)
      from (
        select r.row_no,
               seadiva._cell_text(r.data->'cells'->c_inv) as inv,
               seadiva._cell_text(r.data->'cells'->c_slot) as slot_txt,
               seadiva._cell_text(r.data->'cells'->c_sug) as suggested,
               case when c_sku is null then '' else upper(seadiva._cell_text(r.data->'cells'->c_sku)) end as sku
          from seadiva.sheet_raw r
         where r.source = src and r.row_no > coalesce(hdr, 1)
      ) x
      cross join lateral (
        select case when slot_txt ~ '^[0-9]+$' then slot_txt::int else null end as slot
      ) s
     where inv <> '' and slot is not null
  ), '[]'::jsonb);
end $$;

-- The live feed, plus catalog, stock and the decide list. Nothing else changes.
create or replace function seadiva.befalia_business_feed(p_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  out jsonb;
begin
  if not seadiva._befalia_key_ok(p_key) then
    return jsonb_build_object('ok', false, 'error', 'unauthorised');
  end if;

  with src as (
    select source, row_no, data -> 'cells' as c, loaded_at
    from seadiva.sheet_raw
    where source in ('MANUAL (IG & WA) - OL', 'SHOPIFY-OL', 'SHOPEE - OL', 'TOKOPEDIA/TIKTOK shop -OL')
  ),
  hdr as (
    select s.source, k as col,
           lower(regexp_replace(btrim(coalesce(s.c -> k ->> 'd', s.c -> k ->> 'v', '')), '\s+', ' ', 'g')) as t
    from src s, jsonb_object_keys(s.c) k
    where s.row_no <= 6
  ),
  keep as (
    select distinct source, col from hdr
    where t in ('status produksi', 'qty', 'invoice no', 'no pesanan', 'invoice month no', 'name', 'customer name',
                'production payment status', 'status payment', 'financial status', 'fulfillment status',
                'cancelled at', 'invoice date', 'created at', 'shipped', 'batas pengiriman',
                'shipping country', 'all product ready to be shipped')
       or t ~ '^\d+\. item / description$'
  ),
  slim as (
    select s.source, s.row_no, s.loaded_at,
           coalesce((select jsonb_object_agg(k.col, s.c -> k.col)
                     from keep k where k.source = s.source and s.c ? k.col), '{}'::jsonb) as cells
    from src s
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'tailcraft', seadiva._tc_orders(),
    'tabs', coalesce((
      select jsonb_object_agg(source, rows) from (
        select source, jsonb_agg(jsonb_build_object('row_no', row_no, 'cells', cells) order by row_no) as rows
        from slim group by source) t), '{}'::jsonb),
    'loaded', coalesce((
      select jsonb_object_agg(source, l) from (
        select source, max(loaded_at) as l from src group by source) t), '{}'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('name', product_name, 'category', category, 'photo', photo_url))
      from (select distinct on (product_name) product_name, category, photo_url
            from seadiva.inv_products
            where photo_url like 'http%'
            order by product_name, sheet_row) p), '[]'::jsonb),
    'marks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'click_id', m.click_id, 'src', m.src, 'invoice', m.invoice, 'slot', m.slot,
               'row', m.sheet_row, 'at', m.created_at, 'by', case when m.by_who = seadiva._befa_email() then 'Befa' else m.by_who end,
               'via', m.via, 'write', m.write_state,
               'written', w.written_at is not null, 'writeError', w.error,
               'todo', m.todo_page_id is not null) order by m.id)
        from seadiva.pack_marks m
        left join seadiva.sheet_writes w on w.id = m.write_id
       where m.undone_at is null and m.created_at > now() - interval '120 days'), '[]'::jsonb),
    'catalog', seadiva._feed_catalog(),
    'stockTab', seadiva._sheet_col('READY STOCK - STUDIO TABANAN', array['sku']) is not null
                and seadiva._sheet_col('READY STOCK - STUDIO TABANAN', array['available', 'on hand', 'qty', 'qty (edit here)', 'quantity']) is not null,
    'stock', seadiva._feed_stock(),
    'toDecideTab', seadiva._sheet_col('ORDER ITEMS TO DECIDE', array['invoice no', 'invoice']) is not null
                   and seadiva._sheet_col('ORDER ITEMS TO DECIDE', array['slot']) is not null
                   and seadiva._sheet_col('ORDER ITEMS TO DECIDE', array['suggested']) is not null,
    'toDecide', seadiva._feed_to_decide()
  ) into out;
  return out;
end $$;

revoke execute on function seadiva._sheet_col(text, text[]), seadiva._cell_text(jsonb),
  seadiva._tabanan_on_hand(text), seadiva._queue_stock_log(bigint, text, int, text, int, text),
  seadiva._ready_stock_out(text, text, text, text, int, text, jsonb, text, bigint),
  seadiva._stock_out_undo(text, bigint),
  seadiva._feed_catalog(), seadiva._feed_stock(), seadiva._feed_to_decide()
  from public, anon, authenticated;
revoke execute on function seadiva.befalia_business_feed(text) from public, anon, authenticated;
grant execute on function seadiva.befalia_business_feed(text) to service_role;
