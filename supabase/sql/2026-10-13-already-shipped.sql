-- Already shipped, 13 Oct 2026
-- ---------------------------------------------------------------------------
-- Befa, 22:09 WITA: "there are so many orders that's actually already done,
-- already shipped. How do I mark it as shipped so that you can update the data".
--
-- One tap on a card ("Already shipped, mark DONE") records the whole order as
-- finished in seadiva.ship_marks, which takes it off both pack lists at once.
-- At the same time, for every product line not DONE yet:
--   - the Sea Diva board job moves to its DONE stage (delivered),
--   - on MANUAL, DONE is queued for the sheet bridge behind the invoice guard
--     (only over a word the bridge manages, as for packing),
--   - other tabs: recorded, the card list hides the order, the sheet is
--     changed by hand until the bridge learns those tabs.
-- Undo puts every line back as it was. Ship marks never go on the To-Do.
-- ---------------------------------------------------------------------------

create table if not exists seadiva.ship_marks (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  by_who      text not null,
  via         text not null check (via in ('befalia-os', 'seadiva')),
  src         text not null,
  sheet_row   int  not null,
  invoice     text not null,
  customer    text,
  lines       jsonb not null default '[]'::jsonb,
  undone_at   timestamptz,
  undone_by   text
);
create index if not exists ship_marks_live on seadiva.ship_marks (src, invoice) where undone_at is null;
alter table seadiva.ship_marks enable row level security;
create policy ship_marks_staff_read on seadiva.ship_marks for select to authenticated using (seadiva.is_staff());

create or replace function seadiva._ship_done(p_by text, p_via text, p_src text, p_row int, p_invoice text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  lay jsonb; cells jsonb; v_inv_col text; v_on_row text; v_cust text;
  s int; v_stat_col text; v_item_col text; v_item text; v_now text;
  v_job uuid; v_prev_stage text; v_job_note text; v_state text; v_write bigint; v_col int;
  v_done uuid; out jsonb := '[]'::jsonb; v_id bigint;
begin
  if p_src not in ('MANUAL (IG & WA) - OL','SHOPIFY-OL','SHOPEE - OL','TOKOPEDIA/TIKTOK shop -OL') then
    raise exception 'Unknown order tab %', p_src;
  end if;
  if exists (select 1 from seadiva.ship_marks m where m.src = p_src and m.invoice = btrim(p_invoice) and m.undone_at is null) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  lay := seadiva._tab_layout(p_src);
  v_inv_col := lay->>'inv';
  select r.data->'cells' into cells from seadiva.sheet_raw r where r.source = p_src and r.row_no = p_row;
  v_on_row := btrim(coalesce(cells->v_inv_col->>'d', cells->v_inv_col->>'v', ''));
  if cells is null or v_on_row is distinct from btrim(p_invoice) then
    raise exception 'Row % of % no longer holds %, it holds "%". Reload and try again.', p_row, p_src, p_invoice, v_on_row;
  end if;
  v_cust := btrim(split_part(split_part(coalesce(cells->(lay->>'name')->>'d', cells->(lay->>'name')->>'v', ''), E'\n', 1), ' Mail:', 1));
  select id into v_done from seadiva.production_stages where code = 'delivered';

  for s in 1 .. jsonb_array_length(coalesce(lay->'status', '[]'::jsonb)) loop
    v_stat_col := lay->'status'->>(s - 1);
    v_item_col := lay->'item'->>(s - 1);
    v_item := btrim(coalesce(cells->v_item_col->>'d', cells->v_item_col->>'v', ''));
    v_now  := btrim(coalesce(cells->v_stat_col->>'d', cells->v_stat_col->>'v', ''));
    if v_item = '' or upper(v_now) = 'DONE' then continue; end if;
    v_job := null; v_prev_stage := null; v_job_note := null; v_write := null; v_state := null;

    select j.id, st.code into v_job, v_prev_stage
      from seadiva.production_jobs j
      join seadiva.order_lines l on l.id = j.order_line_id
      join seadiva.orders o on o.id = l.order_id
      join seadiva.production_stages st on st.id = j.current_stage_id
     where o.source_ref->>'tab' = p_src and coalesce(o.legacy_no, o.order_no) = btrim(p_invoice)
       and (l.source_ref->>'slot')::int = s and j.status is distinct from 'cancelled'
     order by j.updated_at desc nulls last limit 1;
    if v_job is not null and v_prev_stage is distinct from 'delivered' and v_done is not null then
      begin
        update seadiva.production_jobs set current_stage_id = v_done, updated_by = p_by || ' via ' || p_via,
               note = 'Already shipped' where id = v_job;
        update seadiva.sheet_writes set error = 'superseded by already shipped at the live row ' || p_row, voided = true
         where job_id = v_job and written_at is null and error is null and row_no <> p_row;
        v_job_note := 'board job moved to DONE';
      exception when others then v_job_note := 'board job not moved: ' || sqlerrm;
      end;
    end if;

    if p_src = 'MANUAL (IG & WA) - OL' then
      if seadiva.bridge_managed_word(v_now) then
        v_col := seadiva._col_num(v_stat_col);
        update seadiva.sheet_writes set error = 'replaced by already shipped', voided = true
         where tab = p_src and row_no = p_row and col_no = v_col and written_at is null and error is null;
        insert into seadiva.sheet_writes (tab, row_no, col_no, value, reason, expect_col, expect_value)
        values (p_src, p_row, v_col, 'DONE', 'already shipped, by ' || p_by || ' via ' || p_via, seadiva._col_num(v_inv_col), btrim(p_invoice))
        returning id into v_write;
        v_state := 'queued';
      else
        v_state := 'person_word';
      end if;
    else
      v_state := 'waiting_bridge';
    end if;
    out := out || jsonb_build_object('slot', s, 'item', v_item, 'prev_status', nullif(v_now, ''), 'write_state', v_state,
                                     'write_id', v_write, 'job_id', v_job, 'prev_stage_code', v_prev_stage, 'job_note', v_job_note);
  end loop;

  insert into seadiva.ship_marks (by_who, via, src, sheet_row, invoice, customer, lines)
  values (p_by, p_via, p_src, p_row, btrim(p_invoice), nullif(v_cust, ''), out)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'lines', out);
end $$;

create or replace function seadiva._ship_undo(p_by text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m record; l jsonb; v_stage uuid; v_written boolean;
begin
  select * into m from seadiva.ship_marks where id = p_id and undone_at is null;
  if m.id is null then return jsonb_build_object('ok', true, 'undone', 0); end if;
  for l in select * from jsonb_array_elements(m.lines) loop
    if (l->>'job_id') is not null and (l->>'prev_stage_code') is not null and (l->>'prev_stage_code') <> 'delivered' then
      begin
        select id into v_stage from seadiva.production_stages where code = l->>'prev_stage_code';
        update seadiva.production_jobs set current_stage_id = v_stage, updated_by = p_by, note = 'Already shipped undone'
         where id = (l->>'job_id')::uuid;
        update seadiva.sheet_writes set error = 'superseded by already shipped undo', voided = true
         where job_id = (l->>'job_id')::uuid and written_at is null and error is null;
      exception when others then null;
      end;
    end if;
    if (l->>'write_id') is not null then
      select written_at is not null into v_written from seadiva.sheet_writes where id = (l->>'write_id')::bigint;
      if not coalesce(v_written, false) then
        update seadiva.sheet_writes set error = 'undone before it reached the sheet', voided = true
         where id = (l->>'write_id')::bigint and written_at is null;
      else
        update seadiva.sheet_writes w set error = 'replaced by already shipped undo', voided = true
          from seadiva.sheet_writes o
         where o.id = (l->>'write_id')::bigint and w.tab = o.tab and w.row_no = o.row_no and w.col_no = o.col_no
           and w.written_at is null and w.error is null;
        insert into seadiva.sheet_writes (tab, row_no, col_no, value, reason, expect_col, expect_value)
        select tab, row_no, col_no, coalesce(l->>'prev_status', ''), 'already shipped undone by ' || p_by, expect_col, expect_value
          from seadiva.sheet_writes where id = (l->>'write_id')::bigint;
      end if;
    end if;
  end loop;
  update seadiva.ship_marks set undone_at = now(), undone_by = p_by where id = m.id;
  return jsonb_build_object('ok', true, 'undone', 1, 'invoice', m.invoice);
end $$;

create or replace function seadiva._ship_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'src', src, 'invoice', invoice, 'at', created_at, 'customer', customer,
           'by', case when by_who = seadiva._befa_email() then 'Befa' else by_who end,
           'lines', jsonb_array_length(lines),
           'byHand', (select count(*) from jsonb_array_elements(lines) x where x->>'write_state' in ('person_word', 'waiting_bridge')))
           order by created_at desc), '[]'::jsonb)
    from seadiva.ship_marks where undone_at is null
$$;

create or replace function seadiva.ship_done(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only Sea Diva staff can mark an order shipped.'; end if;
  return seadiva._ship_done(coalesce(auth.jwt()->>'email', 'staff'), 'seadiva', p->>'src', (p->>'row')::int, p->>'invoice');
end $$;
create or replace function seadiva.ship_undo(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only Sea Diva staff can undo.'; end if;
  return seadiva._ship_undo(coalesce(auth.jwt()->>'email', 'staff'), (p->>'id')::bigint);
end $$;

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

  elsif a = 'overlay' then
    return jsonb_build_object('ok', true, 'ticks', seadiva._pack_ticks_list(), 'shipped', seadiva._ship_list());

  elsif a = 'ship' then
    begin
      return seadiva._ship_done(v_by, 'befalia-os', p->>'src', (p->>'row')::int, p->>'invoice');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'unship' then
    begin
      return seadiva._ship_undo(v_by, (p->>'id')::bigint);
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;
  end if;
  return jsonb_build_object('ok', false, 'error', 'unknown action');
end $$;


-- Grants (run as its own statement).
revoke execute on function seadiva._ship_done(text, text, text, int, text), seadiva._ship_undo(text, bigint), seadiva._ship_list(),
  seadiva.ship_done(jsonb), seadiva.ship_undo(jsonb), seadiva.befalia_pack(text, jsonb) from public, anon;
revoke execute on function seadiva._ship_done(text, text, text, int, text), seadiva._ship_undo(text, bigint), seadiva._ship_list(),
  seadiva.befalia_pack(text, jsonb) from authenticated;
grant execute on function seadiva.ship_done(jsonb), seadiva.ship_undo(jsonb) to authenticated;
