// The Academy door (14 Oct 2026): Befalia OS -> befalia-academy edge function ->
// portal.befalia_academy(p_key, p). Same key and the same pattern as the Business
// tab (BIZ_FEED_KEY), so no new secret. The database checks the key and decides
// what is allowed; this file only carries the request.
export const ACADEMY_URL = process.env.ACADEMY_URL || 'https://gszjrsvvpajznwdrtjva.supabase.co/functions/v1/befalia-academy';

export const DRIVE_RE = /^https:\/\/(drive|docs)\.google\.com\//;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function academy(p, fetchImpl = fetch) {
  const key = process.env.BIZ_FEED_KEY;
  if (!key) return { ok: false, error: 'BIZ_FEED_KEY is not set in Vercel, so the student portal cannot be reached.' };
  let r;
  try {
    r = await fetchImpl(ACADEMY_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-feed-key': key }, body: JSON.stringify(p) });
  } catch (e) { return { ok: false, error: 'The student portal could not be reached.' }; }
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  if (!j) return { ok: false, error: 'The student portal answered HTTP ' + r.status + ' with no JSON.' };
  if (r.status === 401) return { ok: false, error: 'The student portal refused the Befalia key.' };
  return j;
}
