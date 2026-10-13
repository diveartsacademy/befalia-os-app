// befalia-business (13 Oct 2026)
// ---------------------------------------------------------------------------
// A thin door for the Business tab in Befalia OS: the read feed, and the
// "Packed, ready to ship" clicks.
//
// Befalia OS runs on Vercel, outside Cloudflare Access, so it cannot get a
// signed-in database session the way DiveArts OS pages do. Instead its server
// route calls this function with one key (x-feed-key). This function passes
// that key to seadiva.befalia_business_feed(), which checks it against the
// hash Befa made in the SQL editor and returns only order columns and photo
// links. The key check lives in the database, not here, so this file holds no
// secret of its own and decides nothing.
//
//   GET ?check=1   booleans only: is the service key set, does the feed answer
//   GET            the feed, with header x-feed-key
//   GET ?catalog=1 product titles and photo links from the public storefront
//                  seadivatails.com/products.json, slimmed (no prices, no stock).
//                  Public data, no key. Exists because Shopify answers 403 to
//                  Cloudflare Workers, so the Sea Diva Pack and ship page reads
//                  its photos through here. Cached 30 minutes. (13 Oct 2026)
//   POST           pack actions (13 Oct 2026), header x-feed-key, JSON body
//                  passed unchanged to seadiva.befalia_pack(p_key, p). The
//                  database checks the key and decides what is allowed.
//
// Deployed with verify_jwt off because the caller has no Supabase login; the
// gate is the feed key. Until Befa runs  select seadiva.new_befalia_feed_key();
// no key exists and every request is refused.
// ---------------------------------------------------------------------------

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function out(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function rpc(fn: string, args: unknown) {
  const base = Deno.env.get('SUPABASE_URL') || '';
  const sr = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const r = await fetch(base + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      apikey: sr,
      authorization: 'Bearer ' + sr,
      'content-type': 'application/json',
      'content-profile': 'seadiva',
      'accept-profile': 'seadiva',
    },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch (_e) { /* not JSON */ }
  return { status: r.status, body: j, raw: j ? '' : text.slice(0, 200) };
}
const feed = (key: string) => rpc('befalia_business_feed', { p_key: key });

let shopCache: { at: number; products: unknown[] } = { at: 0, products: [] };
async function catalog() {
  if (shopCache.products.length && Date.now() - shopCache.at < 30 * 60000) return { ok: true, products: shopCache.products, cached: true };
  const all: any[] = [];
  for (let page = 1; page <= 8; page++) {
    const r = await fetch('https://seadivatails.com/products.json?limit=250&page=' + page, { headers: { accept: 'application/json' } });
    if (!r.ok) return { ok: false, error: 'The shop answered HTTP ' + r.status + '.', products: shopCache.products };
    const j = await r.json();
    const list = (j && j.products) || [];
    all.push(...list);
    if (list.length < 250) break;
  }
  const products = all.map((p: any) => ({
    title: p.title,
    images: (p.images || []).slice(0, 1).map((i: any) => ({ src: i.src })),
    variants: (p.variants || []).map((v: any) => ({ title: v.title, featured_image: v.featured_image && v.featured_image.src ? { src: v.featured_image.src } : null })),
  }));
  shopCache = { at: Date.now(), products };
  return { ok: true, products, cached: false };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === 'POST') {
    const key = (req.headers.get('x-feed-key') || '').trim();
    if (key.length < 32) return out(401, { ok: false, error: 'unauthorised' });
    let p: unknown = null;
    try { p = await req.json(); } catch (_e) { return out(400, { ok: false, error: 'JSON body needed' }); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) return out(400, { ok: false, error: 'JSON object needed' });
    const f = await rpc('befalia_pack', { p_key: key, p });
    if (f.status !== 200 || !f.body) {
      return out(502, { ok: false, error: 'The database did not answer (HTTP ' + f.status + ').' });
    }
    if (f.body.ok !== true && f.body.error === 'unauthorised') return out(401, { ok: false, error: 'unauthorised' });
    return out(200, f.body);
  }
  if (req.method !== 'GET') return out(405, { ok: false, error: 'GET or POST only' });

  if (url.searchParams.get('catalog') === '1') {
    try { return out(200, await catalog()); }
    catch (e) { return out(200, { ok: false, error: 'The shop could not be read (' + String((e as Error).message || e) + ').', products: [] }); }
  }

  if (url.searchParams.get('check') === '1') {
    const hasUrl = !!Deno.env.get('SUPABASE_URL');
    const hasKey = !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    let feedAnswers = false;
    if (hasUrl && hasKey) {
      // An empty key must come back as a clean refusal. That proves the
      // service key reaches the database without exposing any data.
      const f = await feed('');
      feedAnswers = f.status === 200 && f.body && f.body.ok === false && f.body.error === 'unauthorised';
    }
    return out(200, { ok: true, urlSet: hasUrl, serviceKeySet: hasKey, feedAnswers });
  }

  const key = (req.headers.get('x-feed-key') || '').trim();
  if (key.length < 32) return out(401, { ok: false, error: 'unauthorised' });

  const f = await feed(key);
  if (f.status !== 200 || !f.body) {
    return out(502, { ok: false, error: 'The database did not answer the feed (HTTP ' + f.status + ').' });
  }
  if (f.body.ok !== true) return out(401, { ok: false, error: 'unauthorised' });
  return out(200, f.body);
});
