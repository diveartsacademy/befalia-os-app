// _sd-business.js (13 Oct 2026)
// ---------------------------------------------------------------------------
// The Sea Diva section of the Business tab. Pure functions, no network, so it
// runs the same under node --test and inside the /api/business route.
//
// What Befa asked for, 13 Oct 2026, and how each part is decided:
//
//   "all the unfulfilled orders on Shopify"
//     SHOPIFY-OL rows that Shopify calls paid (or partly paid), not cancelled
//     or refunded, with Fulfillment Status unfulfilled or partial. Same rule as
//     the Sea Diva Overview in DiveArts OS (sd-overview.js, copied unchanged).
//
//   "and manual that's not done ... they pay but production is still in progress"
//     MANUAL (IG & WA) - OL rows whose Production Payment Status is PAID,
//     Deposit, Installment Plan or Production Paid, with at least one product
//     whose Status Produksi is not DONE, and not ticked Shipped.
//
//   "name, invoices and the products in one invoice"
//     One card per invoice, every product line on it that is not DONE, with
//     its quantity and production status as typed in the sheet.
//
//   "the photo of the product ... from Shopify ... or from the product listing"
//     Shopify lines: the product photo from seadivatails.com (variant photo
//     when the variant can be told apart, otherwise the product's first photo).
//     Manual lines: the photo in PRODUCT LIST SDT, then Shopify as a second
//     source. Every photo says how sure the match is: "exact" (this variant),
//     or "product" (right product, colour or size may differ). There is no
//     fuzzy guess. When the name does not clearly match a product, the line
//     shows no photo rather than a wrong one, because a wrong picture is worse
//     than none when packing.
//
// Nothing is invented. A line with no photo says so. A column the sheet has
// renamed makes that tab refuse by name, and the other tab still shows.
// ---------------------------------------------------------------------------
import './_sd-overview.js';

const SO = globalThis.SDOverview;

export const SRC = { manual: 'MANUAL (IG & WA) - OL', shopify: 'SHOPIFY-OL' };

const DAY = 86400000;

function txt(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
function low(v) { return txt(v).toLowerCase(); }
function lines(v) { return String(v == null ? '' : v).replace(/\r/g, '').split('\n').map((s) => s.trim()).filter(Boolean); }

function cellRaw(cells, col) {
  if (!col || !cells || !cells[col]) return '';
  const x = cells[col];
  const d = x.d;
  if (d !== undefined && d !== null && String(d).trim() !== '') return String(d);
  return x.v === undefined || x.v === null ? '' : String(x.v);
}
function cell(cells, col) { return txt(cellRaw(cells, col)); }

function colNum(c) { let n = 0; for (let i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64); return n; }
function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/* Header text for each column in the first six rows (lower case). */
function headers(rows) {
  const h = {};
  rows.forEach((r) => {
    if (r.row_no > 6) return;
    const cells = r.cells || {};
    Object.keys(cells).forEach((col) => {
      const t = low(cellRaw(cells, col));
      if (t) (h[col] = h[col] || []).push(t);
    });
  });
  return h;
}
function findHeader(h, name) {
  const hits = Object.keys(h).filter((c) => h[c].indexOf(name) >= 0).sort((a, b) => colNum(a) - colNum(b));
  return hits[0] || null;
}

function payKind(channel, payText, cancelledText) {
  const p = low(payText);
  if (channel === 'shopify') {
    if (cancelledText) return 'cancelled';
    if (p === 'paid' || p === 'partially_paid' || p === 'partially paid') return 'paid';
    if (p === 'refunded' || p === 'voided' || p === 'partially_refunded') return 'cancelled';
    return 'unpaid';
  }
  if (p === 'paid') return 'paid';
  if (/waiting for payment/.test(p)) return 'unpaid';
  if (/deposit|installment|instalment|cicilan|production paid/.test(p)) return 'part';
  if (/cancel/.test(p)) return 'cancelled';
  return p ? 'other' : 'blank';
}

function groupOf(status) {
  const k = low(status);
  return Object.prototype.hasOwnProperty.call(SO.STATUS, k) ? SO.STATUS[k] : 'other';
}

function qtyOf(v) {
  const s = txt(v);
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  return isFinite(n) && n > 0 ? n : null;
}

/* parseDate gives a Date at local midnight, so read it back with local getters. */
function ymd(d) {
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function daysSince(d, now) {
  if (!d) return null;
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - d) / DAY);
}

/* ---------------------------------------------------------------------
   Reading one tab
--------------------------------------------------------------------- */
export function readTab(channel, rows, now) {
  const src = SRC[channel];
  if (!rows || !rows.length) return { ok: false, error: src + ' was not in the feed.', orders: [] };
  const res = SO.resolveTab(src, rows);
  if (!res.ok) return { ok: false, error: res.error, orders: [] };
  const c = res.cols;
  const h = headers(rows);
  const shippedCol = channel === 'manual' ? findHeader(h, 'shipped') : null;
  const countryCol = channel === 'shopify' ? findHeader(h, 'shipping country') : null;
  /* Quantity sits in the column straight after each product's item column.
     It is only read if that column's header really says Qty. */
  const slots = c.slots.map((s) => {
    const q = colName(colNum(s.item) + 1);
    return { status: s.status, item: s.item, qty: (h[q] || []).indexOf('qty') >= 0 ? q : null };
  });

  const orders = [];
  rows.forEach((r) => {
    if (r.row_no <= res.headerRow) return;
    const cells = r.cells || {};
    const invoice = cell(cells, c.inv);
    if (!invoice || /^qa[-_ ]/i.test(invoice)) return;
    const date = SO.parseDate(cells[c.date] ? cells[c.date].v : null, cell(cells, c.date));
    const o = {
      channel, invoice,
      customer: cell(cells, c.name).split(/\n| Mail:/)[0].trim(),
      row: r.row_no,
      dateText: cell(cells, c.date),
      date: ymd(date),
      days: daysSince(date, now),
      payText: cell(cells, c.pay),
      pay: payKind(channel, cell(cells, c.pay), c.cancelled ? cell(cells, c.cancelled) : ''),
      fulfil: c.fulfil ? low(cell(cells, c.fulfil)) : '',
      shipped: shippedCol ? /^true$/i.test(cell(cells, shippedCol)) : false,
      country: countryCol ? cell(cells, countryCol) : '',
      lines: []
    };
    slots.forEach((s, i) => {
      const raw = cellRaw(cells, s.item);
      const item = txt(raw);
      if (!item) return;
      const status = cell(cells, s.status);
      const ls = lines(raw);
      o.lines.push({
        slot: i + 1, item, title: ls[0] || item, detail: ls.slice(1),
        qty: s.qty ? qtyOf(cellRaw(cells, s.qty)) : null,
        status, group: groupOf(status)
      });
    });
    orders.push(o);
  });
  return { ok: true, orders };
}

/* ---------------------------------------------------------------------
   Photos
--------------------------------------------------------------------- */
const STOP = { the: 1, and: 1, with: 1, 'for': 1, of: 1, a: 1, size: 1, color: 1, colour: 1, design: 1, variasi: 1, best: 1, seller: 1, default: 1, title: 1 };
export function words(s) {
  return low(s).replace(/0,5/g, '0.5').replace(/&amp;/g, '&').replace(/[–—]/g, '-')
    .replace(/[^a-z0-9.&]+/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/&/g, ' ')
    .split(' ').filter((w) => w && !STOP[w]);
}
const key = (s) => words(s).join(' ');

/* products: seadivatails.com /products.json rows. catalog: [{name, category, photo}] */
export function photoIndex(catalog, products) {
  const shop = [];
  (products || []).forEach((p) => {
    if (!p || !p.title) return;
    const imgs = (p.images || []).map((i) => i && i.src).filter(Boolean);
    const first = imgs[0] || '';
    const variants = (p.variants || []).map((v) => ({
      key: key(String(v.title || '').replace(/\//g, ' ')),
      img: (v.featured_image && v.featured_image.src) || ''
    })).filter((v) => v.key);
    shop.push({ title: p.title, key: key(p.title), set: words(p.title), img: first, variants, handle: p.handle || '' });
  });
  const cat = [];
  (catalog || []).forEach((r) => {
    if (!r || !r.name || !/^https?:\/\//i.test(r.photo || '')) return;
    cat.push({ title: r.name, key: key(r.name), set: words(r.name), img: r.photo });
  });
  return { shop, cat };
}

function contained(hay, needle) { return needle.length >= 6 && (' ' + hay + ' ').indexOf(' ' + needle + ' ') >= 0; }

/* Every word of the product name appears in the order text, in any order.
   "Mermaid Tail Adult - Fairytopia (Yellow)" finds "Mermaid Tail - Fairytopia
   (Yellow)". Needs at least two words so a one word name cannot grab lines. */
function allWords(list, ws) {
  const wset = {}; ws.forEach((w) => { wset[w] = 1; });
  let best = null;
  list.forEach((q) => {
    if (q.set.length < 2) return;
    if (q.set.every((w) => wset[w]) && (!best || q.set.length > best.set.length)) best = q;
  });
  return best;
}

function fromShop(idx, text) {
  const k = key(text), ws = words(text);
  let p = null;
  idx.shop.forEach((q) => { if ((k === q.key || k.indexOf(q.key + ' ') === 0) && (!p || q.key.length > p.key.length)) p = q; });
  if (p) {
    const rest = k === p.key ? '' : k.slice(p.key.length + 1);
    let v = null;
    if (rest) {
      v = p.variants.find((x) => x.key === rest) ||
          p.variants.find((x) => { const xs = x.key.split(' '); return xs.length && xs.every((w) => (' ' + rest + ' ').indexOf(' ' + w + ' ') >= 0); }) || null;
    }
    if (v && v.img) return { url: v.img, how: 'exact', from: 'Shopify', product: p.title };
    if (p.img) return { url: p.img, how: rest && p.variants.length > 1 ? 'product' : 'exact', from: 'Shopify', product: p.title };
    return null;
  }
  let q = null;
  idx.shop.forEach((x) => { if (contained(k, x.key) && (!q || x.key.length > q.key.length)) q = x; });
  if (!q) q = allWords(idx.shop, ws);
  if (q && q.img) return { url: q.img, how: 'product', from: 'Shopify', product: q.title };
  return null;
}

function fromList(idx, text) {
  const k = key(text), ws = words(text);
  let p = idx.cat.find((q) => q.key === k) || null;
  if (p) return { url: p.img, how: 'exact', from: 'Product list', product: p.title };
  idx.cat.forEach((q) => { if (contained(k, q.key) && (!p || q.key.length > p.key.length)) p = q; });
  if (!p) p = allWords(idx.cat, ws);
  if (p) return { url: p.img, how: 'product', from: 'Product list', product: p.title };
  return null;
}

/* The first line of a cell is the product. Lines under it ("Earring design:
   Sun Gold", "Size: Long") often carry the design, so the product list match
   reads the whole cell, and the Shopify name match reads the first line. */
export function photoFor(idx, channel, line) {
  const title = line.title || line.item;
  const full = line.item || title;
  if (channel === 'shopify') {
    return fromShop(idx, title) || fromList(idx, full);
  }
  return fromList(idx, full) || fromShop(idx, title);
}

/* ---------------------------------------------------------------------
   The Sea Diva section
--------------------------------------------------------------------- */
const READY = { ready: 1, shipping: 1 };

export function build(feed, products, now) {
  now = now || new Date();
  const tabs = (feed && feed.tabs) || {};
  const idx = photoIndex(feed && feed.photos, products);
  const sources = {}, all = [];
  ['shopify', 'manual'].forEach((ch) => {
    const t = readTab(ch, tabs[SRC[ch]], now);
    sources[ch] = { ok: t.ok, error: t.error || '', loadedAt: (feed && feed.loaded && feed.loaded[SRC[ch]]) || null };
    if (ch === 'shopify' && t.ok) {
      /* The newest Shopify order the sheet holds. If the Shopify to sheet
         sync stops, this is what shows how far behind the list is. */
      let newest = null;
      t.orders.forEach((o) => { if (o.date && (!newest || o.date > newest.date)) newest = { invoice: o.invoice, date: o.date }; });
      sources.shopify.newest = newest;
    }
    all.push(...t.orders);
  });

  const orders = [];
  all.forEach((o) => {
    const open = o.lines.filter((l) => l.group !== 'done' && l.group !== 'ignore');
    let include = false, stage = '';
    if (o.channel === 'shopify') {
      if (o.pay === 'paid' && /unfulfilled|partial/.test(o.fulfil)) {
        include = true;
        if (!o.lines.length) stage = 'no_items';
        else if (!open.length) stage = 'close_in_shopify';
      }
    } else if ((o.pay === 'paid' || o.pay === 'part') && open.length && !o.shipped) {
      include = true;
    }
    if (!include) return;
    if (!stage) {
      const ready = open.filter((l) => READY[l.group]);
      const blank = open.filter((l) => l.group === 'blank');
      if (ready.length === open.length) stage = 'ready';
      else if (blank.length === open.length) stage = 'not_set';
      else if (ready.length) stage = 'partly';
      else stage = 'production';
    }
    const show = open.length ? open : o.lines;
    orders.push({
      channel: o.channel, invoice: o.invoice, customer: o.customer, date: o.date, dateText: o.dateText,
      days: o.days, pay: o.pay, payText: o.payText, country: o.country, stage,
      doneCount: o.lines.length - open.length, lineCount: o.lines.length,
      lines: show.map((l) => ({
        title: l.title, detail: l.detail, qty: l.qty, status: l.status || '', group: l.group,
        photo: photoFor(idx, o.channel, l)
      }))
    });
  });

  const RANK = { ready: 0, partly: 1, production: 2, not_set: 3, close_in_shopify: 4, no_items: 5 };
  orders.sort((a, b) => (RANK[a.stage] - RANK[b.stage]) || ((b.days == null ? -1 : b.days) - (a.days == null ? -1 : a.days)));

  const counts = { all: orders.length, shopify: 0, manual: 0, ready: 0, partly: 0, production: 0, not_set: 0, close_in_shopify: 0, no_items: 0, lines: 0, photos: 0, productPhotos: 0 };
  orders.forEach((o) => {
    counts[o.channel]++; counts[o.stage]++;
    o.lines.forEach((l) => { counts.lines++; if (l.photo) { counts.photos++; if (l.photo.how === 'product') counts.productPhotos++; } });
  });
  return { ok: true, generatedAt: now.toISOString(), sources, counts, orders };
}
