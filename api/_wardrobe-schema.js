// Wardrobe data model. One table of field specs per Notion database, so that
// reading (Notion page -> plain object) and writing (whitelisted patch ->
// Notion properties) come from the same list and cannot drift apart.
//
// Underscore file: Vercel does not route it, so it is a helper, not an endpoint.

export const DB = {
  items: (process.env.WARDROBE_ITEMS_DB || 'e1be0c8741564047a094036a03b2cc81').replace(/-/g, ''),
  outfits: (process.env.WARDROBE_OUTFITS_DB || 'a4ec21765e774953a8c865104d3e9cff').replace(/-/g, ''),
  log: (process.env.WARDROBE_LOG_DB || 'bb80cd1004bb40269423fa7d8a2b12b3').replace(/-/g, ''),
  collections: (process.env.WARDROBE_COLLECTIONS_DB || '43e7a6cbb0fa4f4ba78dcf89a023e11c').replace(/-/g, ''),
  trips: (process.env.WARDROBE_TRIPS_DB || 'bb72390f45a743b2b3578b198ab0c9d6').replace(/-/g, ''),
  wish: (process.env.WARDROBE_WISH_DB || '8d2b409e101b4d158e1ebca8b9d5516c').replace(/-/g, ''),
  settings: (process.env.WARDROBE_SETTINGS_DB || '329c26f303434f93a49fb97b6f792c2c').replace(/-/g, ''),
};
export const KINDS = Object.keys(DB);

export const CATEGORIES = ['Dresses', 'Tops', 'Shirts and blouses', 'Pants', 'Jeans', 'Skirts', 'Shorts',
  'Outerwear', 'Activewear', 'Swimwear', 'Mermaid and underwater outfits', 'Performance costumes',
  'Formalwear', 'Shoes', 'Bags', 'Jewelry', 'Accessories', 'Other'];
export const SEASONS = ['All year', 'Tropical heat', 'Rainy season', 'Spring', 'Summer', 'Autumn', 'Winter'];
export const OCCASIONS = ['Business', 'Casual', 'Evening', 'Event', 'Travel', 'Beach', 'Performance'];
export const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'AUD', 'GBP'];
export const CONDITIONS = ['New', 'Excellent', 'Good', 'Worn', 'Needs repair'];
export const LAUNDRY = ['Clean', 'Worn once', 'In laundry', 'At dry cleaner', 'Needs repair'];
// Laundry states that make a piece unavailable to wear today.
export const LAUNDRY_OUT = ['In laundry', 'At dry cleaner', 'Needs repair'];
export const STATUSES = ['In closet', 'Lent out', 'Donated', 'Sold'];
export const SOURCES = ['Manual', 'AI stylist', 'Dressing room', 'Packing'];
export const LOG_KINDS = ['Planned', 'Worn'];
export const LUGGAGE = ['Carry-on only', 'One checked bag', 'Multiple bags'];
export const PRIORITIES = ['High', 'Medium', 'Low'];
export const WISH_STATUS = ['Wanted', 'Bought', 'Dropped'];
// Pieces that get washed. Shoes, bags, jewelry and accessories are not put
// into "Worn once" when an outfit is logged.
export const WASHABLE = CATEGORIES.filter((c) => !['Shoes', 'Bags', 'Jewelry', 'Accessories'].includes(c));

// type: title | text | select | multi | number | date | checkbox | url | relation | files | json
// opts: fixed option list (select/multi). Without opts a select accepts any
// clean label, which Notion then adds as a new option.
// ro: read only through the generic patch (files are written by upload ids).
export const FIELDS = {
  items: {
    name: { p: 'Name', t: 'title' },
    category: { p: 'Category', t: 'select', opts: CATEGORIES },
    subcategory: { p: 'Subcategory', t: 'text', max: 120 },
    brand: { p: 'Brand', t: 'text', max: 120 },
    color: { p: 'Color', t: 'select' },
    secondary: { p: 'Secondary colors', t: 'multi' },
    pattern: { p: 'Pattern', t: 'select' },
    material: { p: 'Material', t: 'multi' },
    size: { p: 'Size', t: 'text', max: 40 },
    fit: { p: 'Fit', t: 'select' },
    season: { p: 'Season', t: 'multi', opts: SEASONS },
    occasion: { p: 'Occasion', t: 'multi' },
    styleTags: { p: 'Style tags', t: 'multi' },
    price: { p: 'Price', t: 'number' },
    currency: { p: 'Currency', t: 'select', opts: CURRENCIES },
    purchaseDate: { p: 'Purchase date', t: 'date', past: true },
    purchaseLocation: { p: 'Purchase location', t: 'text', max: 200 },
    condition: { p: 'Condition', t: 'select', opts: CONDITIONS },
    storage: { p: 'Storage', t: 'text', max: 120 },
    laundry: { p: 'Laundry', t: 'select', opts: LAUNDRY },
    status: { p: 'Status', t: 'select', opts: STATUSES },
    favorite: { p: 'Favorite', t: 'checkbox' },
    notes: { p: 'Notes', t: 'text', max: 4000 },
    imageHash: { p: 'Image hash', t: 'text', max: 80 },
    ai: { p: 'AI analysis', t: 'json' },
    photo: { p: 'Photo', t: 'files', ro: true },
    cutout: { p: 'Cutout', t: 'files', ro: true },
  },
  outfits: {
    name: { p: 'Name', t: 'title' },
    items: { p: 'Items', t: 'relation', to: 'items' },
    occasion: { p: 'Occasion', t: 'multi' },
    source: { p: 'Source', t: 'select', opts: SOURCES },
    explanation: { p: 'Explanation', t: 'text', max: 4000 },
    alternatives: { p: 'Alternatives', t: 'json' },
    notes: { p: 'Notes', t: 'text', max: 4000 },
    layout: { p: 'Layout', t: 'json' },
    favorite: { p: 'Favorite', t: 'checkbox' },
  },
  log: {
    name: { p: 'Name', t: 'title' },
    date: { p: 'Date', t: 'date' },
    kind: { p: 'Kind', t: 'select', opts: LOG_KINDS },
    outfit: { p: 'Outfit', t: 'relation', to: 'outfits', single: true },
    items: { p: 'Items', t: 'relation', to: 'items' },
    event: { p: 'Event', t: 'text', max: 300 },
    taskId: { p: 'Task ID', t: 'text', max: 40 },
    notes: { p: 'Notes', t: 'text', max: 2000 },
  },
  collections: {
    name: { p: 'Name', t: 'title' },
    items: { p: 'Items', t: 'relation', to: 'items' },
    outfits: { p: 'Outfits', t: 'relation', to: 'outfits' },
    notes: { p: 'Notes', t: 'text', max: 4000 },
    order: { p: 'Order', t: 'number', neg: true },
  },
  trips: {
    name: { p: 'Name', t: 'title' },
    destination: { p: 'Destination', t: 'text', max: 200 },
    dates: { p: 'Dates', t: 'date' },
    activities: { p: 'Activities', t: 'text', max: 2000 },
    dressCodes: { p: 'Dress codes', t: 'text', max: 1000 },
    luggage: { p: 'Luggage', t: 'select', opts: LUGGAGE },
    plan: { p: 'Plan', t: 'json' },
    template: { p: 'Template', t: 'checkbox' },
    notes: { p: 'Notes', t: 'text', max: 2000 },
  },
  wish: {
    name: { p: 'Name', t: 'title' },
    category: { p: 'Category', t: 'select', opts: CATEGORIES },
    brand: { p: 'Brand', t: 'text', max: 120 },
    color: { p: 'Color', t: 'text', max: 80 },
    size: { p: 'Size', t: 'text', max: 40 },
    price: { p: 'Price', t: 'number' },
    currency: { p: 'Currency', t: 'select', opts: CURRENCIES },
    link: { p: 'Link', t: 'url' },
    priority: { p: 'Priority', t: 'select', opts: PRIORITIES },
    status: { p: 'Status', t: 'select', opts: WISH_STATUS },
    notes: { p: 'Notes', t: 'text', max: 2000 },
    aiNotes: { p: 'AI notes', t: 'json' },
    image: { p: 'Image', t: 'files', ro: true },
  },
  settings: {
    name: { p: 'Name', t: 'title' },
    value: { p: 'Value', t: 'text', max: 100000 },
  },
};

export const nid = (s) => String(s || '').replace(/-/g, '');
const plain = (arr) => (arr || []).map((x) => x.plain_text != null ? x.plain_text : ((x.text && x.text.content) || '')).join('');

export function rt(s) {
  s = String(s == null ? '' : s);
  const out = [];
  for (let i = 0; i < s.length && out.length < 100; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
}

export function badReq(m, status = 400) { const e = new Error(m); e.status = status; return e; }

// Notion select and multi-select names cannot hold commas and top out at 100.
function label(v) {
  return String(v == null ? '' : v).replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function mapFiles(prop) {
  const files = (prop && prop.files) || [];
  return files.map((f) => {
    if (f.type === 'external') return { name: f.name || '', url: f.external && f.external.url, external: true };
    return { name: f.name || '', url: f.file && f.file.url, expires: f.file && f.file.expiry_time };
  }).filter((f) => f.url);
}

// Notion page -> plain object for the client. Relations carry has_more when a
// page has over 25 links; the route completes those before answering.
export function mapPage(kind, pg) {
  const spec = FIELDS[kind];
  const pr = pg.properties || {};
  const o = { id: nid(pg.id), created: pg.created_time, edited: pg.last_edited_time, url: pg.url };
  for (const key of Object.keys(spec)) {
    const f = spec[key];
    const v = pr[f.p];
    switch (f.t) {
      case 'title': o[key] = plain(v && v.title); break;
      case 'text': o[key] = plain(v && v.rich_text); break;
      case 'json': {
        const s = plain(v && v.rich_text);
        let j = null; if (s) { try { j = JSON.parse(s); } catch (e) { j = null; } }
        o[key] = j; break;
      }
      case 'select': o[key] = (v && v.select && v.select.name) || null; break;
      case 'multi': o[key] = ((v && v.multi_select) || []).map((x) => x.name); break;
      case 'number': o[key] = v && typeof v.number === 'number' ? v.number : null; break;
      case 'checkbox': o[key] = !!(v && v.checkbox); break;
      case 'url': o[key] = (v && v.url) || ''; break;
      case 'date': o[key] = v && v.date ? { start: String(v.date.start).slice(0, 10), end: v.date.end ? String(v.date.end).slice(0, 10) : null } : null; break;
      case 'relation': {
        const ids = ((v && v.relation) || []).map((x) => nid(x.id));
        o[key] = f.single ? (ids[0] || null) : ids;
        if (v && v.has_more) { o._more = o._more || []; o._more.push({ key, propId: v.id }); }
        break;
      }
      case 'files': o[key] = mapFiles(v); break;
      default: break;
    }
  }
  return o;
}

// Whitelisted client patch -> Notion properties. Unknown keys are ignored,
// read-only keys refused, every value checked against its type.
export function buildProps(kind, patch, today) {
  const spec = FIELDS[kind];
  if (!spec) throw badReq('Unknown kind');
  const props = {};
  for (const key of Object.keys(patch || {})) {
    const f = spec[key];
    if (!f) continue;
    if (f.ro) throw badReq(key + ' is written by uploads, not by edits');
    const v = patch[key];
    switch (f.t) {
      case 'title': {
        const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
        if (!s) throw badReq('A name is required');
        props[f.p] = { title: rt(s.slice(0, 300)) }; break;
      }
      case 'text': props[f.p] = { rich_text: rt(String(v == null ? '' : v).slice(0, f.max || 2000)) }; break;
      case 'json': {
        if (v == null) { props[f.p] = { rich_text: [] }; break; }
        const s = JSON.stringify(v);
        if (s.length > 150000) throw badReq(key + ' is too large to store');
        props[f.p] = { rich_text: rt(s) }; break;
      }
      case 'select': {
        if (v == null || v === '') { props[f.p] = { select: null }; break; }
        const s = label(v);
        if (f.opts && !f.opts.includes(s)) throw badReq('Unknown ' + key + ': ' + s);
        if (!s) { props[f.p] = { select: null }; break; }
        props[f.p] = { select: { name: s } }; break;
      }
      case 'multi': {
        const arr = Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
        const seen = new Set();
        const out = [];
        for (const x of arr) {
          const s = label(x);
          if (!s || seen.has(s.toLowerCase())) continue;
          if (f.opts && !f.opts.includes(s)) throw badReq('Unknown ' + key + ': ' + s);
          seen.add(s.toLowerCase()); out.push({ name: s });
        }
        if (out.length > 25) throw badReq('Too many ' + key + ' values');
        props[f.p] = { multi_select: out }; break;
      }
      case 'number': {
        if (v === null || v === '') { props[f.p] = { number: null }; break; }
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
        if (!isFinite(n) || (!f.neg && n < 0) || Math.abs(n) > 1e12) throw badReq(key + ' must be a sensible number');
        props[f.p] = { number: n }; break;
      }
      case 'checkbox': props[f.p] = { checkbox: !!v }; break;
      case 'url': {
        const s = String(v || '').trim();
        if (s && !/^https?:\/\/[^\s]+$/i.test(s)) throw badReq('Links must start with http:// or https://');
        props[f.p] = { url: s ? s.slice(0, 2000) : null }; break;
      }
      case 'date': {
        if (!v) { props[f.p] = { date: null }; break; }
        const start = typeof v === 'string' ? v : v.start;
        const end = typeof v === 'string' ? null : (v.end || null);
        if (!DATE_RE.test(String(start || '')) || (end && !DATE_RE.test(String(end)))) throw badReq('Dates must be YYYY-MM-DD');
        if (end && end < start) throw badReq('The end date is before the start date');
        if (f.past && today && start > today) throw badReq(key + ' cannot be in the future');
        props[f.p] = { date: { start, end } }; break;
      }
      case 'relation': {
        const arr = f.single ? (v ? [v] : []) : (Array.isArray(v) ? v : []);
        const ids = [...new Set(arr.map(nid).filter((x) => /^[0-9a-f]{32}$/.test(x)))];
        if (ids.length > 100) throw badReq('Too many links in ' + key);
        props[f.p] = { relation: ids.map((id) => ({ id })) }; break;
      }
      default: break;
    }
  }
  return props;
}
