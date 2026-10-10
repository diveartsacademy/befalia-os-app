// Wardrobe backend. Reads and writes the seven databases on the Notion page
// Personal Life / Wardrobe, and nothing else.
//
// Gates, in the order they run:
//   1. the OS key, same as every route (api/_auth.js)
//   2. every edit, archive or photo call first fetches the page and checks that
//      its parent is the right wardrobe database (403 otherwise), so a bug or a
//      leaked key here cannot touch a journal or the To-Do
//   3. fields are whitelisted per database (api/_wardrobe-schema.js)
//   4. uploads must be real JPEG, PNG or WebP bytes under 3 MB
//   5. original photos are never replaced: a second photo is appended to the
//      page body; only the background-removed copy can be swapped
//   6. AI calls reserve a slot in a daily meter first (WARDROBE_AI_DAILY_CAP,
//      default 40). If the meter cannot be read or written, nothing is sent to
//      Claude. Fails closed, like /api/vision
//   7. stylist, packing and wishlist answers are checked against her catalog
//      and anything she does not own is dropped (api/_wardrobe-ai.js)
//
// Honest limit: the OS key is one shared key with no per-person identity. "The
// authenticated user" here means whoever holds that key. See docs/endpoints.md.
import { requireKey } from './_auth.js';
import { DB, KINDS, FIELDS, LAUNDRY_OUT, WASHABLE, mapPage, buildProps, nid, rt, badReq } from './_wardrobe-schema.js';
import {
  claude, scanModels, stylistModels, parseJsonLoose, SCAN_SYSTEM, normalizeScan, availableItems, wearStats,
  buildCatalog, validateLook, flagLooks, stylistSystem, packSystem, wishSystem, forecast, weatherLine, addDays,
} from './_wardrobe-ai.js';

const NOTION = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const TZ = 'Asia/Makassar';
const CAP = Math.max(1, parseInt(process.env.WARDROBE_AI_DAILY_CAP || '40', 10) || 40);
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const IMAGE_HOSTS = ['prod-files-secure.s3.us-west-2.amazonaws.com', 's3.us-west-2.amazonaws.com', 'file.notion.so'];
const EDITABLE = KINDS.filter((k) => k !== 'settings');
const BULK_FIELDS = ['laundry', 'status', 'category', 'season', 'occasion', 'styleTags', 'storage', 'favorite', 'condition'];

export const witaDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hdr = (token, json = true) => Object.assign({ 'Authorization': 'Bearer ' + token, 'Notion-Version': VERSION }, json ? { 'Content-Type': 'application/json' } : {});

async function notion(path, H, opts = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(NOTION + path, { method: opts.method || 'GET', headers: H, body: opts.body ? JSON.stringify(opts.body) : undefined });
    let d = {};
    try { d = await r.json(); } catch (e) { d = {}; }
    if (r.status === 429 && attempt < 2) { await sleep(Math.min(4000, (parseFloat(r.headers.get('retry-after')) || 1) * 1000)); continue; }
    if (!r.ok || d.object === 'error') {
      const e = new Error(explain(d, r.status)); e.status = 502; e.notionCode = d.code || ('http_' + r.status); throw e;
    }
    return d;
  }
  const e = new Error('Notion kept rate limiting us. Try again in a minute.'); e.status = 503; throw e;
}

function explain(d, status) {
  if (d && d.code === 'object_not_found') return 'Notion cannot see that wardrobe page. Check the Wardrobe page under Personal Life is still connected to the Befalia OS integration.';
  if (d && d.code === 'unauthorized') return 'Notion refused the token. NOTION_TOKEN in Vercel may be wrong or revoked.';
  if (d && d.code === 'rate_limited') return 'Notion is rate limiting us. Wait a few seconds and try again.';
  if (d && d.code === 'validation_error') return 'Notion refused the change: ' + (d.message || 'validation error');
  return 'Notion error: ' + ((d && d.message) || ('HTTP ' + status));
}

async function queryAll(kind, H, filter) {
  const pages = [];
  let cursor;
  for (let i = 0; i < 50; i++) {
    const body = { page_size: 100, sorts: [{ timestamp: 'created_time', direction: 'ascending' }] };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const d = await notion('/databases/' + DB[kind] + '/query', H, { method: 'POST', body });
    for (const pg of d.results || []) if (!pg.archived && !pg.in_trash) pages.push(pg);
    if (!d.has_more) break;
    cursor = d.next_cursor;
  }
  return pages;
}

// Relations over 25 links come back truncated on the page object. Fill them in.
async function complete(kind, obj, H) {
  if (!obj._more) return obj;
  for (const m of obj._more) {
    const ids = [];
    let cursor;
    for (let i = 0; i < 20; i++) {
      const d = await notion('/pages/' + obj.id + '/properties/' + encodeURIComponent(m.propId) + (cursor ? '?start_cursor=' + encodeURIComponent(cursor) : ''), H);
      for (const r of d.results || []) if (r.relation && r.relation.id) ids.push(nid(r.relation.id));
      if (!d.has_more) break;
      cursor = d.next_cursor;
    }
    obj[m.key] = FIELDS[kind][m.key].single ? (ids[0] || null) : ids;
  }
  delete obj._more;
  return obj;
}

async function listKind(kind, H) {
  const pages = await queryAll(kind, H);
  const out = [];
  for (const pg of pages) out.push(await complete(kind, mapPage(kind, pg), H));
  return out;
}

async function assertIn(kind, id, H) {
  if (!/^[0-9a-f]{32}$/.test(nid(id))) throw badReq('Bad id');
  const pg = await notion('/pages/' + nid(id), H);
  const owner = nid((pg.parent && pg.parent.database_id) || '');
  if (owner !== DB[kind]) { const e = new Error('That page is not in the wardrobe ' + kind + ' database, so the wardrobe will not touch it'); e.status = 403; throw e; }
  if (pg.archived || pg.in_trash) throw badReq('That entry was deleted', 410);
  return pg;
}

/* ---------------- settings and the AI meter ---------------- */

async function settingRow(H, key) {
  const d = await notion('/databases/' + DB.settings + '/query', H, { method: 'POST', body: { page_size: 5, filter: { property: 'Name', title: { equals: key } } } });
  return (d.results || []).filter((p) => !p.archived && !p.in_trash)[0] || null;
}
async function readSetting(H, key) {
  const pg = await settingRow(H, key);
  return { page: pg, value: pg ? mapPage('settings', pg).value : '' };
}
async function writeSetting(H, key, value, page) {
  const props = { Name: { title: rt(key) }, Value: { rich_text: rt(value) } };
  if (page) return notion('/pages/' + nid(page.id), H, { method: 'PATCH', body: { properties: { Value: props.Value } } });
  return notion('/pages', H, { method: 'POST', body: { parent: { database_id: DB.settings }, properties: props } });
}
async function readMeter(H) {
  const s = await readSetting(H, 'ai_meter');
  const m = String(s.value || '').match(/^(\d{4}-\d{2}-\d{2})\|(\d+)/);
  const day = witaDate();
  return { page: s.page, day, used: m && m[1] === day ? parseInt(m[2], 10) || 0 : 0 };
}
async function reserve(H) {
  let m;
  try {
    m = await readMeter(H);
    if (m.used >= CAP) { const e = new Error('Daily AI limit reached: ' + m.used + ' of ' + CAP + ' today. It resets at midnight WITA. Raise WARDROBE_AI_DAILY_CAP in Vercel if you need more.'); e.status = 429; e.capped = true; throw e; }
    await writeSetting(H, 'ai_meter', m.day + '|' + (m.used + 1), m.page);
  } catch (e) {
    if (e.capped) throw e;
    const x = new Error('The daily AI meter could not be checked (' + (e.message || e) + '), so nothing was sent to Claude.'); x.status = 503; throw x;
  }
  return m.used + 1;
}
async function refund(H) {
  try { const m = await readMeter(H); if (m.used > 0) await writeSetting(H, 'ai_meter', m.day + '|' + (m.used - 1), m.page); } catch (e) { /* best effort */ }
}
async function loadProfile(H) {
  try { const s = await readSetting(H, 'profile'); return s.value ? JSON.parse(s.value) : {}; } catch (e) { return {}; }
}

/* ---------------- files ---------------- */

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
function decodeImage(data) {
  let s = String(data || '');
  const comma = s.indexOf(',');
  if (s.slice(0, 5) === 'data:' && comma !== -1) s = s.slice(comma + 1);
  if (!s) throw badReq('No image');
  if (s.length > Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 16) throw badReq('That image is over 3 MB after compression. Try a smaller photo.', 413);
  const buf = Buffer.from(s, 'base64');
  const mime = sniff(buf);
  if (!mime) throw badReq('That file is not a JPEG, PNG or WebP image');
  if (buf.length > MAX_UPLOAD_BYTES) throw badReq('That image is over 3 MB after compression.', 413);
  return { buf, mime, b64: s };
}

async function uploadToNotion(token, data, filename) {
  const { buf, mime } = decodeImage(data);
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const name = (String(filename || 'photo').replace(/[^\w.-]+/g, '-').replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'photo') + '.' + ext;
  const created = await notion('/file_uploads', hdr(token), { method: 'POST', body: { filename: name, content_type: mime } });
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime }), name);
  const url = created.upload_url || (NOTION + '/file_uploads/' + created.id + '/send');
  const r = await fetch(url, { method: 'POST', headers: hdr(token, false), body: fd });
  let d = {}; try { d = await r.json(); } catch (e) { d = {}; }
  if (!r.ok || d.object === 'error' || (d.status && d.status !== 'uploaded')) {
    const e = new Error('Notion did not accept the photo: ' + (d.message || d.status || ('HTTP ' + r.status))); e.status = 502; throw e;
  }
  return { id: created.id, name, bytes: buf.length, mime };
}

const uploadRef = (u, name) => ({ type: 'file_upload', file_upload: { id: String(u) }, name: String(name || 'photo').slice(0, 90) });
const okUpload = (u) => typeof u === 'string' && /^[0-9a-f-]{32,36}$/i.test(u);

async function listImages(id, H) {
  const out = [];
  let cursor;
  for (let i = 0; i < 5; i++) {
    const d = await notion('/blocks/' + nid(id) + '/children?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''), H);
    for (const b of d.results || []) {
      if (b.type !== 'image' || b.archived || b.in_trash) continue;
      const im = b.image || {};
      const url = im.type === 'external' ? im.external && im.external.url : im.file && im.file.url;
      if (url) out.push({ block: nid(b.id), url, caption: (im.caption || []).map((c) => c.plain_text || '').join(''), created: b.created_time });
    }
    if (!d.has_more) break;
    cursor = d.next_cursor;
  }
  return out;
}
async function appendImage(id, upload, caption, H) {
  if (!okUpload(upload)) throw badReq('Bad upload id');
  await notion('/blocks/' + nid(id) + '/children', H, { method: 'PATCH', body: { children: [{ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: upload }, caption: rt(String(caption || '').slice(0, 200)) } }] } });
}

/* ---------------- write helpers ---------------- */

function logTitle(date, kind, label) {
  return [date || 'undated', kind || 'Planned', label || 'Look'].join(' · ').slice(0, 200);
}

async function outfitItems(outfitId, H) {
  const pg = await assertIn('outfits', outfitId, H);
  const o = await complete('outfits', mapPage('outfits', pg), H);
  return o;
}

// Wear and plan rows keep a snapshot of the pieces, taken from the outfit when
// none are given, so history survives the outfit being edited later.
async function prepareLog(data, today, H, existing) {
  const d = Object.assign({}, data);
  const kind = d.kind || (existing && existing.kind) || 'Planned';
  const date = d.date || (existing && existing.date);
  const day = date && (typeof date === 'string' ? date : date.start);
  if (kind === 'Worn' && day && day > today) throw badReq('A look cannot be marked worn on a day that has not happened yet');
  const outfitId = 'outfit' in d ? d.outfit : (existing && existing.outfit);
  let label = d.label;
  // Snapshot on create, on a new outfit, and when a plan becomes a wear.
  const snap = !existing || 'outfit' in d || (kind === 'Worn' && existing.kind !== 'Worn');
  if (outfitId && snap) {
    const o = await outfitItems(outfitId, H);
    if (!('items' in d) || !Array.isArray(d.items) || !d.items.length) d.items = o.items;
    label = label || o.name;
  }
  if ((!d.items || !d.items.length) && !(existing && existing.items && existing.items.length) && !outfitId) throw badReq('Pick an outfit or at least one piece');
  delete d.label;
  if (!existing || 'kind' in data || 'date' in data || 'outfit' in data) d.name = logTitle(day, kind, label || (existing && existing.name && existing.name.split(' · ')[2]) || 'Pieces');
  return d;
}

async function markWornLaundry(itemIds, H) {
  const changed = [];
  for (const id of itemIds.slice(0, 30)) {
    try {
      const pg = await assertIn('items', id, H);
      const it = mapPage('items', pg);
      if (WASHABLE.includes(it.category) && (!it.laundry || it.laundry === 'Clean')) {
        const up = await notion('/pages/' + it.id, H, { method: 'PATCH', body: { properties: buildProps('items', { laundry: 'Worn once' }) } });
        changed.push(mapPage('items', up));
      }
    } catch (e) { /* one failed piece does not undo the wear log */ }
  }
  return changed;
}

/* ---------------- AI handlers ---------------- */

async function aiContext(H, opts) {
  const [items, logs, profile] = await Promise.all([listKind('items', H), listKind('log', H), loadProfile(H)]);
  const stats = wearStats(items, logs);
  const avail = availableItems(items, opts);
  return { items, logs, profile, stats, avail };
}

function recentWorn(logs, back, since) {
  return logs.filter((l) => l.kind === 'Worn' && l.date && l.date.start >= since)
    .sort((a, b) => (a.date.start < b.date.start ? 1 : -1)).slice(0, 20)
    .map((l) => l.date.start + ': ' + (l.items || []).map((id) => back[id]).filter(Boolean).join(', ')).filter((s) => /i\d/.test(s));
}

async function aiStyle(body, H, today) {
  const ctx = await aiContext(H, { includeLaundry: !!body.allowLaundry });
  if (!ctx.avail.length) throw badReq('There are no pieces available to style yet. Add a few pieces first, or allow laundry items.');
  const cat = buildCatalog(ctx.avail, ctx.stats);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? body.date : today;
  const focusId = body.focusId ? nid(body.focusId) : null;
  if (focusId && !cat.back[focusId]) throw badReq('That piece is not available to style right now (it may be in the laundry or not in your closet).');
  const count = Math.max(1, Math.min(5, parseInt(body.count, 10) || (focusId ? 3 : 3)));
  const weather = body.place ? await forecast(body.place, date, date, today) : null;
  const history = (Array.isArray(body.history) ? body.history : []).slice(-6).map((h) => (h.role === 'me' ? 'She said: ' : 'You suggested: ') + String(h.text || '').slice(0, 400));
  const lines = [
    'Request: ' + String(body.request || 'Style me for today').slice(0, 600),
    'Date: ' + date + (body.timeOfDay ? ', ' + String(body.timeOfDay).slice(0, 30) : ''),
    body.place ? 'Place: ' + String(body.place).slice(0, 80) : '',
    body.occasion ? 'Occasion: ' + String(body.occasion).slice(0, 80) : '',
    body.dressCode ? 'Dress code: ' + String(body.dressCode).slice(0, 80) : '',
    weather ? weatherLine(weather) : 'No forecast available. Do not state the weather.',
    focusId ? 'Every look must include ' + cat.back[focusId] + '. Make each look clearly different.' : '',
    body.avoidRepeatDays ? 'Avoid repeating any full look she wore in the last ' + Math.min(90, parseInt(body.avoidRepeatDays, 10) || 14) + ' days.' : '',
    'Recently worn: ' + (recentWorn(ctx.logs, cat.back, addDays(date, -21)).join('; ') || 'nothing logged'),
    history.length ? 'Conversation so far:\n' + history.join('\n') : '',
    'Give ' + count + ' look' + (count > 1 ? 's' : '') + '.',
    'Catalog (' + ctx.avail.length + ' pieces):', cat.text,
  ].filter(Boolean).join('\n');
  const used = await reserve(H);
  let res;
  try { res = await claude(stylistModels(), stylistSystem(ctx.profile), [{ type: 'text', text: lines }], 3000); }
  catch (e) { if (e.upstream) await refund(H); throw e; }
  const raw = parseJsonLoose(res.text);
  const counter = { dropped: 0 };
  const looks = (raw && Array.isArray(raw.looks) ? raw.looks : []).map((l) => validateLook(l, cat.refs, counter)).filter(Boolean).slice(0, count);
  flagLooks(looks, ctx.logs, { avoidRepeatDays: parseInt(body.avoidRepeatDays, 10) || 0, date, focusId });
  return { looks, note: raw ? String(raw.note || '').slice(0, 300) : 'The stylist answer could not be read. Try again.', dropped: counter.dropped, weather, model: res.model, used, cap: CAP, considered: ctx.avail.length };
}

async function aiPack(body, H, today) {
  const start = String(body.start || ''), end = String(body.end || body.start || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) throw badReq('Give the trip a start and end date');
  const days = [];
  for (let d = start; d <= end && days.length < 22; d = addDays(d, 1)) days.push(d);
  if (days.length > 21) throw badReq('Trips up to 21 days can be planned at once');
  const ctx = await aiContext(H, { includeLaundry: true });
  if (!ctx.avail.length) throw badReq('There are no pieces in your closet yet to pack from.');
  const cat = buildCatalog(ctx.avail, ctx.stats);
  const weather = body.destination ? await forecast(body.destination, start, end, today) : null;
  const text = [
    'Destination: ' + String(body.destination || '').slice(0, 120),
    'Dates: ' + start + ' to ' + end + ' (' + days.length + ' days): ' + days.join(', '),
    body.activities ? 'Planned activities: ' + String(body.activities).slice(0, 800) : '',
    body.dressCodes ? 'Dress codes: ' + String(body.dressCodes).slice(0, 400) : '',
    body.luggage ? 'Luggage: ' + String(body.luggage).slice(0, 40) : '',
    body.notes ? 'Notes: ' + String(body.notes).slice(0, 400) : '',
    weather ? weatherLine(weather) : 'No forecast available for these dates.',
    'Catalog:', cat.text,
  ].filter(Boolean).join('\n');
  const used = await reserve(H);
  let res;
  try { res = await claude(stylistModels(), packSystem(ctx.profile), [{ type: 'text', text }], 4000); }
  catch (e) { if (e.upstream) await refund(H); throw e; }
  const raw = parseJsonLoose(res.text) || {};
  const counter = { dropped: 0 };
  const planDays = days.map((d) => {
    const hit = (Array.isArray(raw.days) ? raw.days : []).find((x) => x && x.date === d);
    const look = hit && hit.look ? validateLook(hit.look, cat.refs, counter) : null;
    return { date: d, plan: hit ? String(hit.plan || '').slice(0, 200) : '', look };
  });
  const ids = [...new Set(planDays.flatMap((d) => (d.look ? d.look.pieces.map((p) => p.id) : [])))];
  const byId = Object.fromEntries(ctx.items.map((i) => [i.id, i]));
  const strList = (a, n) => (Array.isArray(a) ? a : []).map((x) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean).slice(0, n)
    .map((label) => ({ label, packed: false }));
  const reusable = (Array.isArray(raw.reusable) ? raw.reusable : []).slice(0, 4).map((r) => ({
    name: String((r && r.name) || 'Capsule').slice(0, 60),
    ids: (Array.isArray(r && r.refs) ? r.refs : []).map((x) => cat.refs[String(x).toLowerCase()]).filter((x) => { if (!x) counter.dropped++; return !!x; }),
  })).filter((r) => r.ids.length);
  return {
    plan: {
      v: 1, generated: new Date().toISOString(), model: res.model, weather,
      days: planDays,
      pieces: ids.map((id) => ({ id, packed: false, group: ['Shoes', 'Bags', 'Jewelry', 'Accessories'].includes(byId[id] && byId[id].category) ? 'shoes' : 'clothing', laundry: byId[id] && LAUNDRY_OUT.includes(byId[id].laundry) ? byId[id].laundry : null })),
      toiletries: strList(raw.toiletries, 25),
      personal: strList(raw.personal, 25),
      reusable,
      missing: (Array.isArray(raw.missing) ? raw.missing : []).slice(0, 8).map((m) => ({ description: String((m && m.description) || '').slice(0, 140), why: String((m && m.why) || '').slice(0, 200), packed: false })).filter((m) => m.description),
      note: String(raw.note || '').slice(0, 300),
      dropped: counter.dropped,
    },
    used, cap: CAP,
  };
}

async function aiWish(body, H) {
  const pg = await assertIn('wish', body.id, H);
  const w = mapPage('wish', pg);
  const ctx = await aiContext(H, { includeLaundry: true, includeLent: true });
  if (!ctx.avail.length) throw badReq('Add some pieces to your closet first, so there is something to compare with.');
  const cat = buildCatalog(ctx.avail, ctx.stats);
  const text = ['Wishlist piece: ' + [w.name, w.category, w.brand, w.color, w.notes].filter(Boolean).join(' | '), 'Catalog:', cat.text].join('\n');
  const used = await reserve(H);
  let res;
  try { res = await claude(stylistModels(), wishSystem(), [{ type: 'text', text }], 1200); }
  catch (e) { if (e.upstream) await refund(H); throw e; }
  const raw = parseJsonLoose(res.text) || {};
  let dropped = 0;
  const pairs = (Array.isArray(raw.pairs) ? raw.pairs : []).slice(0, 4).map((p) => ({
    ids: (Array.isArray(p && p.refs) ? p.refs : []).map((x) => cat.refs[String(x).toLowerCase()]).filter((x) => { if (!x) dropped++; return !!x; }),
    how: String((p && p.how) || '').slice(0, 200),
  })).filter((p) => p.ids.length);
  const similar = (Array.isArray(raw.similar) ? raw.similar : []).map((x) => cat.refs[String(x).toLowerCase()]).filter((x) => { if (!x) dropped++; return !!x; }).slice(0, 5);
  const verdict = ['fills a gap', 'nice to have', 'likely duplicate'].includes(String(raw.verdict || '').toLowerCase()) ? String(raw.verdict).toLowerCase() : 'nice to have';
  const ai = { verdict, reason: String(raw.reason || '').slice(0, 400), pairs, similar, dropped, model: res.model, at: new Date().toISOString() };
  const up = await notion('/pages/' + w.id, H, { method: 'PATCH', body: { properties: buildProps('wish', { aiNotes: ai }) } });
  return { wish: mapPage('wish', up), used, cap: CAP };
}

async function aiScan(body, H, token) {
  const hash = /^[0-9a-f]{64}$/.test(String(body.hash || '')) ? body.hash : null;
  if (hash && !body.force) {
    const d = await notion('/databases/' + DB.items + '/query', H, { method: 'POST', body: { page_size: 3, filter: { property: 'Image hash', rich_text: { equals: hash } } } });
    const hit = (d.results || []).filter((p) => !p.archived && !p.in_trash).map((p) => mapPage('items', p))[0];
    if (hit) return { cached: true, duplicate: { id: hit.id, name: hit.name }, scan: hit.ai && hit.ai.scan ? hit.ai.scan : null };
  }
  const img = decodeImage(body.data);
  const used = await reserve(H);
  let res;
  try {
    res = await claude(scanModels(), SCAN_SYSTEM, [
      { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.b64 } },
      { type: 'text', text: 'Catalogue the clothing in this photo.' + (body.hint ? ' Owner\'s hint: ' + String(body.hint).slice(0, 200) : '') + ' JSON only.' },
    ], 1500);
  } catch (e) { if (e.upstream) await refund(H); throw e; }
  const raw = parseJsonLoose(res.text);
  if (!raw) return { scan: { isClothing: false, items: [], note: 'The scanner answer could not be read. Fill the details by hand or try again.' }, used, cap: CAP, model: res.model };
  return { scan: normalizeScan(raw), used, cap: CAP, model: res.model };
}

async function removeBg(body) {
  const key = process.env.REMOVEBG_API_KEY;
  if (!key) { const e = new Error('No server background remover is set up. The app removes backgrounds on your phone instead.'); e.status = 501; throw e; }
  const img = decodeImage(body.data);
  const fd = new FormData();
  fd.append('image_file_b64', img.b64);
  fd.append('size', 'auto');
  fd.append('format', 'png');
  const r = await fetch('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': key }, body: fd });
  if (!r.ok) { let t = ''; try { t = await r.text(); } catch (e) { t = ''; } const e = new Error('remove.bg refused it (HTTP ' + r.status + '): ' + t.slice(0, 200)); e.status = 502; throw e; }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_UPLOAD_BYTES) throw badReq('The cut-out came back too large', 413);
  return { data: buf.toString('base64'), mime: 'image/png' };
}

async function proxyImage(body) {
  let u;
  try { u = new URL(String(body.url || '')); } catch (e) { throw badReq('Bad image address'); }
  if (u.protocol !== 'https:' || !IMAGE_HOSTS.includes(u.hostname)) throw badReq('Only your own Notion photos can be fetched');
  const r = await fetch(u.toString(), { redirect: 'error' });
  if (!r.ok) throw badReq('That photo link has expired. Reload the wardrobe and try again.', 410);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 4 * 1024 * 1024) throw badReq('Photo too large to fetch', 413);
  const mime = sniff(buf);
  if (!mime) throw badReq('That file is not an image');
  return { data: buf.toString('base64'), mime };
}

/* ---------------- handler ---------------- */

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Free health check: counts and switches only, no names, photos or notes.
    const tok = process.env.NOTION_TOKEN;
    if (!tok) { res.status(500).json({ ok: false, error: 'NOTION_TOKEN env var is not set in Vercel' }); return; }
    const HG = hdr(tok);
    const out = { ok: true, today: witaDate(), keyGate: !!process.env.OS_KEY, counts: {}, ai: !!process.env.ANTHROPIC_API_KEY, bgServer: !!process.env.REMOVEBG_API_KEY, tryon: false, weather: process.env.WARDROBE_WEATHER !== 'off', cap: CAP };
    try {
      for (const k of EDITABLE) out.counts[k] = (await queryAll(k, HG)).length;
      const m = await readMeter(HG);
      out.used = m.used; out.meterRow = !!m.page;
    } catch (e) { out.ok = false; out.error = String(e.message || e); }
    res.status(200).json(out);
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST or GET only' }); return; }
  if (!requireKey(req, res)) return;
  const token = process.env.NOTION_TOKEN;
  if (!token) { res.status(500).json({ error: 'NOTION_TOKEN env var is not set in Vercel' }); return; }
  const H = hdr(token);
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const today = witaDate();
  const a = body.action;
  const kind = body.kind;

  try {
    if (a === 'ping') { res.status(200).json({ ok: true, today }); return; }

    if (a === 'list') {
      const want = (Array.isArray(body.kinds) ? body.kinds : EDITABLE).filter((k) => EDITABLE.includes(k));
      const out = { today, tz: TZ };
      // Two at a time keeps us inside Notion's request rate.
      for (let i = 0; i < want.length; i += 2) {
        const part = await Promise.all(want.slice(i, i + 2).map((k) => listKind(k, H)));
        part.forEach((rows, j) => { out[want[i + j]] = rows; });
      }
      if (body.withProfile !== false) out.profile = await loadProfile(H);
      try { const m = await readMeter(H); out.meter = { used: m.used, cap: CAP }; } catch (e) { out.meter = { used: null, cap: CAP, error: String(e.message || e) }; }
      out.server = { ai: !!process.env.ANTHROPIC_API_KEY, bgServer: !!process.env.REMOVEBG_API_KEY, tryon: false, weather: process.env.WARDROBE_WEATHER !== 'off' };
      res.status(200).json(out);
      return;
    }

    if (a === 'upload') {
      const u = await uploadToNotion(token, body.data, body.filename);
      res.status(200).json({ upload: u.id, name: u.name, bytes: u.bytes, mime: u.mime });
      return;
    }

    if (a === 'create') {
      if (!EDITABLE.includes(kind)) throw badReq('Unknown kind');
      let data = Object.assign({}, body.data || {});
      if (kind === 'log') data = await prepareLog(data, today, H, null);
      if (kind === 'items') { if (!data.status) data.status = 'In closet'; if (!data.laundry) data.laundry = 'Clean'; }
      if (kind === 'wish' && !data.status) data.status = 'Wanted';
      const props = buildProps(kind, data, today);
      if (!props[FIELDS[kind].name.p]) throw badReq('A name is required');
      const up = body.uploads || {};
      if (kind === 'items') {
        if (up.photo) { if (!okUpload(up.photo)) throw badReq('Bad upload id'); props.Photo = { files: [uploadRef(up.photo, 'original')] }; }
        if (up.cutout) { if (!okUpload(up.cutout)) throw badReq('Bad upload id'); props.Cutout = { files: [uploadRef(up.cutout, 'cutout')] }; }
      }
      if (kind === 'wish' && up.image) { if (!okUpload(up.image)) throw badReq('Bad upload id'); props.Image = { files: [uploadRef(up.image, 'wishlist')] }; }
      const pg = await notion('/pages', H, { method: 'POST', body: { parent: { database_id: DB[kind] }, properties: props } });
      const id = nid(pg.id);
      for (const ex of (Array.isArray(up.extra) ? up.extra : []).slice(0, 8)) await appendImage(id, ex, 'extra photo', H);
      let laundry = [];
      if (kind === 'log' && data.kind === 'Worn' && body.markLaundry) laundry = await markWornLaundry(data.items || [], H);
      res.status(200).json({ today, row: await complete(kind, mapPage(kind, pg), H), laundry });
      return;
    }

    if (a === 'update') {
      if (!EDITABLE.includes(kind)) throw badReq('Unknown kind');
      const pg0 = await assertIn(kind, body.id, H);
      const before = await complete(kind, mapPage(kind, pg0), H);
      let patch = Object.assign({}, body.patch || {});
      if (kind === 'log') patch = await prepareLog(patch, today, H, before);
      const props = buildProps(kind, patch, today);
      const up = body.uploads || {};
      let appended = false;
      if (kind === 'items') {
        if (up.cutout) { if (!okUpload(up.cutout)) throw badReq('Bad upload id'); props.Cutout = { files: [uploadRef(up.cutout, 'cutout')] }; }
        if (up.photo) {
          // Never replace an original: the first photo goes in Photo, any later one is appended.
          if (before.photo && before.photo.length) { await appendImage(before.id, up.photo, 'added photo', H); appended = true; }
          else { if (!okUpload(up.photo)) throw badReq('Bad upload id'); props.Photo = { files: [uploadRef(up.photo, 'original')] }; }
        }
      }
      if (kind === 'wish' && up.image) { if (!okUpload(up.image)) throw badReq('Bad upload id'); props.Image = { files: [uploadRef(up.image, 'wishlist')] }; }
      if (!Object.keys(props).length && !appended) throw badReq('Nothing to change');
      const pg = Object.keys(props).length ? await notion('/pages/' + before.id, H, { method: 'PATCH', body: { properties: props } }) : pg0;
      let laundry = [];
      const after = await complete(kind, mapPage(kind, pg), H);
      if (kind === 'log' && after.kind === 'Worn' && before.kind !== 'Worn' && body.markLaundry) laundry = await markWornLaundry(after.items || [], H);
      res.status(200).json({ today, row: after, appended, laundry });
      return;
    }

    if (a === 'archive') {
      if (!EDITABLE.includes(kind)) throw badReq('Unknown kind');
      const pg0 = await assertIn(kind, body.id, H);
      await notion('/pages/' + nid(pg0.id), H, { method: 'PATCH', body: { archived: true } });
      res.status(200).json({ today, id: nid(pg0.id), archived: true });
      return;
    }

    if (a === 'bulk') {
      if (kind !== 'items') throw badReq('Bulk edit is for closet pieces');
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(nid))].slice(0, 60);
      if (!ids.length) throw badReq('Select at least one piece');
      const patch = {};
      for (const k of BULK_FIELDS) if (body.patch && k in body.patch) patch[k] = body.patch[k];
      const archive = !!body.archive;
      const props = archive ? null : buildProps('items', patch, today);
      if (!archive && !Object.keys(props).length) throw badReq('Nothing to change');
      const rows = []; const failed = [];
      for (const id of ids) {
        try {
          await assertIn('items', id, H);
          const pg = await notion('/pages/' + id, H, { method: 'PATCH', body: archive ? { archived: true } : { properties: props } });
          rows.push(archive ? { id, archived: true } : mapPage('items', pg));
        } catch (e) { failed.push({ id, error: String(e.message || e) }); }
      }
      res.status(200).json({ today, rows, failed });
      return;
    }

    if (a === 'collect') {
      const pg0 = await assertIn('collections', body.id, H);
      const c = await complete('collections', mapPage('collections', pg0), H);
      const next = {};
      for (const key of ['items', 'outfits']) {
        const ch = body[key];
        if (!ch) continue;
        const add = (Array.isArray(ch.add) ? ch.add : []).map(nid);
        const rem = new Set((Array.isArray(ch.remove) ? ch.remove : []).map(nid));
        for (const id of add) await assertIn(key, id, H);
        next[key] = [...new Set(c[key].concat(add))].filter((x) => !rem.has(x));
      }
      const pg = await notion('/pages/' + c.id, H, { method: 'PATCH', body: { properties: buildProps('collections', next) } });
      res.status(200).json({ today, row: await complete('collections', mapPage('collections', pg), H) });
      return;
    }

    if (a === 'photos') {
      if (!['items', 'collections'].includes(kind)) throw badReq('Photos are kept for pieces and collections');
      await assertIn(kind, body.id, H);
      res.status(200).json({ images: await listImages(body.id, H) });
      return;
    }
    if (a === 'addPhoto') {
      if (!['items', 'collections'].includes(kind)) throw badReq('Photos are kept for pieces and collections');
      await assertIn(kind, body.id, H);
      await appendImage(body.id, body.upload, body.caption || (kind === 'collections' ? 'inspiration' : 'added photo'), H);
      res.status(200).json({ images: await listImages(body.id, H) });
      return;
    }

    if (a === 'settings') {
      if (body.key !== 'profile') throw badReq('Only the style profile can be saved here');
      const v = body.value && typeof body.value === 'object' ? body.value : {};
      const clean = {};
      for (const k of ['about', 'style', 'avoid', 'colors', 'notes', 'sizes', 'home']) if (v[k] != null) clean[k] = String(v[k]).slice(0, 600);
      const s = await readSetting(H, 'profile');
      await writeSetting(H, 'profile', JSON.stringify(clean), s.page);
      res.status(200).json({ profile: clean });
      return;
    }

    if (a === 'weather') {
      const w = await forecast(body.place, body.start, body.end || body.start, today);
      res.status(200).json({ weather: w });
      return;
    }

    if (a === 'image') { res.status(200).json(await proxyImage(body)); return; }
    if (a === 'bg') { res.status(200).json(await removeBg(body)); return; }
    if (a === 'tryon') { res.status(501).json({ error: 'Virtual try-on is not set up. It needs a try-on provider and its key in Vercel first.' }); return; }

    if (a === 'ai.scan') { res.status(200).json(await aiScan(body, H, token)); return; }
    if (a === 'ai.style') { res.status(200).json(await aiStyle(body, H, today)); return; }
    if (a === 'ai.pack') { res.status(200).json(await aiPack(body, H, today)); return; }
    if (a === 'ai.wish') { res.status(200).json(await aiWish(body, H)); return; }

    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e), code: e.notionCode || null, capped: !!e.capped });
  }
}
