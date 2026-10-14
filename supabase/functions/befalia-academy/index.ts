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
//                           video (queue class video emails),
//                           certs, cert_set (certificates, 14 Oct 2026)
//                  cert_file is handled here: the key is checked by the
//                  database first (action ping), then one JPEG or PNG of at
//                  most 3 MB is stored in the public "certificates" bucket at
//                  <profile uuid>/<random uuid>.jpg and its public address is
//                  returned. Nothing is stored for a wrong key.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function certFile(key: string, p: any) {
  const pid = String(p.profile_id || '');
  if (!UUID_RE.test(pid)) return out(400, { ok: false, error: 'Pick the student in the portal first.' });
  const okKey = await rpc({ p_key: key, p: { action: 'ping' } });
  if (okKey.status !== 200 || !okKey.body || okKey.body.ok !== true) return out(401, { ok: false, error: 'unauthorised' });
  let bytes: Uint8Array;
  try {
    const bin = atob(String(p.data_base64 || ''));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (_e) { return out(400, { ok: false, error: 'The image did not arrive whole.' }); }
  if (bytes.length < 1000 || bytes.length > 3145728) return out(400, { ok: false, error: 'The image must be between 1 KB and 3 MB.' });
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!jpg && !png) return out(400, { ok: false, error: 'Only a JPEG or PNG image is stored.' });
  const base = Deno.env.get('SUPABASE_URL') || '';
  const sr = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const path = pid.toLowerCase() + '/' + crypto.randomUUID() + (jpg ? '.jpg' : '.png');
  const r = await fetch(base + '/storage/v1/object/certificates/' + path, {
    method: 'POST',
    headers: { apikey: sr, authorization: 'Bearer ' + sr, 'content-type': jpg ? 'image/jpeg' : 'image/png', 'x-upsert': 'false' },
    body: bytes,
  });
  if (!r.ok) return out(502, { ok: false, error: 'The image could not be stored (HTTP ' + r.status + ').' });
  return out(200, { ok: true, file_url: base + '/storage/v1/object/public/certificates/' + path });
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
  if ((p as any).action === 'cert_file') return certFile(key, p as any);
  const f = await rpc({ p_key: key, p });
  if (f.status !== 200 || !f.body) return out(502, { ok: false, error: 'The database did not answer (HTTP ' + f.status + ').' });
  if (f.body.ok !== true && f.body.error === 'unauthorised') return out(401, { ok: false, error: 'unauthorised' });
  return out(200, f.body);
});
