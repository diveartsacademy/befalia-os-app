// befalia-business (13 Oct 2026)
// ---------------------------------------------------------------------------
// A thin, read-only door for the Business tab in Befalia OS.
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
//
// Deployed with verify_jwt off because the caller has no Supabase login; the
// gate is the feed key. Until Befa runs  select seadiva.new_befalia_feed_key();
// no key exists and every request is refused.
// ---------------------------------------------------------------------------

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function out(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function feed(key: string) {
  const base = Deno.env.get('SUPABASE_URL') || '';
  const sr = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const r = await fetch(base + '/rest/v1/rpc/befalia_business_feed', {
    method: 'POST',
    headers: {
      apikey: sr,
      authorization: 'Bearer ' + sr,
      'content-type': 'application/json',
      'content-profile': 'seadiva',
      'accept-profile': 'seadiva',
    },
    body: JSON.stringify({ p_key: key }),
  });
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch (_e) { /* not JSON */ }
  return { status: r.status, body: j, raw: j ? '' : text.slice(0, 200) };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method !== 'GET') return out(405, { ok: false, error: 'GET only' });

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
