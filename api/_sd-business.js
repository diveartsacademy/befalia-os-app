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
//     Every line, Shopify or Manual, takes its photo from the public Shopify
//     storefront, the only source whose photos load for anyone. See the
//     Photos section below for the rules. When the name does not clearly match
//     one product, the line shows no photo rather than a wrong one, because a
//     wrong picture is worse than none when packing.
//
//   "Order at the Shopee order as well" (13 Oct 2026)
//     SHOPEE - OL and TOKOPEDIA/TIKTOK shop -OL rows with a product not DONE.
//     The marketplace has the buyer's money, so they always count as paid, as
//     in the Sea Diva Overview. An order whose products all have no status is
//     only listed for its first 45 days. Ship-by date (Batas Pengiriman) shown.
//
//   "click ready to ship ... once I pack the order"
//     Pack marks from the database (seadiva.pack_marks) are laid over the
//     sheet: a packed line counts as ready at once and shows who packed it and
//     whether the sheet has caught up. Stage "packed" = every physical product
//     packed, waiting for the courier.
//
// Nothing is invented. A line with no photo says so. A column the sheet has
// renamed makes that tab refuse by name, and the other tab still shows.
// ---------------------------------------------------------------------------
import './_sd-overview.js';

const SO = globalThis.SDOverview;

export const SRC = { manual: 'MANUAL (IG & WA) - OL', shopify: 'SHOPIFY-OL', shopee: 'SHOPEE - OL', toko: 'TOKOPEDIA/TIKTOK shop -OL' };
export const CHANNELS = ['shopify', 'shopee', 'toko', 'manual'];
const MARKETPLACE = { shopee: 1, toko: 1 };
/* Same window as the Sea Diva Overview (NOTSET_DAYS in sd-overview.js): a
   marketplace order whose products all have no status is only listed while it
   is this new. Older blank rows are almost always long delivered. */
export const NOTSET_DAYS = 45;

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
  /* Shopee and Tokopedia/TikTok pay Sea Diva only after delivery, but the
     buyer has paid the marketplace, so the order is real and must be packed.
     Same rule as sd-overview.js. */
  if (MARKETPLACE[channel]) return 'paid';
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
  const shipByCol = MARKETPLACE[channel] ? findHeader(h, 'batas pengiriman') : null;
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
    const shipBy = shipByCol ? SO.parseDate(cells[shipByCol] ? cells[shipByCol].v : null, cell(cells, shipByCol)) : null;
    const o = {
      channel, src, invoice,
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
      shipBy: ymd(shipBy),
      shipByText: shipByCol ? cell(cells, shipByCol) : '',
      shipByDays: shipBy ? -daysSince(shipBy, now) : null,
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
   TailCraft (13 Oct 2026, 23:00). Befa: "Follow the invoice." Paid TailCraft
   orders come from the database (tailcraft.invoices and invoice_lines), not
   from the TAILCRAFT DASHBOARD sheet. Every product carries the project's
   stage; Ready to be shipped counts as ready, anything earlier as still being
   made. No shop photos: these are custom pieces.
--------------------------------------------------------------------- */
export const TC_SRC = 'TAILCRAFT';
export function readTailcraft(list, now) {
  return (list || []).filter((t) => t && t.invoice).map((t) => {
    const date = t.date ? new Date(String(t.date).slice(0, 10) + 'T00:00:00') : null;
    const ready = t.stage === 'ready_ship';
    return {
      channel: 'tailcraft', src: TC_SRC, invoice: txt(t.invoice), customer: txt(t.customer), row: 0,
      dateText: t.date || '', date: ymd(date), days: daysSince(date, now),
      payText: t.pay || '', pay: t.pay === 'paid' ? 'paid' : 'part', fulfil: '', shipped: false,
      country: txt(t.country), shipBy: null, shipByText: '', shipByDays: null, project: t.project || '',
      lines: (t.lines || []).map((l) => ({
        slot: Number(l.slot), item: txt(l.title), title: txt(l.title), detail: t.project ? ['TailCraft ' + t.project] : [],
        qty: Number(l.qty) || null, status: t.stage_label || '', group: ready ? 'ready' : 'tc_making', tailcraft: true
      }))
    };
  });
}

/* ---------------------------------------------------------------------
   Photos (rewritten 13 Oct 2026 after the first live check)

   Source order, for every order, Shopify or Manual:
     1. seadivatails.com, the public Shopify storefront. Its photos are on
        Shopify's CDN and open for anyone, so they always load.
     2. PRODUCT LIST SDT, but only links anyone can open. The links the sheet
        holds today (lh7-rt.googleusercontent.com/sheetsz/...) answer 403 to a
        server, with or without their key, checked 13 Oct 2026, so they are
        skipped rather than drawn as a broken square.

   Rules, in order. The first that matches wins:
     - name starts with a Shopify product name ("Kaia Bottom - Unicorn - M")
     - a Shopify product name sits inside the line
     - every word of a Shopify product name (3 words or more) is in the line
     - every main word of the line is in exactly one Shopify product's name or
       its variant names ("Mermaid Tail Adult - Fairytopia (Yellow)" finds
       "Barbie Yellow Fairytopia Mermaid Tail"). One product only, or nothing.
   A line with the word "custom" never gets a photo by the last two rules: a
   stock picture of a custom tail or crown shows the wrong thing.

   The variant comes from the words left over plus the lines under the product
   in the sheet ("Earring design: Sun Gold", "Color: Jogja"). A variant with
   its own photo gives that photo. Otherwise the product photo, marked
   "product" only when the product has other colours with their own photos,
   so the picture might not be the colour ordered.
--------------------------------------------------------------------- */
const STOP = { the: 1, and: 1, with: 1, 'for': 1, of: 1, a: 1, size: 1, color: 1, colour: 1, design: 1, variasi: 1,
               best: 1, seller: 1, default: 1, title: 1, warna: 1, ukuran: 1, earring: 1, necklace: 1 };
/* Words that say which size or who, not which product. */
const SIZEISH = { adult: 1, adults: 1, kids: 1, kid: 1, xs: 1, s: 1, m: 1, l: 1, xl: 1, xxl: 1, short: 1, long: 1, pcs: 1, pc: 1 };

export function words(s) {
  return low(s).replace(/(\d),(\d)/g, '$1.$2').replace(/&amp;/g, '&').replace(/[–—]/g, '-')
    .replace(/(\d)(kg|gr|g|lbs|lb|cm)\b/g, '$1 $2')
    .replace(/[^a-z0-9.&]+/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/&/g, ' ')
    .split(' ').filter((w) => w && !STOP[w]);
}
const key = (s) => words(s).join(' ');
const PRIVATE = /^https?:\/\/lh\d+(-rt)?\.googleusercontent\.com\/sheetsz\//i;

export function photoIndex(catalog, products) {
  const shop = [];
  (products || []).forEach((p) => {
    if (!p || !p.title) return;
    const imgs = (p.images || []).map((i) => i && i.src).filter(Boolean);
    const variants = (p.variants || []).map((v) => ({
      set: words(String(v.title || '').replace(/\//g, ' ')),
      opt1: key(String(v.title || '').split('/')[0]),
      img: (v.featured_image && v.featured_image.src) || ''
    })).filter((v) => v.set.length && v.set.join(' ') !== '');
    const vwords = {};
    variants.forEach((v) => v.set.forEach((w) => { vwords[w] = 1; }));
    shop.push({ title: p.title, key: key(p.title), set: words(p.title), img: imgs[0] || '', variants, vwords,
                ownVariantPhotos: variants.some((v) => v.img) });
  });
  const cat = [];
  (catalog || []).forEach((r) => {
    if (!r || !r.name || !/^https?:\/\//i.test(r.photo || '') || PRIVATE.test(r.photo)) return;
    cat.push({ title: r.name, key: key(r.name), set: words(r.name), img: r.photo });
  });
  return { shop, cat };
}

function contains(hay, needle) { return needle.length >= 6 && (' ' + hay + ' ').indexOf(' ' + needle + ' ') >= 0; }

function pickProduct(list, text, allowLoose) {
  const k = key(text), ws = words(text);
  const wset = {}; ws.forEach((w) => { wset[w] = 1; });
  let best = null;
  const longer = (q) => !best || q.key.length > best.key.length;
  list.forEach((q) => { if (q.key && (k === q.key || k.indexOf(q.key + ' ') === 0) && longer(q)) best = q; });
  if (best) return best;
  list.forEach((q) => { if (contains(k, q.key) && longer(q)) best = q; });
  if (best) return best;
  if (!allowLoose) return null;
  list.forEach((q) => { if (q.set.length >= 3 && q.set.every((w) => wset[w]) && longer(q)) best = q; });
  if (best) return best;
  const core = ws.filter((w) => !SIZEISH[w] && !/^\d+(-\d+)?$/.test(w));
  if (core.length < 2) return null;
  const hits = list.filter((q) => {
    const tset = {}; q.set.forEach((w) => { tset[w] = 1; });
    const inTitle = core.filter((w) => tset[w]).length;
    return inTitle >= 2 && core.every((w) => tset[w] || (q.vwords && q.vwords[w]));
  });
  return hits.length === 1 ? hits[0] : null;
}

function pickVariant(p, text, hints) {
  if (!p.variants || !p.variants.length) return null;
  const tset = {}; p.set.forEach((w) => { tset[w] = 1; });
  const left = {};
  words(text).forEach((w) => { if (!tset[w]) left[w] = 1; });
  (hints || []).forEach((h) => words(String(h).replace(/^[^:]*:/, '')).forEach((w) => { left[w] = 1; }));
  let best = null;
  p.variants.forEach((v) => {
    if (v.set.every((w) => left[w]) && (!best || v.set.length > best.set.length || (v.set.length === best.set.length && v.img && !best.img))) best = v;
  });
  return best;
}

function fromShop(idx, line, loose) {
  const text = line.title || line.item;
  const p = pickProduct(idx.shop, text, loose);
  if (!p) return null;
  const v = pickVariant(p, text, line.detail);
  if (v && v.img) return { url: v.img, how: 'exact', from: 'Shopify', product: p.title };
  /* "Orange / Small pack" has no photo, "Orange / Complete pack" does. Same
     first option means same colour or design, so borrow that photo. */
  if (v && v.opt1) {
    const sib = p.variants.find((x) => x.img && x.opt1 === v.opt1);
    if (sib) return { url: sib.img, how: 'exact', from: 'Shopify', product: p.title };
  }
  if (!p.img) return null;
  /* The main photo shows one colour. If other colours have their own photos,
     the main one may not be the colour ordered, so say so. */
  return { url: p.img, how: p.ownVariantPhotos ? 'product' : 'exact', from: 'Shopify', product: p.title };
}

function fromList(idx, line) {
  const p = pickProduct(idx.cat, line.item || line.title, true);
  return p ? { url: p.img, how: 'product', from: 'Product list', product: p.title } : null;
}

export function photoFor(idx, channel, line) {
  const custom = /\bcustom\b/i.test(line.item || line.title || '');
  return fromShop(idx, line, !custom) || (custom ? null : fromList(idx, line));
}

/* ---------------------------------------------------------------------
   The Sea Diva section
--------------------------------------------------------------------- */
const READY = { ready: 1, shipping: 1 };

/* Befa's rule, 13 Oct 2026: lines that are not a physical item (custom colour,
   design fees, design buy out, warranty and similar) are marked DONE as soon
   as the invoice is paid. The tab checks for that. Such a line that is still
   open is flagged "mark DONE", and it does not hold the order out of Ready to
   pack. The list is kept narrow on purpose: "Upgrade" and "Performance
   Support Program" lines are real production and are not on it. */
export const NON_PHYSICAL = /\b(custom colou?r|custom design fee|design fee|design buy ?out|buy ?out|warranty|garansi|shipping fee|ongkir|insurance|asuransi)\b/i;
export function nonPhysical(item) { return NON_PHYSICAL.test(String(item || '')); }

/* Pack marks (13 Oct 2026). Befa or staff clicked "Packed, ready to ship" on
   a product line, in Befalia OS or on the Sea Diva dashboard. The click is the
   truth from that moment, even before the sheet bridge writes the word, so the
   line counts as ready and carries the mark for the Undo button. */
function markIndex(marks) {
  const m = {};
  (marks || []).forEach((k) => { if (k && k.src && k.invoice && k.slot) m[k.src + '|' + txt(k.invoice) + '|' + k.slot] = k; });
  return m;
}
/* "In the box" ticks (13 Oct 2026): one per product line, shared by both
   dashboards, so Befa can tick what is already in the box while packing. */
function tickIndex(ticks) {
  const m = {};
  (ticks || []).forEach((k) => { if (k && k.src && k.invoice && k.slot) m[k.src + '|' + txt(k.invoice) + '|' + k.slot] = { at: k.at || null, by: k.by || '' }; });
  return m;
}
function markView(k) {
  return { id: k.id, click: k.click_id, at: k.at, by: k.by || '', via: k.via || '', write: k.write || '',
           written: !!k.written, writeError: k.writeError || '', todo: !!k.todo };
}

/* ---------------------------------------------------------------------
   My work (14 Oct 2026)

   Befa, 14 Oct 18:08 and 18:22: one list of every product line that waits on
   her own hands (she designs, makes the fluke fillers and the crowns, and
   orders from third parties), plus what waits on the craftspeople who are
   still working (Timur Jaya prints, Pak Supri sews). TailCraft designs sit in
   the same Designer list, "because it's basically the same company".

   Her rulings on what Done moves a line to:
     design done            -> Printing
     fluke filler or crown  -> Ready to be shipped
     third party bought     -> Ordered, and when it arrives -> Ready to be shipped

   WORK_FROM is the closed list of moves. The database function
   seadiva._work_move holds the same list and refuses anything else, so a
   button can never offer a move the database would not make.
--------------------------------------------------------------------- */
export const WORK_FROM = {
  'design needs to be made': ['Design in Progress', 'Printing'],
  'design making': ['Design in Progress', 'Printing'],
  'design in progress': ['Printing'],
  'order from 3rd party': ['Ordered'],
  'ordering from 3rdparty': ['Ordered'],
  'ordered': ['Ready to be shipped'],
  'fluke filler making': ['Ready to be shipped'],
  'in the making': ['Ready to be shipped'],
  'need to create': ['Ready to be shipped'],
  'printing': ['Sewing / Building', 'Ready to be shipped'],
  'sewing / building': ['Ready to be shipped']
};
/* [to, button label] per list. The design list offers Start only while the
   design has not been started. */
export const WORK_MOVES = {
  design: [['Design in Progress', 'Start designing'], ['Printing', 'Design done, to printing']],
  order: [['Ordered', 'Bought, now ordered']],
  ordered: [['Ready to be shipped', 'Arrived, ready to pack']],
  fluke: [['Ready to be shipped', 'Fluke filler done, ready to pack']],
  crown: [['Ready to be shipped', 'Crown done, ready to pack']],
  make: [['Ready to be shipped', 'Made, ready to pack']],
  printing: [['Sewing / Building', 'Back from print, to sewing'], ['Ready to be shipped', 'Back from print, ready to pack']],
  sewing: [['Ready to be shipped', 'Sewn, ready to pack']]
};
export const WORK_MINE = ['design', 'order', 'ordered', 'fluke', 'crown', 'make'];
export const WORK_WAITING = ['printing', 'sewing'];
export const TC_WORK_MOVES = [['design_sent', 'Design done, sent to customer'], ['lost', 'Not going ahead']];

export function workBucket(l) {
  if (!l || l.physical === false || l.packed) return null;
  const st = low(l.status);
  const text = (l.title || '') + ' ' + (l.detail || []).join(' ');
  if (l.group === 'design_todo' || l.group === 'design_wip') return 'design';
  if (l.group === 'third_todo') return 'order';
  if (l.group === 'third_ordered') return 'ordered';
  if (st === 'printing') return 'printing';
  if (st === 'sewing / building') return 'sewing';
  if (l.group === 'making') {
    if (/\bcrowns?\b/i.test(text)) return 'crown';
    if (st === 'fluke filler making' || /fluke\s*filler/i.test(text)) return 'fluke';
    return 'make';
  }
  return null;
}

/* Done clicks laid over the sheet, oldest first. A click only counts while
   the sheet still says what the click moved the line from; once the sheet
   says anything else, the sheet wins. Clicks chain (Ordered, then Arrived). */
function workIndex(list) {
  const m = {};
  (list || []).slice().sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0)).forEach((k) => {
    if (!k || !k.src || !k.invoice || !k.slot || !k.to) return;
    (m[k.src + '|' + txt(k.invoice) + '|' + k.slot] = m[k.src + '|' + txt(k.invoice) + '|' + k.slot] || []).push(k);
  });
  return m;
}
function workView(k) {
  return { id: k.id, from: k.from, to: k.to, at: k.at || null, by: k.by || '', via: k.via || '', write: k.write || '',
           written: !!k.written, writeError: k.writeError || '', job: k.job || '' };
}
function applyWork(line, clicks) {
  if (!clicks || !clicks.length) return;
  let cur = line.status, last = null;
  clicks.forEach((k) => { if (low(k.from) === low(cur)) { cur = k.to; last = k; } });
  if (last) {
    line.sheetStatus = line.status;
    line.status = cur;
    line.group = groupOf(cur);
    line.work = workView(last);
  }
}

function buildWork(orders, tcwork, now) {
  const items = {};
  WORK_MINE.concat(WORK_WAITING).forEach((k) => { items[k] = []; });
  orders.forEach((o) => {
    if (o.stage === 'old_no_status') return;
    o.lines.forEach((l) => {
      const b = workBucket(l);
      if (!b) return;
      const allowed = WORK_FROM[low(l.status)] || [];
      let moves = WORK_MOVES[b].filter((m) => allowed.includes(m[0]));
      if (!moves.length) return;
      items[b].push({
        key: o.src + '|' + o.invoice + '|' + l.slot, src: o.src, row: o.row, invoice: o.invoice, slot: l.slot,
        channel: o.channel, customer: o.customer, days: o.days, date: o.date, unpaid: o.stage === 'unpaid',
        title: l.title, detail: l.detail, qty: l.qty, status: l.status, sheetStatus: l.sheetStatus || '',
        photo: l.photo, note: l.note, work: l.work || null,
        moves: moves.map((m) => ({ to: m[0], label: m[1] }))
      });
    });
  });
  (tcwork || []).forEach((t) => {
    if (!t || t.stage !== 'design_making' || !t.project) return;
    const at = Date.parse(t.updated_at || t.created_at || '');
    items.design.push({
      key: 'TAILCRAFT|' + t.project + '|0', src: TC_SRC, row: 0, invoice: txt(t.project), project: txt(t.project), slot: 0,
      channel: 'tailcraft', tc: true, customer: txt(t.customer), title: txt(t.design) || 'Custom TailCraft design',
      detail: [t.country, t.next_action].map(txt).filter(Boolean), qty: null, status: t.stage_label || 'Custom Design Making',
      days: isFinite(at) ? Math.floor((now.getTime() - at) / DAY) : null, lastFollowUp: t.last_follow_up || null,
      photo: null, note: null, work: null, moves: TC_WORK_MOVES.map((m) => ({ to: m[0], label: m[1] }))
    });
  });
  /* Oldest first: the longest wait is the most urgent. */
  Object.keys(items).forEach((k) => items[k].sort((a, b) => (b.days == null ? -1 : b.days) - (a.days == null ? -1 : a.days)));
  const counts = {};
  Object.keys(items).forEach((k) => { counts[k] = items[k].length; });
  counts.mine = WORK_MINE.reduce((n, k) => n + items[k].length, 0);
  counts.waiting = WORK_WAITING.reduce((n, k) => n + items[k].length, 0);
  counts.tcDesign = items.design.filter((x) => x.tc).length;
  return { items, counts };
}

export function build(feed, products, now, opts) {
  now = now || new Date();
  opts = opts || {};
  const tabs = (feed && feed.tabs) || {};
  const idx = photoIndex(feed && feed.photos, products);
  const marks = markIndex(feed && feed.marks);
  const ticks = tickIndex(feed && feed.ticks);
  const work = workIndex(feed && feed.work);
  /* Product notes (13 Oct 2026, 22:24): e.g. the customer changed size or
     colour after checkout. One per product line, shared by both dashboards. */
  const notes = {};
  ((feed && feed.notes) || []).forEach((k) => {
    if (k && k.src && k.invoice && k.slot && txt(k.note)) notes[k.src + '|' + txt(k.invoice) + '|' + k.slot] = { text: String(k.note), at: k.at || null, by: k.by || '' };
  });
  /* Orders marked "Already shipped" (13 Oct 2026, 22:09) leave the list at
     once, whatever the sheet still says. */
  const shippedBy = {};
  ((feed && feed.shipped) || []).forEach((k) => { if (k && k.src && k.invoice) shippedBy[k.src + '|' + txt(k.invoice)] = k; });
  let shippedHidden = 0;
  /* Pickup or send (13 Oct 2026, 22:27): chosen once an order is packed.
     Pickup orders live only on the Sea Diva dashboard (opts.hidePickup is set
     by Befalia OS); send orders get their own To send list. */
  const handoff = {};
  ((feed && feed.handoff) || []).forEach((k) => {
    if (k && k.src && k.invoice && (k.method === 'pickup' || k.method === 'send')) handoff[k.src + '|' + txt(k.invoice)] = { method: k.method, at: k.at || null, by: k.by || '', tracking: k.tracking || '' };
  });
  let pickupHidden = 0;
  const sources = {}, all = [];
  CHANNELS.forEach((ch) => {
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
  /* TailCraft: only when the feed carries it (older feeds do not). */
  if (feed && Array.isArray(feed.tailcraft)) {
    sources.tailcraft = { ok: true, error: '', loadedAt: null };
    all.push(...readTailcraft(feed.tailcraft, now));
  }

  const orders = [];
  all.forEach((o) => {
    if (shippedBy[o.src + '|' + o.invoice]) { shippedHidden++; return; }
    o.lines.forEach((l) => {
      applyWork(l, work[o.src + '|' + o.invoice + '|' + l.slot]);
      const k = marks[o.src + '|' + o.invoice + '|' + l.slot];
      if (k && l.group !== 'done') l.packed = markView(k);
      const t = ticks[o.src + '|' + o.invoice + '|' + l.slot];
      if (t) l.inBox = t;
      const n = notes[o.src + '|' + o.invoice + '|' + l.slot];
      if (n) l.note = n;
    });
    const open = o.lines.filter((l) => l.group !== 'done' && l.group !== 'ignore');
    let include = false, stage = '';
    if (o.channel === 'shopify') {
      if (o.pay === 'paid' && /unfulfilled|partial/.test(o.fulfil)) {
        include = true;
        if (!o.lines.length) stage = 'no_items';
        else if (!open.length) stage = 'close_in_shopify';
      }
    } else if (MARKETPLACE[o.channel]) {
      /* Nothing is hidden any more (Befa, 14 Oct 00:21: unfinished orders
         were missing). Old orders with no status at all get their own tile
         instead of dropping off the list. */
      const anySet = open.some((l) => l.group !== 'blank' || l.packed);
      include = open.length > 0;
      if (include && !anySet && !(o.days !== null && o.days <= NOTSET_DAYS)) stage = 'old_no_status';
    } else if ((o.pay === 'paid' || o.pay === 'part') && open.length && !o.shipped) {
      include = true;
    } else if (o.pay === 'unpaid' && open.length && !o.shipped && open.some((l) => l.group !== 'blank')) {
      /* Not paid yet, but production has started: shown, never packed. */
      include = true;
      stage = 'unpaid';
    }
    if (!include) return;
    const physical = open.filter((l) => !nonPhysical(l.item));
    if (!stage) {
      const packed = physical.filter((l) => l.packed);
      const ready = physical.filter((l) => l.packed || READY[l.group]);
      const blank = physical.filter((l) => !l.packed && l.group === 'blank');
      if (!physical.length) stage = 'paperwork';
      else if (packed.length === physical.length) stage = 'packed';
      else if (ready.length === physical.length) stage = 'ready';
      else if (blank.length === physical.length) stage = 'not_set';
      else if (ready.length) stage = 'partly';
      else stage = 'production';
    }
    const ho = handoff[o.src + '|' + o.invoice] || null;
    if (stage === 'packed' && ho) stage = ho.method === 'pickup' ? 'pickup' : 'to_send';
    if (stage === 'pickup' && opts.hidePickup) { pickupHidden++; return; }
    const show = open.length ? open : o.lines;
    orders.push({
      channel: o.channel, src: o.src, row: o.row, invoice: o.invoice, customer: o.customer, date: o.date, dateText: o.dateText,
      days: o.days, pay: o.pay, payText: o.payText, country: o.country, stage, handoff: ho,
      shipBy: o.shipBy, shipByText: o.shipByText, shipByDays: o.shipByDays,
      doneCount: o.lines.length - open.length, lineCount: o.lines.length,
      lines: show.map((l) => ({
        slot: l.slot, title: l.title, detail: l.detail, qty: l.qty, status: l.status || '', group: l.group,
        sheetStatus: l.sheetStatus || '', work: l.work || null,
        markDone: o.pay !== 'unpaid' && l.group !== 'done' && nonPhysical(l.item),
        physical: !nonPhysical(l.item),
        canPack: stage !== 'unpaid' && l.group !== 'done' && l.group !== 'ignore' && !l.packed && !nonPhysical(l.item),
        packed: l.packed || null,
        inBox: l.inBox || null,
        note: l.note || null,
        photo: l.tailcraft ? null : photoFor(idx, o.channel, l)
      }))
    });
  });

  /* Packing first: everything ready, then the ones half ready, then what is
     still being made. Packed and waiting for the courier sit after those. */
  const RANK = { ready: 0, partly: 1, production: 2, not_set: 3, packed: 4, to_send: 5, pickup: 6, paperwork: 7, close_in_shopify: 8, no_items: 9, unpaid: 10, old_no_status: 11 };
  const due = (o) => (o.shipByDays == null ? 9999 : o.shipByDays);
  orders.sort((a, b) => (RANK[a.stage] - RANK[b.stage]) || (due(a) - due(b)) ||
    ((b.days == null ? -1 : b.days) - (a.days == null ? -1 : a.days)));

  /* "All" leaves out the old no-status marketplace orders; they have their
     own tile so they never bury the work of today. */
  const counts = { all: orders.filter((o) => o.stage !== 'old_no_status').length, shopify: 0, manual: 0, shopee: 0, toko: 0, tailcraft: 0, ready: 0, partly: 0, production: 0, not_set: 0,
                   packed: 0, to_send: 0, pickup: 0, unpaid: 0, old_no_status: 0, close_in_shopify: 0, paperwork: 0, no_items: 0, lines: 0, photos: 0, productPhotos: 0, markDone: 0,
                   packedLines: 0, packedToday: 0 };
  const today = witaDay(now.toISOString());
  orders.forEach((o) => {
    counts[o.stage]++;
    if (o.stage !== 'old_no_status') counts[o.channel]++;
    o.lines.forEach((l) => {
      counts.lines++;
      if (l.markDone) counts.markDone++;
      if (l.photo) { counts.photos++; if (l.photo.how === 'product') counts.productPhotos++; }
      if (l.packed) { counts.packedLines++; if (l.packed.at && witaDay(l.packed.at) === today) counts.packedToday++; }
    });
  });
  counts.shippedHidden = shippedHidden;
  counts.pickupHidden = pickupHidden;
  /* The last three days of "Already shipped", newest first, for Undo. */
  const since = now.getTime() - 3 * DAY;
  const shipped = ((feed && feed.shipped) || []).filter((k) => Date.parse(k.at) >= since)
    .map((k) => ({ id: k.id, src: k.src, invoice: k.invoice, customer: k.customer || '', at: k.at, by: k.by || '', lines: k.lines || 0, byHand: k.byHand || 0 }));
  const workOut = buildWork(orders, feed && feed.tcwork, now);
  /* The last day of Done clicks, newest first, so any of them can be undone
     even after the line has left every list. */
  const daySince = now.getTime() - DAY;
  workOut.log = ((feed && feed.work) || []).filter((k) => Date.parse(k.at) >= daySince)
    .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0))
    .map((k) => Object.assign(workView(k), { src: k.src, invoice: k.invoice, slot: k.slot, item: k.item || '', customer: k.customer || '' }));
  if (feed && Array.isArray(feed.tcwork)) sources.tcwork = { ok: true, error: '', loadedAt: null };
  /* The Done buttons need the database part (seadiva.work_marks and
     _work_move). Until the feed carries the click list, the page shows the
     lists without buttons and says why. */
  workOut.live = !!(feed && Array.isArray(feed.work));
  return { ok: true, generatedAt: now.toISOString(), sources, counts, orders, shipped, work: workOut };
}

/* The calendar day in Bali for a timestamp, YYYY-MM-DD. */
export function witaDay(iso) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return null;
  return new Date(t + 8 * 3600000).toISOString().slice(0, 10);
}
