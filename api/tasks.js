// To-Do backend for the dashboard. Reads and writes ONE Notion database, the
// "Tasks" database under Personal Life / Befa's To-Do, and nothing else.
//
// Why a separate route instead of more cases in /api/notion: that route can
// touch any page the token reaches. This one refuses any page whose parent is
// not the Tasks database, so a bug or a leaked key here cannot rewrite a
// journal page. Same OS key gate as every other route.
//
// Dates: "today" is always the calendar day in WITA (Asia/Makassar), computed
// here on the server, so a tick at 00:30 in Bali never lands on yesterday
// because a phone clock or a Vercel region said otherwise.
import { requireKey } from './_auth.js';
import { loadArchive } from './_archive.js';

export const TASKS_DB = (process.env.TASKS_DB_ID || 'ac45a1773bfc4e3c96652745a1ea4c46').replace(/-/g, '');
const NOTION = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const TZ = 'Asia/Makassar';
// Same order as the headings in her TO DO LIST 2026 note: the untitled top
// block (Main), then each business, Personal, and the Schedule list last.
export const AREAS = ['Main', 'DiveArts', 'Sea Diva', 'TailCraft', 'Personal', 'Schedule'];
// Parked = an open task that is no longer in her note. Hidden from the lists,
// kept in Notion so nothing is lost.
const STATUSES = ['To do', 'Doing', 'Done', 'Parked'];
const TYPES = ['Task', 'Event'];

// Property names exactly as they exist in Notion.
const P = {
  name: 'Name', area: 'Area', section: 'Section', status: 'Status', done: 'Done',
  priority: '⏰ Priority', urgent: '🚨 Urgent', type: 'Type', notes: 'Notes',
  date: 'Date', completedOn: 'Completed on', parent: 'Parent task', order: 'Order',
};

export function witaDate(d = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const plain = (arr) => (arr || []).map((x) => x.plain_text != null ? x.plain_text : ((x.text && x.text.content) || '')).join('');
const sel = (p) => (p && p.select && p.select.name) || null;
const chk = (p) => !!(p && p.checkbox);
const nid = (s) => String(s || '').replace(/-/g, '');

export function mapPage(pg) {
  const pr = pg.properties || {};
  const d = pr[P.date] && pr[P.date].date;
  const c = pr[P.completedOn] && pr[P.completedOn].date;
  const par = (pr[P.parent] && pr[P.parent].relation) || [];
  return {
    id: nid(pg.id),
    name: plain(pr[P.name] && pr[P.name].title),
    area: sel(pr[P.area]),
    section: sel(pr[P.section]),
    status: sel(pr[P.status]) || 'To do',
    done: chk(pr[P.done]),
    priority: chk(pr[P.priority]),
    urgent: chk(pr[P.urgent]),
    type: sel(pr[P.type]) || 'Task',
    notes: plain(pr[P.notes] && pr[P.notes].rich_text),
    date: d ? { start: d.start, end: d.end || null } : null,
    completedOn: c ? String(c.start).slice(0, 10) : null,
    parent: par.length ? nid(par[0].id) : null,
    order: pr[P.order] && typeof pr[P.order].number === 'number' ? pr[P.order].number : null,
    created: pg.created_time,
    edited: pg.last_edited_time,
    url: pg.url,
  };
}

function rt(s) {
  s = String(s || '');
  const out = [];
  for (let i = 0; i < s.length; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)?)?$/;

// Turns a whitelisted patch from the client into Notion properties.
// Anything not on the list is ignored, so the client cannot set arbitrary fields.
export function buildProps(patch, todayWita) {
  const props = {};
  const bad = (m) => { const e = new Error(m); e.status = 400; throw e; };
  if ('name' in patch) {
    const n = String(patch.name || '').trim();
    if (!n) bad('A task needs a name');
    props[P.name] = { title: rt(n.slice(0, 2000)) };
  }
  if ('area' in patch) {
    if (patch.area && !AREAS.includes(patch.area)) bad('Unknown area: ' + patch.area);
    props[P.area] = { select: patch.area ? { name: patch.area } : null };
  }
  if ('section' in patch) {
    const s = String(patch.section || '').trim().replace(/,/g, ' ').slice(0, 100);
    props[P.section] = { select: s ? { name: s } : null };
  }
  if ('type' in patch) {
    if (!TYPES.includes(patch.type)) bad('Unknown type');
    props[P.type] = { select: { name: patch.type } };
  }
  if ('priority' in patch) props[P.priority] = { checkbox: !!patch.priority };
  if ('urgent' in patch) props[P.urgent] = { checkbox: !!patch.urgent };
  if ('notes' in patch) props[P.notes] = { rich_text: rt(patch.notes) };
  if ('date' in patch) {
    const d = patch.date;
    if (!d || !d.start) props[P.date] = { date: null };
    else {
      if (!DATE_RE.test(d.start) || (d.end && !DATE_RE.test(d.end))) bad('Dates must be YYYY-MM-DD or a full ISO time');
      props[P.date] = { date: { start: d.start, end: d.end || null } };
    }
  }
  // Position inside its title, so the app keeps the note's order.
  if ('order' in patch) {
    const o = patch.order;
    if (o !== null && (typeof o !== 'number' || !isFinite(o))) bad('Order must be a number');
    props[P.order] = { number: o };
  }
  if ('parent' in patch) props[P.parent] = { relation: patch.parent ? [{ id: nid(patch.parent) }] : [] };
  if ('status' in patch) {
    if (!STATUSES.includes(patch.status)) bad('Unknown status');
    props[P.status] = { select: { name: patch.status } };
  }
  // Ticking is one rule in one place: done means Done box, Status Done, and
  // Completed on stamped with today in WITA. Unticking clears all three.
  if ('done' in patch) {
    if (patch.done) {
      props[P.done] = { checkbox: true };
      props[P.status] = { select: { name: 'Done' } };
      props[P.completedOn] = { date: { start: todayWita } };
    } else {
      props[P.done] = { checkbox: false };
      props[P.completedOn] = { date: null };
      if (!('status' in patch)) props[P.status] = { select: { name: 'To do' } };
    }
  } else if (patch.status === 'Done') {
    props[P.done] = { checkbox: true };
    props[P.completedOn] = { date: { start: todayWita } };
  }
  // Moving a done task to the day it was really done (drag onto the calendar,
  // or the "Done on" field). Day only, never in the future.
  if ('completedOn' in patch) {
    const c = patch.completedOn;
    if (!c) props[P.completedOn] = { date: null };
    else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c))) bad('Done date must be YYYY-MM-DD');
      if (String(c) > todayWita) bad('A task cannot be done on a day that has not happened yet');
      props[P.completedOn] = { date: { start: String(c) } };
    }
  }
  return props;
}

async function notion(path, H, opts = {}) {
  const r = await fetch(NOTION + path, { method: opts.method || 'GET', headers: H, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let d = {};
  try { d = await r.json(); } catch (e) { d = {}; }
  if (!r.ok || d.object === 'error') {
    const e = new Error(explain(d, r.status));
    e.status = 502; // upstream failure, not the caller's fault
    e.notionCode = d.code || ('http_' + r.status);
    throw e;
  }
  return d;
}

function explain(d, status) {
  if (d && d.code === 'object_not_found') {
    return 'Notion says the Tasks database is not shared with the Befalia OS integration. In Notion open Befa\'s To-Do, tap ••• then Connections, and add Befalia OS.';
  }
  if (d && d.code === 'unauthorized') return 'Notion refused the token. NOTION_TOKEN in Vercel may be wrong or revoked.';
  if (d && d.code === 'rate_limited') return 'Notion is rate limiting us. Wait a few seconds and try again.';
  return 'Notion error: ' + ((d && d.message) || ('HTTP ' + status));
}

async function listAll(H) {
  const pages = [];
  let cursor;
  for (let i = 0; i < 30; i++) { // 3000 tasks is far beyond today's ~250, and stops a runaway loop
    const body = { page_size: 100, sorts: [{ timestamp: 'created_time', direction: 'ascending' }] };
    if (cursor) body.start_cursor = cursor;
    const d = await notion('/databases/' + TASKS_DB + '/query', H, { method: 'POST', body });
    for (const pg of d.results || []) pages.push(pg);
    if (!d.has_more) return { pages, complete: true };
    cursor = d.next_cursor;
  }
  return { pages, complete: false };
}

async function sectionOptions(H) {
  try {
    const db = await notion('/databases/' + TASKS_DB, H);
    const s = db.properties && db.properties[P.section];
    return ((s && s.select && s.select.options) || []).map((o) => o.name);
  } catch (e) { return null; }
}

async function assertTask(id, H) {
  const pg = await notion('/pages/' + nid(id), H);
  const parent = pg.parent || {};
  const owner = nid(parent.database_id || '');
  if (owner !== TASKS_DB) {
    const e = new Error('That page is not in the Tasks database, so the To-Do will not touch it');
    e.status = 403;
    throw e;
  }
  return pg;
}

export default async function handler(req, res) {
  // GET is a free health check, like GET /api/vision. It proves the token can
  // read the Tasks database and returns counts only: no task names, notes or
  // dates. It exists so the To-Do can be verified on a deployment without
  // anyone typing the OS key into it.
  if (req.method === 'GET') {
    const tok = process.env.NOTION_TOKEN;
    if (!tok) { res.status(500).json({ ok: false, error: 'NOTION_TOKEN env var is not set in Vercel' }); return; }
    const HG = { 'Authorization': 'Bearer ' + tok, 'Notion-Version': VERSION, 'Content-Type': 'application/json' };
    try {
      const all = await listAll(HG);
      const t = all.pages.filter((p) => !p.archived && !p.in_trash).map(mapPage);
      const day = witaDate();
      const out = { ok: true, today: day, keyGate: !!process.env.OS_KEY, complete: all.complete, total: t.length, open: t.filter((x) => !x.done && x.status !== 'Parked').length, parked: t.filter((x) => !x.done && x.status === 'Parked').length, areas: t.filter((x) => !x.done && x.status !== 'Parked').reduce((m, x) => { m[x.area || 'none'] = (m[x.area || 'none'] || 0) + 1; return m; }, {}), doneToday: t.filter((x) => x.done && x.completedOn === day).length, untitled: t.filter((x) => !x.name).length };
      // Counts only for the 2026 archive too: proves the key page and the
      // decryption work without exposing a single line of it.
      try { const a = await loadArchive(HG); out.archive = { ok: true, days: a.days.length, items: a.items, first: a.days.length ? a.days[0].d : null, last: a.days.length ? a.days[a.days.length - 1].d : null }; }
      catch (e) { out.archive = { ok: false, error: String(e.message || e) }; }
      res.status(200).json(out);
    } catch (e) {
      res.status(200).json({ ok: false, error: String(e.message || e) });
    }
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!requireKey(req, res)) return;
  const token = process.env.NOTION_TOKEN;
  if (!token) { res.status(500).json({ error: 'NOTION_TOKEN env var is not set in Vercel' }); return; }
  const H = { 'Authorization': 'Bearer ' + token, 'Notion-Version': VERSION, 'Content-Type': 'application/json' };
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const today = witaDate();

  try {
    if (body.action === 'ping') { res.status(200).json({ ok: true }); return; }
    if (body.action === 'list') {
      const [all, sections] = await Promise.all([listAll(H), sectionOptions(H)]);
      res.status(200).json({ today, tz: TZ, complete: all.complete, sections, areas: AREAS, tasks: all.pages.filter((p) => !p.archived && !p.in_trash).map(mapPage) });
      return;
    }
    if (body.action === 'history') {
      const a = await loadArchive(H);
      res.status(200).json({ today, source: a.source, days: a.days, items: a.items });
      return;
    }
    if (body.action === 'create') {
      const t = body.task || {};
      const props = buildProps(Object.assign({ type: 'Task', status: 'To do', done: false }, t), today);
      if (!props[P.name]) { res.status(400).json({ error: 'A task needs a name' }); return; }
      if (t.parent) await assertTask(t.parent, H);
      const pg = await notion('/pages', H, { method: 'POST', body: { parent: { database_id: TASKS_DB }, properties: props } });
      res.status(200).json({ today, task: mapPage(pg) });
      return;
    }
    if (body.action === 'update') {
      if (!body.id || !body.patch || typeof body.patch !== 'object') { res.status(400).json({ error: 'update needs id and patch' }); return; }
      await assertTask(body.id, H);
      if (body.patch.parent) {
        if (nid(body.patch.parent) === nid(body.id)) { res.status(400).json({ error: 'A task cannot be its own parent' }); return; }
        await assertTask(body.patch.parent, H);
      }
      const props = buildProps(body.patch, today);
      if (!Object.keys(props).length) { res.status(400).json({ error: 'Nothing to change' }); return; }
      // The PATCH response is what Notion actually stored. The client re-renders
      // from it, so the screen never claims a save that did not happen.
      const pg = await notion('/pages/' + nid(body.id), H, { method: 'PATCH', body: { properties: props } });
      res.status(200).json({ today, task: mapPage(pg) });
      return;
    }
    if (body.action === 'archive') {
      if (!body.id) { res.status(400).json({ error: 'archive needs id' }); return; }
      await assertTask(body.id, H);
      const pg = await notion('/pages/' + nid(body.id), H, { method: 'PATCH', body: { archived: true } });
      res.status(200).json({ today, id: nid(pg.id), archived: !!pg.archived });
      return;
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e), code: e.notionCode || null });
  }
}
