-- Shop catalog cache, 13 Oct 2026
-- ---------------------------------------------------------------------------
-- The Sea Diva Pack and ship page shows each product's photo from the public
-- storefront, seadivatails.com/products.json. Shopify answers 403 to
-- Cloudflare Workers and 429 to Supabase edge functions, but answers the
-- database's own pg_net fine (checked 13 Oct). So the database fetches the
-- list itself every 6 hours and keeps a slim copy: titles, image links,
-- variant titles and variant image links. No prices, no stock.
-- Staff read it with seadiva.shop_catalog_get().
-- ---------------------------------------------------------------------------

create table if not exists seadiva.shop_catalog (
  id          int primary key default 1 check (id = 1),
  products    jsonb not null default '[]'::jsonb,
  fetched_at  timestamptz,
  note        text
);
alter table seadiva.shop_catalog enable row level security;
-- No policies: nobody reads the table directly. shop_catalog_get() is the door.

create table if not exists seadiva.shop_catalog_requests (
  page        int primary key,
  request_id  bigint,
  asked_at    timestamptz
);
alter table seadiva.shop_catalog_requests enable row level security;

-- Ask Shopify for up to 4 pages (1,000 products). pg_net answers later.
create or replace function seadiva.shop_catalog_request()
returns int language plpgsql security definer set search_path = '' as $$
declare p int; n int := 0;
begin
  if current_user not in ('postgres', 'supabase_admin') and not seadiva.is_staff() then
    raise exception 'staff only';
  end if;
  for p in 1..4 loop
    insert into seadiva.shop_catalog_requests (page, request_id, asked_at)
    values (p, net.http_get(
      'https://seadivatails.com/products.json?limit=250&page=' || p,
      headers := '{"accept":"application/json","user-agent":"Mozilla/5.0 (compatible; SeaDivaOS/1.0; +https://seadivatails.com)"}'::jsonb,
      timeout_milliseconds := 20000), now())
    on conflict (page) do update set request_id = excluded.request_id, asked_at = excluded.asked_at;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Gather the answers into one slim list. Keeps the old copy if any page failed.
create or replace function seadiva.shop_catalog_collect()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare bad int; got int; list jsonb;
begin
  if current_user not in ('postgres', 'supabase_admin') and not seadiva.is_staff() then
    raise exception 'staff only';
  end if;
  select count(*) filter (where r.id is null or r.status_code is distinct from 200),
         count(*) filter (where r.status_code = 200)
    into bad, got
    from seadiva.shop_catalog_requests q
    left join net._http_response r on r.id = q.request_id;
  if bad > 0 or got = 0 then
    update seadiva.shop_catalog set note = 'last refresh failed at ' || now() || ' (' || bad || ' pages not answered 200)' where id = 1;
    return jsonb_build_object('ok', false, 'pages_ok', got, 'pages_bad', bad);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', p->>'title',
           'images', coalesce((select jsonb_agg(jsonb_build_object('src', i->>'src')) from (select i from jsonb_array_elements(p->'images') i limit 1) x), '[]'::jsonb),
           'variants', coalesce((select jsonb_agg(jsonb_build_object('title', v->>'title',
                                   'featured_image', case when v->'featured_image'->>'src' is not null then jsonb_build_object('src', v->'featured_image'->>'src') end))
                                 from jsonb_array_elements(p->'variants') v), '[]'::jsonb))), '[]'::jsonb)
    into list
    from seadiva.shop_catalog_requests q
    join net._http_response r on r.id = q.request_id,
         jsonb_array_elements(r.content::jsonb->'products') p;
  insert into seadiva.shop_catalog (id, products, fetched_at, note) values (1, list, now(), null)
  on conflict (id) do update set products = excluded.products, fetched_at = excluded.fetched_at, note = null;
  return jsonb_build_object('ok', true, 'products', jsonb_array_length(list));
end $$;

-- The page's door: signed-in staff only.
create or replace function seadiva.shop_catalog_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not seadiva.is_staff() then raise exception 'staff only'; end if;
  return coalesce((select jsonb_build_object('ok', true, 'products', products, 'fetched_at', fetched_at, 'note', note)
                     from seadiva.shop_catalog where id = 1),
                  jsonb_build_object('ok', false, 'products', '[]'::jsonb, 'note', 'not fetched yet'));
end $$;

revoke execute on function seadiva.shop_catalog_request(), seadiva.shop_catalog_collect(), seadiva.shop_catalog_get() from public, anon;
grant execute on function seadiva.shop_catalog_get() to authenticated;

-- Every 6 hours: ask at :07, gather at :09 (WITA hours 02, 08, 14, 20).
select cron.schedule('shop-catalog-request', '7 */6 * * *', $$select seadiva.shop_catalog_request()$$);
select cron.schedule('shop-catalog-collect', '9 */6 * * *', $$select seadiva.shop_catalog_collect()$$);

-- First fill now, then a minute later: select seadiva.shop_catalog_collect();
-- Applied 13 Oct 2026 21:40 WITA: 478 products cached, anon has no execute.
select seadiva.shop_catalog_request();
