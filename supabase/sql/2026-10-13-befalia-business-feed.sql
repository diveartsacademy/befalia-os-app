-- Befalia OS, Business tab, Sea Diva section (13 Oct 2026)
-- ---------------------------------------------------------------------------
-- One read-only door from the DiveArts OS database into Befa's personal OS.
--
-- What it returns, and nothing else:
--   * MANUAL (IG & WA) - OL and SHOPIFY-OL from the nightly / 15-minute sheet
--     mirror (seadiva.sheet_raw), but ONLY the columns whose header is one of
--     the names below. Phone, email, address and money columns never leave.
--   * Product photo links from the product list mirror (seadiva.inv_products).
--
-- Who can call it: service_role only. No grant to anon or authenticated, so
-- the "zero anon grants" count from 12 Oct stays at zero. The caller is the
-- befalia-business edge function, which forwards the key it was given.
--
-- The key: 256 random bits, made in the SQL editor by Befa with
--     select seadiva.new_befalia_feed_key();
-- Only its sha256 is stored. Making a new key revokes the old one. Until a
-- key exists, the feed refuses every request.
-- ---------------------------------------------------------------------------

create table if not exists seadiva.befalia_feed_keys (
  id          bigserial primary key,
  key_sha256  text not null,
  note        text,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
comment on table seadiva.befalia_feed_keys is
  'Hashes of the key Befalia OS uses to read the Sea Diva business feed. Plain key is shown once in the SQL editor and never stored. Making a new key revokes the old.';
alter table seadiva.befalia_feed_keys enable row level security;
revoke all on seadiva.befalia_feed_keys from public, anon, authenticated, service_role;
revoke all on sequence seadiva.befalia_feed_keys_id_seq from public, anon, authenticated, service_role;

create or replace function seadiva.new_befalia_feed_key()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare k text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  update seadiva.befalia_feed_keys set revoked_at = now() where revoked_at is null;
  insert into seadiva.befalia_feed_keys (key_sha256, note)
  values (encode(extensions.digest(k, 'sha256'), 'hex'), 'made in the SQL editor');
  return k;
end $$;
revoke execute on function seadiva.new_befalia_feed_key() from public, anon, authenticated, service_role;

create or replace function seadiva.befalia_business_feed(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ok boolean;
  out jsonb;
begin
  select exists (
    select 1 from seadiva.befalia_feed_keys
    where revoked_at is null
      and key_sha256 = encode(extensions.digest(btrim(coalesce(p_key, '')), 'sha256'), 'hex')
  ) into ok;
  if not coalesce(ok, false) or length(btrim(coalesce(p_key, ''))) < 32 then
    return jsonb_build_object('ok', false, 'error', 'unauthorised');
  end if;

  with src as (
    select source, row_no, data -> 'cells' as c, loaded_at
    from seadiva.sheet_raw
    where source in ('MANUAL (IG & WA) - OL', 'SHOPIFY-OL')
  ),
  hdr as (
    -- every header text in the first six rows, per column
    select s.source, k as col,
           lower(regexp_replace(btrim(coalesce(s.c -> k ->> 'd', s.c -> k ->> 'v', '')), '\s+', ' ', 'g')) as t
    from src s, jsonb_object_keys(s.c) k
    where s.row_no <= 6
  ),
  keep as (
    select distinct source, col from hdr
    where t in ('status produksi', 'qty', 'invoice no', 'name', 'customer name',
                'production payment status', 'financial status', 'fulfillment status',
                'cancelled at', 'invoice date', 'created at', 'shipped',
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
            order by product_name, sheet_row) p), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke execute on function seadiva.befalia_business_feed(text) from public, anon, authenticated;
grant execute on function seadiva.befalia_business_feed(text) to service_role;

comment on function seadiva.befalia_business_feed(text) is
  'Befalia OS Business tab. Key-gated, read only, service_role only. Returns the order columns of MANUAL and SHOPIFY-OL (no phone, email, address or money) and product photo links.';
