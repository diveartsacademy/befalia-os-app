-- Pack and ship, 13 Oct 2026
-- ---------------------------------------------------------------------------
-- Befa now packs and ships. She wants one click per order (or per product):
-- "Packed, ready to ship". That click must
--   1. be recorded once, with who and when, and be undoable,
--   2. move the line to Ready to be shipped in the sheet where the sheet
--      bridge can write it (MANUAL today), behind the bridge's own guards,
--   3. move the matching production job on the Sea Diva board to Shipping,
--   4. show at once on both the Sea Diva dashboard and the Befalia OS
--      Business tab, without waiting an hour for the bridge and the mirror,
--   5. log a done task on Befa's To-Do (done by Befalia OS, which holds the
--      Notion token; this table keeps the task id).
--
-- What this does NOT do: write SHOPIFY-OL or SHOPEE - OL cells. The bridge
-- (status_push_v2.gs) refuses any tab but MANUAL. Those clicks are recorded
-- with write_state 'waiting_bridge' and shown on both dashboards; they are
-- queued for the sheet once the bridge learns those tabs.
--
-- Also: the writer never overwrites a word a person typed (anything outside its
-- managed list). Such a line is still recorded as packed, write_state
-- 'person_word', and the dashboards say the sheet still needs changing.
-- ---------------------------------------------------------------------------

create table if not exists seadiva.pack_marks (
  id              bigserial primary key,
  click_id        uuid not null,
  created_at      timestamptz not null default now(),
  by_who          text not null,
  via             text not null check (via in ('befalia-os', 'seadiva')),
  src             text not null,
  sheet_row       integer not null,
  invoice         text not null,
  slot            integer not null check (slot between 1 and 12),
  item            text,
  prev_status     text,
  new_status      text not null default 'Ready to be shipped',
  write_state     text not null,
  write_id        bigint,
  job_id          uuid,
  prev_stage_code text,
  job_note        text,
  undone_at       timestamptz,
  undone_by       text,
  todo_page_id    text,
  todo_state      text,
  todo_claimed_at timestamptz,
  customer        text
);
alter table seadiva.pack_marks add column if not exists todo_claimed_at timestamptz;
alter table seadiva.pack_marks add column if not exists customer text;
comment on table seadiva.pack_marks is
  'One row per product line Befa or staff marked Packed, ready to ship. Append only except undo and the To-Do link. Shared by the Sea Diva Pack and ship page and the Befalia OS Business tab.';
create index if not exists pack_marks_cell on seadiva.pack_marks (src, invoice, slot) where undone_at is null;
create index if not exists pack_marks_click on seadiva.pack_marks (click_id);
alter table seadiva.pack_marks enable row level security;
revoke all on seadiva.pack_marks from public, anon, authenticated;
revoke all on sequence seadiva.pack_marks_id_seq from public, anon, authenticated;
grant select on seadiva.pack_marks to authenticated;
drop policy if exists pack_marks_staff_read on seadiva.pack_marks;
create policy pack_marks_staff_read on seadiva.pack_marks for select to authenticated using (seadiva.is_staff());

-- Words the bridge may overwrite. Must match MANAGED_WORDS_V2 in
-- status_push_v2.gs exactly, or a refusal surfaces an hour later instead of now.
create or replace function seadiva.bridge_managed_word(p text)
returns boolean language sql immutable as $$
  select coalesce(btrim(p), '') = '' or btrim(p) in (
    'Design Needs to Be Made','Design in Progress','Printing','Order from 3rd Party',
    'FLUKE FILLER MAKING','Sewing / Building','Ready to be shipped','Shipping Process','DONE',
    'Design Making','Ordering from 3rdParty')
$$;

create or replace function seadiva._col_num(p text)
returns integer language sql immutable as $$
  select sum((ascii(substr(upper(p), i, 1)) - 64) * power(26, length(p) - i))::int
  from generate_series(1, length(p)) i
$$;

-- Header layout of an order tab, read from the live copy: invoice column, and
-- the Status Produksi and Item / Description columns in slot order.
create or replace function seadiva._tab_layout(p_src text)
returns jsonb language sql stable set search_path = '' as $$
  with h as (
    select k as col, seadiva._col_num(k) as n,
           lower(regexp_replace(btrim(coalesce(r.data->'cells'->k->>'d', r.data->'cells'->k->>'v', '')), '\s+', ' ', 'g')) as t
    from seadiva.sheet_raw r, jsonb_object_keys(r.data->'cells') k
    where r.source = p_src and r.row_no <= 6
  )
  -- Same choice as resolveTab in sd-overview.js: the first header name in the
  -- list that exists wins, then the leftmost column with it.
  select jsonb_build_object(
    'inv',    (select col from h where t in ('invoice no','no pesanan','invoice month no')
                order by array_position(array['invoice no','no pesanan','invoice month no'], t), n limit 1),
    'name',   (select col from h where t in ('name','customer name')
                order by array_position(array['name','customer name'], t), n limit 1),
    'status', (select jsonb_agg(col order by n) from (select distinct col, n from h where t = 'status produksi') s),
    'item',   (select jsonb_agg(col order by n) from (select distinct col, n from h where t ~ '^\d+\. item / description$') i)
  )
$$;

-- The one place a pack click is carried out. Internal: callers are the two
-- gated wrappers below, which supply who and via.
create or replace function seadiva._pack_mark(p_by text, p_via text, p_src text, p_row int, p_invoice text, p_slots int[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lay jsonb; cells jsonb; v_inv_col text; v_on_row text;
  v_click uuid := gen_random_uuid();
  s int; v_stat_col text; v_item_col text; v_item text; v_now text;
  v_state text; v_write bigint; v_job uuid; v_prev_stage text; v_job_note text;
  v_ship uuid; v_col int; v_cust text; out jsonb := '[]'::jsonb;
begin
  if p_src not in ('MANUAL (IG & WA) - OL','SHOPIFY-OL','SHOPEE - OL','TOKOPEDIA/TIKTOK shop -OL') then
    raise exception 'Unknown order tab %', p_src;
  end if;
  if p_slots is null or array_length(p_slots, 1) is null then
    raise exception 'No product chosen.';
  end if;

  lay := seadiva._tab_layout(p_src);
  v_inv_col := lay->>'inv';
  if v_inv_col is null or jsonb_array_length(coalesce(lay->'status','[]')) = 0
     or jsonb_array_length(coalesce(lay->'status','[]')) <> jsonb_array_length(coalesce(lay->'item','[]')) then
    raise exception 'The % layout could not be read, so nothing was marked.', p_src;
  end if;

  select r.data->'cells' into cells from seadiva.sheet_raw r where r.source = p_src and r.row_no = p_row;
  v_on_row := btrim(coalesce(cells->v_inv_col->>'d', cells->v_inv_col->>'v', ''));
  if cells is null or v_on_row is distinct from btrim(p_invoice) then
    raise exception 'Row % of % no longer holds %, it holds "%". Reload and try again.', p_row, p_src, p_invoice, v_on_row;
  end if;

  v_cust := btrim(split_part(split_part(coalesce(cells->(lay->>'name')->>'d', cells->(lay->>'name')->>'v', ''), E'\n', 1), ' Mail:', 1));
  select id into v_ship from seadiva.production_stages where code = 'shipping';

  foreach s in array p_slots loop
    v_state := null; v_write := null; v_job := null; v_prev_stage := null; v_job_note := null;
    if s < 1 or s > jsonb_array_length(lay->'status') then
      out := out || jsonb_build_object('slot', s, 'state', 'refused', 'why', 'no such product slot');
      continue;
    end if;
    v_stat_col := lay->'status'->>(s - 1);
    v_item_col := lay->'item'->>(s - 1);
    v_item := btrim(coalesce(cells->v_item_col->>'d', cells->v_item_col->>'v', ''));
    v_now  := btrim(coalesce(cells->v_stat_col->>'d', cells->v_stat_col->>'v', ''));
    if v_item = '' then
      out := out || jsonb_build_object('slot', s, 'state', 'refused', 'why', 'that product slot is empty');
      continue;
    end if;
    if exists (select 1 from seadiva.pack_marks m where m.src = p_src and m.invoice = p_invoice and m.slot = s and m.undone_at is null) then
      out := out || jsonb_build_object('slot', s, 'state', 'already', 'item', v_item);
      continue;
    end if;
    if upper(v_now) = 'DONE' then
      out := out || jsonb_build_object('slot', s, 'state', 'refused', 'item', v_item, 'why', 'already DONE in the sheet');
      continue;
    end if;

    -- The production job on the Sea Diva board, if there is one for this line.
    select j.id, st.code into v_job, v_prev_stage
      from seadiva.production_jobs j
      join seadiva.order_lines l on l.id = j.order_line_id
      join seadiva.orders o on o.id = l.order_id
      join seadiva.production_stages st on st.id = j.current_stage_id
     where o.source_ref->>'tab' = p_src
       and coalesce(o.legacy_no, o.order_no) = p_invoice
       and (l.source_ref->>'slot')::int = s
       and j.status is distinct from 'cancelled'
     order by j.updated_at desc nulls last limit 1;
    if v_job is not null and v_prev_stage is distinct from 'shipping' then
      begin
        update seadiva.production_jobs
           set current_stage_id = v_ship, updated_by = p_by || ' via ' || p_via,
               note = 'Packed, ready to ship'
         where id = v_job;
        -- Belt and braces: any write for this job aimed at another row is
        -- cancelled. The write below targets the live row.
        update seadiva.sheet_writes
           set error = 'superseded by a pack click at the live row ' || p_row, voided = true
         where job_id = v_job and written_at is null and error is null and row_no <> p_row;
        v_job_note := 'board job moved to Shipping';
      exception when others then
        v_job_note := 'board job not moved: ' || sqlerrm;
      end;
    elsif v_job is not null then
      v_job_note := 'board job already in Shipping';
    end if;

    if p_src = 'MANUAL (IG & WA) - OL' then
      if seadiva.bridge_managed_word(v_now) then
        v_col := seadiva._col_num(v_stat_col);
        update seadiva.sheet_writes
           set error = 'replaced by a pack click', voided = true
         where tab = p_src and row_no = p_row and col_no = v_col and written_at is null and error is null;
        insert into seadiva.sheet_writes (tab, row_no, col_no, value, reason, expect_col, expect_value)
        values (p_src, p_row, v_col, 'Ready to be shipped',
                'packed, ready to ship, by ' || p_by || ' via ' || p_via,
                seadiva._col_num(v_inv_col), p_invoice)
        returning id into v_write;
        v_state := 'queued';
      else
        v_state := 'person_word';
      end if;
    else
      v_state := 'waiting_bridge';
    end if;

    insert into seadiva.pack_marks
      (click_id, by_who, via, src, sheet_row, invoice, slot, item, prev_status, write_state, write_id, job_id, prev_stage_code, job_note, customer)
    values
      (v_click, p_by, p_via, p_src, p_row, p_invoice, s, v_item, nullif(v_now, ''), v_state, v_write, v_job, v_prev_stage, v_job_note, nullif(v_cust, ''));

    out := out || jsonb_build_object('slot', s, 'state', v_state, 'item', v_item, 'was', v_now, 'job', v_job_note);
  end loop;

  return jsonb_build_object('ok', true, 'click_id', v_click, 'lines', out,
    'marked', (select count(*) from seadiva.pack_marks where click_id = v_click));
end $$;
revoke execute on function seadiva._pack_mark(text,text,text,int,text,int[]) from public, anon, authenticated, service_role;

-- Undo one click (every line it marked) or one line.
create or replace function seadiva._pack_undo(p_by text, p_click uuid, p_mark bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare m record; v_stage uuid; n int := 0; v_written boolean; pages jsonb := '[]'::jsonb;
begin
  for m in
    select * from seadiva.pack_marks
     where undone_at is null and ((p_click is not null and click_id = p_click) or (p_mark is not null and id = p_mark))
  loop
    -- Board first. Moving the job back makes the board's own trigger queue its
    -- word for that stage; that write is cancelled, because undo puts the
    -- sheet back to exactly what it held before the click (below).
    if m.job_id is not null and m.prev_stage_code is not null and m.prev_stage_code <> 'shipping' then
      begin
        select id into v_stage from seadiva.production_stages where code = m.prev_stage_code;
        update seadiva.production_jobs set current_stage_id = v_stage, updated_by = p_by, note = 'Pack undone'
         where id = m.job_id;
        update seadiva.sheet_writes set error = 'superseded by pack undo', voided = true
         where job_id = m.job_id and written_at is null and error is null;
      exception when others then null;
      end;
    end if;
    if m.write_id is not null then
      select written_at is not null into v_written from seadiva.sheet_writes where id = m.write_id;
      if not coalesce(v_written, false) then
        update seadiva.sheet_writes set error = 'undone before it reached the sheet', voided = true
         where id = m.write_id and written_at is null;
      else
        -- Already in the sheet: put back what was there. The bridge accepts it
        -- because the cell now holds a word it manages.
        update seadiva.sheet_writes w set error = 'replaced by pack undo', voided = true
          from seadiva.sheet_writes o
         where o.id = m.write_id and w.tab = o.tab and w.row_no = o.row_no and w.col_no = o.col_no
           and w.written_at is null and w.error is null;
        insert into seadiva.sheet_writes (tab, row_no, col_no, value, reason, expect_col, expect_value)
        select tab, row_no, col_no, coalesce(m.prev_status, ''), 'pack undone by ' || p_by, expect_col, expect_value
          from seadiva.sheet_writes where id = m.write_id;
      end if;
    end if;
    update seadiva.pack_marks set undone_at = now(), undone_by = p_by where id = m.id;
    if m.todo_page_id is not null and not pages ? m.todo_page_id then pages := pages || to_jsonb(m.todo_page_id); end if;
    n := n + 1;
  end loop;
  -- A To-Do task is per click. It is only archived when no line of that
  -- click is still packed.
  return jsonb_build_object('ok', true, 'undone', n,
    'todo_pages', coalesce((select jsonb_agg(p) from jsonb_array_elements_text(pages) p
                             where not exists (select 1 from seadiva.pack_marks k where k.todo_page_id = p and k.undone_at is null)), '[]'::jsonb));
end $$;
revoke execute on function seadiva._pack_undo(text,uuid,bigint) from public, anon, authenticated, service_role;

-- Sea Diva dashboard: signed in staff only.
create or replace function seadiva.pack_mark(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only Sea Diva staff can mark an order packed.'; end if;
  return seadiva._pack_mark(coalesce(auth.jwt()->>'email', 'staff'), 'seadiva', p->>'src', (p->>'row')::int, p->>'invoice',
    array(select jsonb_array_elements_text(p->'slots')::int));
end $$;
create or replace function seadiva.pack_undo(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only Sea Diva staff can undo a pack.'; end if;
  return seadiva._pack_undo(coalesce(auth.jwt()->>'email', 'staff'), nullif(p->>'click_id','')::uuid, nullif(p->>'mark_id','')::bigint);
end $$;
revoke execute on function seadiva.pack_mark(jsonb) from public, anon;
revoke execute on function seadiva.pack_undo(jsonb) from public, anon;
grant execute on function seadiva.pack_mark(jsonb) to authenticated;
grant execute on function seadiva.pack_undo(jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- Board moves wrote to the row the order remembers (13 Oct 2026 fix)
-- ---------------------------------------------------------------------------
-- queue_status_write wrote at orders.source_ref->>'row' and set its invoice
-- guard to whatever invoice the mirror held at THAT row. Rows have moved since
-- the orders were made (all 46 open jobs point 1 or 2 rows off, checked 13 Oct),
-- so the guard checked the wrong order against itself and would have passed.
-- Now: the row is found by the order's own invoice in the live mirror (only
-- when exactly one row holds it), and the guard always expects that invoice.
-- If no row holds it, the old row is kept and the guard refuses the write,
-- which shows as an error instead of landing on someone else's order.
create or replace function seadiva.queue_status_write()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'seadiva', 'public'
as $function$
declare
  v_row int; v_slot int; v_tab text; v_col int; v_word text; v_code text;
  v_inv text; v_err text; v_live int; v_hits int;
begin
  select ps.code into v_code
    from seadiva.production_stages ps
   where ps.id = new.current_stage_id;

  select o.source_ref->>'tab', (o.source_ref->>'row')::int,
         (l.source_ref->>'slot')::int, coalesce(o.legacy_no, o.order_no)
    into v_tab, v_row, v_slot, v_inv
    from seadiva.order_lines l
    join seadiva.orders o on o.id = l.order_id
   where l.id = new.order_line_id;

  if v_tab is distinct from 'MANUAL (IG & WA) - OL' then return new; end if;
  if v_slot is null or v_slot < 1 or v_slot > 6 then return new; end if;

  select count(*), min(r.row_no) into v_hits, v_live
    from seadiva.sheet_raw r
   where r.source = 'MANUAL (IG & WA) - OL' and r.row_no > 4
     and btrim(coalesce(r.data->'cells'->'B'->>'d', r.data->'cells'->'B'->>'v', '')) = btrim(v_inv);
  if v_hits = 1 then v_row := v_live; end if;
  if v_row is null then return new; end if;

  select w.sheet_word into v_word
    from seadiva.stage_sheet_words w
   where w.stage_code = v_code;
  if v_word is null then return new; end if; -- no word for this stage, so nothing is written

  begin
    v_col := seadiva.manual_slot_col(v_slot, 'status');
  exception when others then
    v_err := sqlerrm;
    insert into seadiva.sheet_writes
      (tab, row_no, col_no, value, reason, job_id, error)
    values
      (v_tab, v_row, 0, v_word,
       'status write refused, MANUAL layout could not be resolved', new.id, v_err);
    return new;
  end;

  delete from seadiva.sheet_writes
   where tab = v_tab and row_no = v_row and col_no = v_col
     and written_at is null and error is null;

  insert into seadiva.sheet_writes
    (tab, row_no, col_no, value, reason, job_id, expect_col, expect_value)
  values
    (v_tab, v_row, v_col, v_word, 'stage is now ' || v_word, new.id, 2, btrim(v_inv));

  return new;
end
$function$;

-- ---------------------------------------------------------------------------
-- Befalia OS door. Befalia OS has no Supabase login, so it carries the same
-- feed key as the read feed. The key is checked here, in the database.
-- ---------------------------------------------------------------------------
create or replace function seadiva._befalia_key_ok(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select length(btrim(coalesce(p_key, ''))) >= 32 and exists (
    select 1 from seadiva.befalia_feed_keys
     where revoked_at is null
       and key_sha256 = encode(extensions.digest(btrim(coalesce(p_key, '')), 'sha256'), 'hex'))
$$;
revoke execute on function seadiva._befalia_key_ok(text) from public, anon, authenticated;

-- Befa's own clicks, from either dashboard, are the ones logged on her To-Do.
create or replace function seadiva._befa_email()
returns text language sql immutable as $$ select 'diveartsacademy@gmail.com'::text $$;

--   {"action":"mark", "src","row","invoice","slots":[1,2]}
--   {"action":"undo", "click_id" | "mark_id"}
--   {"action":"todo_claim"}                 clicks by Befa with no To-Do task yet
--   {"action":"todo_set", "items":[{"click_id","page_id"}]}
--   {"action":"todo_release", "click_ids":[...]}   creating the task failed
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
    return jsonb_build_object('ok', true, 'clicks', r);

  elsif a = 'todo_set' then
    for i in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
      update seadiva.pack_marks set todo_page_id = i->>'page_id', todo_state = 'logged'
       where click_id = (i->>'click_id')::uuid and by_who = v_by;
    end loop;
    return jsonb_build_object('ok', true);

  elsif a = 'todo_release' then
    update seadiva.pack_marks set todo_state = null, todo_claimed_at = null
     where by_who = v_by and todo_page_id is null
       and click_id in (select (jsonb_array_elements_text(coalesce(p->'click_ids', '[]'::jsonb)))::uuid);
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'unknown action');
end $$;
revoke execute on function seadiva.befalia_pack(text, jsonb) from public, anon, authenticated;
grant execute on function seadiva.befalia_pack(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The read feed, now with Shopee and Tokopedia/TikTok, the ship-by date, and
-- the pack marks that are still standing.
-- ---------------------------------------------------------------------------
create or replace function seadiva.befalia_business_feed(p_key text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
       where m.undone_at is null and m.created_at > now() - interval '120 days'), '[]'::jsonb)
  ) into out;
  return out;
end $function$;

-- Helpers are internal. Nothing here is callable by anon or by signed-in users
-- directly; they reach it only through pack_mark / pack_undo (staff) and
-- befalia_pack / befalia_business_feed (the key).
revoke execute on function seadiva.bridge_managed_word(text) from public, anon, authenticated;
revoke execute on function seadiva._col_num(text) from public, anon, authenticated;
revoke execute on function seadiva._tab_layout(text) from public, anon, authenticated;
revoke execute on function seadiva._befa_email() from public, anon, authenticated;
revoke execute on function seadiva.befalia_business_feed(text) from public, anon, authenticated;
