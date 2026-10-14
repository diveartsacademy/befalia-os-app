-- My work, 14 Oct 2026 (applied the same evening)
-- ---------------------------------------------------------------------------
-- Befa, 14 Oct 18:08 and 18:22: a list of every product line that waits on her
-- own hands (designer, fluke filler, crown, ordering from third parties) and
-- on the craftspeople who are still working (printing, sewing), with a Done
-- button that moves the line along. TailCraft designs are in the same
-- Designer list.
--
-- Her rulings on what Done moves a line to:
--   design done            -> Printing
--   fluke filler or crown  -> Ready to be shipped
--   third party bought     -> Ordered, and when it arrives -> Ready to be shipped
-- Plus, offered because the craftspeople still work: Printing -> Sewing /
-- Building or Ready to be shipped, Sewing / Building -> Ready to be shipped,
-- and Start designing (-> Design in Progress).
--
-- How a click travels, same road as "Packed, ready to ship":
--   1. seadiva.work_marks records it. Both dashboards lay it over the sheet
--      copy at once, so the line moves before the sheet catches up.
--   2. MANUAL: one write is queued in seadiva.sheet_writes, guarded by the
--      invoice on the row (expect_col). The OS Sheet Bridge writes it within
--      the hour. SHOPIFY, SHOPEE and TOKOPEDIA tabs are not written by the
--      bridge yet: the click is recorded and shown, the sheet is set by hand.
--   3. The board job for that line, if there is one, moves to the matching
--      stage. If the board refuses (its design approval gate), the sheet
--      still moves and the note says why the board did not.
-- A click only counts while the sheet still says what it moved the line
-- from; once the sheet says anything else, the sheet wins.
--
-- TailCraft: the project stage moves from Custom Design Making to Design
-- options sent (design done) or Not proceeding. The project row mirrors to
-- the OS_TC_PROJECTS tab as before. The TAILCRAFT DASHBOARD tab is not written.
--
-- Make: the customer-facing scenarios stay off under the 8 Sep freeze, so no
-- status change made here sends anything to a customer.
-- ---------------------------------------------------------------------------

create table if not exists seadiva.work_marks (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  by_who        text not null,
  via           text not null check (via in ('befalia-os', 'seadiva')),
  src           text not null,
  sheet_row     int  not null,
  invoice       text not null,
  slot          int  not null,
  item          text,
  customer      text,
  from_word     text not null,
  to_word       text not null,
  write_state   text,
  write_id      bigint,
  job_id        uuid,
  prev_stage_code text,
  job_note      text,
  undone_at     timestamptz,
  undone_by     text,
  undo_note     text
);
create index if not exists work_marks_line on seadiva.work_marks (src, invoice, slot) where undone_at is null;
alter table seadiva.work_marks enable row level security;
drop policy if exists work_marks_staff_read on seadiva.work_marks;
create policy work_marks_staff_read on seadiva.work_marks for select to authenticated using (seadiva.is_staff());

-- The system now writes Ordered, so a later pack click may overwrite it.
create or replace function seadiva.bridge_managed_word(p text)
returns boolean language sql immutable as $$
  select coalesce(btrim(p), '') = '' or btrim(p) in (
    'Design Needs to Be Made','Design in Progress','Printing','Order from 3rd Party',
    'FLUKE FILLER MAKING','Sewing / Building','Ready to be shipped','Shipping Process','DONE',
    'Design Making','Ordering from 3rdParty','Ordered')
$$;

-- The closed list of moves. Same list as WORK_FROM in api/_sd-business.js.
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
    when 'need to create'          then array['Ready to be shipped']
    when 'printing'                then array['Sewing / Building', 'Ready to be shipped']
    when 'sewing / building'       then array['Ready to be shipped']
    else array[]::text[] end)
$$;

-- The board stage a sheet word belongs to (stage_of, plus Ordered).
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
    else null end
$$;

-- What a line says now: the sheet copy, with the clicks still standing laid
-- over it in order.
create or replace function seadiva._work_now(p_src text, p_invoice text, p_slot int, p_sheet text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text := coalesce(p_sheet, ''); k record;
begin
  for k in select from_word, to_word from seadiva.work_marks
            where src = p_src and invoice = btrim(p_invoice) and slot = p_slot and undone_at is null order by id loop
    if lower(btrim(k.from_word)) = lower(btrim(v)) then v := k.to_word; end if;
  end loop;
  return v;
end $$;

create or replace function seadiva._work_move(p_by text, p_via text, p_src text, p_row int, p_invoice text, p_slot int, p_from text, p_to text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  lay jsonb; cells jsonb; v_inv_col text; v_on_row text; v_stat_col text; v_item_col text;
  v_item text; v_sheet text; v_now text; v_cust text;
  v_job uuid; v_prev text; v_code text; v_stage uuid; v_note text;
  v_col int; v_write bigint; v_state text; v_id bigint;
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

  -- The board job for this line, if there is one.
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
    -- Whatever was waiting for this cell (including what the board trigger
    -- just queued) gives way to this click.
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

  return jsonb_build_object('ok', true, 'id', v_id, 'item', v_item, 'from', v_now, 'to', p_to,
                            'write', v_state, 'job', v_note);
end $$;

-- TailCraft designs still to make.
create or replace function seadiva._tc_work_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'project', p.project_no, 'customer', p.customer_name, 'stage', p.stage_code, 'stage_label', st.label,
           'design', p.design_name, 'country', p.country_city, 'next_action', p.next_action,
           'last_follow_up', p.last_follow_up_at, 'updated_at', p.updated_at, 'created_at', p.created_at)
         order by p.project_no), '[]'::jsonb)
    from tailcraft.projects p
    join tailcraft.stages st on st.code = p.stage_code
   where p.stage_code = 'design_making' and not coalesce(p.is_archived, false)
$$;

create or replace function seadiva._tc_work_move(p_by text, p_via text, p_project text, p_from text, p_to text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_stage text; v_cust text; v_design text; v_id bigint;
begin
  if p_from is distinct from 'design_making' or p_to not in ('design_sent', 'lost') then
    raise exception 'Moving TailCraft "%" to "%" is not a step this button makes.', p_from, p_to;
  end if;
  select stage_code, customer_name, design_name into v_stage, v_cust, v_design
    from tailcraft.projects where project_no = btrim(p_project) and not coalesce(is_archived, false);
  if v_stage is null then raise exception 'TailCraft project % not found.', p_project; end if;
  if v_stage <> p_from then raise exception 'TailCraft % is now at "%", not "%". Refresh and try again.', p_project, v_stage, p_from; end if;
  update tailcraft.projects set stage_code = p_to, updated_by = p_by || ' via ' || p_via where project_no = btrim(p_project);
  insert into seadiva.work_marks (by_who, via, src, sheet_row, invoice, slot, item, customer, from_word, to_word, write_state, job_note)
  values (p_by, p_via, 'TAILCRAFT', 0, btrim(p_project), 0, coalesce(v_design, 'Custom TailCraft design'), v_cust, p_from, p_to,
          'tailcraft', 'TailCraft project stage changed')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'project', btrim(p_project), 'from', p_from, 'to', p_to);
end $$;

-- Undo the last click on a line (or a TailCraft move).
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
    -- Board job first: its trigger queues a word for the cell, which the
    -- sheet step below then replaces.
    if k.job_id is not null and k.prev_stage_code is not null and k.job_note like 'board job moved%' then
      select id into v_stage from seadiva.production_stages where code = k.prev_stage_code;
      begin
        update seadiva.production_jobs set current_stage_id = v_stage, updated_by = p_by || ' (undo)' where id = k.job_id;
        -- What the board trigger queued gives way to the sheet step below.
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
  end if;

  update seadiva.work_marks set undone_at = now(), undone_by = p_by, undo_note = nullif(v_note, '') where id = k.id;
  return jsonb_build_object('ok', true, 'id', k.id, 'note', v_note);
end $$;

-- Clicks still standing from the last 14 days, oldest first.
create or replace function seadiva._work_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'src', m.src, 'invoice', m.invoice, 'slot', m.slot, 'row', m.sheet_row,
           'item', m.item, 'customer', m.customer, 'from', m.from_word, 'to', m.to_word, 'at', m.created_at,
           'by', case when m.by_who = seadiva._befa_email() then 'Befa' else m.by_who end, 'via', m.via,
           'write', m.write_state, 'written', w.written_at is not null, 'writeError', w.error, 'job', m.job_note)
         order by m.id), '[]'::jsonb)
    from seadiva.work_marks m
    left join seadiva.sheet_writes w on w.id = m.write_id
   where m.undone_at is null and m.created_at > now() - interval '14 days'
$$;

-- befalia_pack gains work, work_undo and tc_work; overlay also returns work
-- and tcwork. Everything else is unchanged from the 14 Oct tracking version.
create or replace function seadiva.befalia_pack(p_key text, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
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

  elsif a = 'note' then
    begin
      return seadiva._pack_note(v_by, 'befalia-os', p->>'src', p->>'invoice', (p->>'slot')::int, p->>'note');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'handoff' then
    begin
      return seadiva._pack_handoff(v_by, 'befalia-os', p->>'src', p->>'invoice', p->>'method');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'tracking' then
    begin
      return seadiva._pack_tracking(v_by, 'befalia-os', p->>'src', p->>'invoice', p->>'tracking');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'work' then
    begin
      return seadiva._work_move(v_by, 'befalia-os', p->>'src', (p->>'row')::int, p->>'invoice', (p->>'slot')::int, p->>'from', p->>'to');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'work_undo' then
    begin
      return seadiva._work_undo(v_by, (p->>'id')::bigint);
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'tc_work' then
    begin
      return seadiva._tc_work_move(v_by, 'befalia-os', p->>'project', p->>'from', p->>'to');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

  elsif a = 'ticks' then
    return jsonb_build_object('ok', true, 'ticks', seadiva._pack_ticks_list());

  elsif a = 'overlay' then
    return jsonb_build_object('ok', true, 'ticks', seadiva._pack_ticks_list(), 'shipped', seadiva._ship_list(),
                              'notes', seadiva._pack_notes_list(), 'handoff', seadiva._pack_handoff_list(),
                              'work', seadiva._work_list(), 'tcwork', seadiva._tc_work_list());

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
end $function$;

revoke execute on function seadiva._work_allowed(text, text), seadiva._work_stage(text), seadiva._work_now(text, text, int, text),
  seadiva._work_move(text, text, text, int, text, int, text, text), seadiva._tc_work_list(),
  seadiva._tc_work_move(text, text, text, text, text), seadiva._work_undo(text, bigint), seadiva._work_list()
  from public, anon, authenticated;
revoke execute on function seadiva.befalia_pack(text, jsonb) from public, anon, authenticated;
