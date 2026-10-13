// Business tab (added 13 Oct 2026). Progress across Befa's businesses, starting
// with Sea Diva: every paid order that is not finished yet, so she can help
// pack and ship.
//
//   GET  /api/business?check=1   free health check, booleans and counts only
//   GET  /api/business           the Sea Diva section (x-os-key). Also logs on
//                                the To-Do any pack click Befa made on the Sea
//                                Diva dashboard that has no task yet.
//   POST /api/business           (x-os-key) pack actions, 13 Oct 2026:
//        { action: 'mark', src, row, invoice, slots: [1, 2] }
//        { action: 'undo', click_id } or { action: 'undo', mark_id }
//      A mark moves those products to Ready to be shipped (Manual sheet via the
//      bridge, Shopify/Shopee/Toko recorded and shown until the bridge learns
//      those tabs), moves the board job to Shipping, and logs one done task on
//      the To-Do. Undo reverses all three.
//
// Where the data comes from:
//   1. The DiveArts OS database, through the befalia-business edge function,
//      which calls seadiva.befalia_business_feed(). That returns only the order
//      columns of the MANUAL, SHOPIFY, SHOPEE and TOKOPEDIA/TIKTOK tabs (no
//      phone, email, address or money), product photo links, and the pack
//      marks still standing.
//      Gate: BIZ_FEED_KEY, made by Befa in the Supabase SQL editor.
//   2. seadivatails.com/products.json, the public Shopify storefront, for
//      Shopify product photos. Public, no key. Cached for 30 minutes.
// The sorting rules live in api/_sd-business.js.
import { requireKey } from './_auth.js';
import { build, SRC } from './_sd-business.js';
import { logPacks, unlogPacks, witaDay } from './_todo-pack.js';

const FEED_URL = process.env.BIZ_FEED_URL || 'https://gszjrsvvpajznwdrtjva.supabase.co/functions/v1/befalia-business';
const STORE = 'https://seadivatails.com';

let shopCache = { at: 0, products: null, error: '' };

async function storefront() {
  if (shopCache.products && Date.now() - shopCache.at < 30 * 60000) return shopCache;
  const all = [];
  try {
    for (let page = 1; page <= 8; page++) {
      const r = await fetch(STORE + '/products.json?limit=250&page=' + page, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const list = (j && j.products) || [];
      all.push(...list);
      if (list.length < 250) break;
    }
    shopCache = { at: Date.now(), products: all, error: '' };
  } catch (e) {
    /* Keep the last good copy if there is one. Photos are a help, not the list. */
    shopCache = { at: Date.now(), products: shopCache.products || [], error: 'Shopify photos could not be read (' + (e && e.message || 'network') + ').' };
  }
  return shopCache;
}

async function feed() {
  let r;
  try { r = await fetch(FEED_URL, { headers: { 'x-feed-key': String(process.env.BIZ_FEED_KEY || '').trim() } }); }
  catch (e) { return { ok: false, status: 502, error: 'The DiveArts OS database could not be reached.' }; }
  let j = null;
  try { j = await r.json(); } catch (e) { /* not JSON */ }
  if (r.status === 401) return { ok: false, status: 502, error: 'The database refused the feed key. Make a new one in the Supabase SQL editor and update BIZ_FEED_KEY in Vercel.' };
  if (!r.ok || !j || j.ok !== true) return { ok: false, status: 502, error: (j && j.error) || ('The database feed answered HTTP ' + r.status + '.') };
  return { ok: true, body: j };
}

/* seadiva.befalia_pack through the same edge function, same key. */
async function pack(p) {
  let r;
  try {
    r = await fetch(FEED_URL, { method: 'POST', headers: { 'x-feed-key': String(process.env.BIZ_FEED_KEY || '').trim(), 'content-type': 'application/json' },
                               body: JSON.stringify(p) });
  } catch (e) { return { ok: false, error: 'The DiveArts OS database could not be reached.' }; }
  let j = null;
  try { j = await r.json(); } catch (e) { /* not JSON */ }
  if (r.status === 401) return { ok: false, error: 'The database refused the feed key.' };
  return j || { ok: false, error: 'The database answered HTTP ' + r.status + '.' };
}

const TABS = Object.values(SRC);

async function post(req, res) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = {}; } }
  b = b || {};
  const today = witaDay(new Date().toISOString());
  if (b.action === 'mark') {
    const slots = Array.isArray(b.slots) ? b.slots.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12) : [];
    const row = Number(b.row);
    if (!TABS.includes(b.src) || !Number.isInteger(row) || row < 2 || !String(b.invoice || '').trim() || !slots.length) {
      return res.status(400).json({ ok: false, error: 'mark needs src, row, invoice and slots.' });
    }
    const r = await pack({ action: 'mark', src: b.src, row, invoice: String(b.invoice).trim(), slots });
    if (!r || r.ok !== true) return res.status(409).json({ ok: false, error: (r && r.error) || 'Not marked.' });
    const todo = r.marked > 0 ? await logPacks(pack, today) : { logged: 0, error: '' };
    return res.status(200).json({ ok: true, result: r, todo });
  }
  if (b.action === 'undo') {
    const click = String(b.click_id || '').trim(), mark = Number(b.mark_id);
    if (!/^[0-9a-f-]{36}$/i.test(click) && !(Number.isInteger(mark) && mark > 0)) {
      return res.status(400).json({ ok: false, error: 'undo needs click_id or mark_id.' });
    }
    const r = await pack(click ? { action: 'undo', click_id: click } : { action: 'undo', mark_id: mark });
    if (!r || r.ok !== true) return res.status(409).json({ ok: false, error: (r && r.error) || 'Not undone.' });
    const todo = await unlogPacks(r.todo_pages || []);
    return res.status(200).json({ ok: true, result: r, todo });
  }
  return res.status(400).json({ ok: false, error: 'Unknown action.' });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST') {
    if (!requireKey(req, res)) return;
    if (!process.env.BIZ_FEED_KEY) return res.status(503).json({ ok: false, notConnected: true, error: 'Not connected yet: BIZ_FEED_KEY is not set in Vercel.' });
    return post(req, res);
  }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'Method not allowed.' }); }

  if (req.query && req.query.check === '1') {
    return res.status(200).json({ ok: true, feedKeySet: !!process.env.BIZ_FEED_KEY, osKeySet: !!process.env.OS_KEY });
  }

  if (!requireKey(req, res)) return;
  if (!process.env.BIZ_FEED_KEY) {
    return res.status(503).json({ ok: false, notConnected: true, error: 'Not connected yet: BIZ_FEED_KEY is not set in Vercel.' });
  }

  /* Clicks Befa made on the Sea Diva dashboard get their To-Do task first, so
     the list below already shows them as logged. Never blocks the list. */
  let todo = { logged: 0, error: '' };
  try { todo = await logPacks(pack, witaDay(new Date().toISOString())); } catch (e) { todo = { logged: 0, error: String(e.message || e) }; }

  const [f, shop] = await Promise.all([feed(), storefront()]);
  if (!f.ok) return res.status(f.status).json({ ok: false, error: f.error });

  const out = build(f.body, shop.products, new Date());
  out.photosNote = shop.error || '';
  out.shopProducts = (shop.products || []).length;
  out.todo = todo;
  return res.status(200).json(out);
}
