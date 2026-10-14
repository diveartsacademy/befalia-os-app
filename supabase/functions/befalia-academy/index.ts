// befalia-academy (14 Oct 2026)
// ---------------------------------------------------------------------------
// The Academy door for Befalia OS, built like befalia-business: Befalia OS runs
// on Vercel outside Cloudflare Access, so its server route calls this function
// with the Befalia feed key (header x-feed-key). The key is checked in the
// database by portal.befalia_academy(p_key, p) (reached through the seadiva.befalia_academy
// wrapper, the schema the service role may use), never here, so this file holds
// no secret and decides nothing.
//
//   GET ?check=1   booleans only: service key set, database answers and refuses
//                  an empty key
//   POST           JSON body passed unchanged to portal.befalia_academy
//                  actions: match (find portal students by name),
//                           video (queue class video emails)
//
// Deployed with verify_jwt off because the caller has no Supabase login; the
// gate is the feed key.
// ---------------------------------------------------------------------------

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const out = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

async function rpc(args: unknown) {
  const base = Deno.env.get('SUPABASE_URL') || '';
  const sr = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const r = await fetch(base + '/rest/v1/rpc/befalia_academy', {
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

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('check') === '1') {
    const hasUrl = !!Deno.env.get('SUPABASE_URL');
    const hasKey = !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    let refuses = false;
    if (hasUrl && hasKey) {
      const f = await rpc({ p_key: '', p: { action: 'match', names: [] } });
      refuses = f.status === 200 && f.body && f.body.ok === false && f.body.error === 'unauthorised';
    }
    return out(200, { ok: true, urlSet: hasUrl, serviceKeySet: hasKey, refusesEmptyKey: refuses });
  }
  if (req.method !== 'POST') return out(405, { ok: false, error: 'POST only' });
  const key = (req.headers.get('x-feed-key') || '').trim();
  if (key.length < 32) return out(401, { ok: false, error: 'unauthorised' });
  let p: unknown = null;
  try { p = await req.json(); } catch (_e) { return out(400, { ok: false, error: 'JSON body needed' }); }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return out(400, { ok: false, error: 'JSON object needed' });
  const f = await rpc({ p_key: key, p });
  if (f.status !== 200 || !f.body) return out(502, { ok: false, error: 'The database did not answer (HTTP ' + f.status + ').' });
  if (f.body.ok !== true && f.body.error === 'unauthorised') return out(401, { ok: false, error: 'unauthorised' });
  return out(200, f.body);
});
