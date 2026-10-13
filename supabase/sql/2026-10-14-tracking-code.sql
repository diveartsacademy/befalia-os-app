-- Tracking code on To send parcels, 14 Oct 2026 00:30 WITA (applied the same night)
-- Befa: "aku juga bisa langsung masukin tracking code-nya di situ".
-- pack_handoff gains tracking + tracking_at. Saving a code keeps (or sets) the
-- method 'send'. The dashboards then mark the order shipped (ship_done), so a
-- saved code means the parcel is out. _ship_list shows the code next to each
-- recently shipped order.
alter table seadiva.pack_handoff add column if not exists tracking text check (tracking is null or length(tracking) <= 120);
alter table seadiva.pack_handoff add column if not exists tracking_at timestamptz;

create or replace function seadiva._pack_tracking(p_by text, p_via text, p_src text, p_invoice text, p_tracking text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_tracking, '')), '');
begin
  if p_src not in ('MANUAL (IG & WA) - OL','SHOPIFY-OL','SHOPEE - OL','TOKOPEDIA/TIKTOK shop -OL','TAILCRAFT') then raise exception 'Unknown order tab %', p_src; end if;
  if coalesce(btrim(p_invoice), '') = '' then raise exception 'No invoice.'; end if;
  if v is not null and length(v) > 120 then raise exception 'A tracking code can be at most 120 characters.'; end if;
  insert into seadiva.pack_handoff (src, invoice, method, changed_at, changed_by, via, tracking, tracking_at)
  values (p_src, btrim(p_invoice), 'send', now(), p_by, p_via, v, case when v is null then null else now() end)
  on conflict (src, invoice) do update set tracking = excluded.tracking, tracking_at = excluded.tracking_at,
    method = case when seadiva.pack_handoff.method = 'none' then 'send' else seadiva.pack_handoff.method end,
    changed_at = now(), changed_by = excluded.changed_by, via = excluded.via;
  return jsonb_build_object('ok', true, 'src', p_src, 'invoice', btrim(p_invoice), 'tracking', v);
end $$;

create or replace function seadiva.pack_tracking_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'Only Sea Diva staff can save a tracking code.'; end if;
  return seadiva._pack_tracking(coalesce(auth.jwt()->>'email', 'staff'), 'seadiva', p->>'src', p->>'invoice', p->>'tracking');
end $$;

-- _pack_handoff_list returns 'tracking'; _ship_list returns 'tracking' looked up
-- from pack_handoff; befalia_pack gained the action 'tracking'
-- (seadiva._pack_tracking(v_by, 'befalia-os', src, invoice, tracking)).

revoke execute on function seadiva._pack_tracking(text,text,text,text,text), seadiva.pack_tracking_set(jsonb) from public, anon;
revoke execute on function seadiva._pack_tracking(text,text,text,text,text) from authenticated;
grant execute on function seadiva.pack_tracking_set(jsonb) to authenticated;
