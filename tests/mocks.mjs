// Local stand-ins for Notion, Claude (Anthropic) and Open-Meteo, so the
// wardrobe route can be tested end to end without touching real data or
// spending money. Installed by replacing globalThis.fetch for those hosts.
//
// The Notion mock follows the 2022-06-28 API shapes the route uses, and it
// enforces the same thing real Notion does for relations: a related page must
// live in the database the relation points at.
import { DB, FIELDS } from '../api/_wardrobe-schema.js';

const realFetch = globalThis.fetch;
// Notion serves files from S3. Under tests/serve.mjs the browser cannot reach
// that, so MOCK_FILE_BASE points photo links at the local server instead.
const fileUrl = (id, name) => (process.env.MOCK_FILE_BASE ? process.env.MOCK_FILE_BASE + '/__file/' + id + '/' + name : 'https://prod-files-secure.s3.us-west-2.amazonaws.com/mock/' + id + '/' + name);
export const state = {
  pages: new Map(), uploads: new Map(), blocks: new Map(), calls: [], anthropicCalls: 0,
  failSettings: false, sonnetMissing: true, lastPrompt: null,
};
let seq = 1;
const uid = () => (seq++).toString(16).padStart(8, '0') + 'aaaabbbbccccddddeeee0000'.slice(0, 24);
export const TASKS_DB = 'ac45a1773bfc4e3c96652745a1ea4c46';

const kindOf = Object.fromEntries(Object.entries(DB).map(([k, v]) => [v, k]));
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const nerr = (code, message, status) => json({ object: 'error', status, code, message }, status);
const now = () => new Date(Date.now() + seq * 1000).toISOString();

function readProp(type, v, db, pname) {
  const txt = (arr) => (arr || []).map((x) => ({ type: 'text', plain_text: x.text.content, text: { content: x.text.content } }));
  if (v.title) return { id: pname, type: 'title', title: txt(v.title) };
  if (v.rich_text) return { id: pname, type: 'rich_text', rich_text: txt(v.rich_text) };
  if ('select' in v) return { id: pname, type: 'select', select: v.select ? { name: v.select.name } : null };
  if (v.multi_select) return { id: pname, type: 'multi_select', multi_select: v.multi_select.map((x) => ({ name: x.name })) };
  if ('number' in v) return { id: pname, type: 'number', number: v.number };
  if ('checkbox' in v) return { id: pname, type: 'checkbox', checkbox: v.checkbox };
  if ('url' in v) return { id: pname, type: 'url', url: v.url };
  if ('date' in v) return { id: pname, type: 'date', date: v.date };
  if (v.relation) return { id: pname, type: 'relation', relation: v.relation.map((r) => ({ id: r.id })), has_more: false };
  if (v.files) return { id: pname, type: 'files', files: v.files.map((f) => ({ name: f.name, type: 'file', file: { url: fileUrl(f.file_upload.id, f.name), expiry_time: new Date(Date.now() + 3600e3).toISOString() } })) };
  return v;
}

// Mirrors Notion's checks that matter here: relation targets and file uploads.
function writeProps(db, props, existing) {
  const kind = kindOf[db];
  const out = Object.assign({}, existing || {});
  for (const [pname, v] of Object.entries(props || {})) {
    if (kind) {
      const f = Object.values(FIELDS[kind]).find((x) => x.p === pname);
      if (!f) return { error: nerr('validation_error', pname + ' is not a property that exists.', 400) };
      if (v.relation) for (const r of v.relation) {
        const pg = state.pages.get(r.id.replace(/-/g, ''));
        if (!pg || pg.parent.database_id !== DB[f.to]) return { error: nerr('validation_error', 'Relation target is not in the related database.', 400) };
      }
    }
    if (v.files) for (const f of v.files) {
      const u = state.uploads.get(f.file_upload.id);
      if (!u || u.status !== 'uploaded') return { error: nerr('validation_error', 'File upload not found or not uploaded.', 400) };
    }
    out[pname] = readProp(null, v, db, pname);
  }
  return { props: out };
}

function pageObj(p) {
  return { object: 'page', id: p.id, parent: { type: 'database_id', database_id: p.parent.database_id }, created_time: p.created, last_edited_time: p.edited, archived: !!p.archived, in_trash: false, url: 'https://www.notion.so/' + p.id, properties: p.props };
}

function plainOf(prop) { return ((prop && (prop.title || prop.rich_text)) || []).map((x) => x.plain_text).join(''); }

async function notion(url, opts) {
  const u = new URL(url);
  const path = u.pathname.replace(/^\/v1/, '');
  const method = (opts && opts.method) || 'GET';
  const body = opts && opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
  state.calls.push(method + ' ' + path);
  let m;
  if ((m = path.match(/^\/databases\/([0-9a-f]{32})\/query$/)) && method === 'POST') {
    const db = m[1];
    if (db === DB.settings && state.failSettings) return nerr('internal_server_error', 'mock outage', 500);
    if (!kindOf[db] && db !== TASKS_DB) return nerr('object_not_found', 'Could not find database', 404);
    let rows = [...state.pages.values()].filter((p) => p.parent.database_id === db && !p.archived);
    const f = body && body.filter;
    if (f && f.title && f.title.equals != null) rows = rows.filter((p) => plainOf(p.props[f.property]) === f.title.equals);
    if (f && f.rich_text && f.rich_text.equals != null) rows = rows.filter((p) => plainOf(p.props[f.property]) === f.rich_text.equals);
    const size = (body && body.page_size) || 100;
    const start = body && body.start_cursor ? parseInt(body.start_cursor, 10) : 0;
    const slice = rows.slice(start, start + size);
    return json({ object: 'list', results: slice.map(pageObj), has_more: start + size < rows.length, next_cursor: start + size < rows.length ? String(start + size) : null });
  }
  if (path === '/pages' && method === 'POST') {
    const db = body.parent.database_id;
    if (!kindOf[db] && db !== TASKS_DB) return nerr('object_not_found', 'Could not find database', 404);
    const w = writeProps(db, body.properties);
    if (w.error) return w.error;
    const id = uid();
    const p = { id, parent: { database_id: db }, props: w.props, created: now(), edited: now() };
    for (const k of Object.keys(FIELDS[kindOf[db]] || {})) { const pn = FIELDS[kindOf[db]][k].p; if (!p.props[pn]) p.props[pn] = readProp(null, defaultFor(FIELDS[kindOf[db]][k].t), db, pn); }
    state.pages.set(id, p);
    return json(pageObj(p));
  }
  if ((m = path.match(/^\/pages\/([0-9a-f]{32})$/))) {
    const p = state.pages.get(m[1]);
    if (!p) return nerr('object_not_found', 'Could not find page', 404);
    if (method === 'GET') return json(pageObj(p));
    if (method === 'PATCH') {
      if (body.archived) p.archived = true;
      if (body.properties) { const w = writeProps(p.parent.database_id, body.properties, p.props); if (w.error) return w.error; p.props = w.props; }
      p.edited = now();
      return json(pageObj(p));
    }
  }
  if (path === '/file_uploads' && method === 'POST') {
    const id = uid().slice(0, 8) + '-aaaa-bbbb-cccc-' + uid().slice(0, 12);
    state.uploads.set(id, { id, status: 'pending', filename: body.filename, type: body.content_type });
    return json({ object: 'file_upload', id, status: 'pending', upload_url: 'https://api.notion.com/v1/file_uploads/' + id + '/send' });
  }
  if ((m = path.match(/^\/file_uploads\/([0-9a-f-]+)\/send$/)) && method === 'POST') {
    const up = state.uploads.get(m[1]);
    if (!up) return nerr('object_not_found', 'no upload', 404);
    const file = opts.body.get('file');
    up.bytes = file ? file.size : 0; up.buf = file ? Buffer.from(await file.arrayBuffer()) : null; up.status = 'uploaded';
    return json({ object: 'file_upload', id: up.id, status: 'uploaded' });
  }
  if ((m = path.match(/^\/blocks\/([0-9a-f]{32})\/children$/))) {
    const list = state.blocks.get(m[1]) || [];
    if (method === 'GET') return json({ object: 'list', results: list, has_more: false });
    if (method === 'PATCH') {
      for (const c of body.children) {
        const fid = c.image.file_upload.id; const up = state.uploads.get(fid);
        if (!up || up.status !== 'uploaded') return nerr('validation_error', 'upload missing', 400);
        list.push({ object: 'block', id: uid(), type: 'image', created_time: now(), image: { type: 'file', caption: c.image.caption.map((x) => ({ plain_text: x.text.content })), file: { url: fileUrl(fid, 'block.jpg') } } });
      }
      state.blocks.set(m[1], list);
      return json({ object: 'list', results: list });
    }
  }
  return nerr('invalid_request_url', 'mock does not know ' + method + ' ' + path, 400);
}
function defaultFor(t) {
  return { title: { title: [] }, text: { rich_text: [] }, json: { rich_text: [] }, select: { select: null }, multi: { multi_select: [] }, number: { number: null }, checkbox: { checkbox: false }, url: { url: null }, date: { date: null }, relation: { relation: [] }, files: { files: [] } }[t];
}

// A fake Claude. It answers in the shapes the prompts ask for, and on purpose
// names one piece that does not exist (i999) so the validator can be seen to
// drop it.
async function anthropic(url, opts) {
  const body = JSON.parse(opts.body);
  if (body.model === 'claude-sonnet-4-5' && state.sonnetMissing) return json({ type: 'error', error: { type: 'not_found_error', message: 'model: claude-sonnet-4-5' } }, 404);
  state.anthropicCalls++;
  const sys = body.system || '';
  const content = body.messages[0].content;
  const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  state.lastPrompt = text;
  const refs = [...text.matchAll(/^(i\d+) \| ([^|]+) \| ([^|\n]+)/gm)].map((m) => ({ ref: m[1], name: m[2].trim(), cat: m[3].trim() }));
  const out = (o) => json({ id: 'msg', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(o) }] });
  if (sys.indexOf('catalogue clothing') !== -1) {
    const multi = /two pieces/.test(text) || state.multiNext;
    state.multiNext = false;
    const item = (n, cat, box) => ({ name: n, category: cat, subcategory: 'wrap', color: 'Ivory', secondary_colors: ['Gold'], pattern: 'Solid', material: ['Silk'], fit: 'Relaxed', season: ['Tropical heat', 'Snowstorm'], occasion: ['Business', 'Evening'], style_tags: ['Elegant'], brand: 'Zara', box, confidence: { category: 0.95, color: 0.9, material: 0.4, pattern: 0.85, brand: 0.3 } });
    return out({ is_clothing: true, items: multi ? [item('Ivory silk blouse', 'Shirts and blouses', [0.1, 0.1, 0.4, 0.5]), item('Black wide trousers', 'pants', [0.5, 0.4, 0.4, 0.55])] : [item('Ivory silk wrap blouse', 'Shirts and blouses', [0.1, 0.1, 0.8, 0.8])], note: '' });
  }
  if (sys.indexOf('personal stylist') !== -1) {
    const pick = (cat) => (refs.find((r) => r.cat.indexOf(cat) === 0) || {}).ref;
    const a = refs.map((r) => r.ref);
    const look = (n) => ({ name: 'Look ' + n, pieces: [{ ref: a[0], role: 'top' }, { ref: a[1] || a[0], role: 'bottom' }, { ref: pick('Shoes') || a[2] || a[0], role: 'shoes' }, { ref: 'i999', role: 'bag' }], explanation: 'Clean lines in a warm palette.', alternatives: a[2] ? [{ replace: a[0], with: a[2], why: 'softer' }, { replace: 'i998', with: a[0], why: 'x' }] : [], suggested_purchases: [{ description: 'A gold cuff', why: 'adds light' }] });
    return out({ looks: [look(1), look(2)], note: '' });
  }
  if (sys.indexOf('plan packing') !== -1) {
    const days = [...text.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]).filter((v, i, s) => s.indexOf(v) === i);
    return out({ days: days.map((d, i) => ({ date: d, plan: 'Day ' + (i + 1), look: { name: 'Travel look', pieces: [{ ref: refs[0].ref, role: 'top' }, { ref: 'i404', role: 'shoes' }], explanation: 'Light.' } })), toiletries: ['Reef safe sunscreen', 'Toothbrush'], personal: ['Passport', 'Charger'], reusable: [{ name: 'Capsule', refs: [refs[0].ref, 'i777'] }], missing: [{ description: 'Rain jacket', why: 'rainy season' }], note: '' });
  }
  if (sys.indexOf('wishlist') !== -1) {
    return out({ verdict: 'fills a gap', reason: 'You have no bags.', pairs: [{ refs: [refs[0].ref, 'i555'], how: 'with the blouse' }], similar: [] });
  }
  return out({});
}

function weather(url) {
  const u = new URL(url);
  if (u.hostname.startsWith('geocoding')) return json({ results: [{ name: u.searchParams.get('name'), admin1: 'Bali', country: 'Indonesia', latitude: -8.6, longitude: 115.2 }] });
  const s = u.searchParams.get('start_date'), e = u.searchParams.get('end_date');
  const days = []; for (let d = s; d <= e; d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10)) days.push(d);
  return json({ daily: { time: days, weathercode: days.map(() => 61), temperature_2m_max: days.map(() => 31.2), temperature_2m_min: days.map(() => 25.4), precipitation_probability_max: days.map(() => 70) } });
}

export function install() {
  globalThis.fetch = async (input, opts) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://api.notion.com/')) return notion(url, opts);
    if (url.startsWith('https://api.anthropic.com/')) return anthropic(url, opts);
    if (url.startsWith('https://geocoding-api.open-meteo.com/') || url.startsWith('https://api.open-meteo.com/')) return weather(url);
    if (url.startsWith('https://prod-files-secure.s3.us-west-2.amazonaws.com/')) return new Response(TINY_JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return realFetch(input, opts);
  };
}

// The smallest valid JPEG (1x1 white), for the photo proxy.
export const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

export function seedTasks(today) {
  const mk = (name, date, type) => {
    const id = uid();
    state.pages.set(id, { id, parent: { database_id: TASKS_DB }, created: now(), edited: now(), props: {
      Name: { type: 'title', title: [{ plain_text: name, text: { content: name } }] },
      Type: { type: 'select', select: { name: type } }, Status: { type: 'select', select: { name: 'To do' } },
      Area: { type: 'select', select: { name: 'Personal' } }, Date: { type: 'date', date: { start: date, end: null } },
      Done: { type: 'checkbox', checkbox: false },
    } });
    return id;
  };
  return { dinner: mk('Client dinner at Merah Putih', today, 'Event'), meeting: mk('Board meeting', today, 'Event') };
}

export function seedCollections() {
  for (const [i, n] of ['Business Chic', 'Tropical Bali', 'Ocean Events'].entries()) {
    const id = uid();
    state.pages.set(id, { id, parent: { database_id: DB.collections }, created: now(), edited: now(), props: { Name: { type: 'title', title: [{ plain_text: n, text: { content: n } }] }, Order: { type: 'number', number: (i + 1) * 10 }, Items: { type: 'relation', relation: [], has_more: false }, Outfits: { type: 'relation', relation: [], has_more: false }, Notes: { type: 'rich_text', rich_text: [] } } });
  }
}
