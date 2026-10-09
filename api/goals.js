// Yearly Goals & Highlights for the Goals tab. Reads and writes ONE Notion
// database, "Yearly Goals Tracker" under Personal Life, and refuses any page
// whose parent is a different database. Same OS key gate as every route.
import { requireKey } from './_auth.js';

export const GOALS_DB = (process.env.GOALS_DB_ID || '3d9efb14a9e549d3ade5e70d6a8fb4fe').replace(/-/g, '');
const NOTION = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
export const STATUSES = ['Not started', 'In progress', 'Done', 'Dropped / changed'];
const KINDS = ['Goal', 'Highlight'];
const ALIGNED = ['Aligned', 'Review', 'No longer'];

const plain = (arr) => (arr || []).map((x) => x.plain_text != null ? x.plain_text : ((x.text && x.text.content) || '')).join('');
const sel = (p) => (p && p.select && p.select.name) || null;
const nid = (s) => String(s || '').replace(/-/g, '');

export function mapGoal(pg) {
  const pr = pg.properties || {};
  return {
    id: nid(pg.id),
    name: plain(pr.Goal && pr.Goal.title),
    year: sel(pr.Year),
    area: sel(pr.Area),
    status: sel(pr.Status),
    aligned: sel(pr['Aligned?']),
    // Rows from before "Kind" existed are all goals.
    kind: sel(pr.Kind) || 'Goal',
    url: pg.url,
    created: pg.created_time,
  };
}

async function notion(path, H, opts = {}) {
  const r = await fetch(NOTION + path, { method: opts.method || 'GET', headers: H, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let d = {};
  try { d = await r.json(); } catch (e) { d = {}; }
  if (!r.ok || d.object === 'error') {
    const e = new Error(d.code === 'object_not_found'
      ? 'Notion says the Yearly Goals Tracker is not shared with the Befalia OS integration.'
      : 'Notion error: ' + ((d && d.message) || ('HTTP ' + r.status)));
    e.status = 502;
    throw e;
  }
  return d;
}

function buildProps(p) {
  const bad = (m) => { const e = new Error(m); e.status = 400; throw e; };
  const props = {};
  if ('name' in p) {
    const n = String(p.name || '').trim();
    if (!n) bad('A goal needs a name');
    props.Goal = { title: [{ text: { content: n.slice(0, 1900) } }] };
  }
  if ('year' in p) {
    if (!/^20\d\d$/.test(String(p.year))) bad('Year must look like 2026');
    props.Year = { select: { name: String(p.year) } };
  }
  if ('area' in p) props.Area = { select: p.area ? { name: String(p.area).replace(/,/g, ' ').slice(0, 100) } : null };
  if ('status' in p) { if (!STATUSES.includes(p.status)) bad('Unknown status'); props.Status = { select: { name: p.status } }; }
  if ('kind' in p) { if (!KINDS.includes(p.kind)) bad('Unknown kind'); props.Kind = { select: { name: p.kind } }; }
  if ('aligned' in p) { if (p.aligned && !ALIGNED.includes(p.aligned)) bad('Unknown alignment'); props['Aligned?'] = { select: p.aligned ? { name: p.aligned } : null }; }
  return props;
}

async function assertGoal(id, H) {
  const pg = await notion('/pages/' + nid(id), H);
  if (nid((pg.parent || {}).database_id) !== GOALS_DB) { const e = new Error('That page is not in the Yearly Goals Tracker'); e.status = 403; throw e; }
  return pg;
}

export default async function handler(req, res) {
  // GET: counts-only health check, no goal names, so the tab can be verified
  // on a deployment without anyone typing the OS key.
  if (req.method === 'GET') {
    const tok = process.env.NOTION_TOKEN;
    if (!tok) { res.status(500).json({ ok: false, error: 'NOTION_TOKEN env var is not set in Vercel' }); return; }
    try {
      const d = await notion('/databases/' + GOALS_DB + '/query', { 'Authorization': 'Bearer ' + tok, 'Notion-Version': VERSION, 'Content-Type': 'application/json' }, { method: 'POST', body: { page_size: 100 } });
      const g = (d.results || []).map(mapGoal);
      const years = {};
      g.forEach((x) => { years[x.year || 'none'] = (years[x.year || 'none'] || 0) + 1; });
      res.status(200).json({ ok: true, firstPage: g.length, more: !!d.has_more, highlights: g.filter((x) => x.kind === 'Highlight').length, years });
    } catch (e) { res.status(200).json({ ok: false, error: String(e.message || e) }); }
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
  try {
    if (body.action === 'list') {
      const out = [];
      let cursor;
      for (let i = 0; i < 10; i++) {
        const q = { page_size: 100 };
        if (cursor) q.start_cursor = cursor;
        const d = await notion('/databases/' + GOALS_DB + '/query', H, { method: 'POST', body: q });
        for (const pg of d.results || []) if (!pg.archived && !pg.in_trash) out.push(mapGoal(pg));
        if (!d.has_more) break;
        cursor = d.next_cursor;
      }
      let areas = null;
      try { const db = await notion('/databases/' + GOALS_DB, H); areas = ((db.properties.Area || {}).select || {}).options.map((o) => o.name); } catch (e) { areas = null; }
      res.status(200).json({ goals: out, areas, statuses: STATUSES, url: 'https://www.notion.so/' + GOALS_DB });
      return;
    }
    if (body.action === 'create') {
      const g = Object.assign({ kind: 'Goal', status: 'Not started' }, body.goal || {});
      const props = buildProps(g);
      if (!props.Goal || !props.Year) { res.status(400).json({ error: 'A goal needs a name and a year' }); return; }
      const pg = await notion('/pages', H, { method: 'POST', body: { parent: { database_id: GOALS_DB }, properties: props } });
      res.status(200).json({ goal: mapGoal(pg) });
      return;
    }
    if (body.action === 'update') {
      if (!body.id || !body.patch) { res.status(400).json({ error: 'update needs id and patch' }); return; }
      await assertGoal(body.id, H);
      const props = buildProps(body.patch);
      if (!Object.keys(props).length) { res.status(400).json({ error: 'Nothing to change' }); return; }
      const pg = await notion('/pages/' + nid(body.id), H, { method: 'PATCH', body: { properties: props } });
      res.status(200).json({ goal: mapGoal(pg) });
      return;
    }
    if (body.action === 'archive') {
      if (!body.id) { res.status(400).json({ error: 'archive needs id' }); return; }
      await assertGoal(body.id, H);
      await notion('/pages/' + nid(body.id), H, { method: 'PATCH', body: { archived: true } });
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
}
