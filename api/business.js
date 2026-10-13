// Business tab (added 13 Oct 2026). Progress across Befa's businesses, starting
// with Sea Diva: every paid order that is not finished yet, so she can help
// pack and ship.
//
//   GET /api/business?check=1   free health check, booleans and counts only
//   GET /api/business           the Sea Diva section (x-os-key)
//
// Where the data comes from:
//   1. The DiveArts OS database, through the befalia-business edge function,
//      which calls seadiva.befalia_business_feed(). That returns only the order
//      columns of MANUAL (IG & WA) - OL and SHOPIFY-OL (no phone, email,
//      address or money) plus product photo links from PRODUCT LIST SDT.
//      Gate: BIZ_FEED_KEY, made by Befa in the Supabase SQL editor.
//   2. seadivatails.com/products.json, the public Shopify storefront, for
//      Shopify product photos. Public, no key. Cached for 30 minutes.
// The sorting rules live in api/_sd-business.js.
import { requireKey } from './_auth.js';
import { build } from './_sd-business.js';

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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false, error: 'Method not allowed.' }); }

  if (req.query && req.query.check === '1') {
    return res.status(200).json({ ok: true, feedKeySet: !!process.env.BIZ_FEED_KEY, osKeySet: !!process.env.OS_KEY });
  }

  if (!requireKey(req, res)) return;
  if (!process.env.BIZ_FEED_KEY) {
    return res.status(503).json({ ok: false, notConnected: true, error: 'Not connected yet: BIZ_FEED_KEY is not set in Vercel.' });
  }

  const [f, shop] = await Promise.all([feed(), storefront()]);
  if (!f.ok) return res.status(f.status).json({ ok: false, error: f.error });

  const out = build(f.body, shop.products, new Date());
  out.photosNote = shop.error || '';
  out.shopProducts = (shop.products || []).length;
  return res.status(200).json(out);
}
