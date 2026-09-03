// Shared gate for every /api route. Files under /api whose name starts with an
// underscore are not routed by Vercel, so this is a helper, not an endpoint.
//
// The dashboard is a public static page, so a secret baked into index.html would
// not be a secret. Instead the key is entered once per device, kept in that
// browser's localStorage, and sent as the x-os-key header on every API call.
// The server compares it against OS_KEY in the Vercel environment.
//
// What this does buy: the endpoints stop being open to anyone who knows the URL.
// What it does not buy: it is one shared key with no per-person identity and no
// rotation. Anyone holding the key has everything. That is the honest limit.
import { timingSafeEqual } from 'node:crypto';

export function requireKey(req, res) {
  const expected = process.env.OS_KEY;
  if (!expected) {
    res.status(500).json({ error: 'OS_KEY env var is not set in Vercel, so this endpoint refuses every request' });
    return false;
  }
  const raw = req.headers['x-os-key'];
  const got = Array.isArray(raw) ? raw[0] : (raw || '');
  const a = Buffer.from(String(got));
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    res.status(401).json({ error: 'unauthorised', needKey: true });
    return false;
  }
  return true;
}
