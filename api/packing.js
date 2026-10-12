// Packing for class (added 12 Oct 2026). The day before a DiveArts class, the
// list of what goes in the bag, built from the DiveArts Bali and Jakarta
// calendars. Same list, same ticks as the card on Dia's dashboard in DiveArts
// OS: both talk to one Apps Script, "DAA Packing", which owns its own sheet
// (DAA PACKING) and only reads the calendars.
//
//   GET  /api/packing              today + tomorrow
//   GET  /api/packing?date=Y-M-D   one day
//   POST /api/packing {date, city, itemKey, ticked}
//
// Gate: the OS key, like every route here. Ticks from this app are recorded as
// "Befa" because this is Befa's personal OS and the key is hers; the sheet also
// records the source "Befalia OS". Env: PACK_GAS_URL and PACK_KEY (the script's
// KEY_BEFALIA_OS, a different key from the one DiveArts OS holds, so either can
// be revoked alone). Never sent to the browser. Missing env -> 503 saying which.
import { requireKey } from './_auth.js';

const BY = 'Befa';

async function brain(init, qs) {
  const url = process.env.PACK_GAS_URL + (qs ? '?' + qs : '');
  let r;
  try { r = await fetch(url, { redirect: 'follow', ...init }); }
  catch (e) { return { ok: false, error: 'The packing list service could not be reached.' }; }
  const text = await r.text();
  try { return JSON.parse(text); }
  catch (e) { return { ok: false, error: 'The packing list service answered with something that is not JSON (HTTP ' + r.status + ').' }; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireKey(req, res)) return;
  const missing = ['PACK_GAS_URL', 'PACK_KEY'].filter((k) => !process.env[k]);
  if (missing.length) return res.status(503).json({ ok: false, notConnected: true, error: 'Not connected yet: ' + missing.join(' and ') + ' not set in Vercel.' });

  if (req.method === 'GET') {
    const date = String((req.query && req.query.date) || '').trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'Bad date.' });
    const qs = new URLSearchParams({ action: 'cards', key: process.env.PACK_KEY });
    if (date) qs.set('date', date);
    const out = await brain({ method: 'GET' }, qs.toString());
    return res.status(out.ok ? 200 : 502).json({ ...out, you: BY });
  }

  if (req.method === 'POST') {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return res.status(400).json({ ok: false, error: 'Body is not JSON.' }); } }
    b = b || {};
    if (b.ticked !== true && b.ticked !== false) return res.status(400).json({ ok: false, error: 'Ticked must be true or false.' });
    const body = { action: 'tick', key: process.env.PACK_KEY, date: String(b.date || ''), city: String(b.city || ''), itemKey: String(b.itemKey || ''), ticked: b.ticked, by: BY };
    const out = await brain({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.status(out.ok ? 200 : 409).json(out);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method not allowed.' });
}
