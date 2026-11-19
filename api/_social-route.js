// Personal social desk (19 Nov 2026).
//
// This file starts with an underscore so Vercel does not deploy it as its
// own serverless function. The Hobby plan allows 12, and this app already
// had 12. api/notion.js calls it when the request is marked social=1.
// /api/social is a rewrite to that, in vercel.json.
//
//   GET ?check=1   counts only, no key, no numbers, no handles. Does not
//                  create the database.
//   GET            the desk: personal accounts, logged snapshots, ideas,
//                  earnings. Needs the OS key.
//   POST snapshot  one dated reading. A blank stays blank. The same account,
//                  grain and date is refused (409) unless correct:true, which
//                  keeps the earlier row and adds this one.
//   POST idea      a hook and optional caption, newest first on the board.
//                  Also appends a line to the Content Ideas page.
//   POST earning   a date, a platform, and an amount or an outcome.
//   POST status    changes only the status of an idea already on the board.
//   POST sync      read-only Zernio pull. Does nothing until a personal
//                  account id is set. Never overwrites a row that exists.
//                  On failure the logged rows are unchanged.
//
// Storage is a Notion database "Personal Social Tracker" under Social Media
// (SOCIAL_DB_ID overrides the find-or-create). Not DiveArts public.social_metrics.
// The Zernio key never leaves the server.
import { requireKey } from './_auth.js';
import {
  DB_TITLE, SOCIAL_PAGE, IDEAS_PAGE, databaseSchema, chooseDb, witaDate, notionUrl,
  cleanSnapshot, cleanIdea, cleanEarning, toProperties, mapPage, sameSlot,
  viewModel, ideaLine, counts, IDEA_STATUS,
} from './_social.js';
import { pullZernio, zernioStatus } from './_zernio-sync.js';

const NOTION = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

let dbCache = null;
export function resetDbCache() { dbCache = null; }

function nid(s) { return String(s || '').replace(/-/g, ''); }

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

async function notion(path, H, opts = {}) {
  const r = await fetch(NOTION + path, {
    method: opts.method || 'GET',
    headers: H,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let d = {};
  try { d = await r.json(); } catch (e) { d = {}; }
  if (!r.ok || d.object === 'error') {
    const e = new Error(d.code === 'object_not_found'
      ? 'Notion says the Social Media page or the tracker database is not shared with the Befalia OS integration.'
      : 'Notion error: ' + ((d && d.message) || ('HTTP ' + r.status)));
    e.status = 502;
    throw e;
  }
  return d;
}

async function listChildren(H) {
  const blocks = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    const url = '/blocks/' + SOCIAL_PAGE + '/children?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : '');
    const d = await notion(url, H);
    for (const b of d.results || []) blocks.push(b);
    if (!d.has_more) break;
    cursor = d.next_cursor;
  }
  return blocks;
}

async function resolveDb(H, { create }) {
  const envId = nid(process.env.SOCIAL_DB_ID);
  if (envId) return envId;
  if (dbCache) return dbCache;
  const found = chooseDb(await listChildren(H));
  if (found) { dbCache = found; return found; }
  if (!create) return null;
  const d = await notion('/databases', H, {
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: SOCIAL_PAGE },
      title: [{ type: 'text', text: { content: DB_TITLE } }],
      properties: databaseSchema(),
    },
  });
  dbCache = nid(d.id);
  return dbCache;
}

async function readRows(db, H) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const d = await notion('/databases/' + db + '/query', H, { method: 'POST', body });
    for (const pg of d.results || []) {
      if (pg.archived || pg.in_trash) continue;
      if (nid((pg.parent || {}).database_id) && nid(pg.parent.database_id) !== nid(db)) continue;
      out.push(mapPage(pg));
    }
    if (!d.has_more) break;
    cursor = d.next_cursor;
  }
  return out;
}

async function assertRow(id, db, H) {
  const pg = await notion('/pages/' + nid(id), H);
  if (nid((pg.parent || {}).database_id) !== nid(db)) {
    const e = new Error('That row is not in the Personal Social Tracker');
    e.status = 403;
    throw e;
  }
  return mapPage(pg);
}

async function insertRow(row, db, H) {
  const pg = await notion('/pages', H, {
    method: 'POST',
    body: { parent: { database_id: db }, properties: toProperties(row) },
  });
  return mapPage(pg);
}

async function appendIdea(row, H) {
  const text = ideaLine(row);
  await notion('/blocks/' + IDEAS_PAGE + '/children', H, {
    method: 'PATCH',
    body: { children: [{ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] } }] },
  });
}

function headers() {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    const e = new Error('NOTION_TOKEN env var is not set in Vercel');
    e.status = 500;
    throw e;
  }
  return { Authorization: 'Bearer ' + token, 'Notion-Version': VERSION, 'Content-Type': 'application/json' };
}

function desk(rows, today, db) {
  const view = viewModel(rows, today);
  view.zernio = zernioStatus();
  view.notion.database = db ? notionUrl(db) : null;
  return view;
}

async function saveSnapshot(body, rows, db, H, today) {
  const row = cleanSnapshot(body, today);
  row.recordedAt = new Date().toISOString();
  const existing = rows.find((r) => sameSlot(r, row));
  if (existing && !body.correct) {
    const e = new Error('A snapshot for this account and date is already kept. It was not overwritten.');
    e.status = 409;
    e.existing = { id: existing.id, when: existing.when, grain: existing.grain, source: existing.source, recordedAt: existing.recordedAt };
    throw e;
  }
  let kept = null;
  if (existing && body.correct) {
    await assertRow(existing.id, db, H);
    await notion('/pages/' + nid(existing.id), H, { method: 'PATCH', body: { properties: { Active: { checkbox: false } } } });
    kept = existing.id;
  }
  const saved = await insertRow(row, db, H);
  return { saved, kept };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET' && req.query && (req.query.check === '1' || req.query.check === 1)) {
      const token = process.env.NOTION_TOKEN;
      if (!token) { send(res, 200, { ok: false, error: 'NOTION_TOKEN is not set' }); return; }
      const H = headers();
      const db = await resolveDb(H, { create: false });
      if (!db) {
        send(res, 200, { ok: true, accounts: 4, database: false, snapshots: 0, ideas: 0, earnings: 0, zernioConfigured: zernioStatus().configured });
        return;
      }
      const c = counts(await readRows(db, H));
      send(res, 200, { ok: true, accounts: 4, database: true, zernioConfigured: zernioStatus().configured, ...c });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'POST') { send(res, 405, { ok: false, error: 'GET or POST only' }); return; }
    if (!requireKey(req, res)) return;
    const H = headers();
    const today = witaDate();

    if (req.method === 'GET') {
      const db = await resolveDb(H, { create: false });
      const rows = db ? await readRows(db, H) : [];
      send(res, 200, desk(rows, today, db));
      return;
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
    body = body || {};
    const action = body.action || 'list';

    if (action === 'list') {
      const db = await resolveDb(H, { create: false });
      const rows = db ? await readRows(db, H) : [];
      send(res, 200, desk(rows, today, db));
      return;
    }

    if (action === 'sync') {
      // The body cannot name an account. Only the server env can.
      const pulled = await pullZernio({ env: process.env });
      const db = await resolveDb(H, { create: pulled.snapshots.length > 0 });
      let rows = db ? await readRows(db, H) : [];
      let saved = 0;
      let kept = 0;
      if (db && pulled.snapshots.length) {
        for (const row of pulled.snapshots) {
          if (rows.some((r) => sameSlot(r, row))) { kept++; continue; }
          const inserted = await insertRow(row, db, H);
          rows.push(inserted);
          saved++;
        }
      }
      const view = desk(rows, today, db);
      if (pulled.skipped) {
        send(res, 200, { ok: pulled.ok, skipped: true, saved: 0, kept: 0, fallback: 'manual', message: pulled.reason, view });
        return;
      }
      if (!pulled.ok) {
        send(res, 200, {
          ok: false, skipped: false, saved, kept, fallback: 'manual',
          message: 'Zernio did not answer. The numbers here are the ones you logged.',
          view,
        });
        return;
      }
      send(res, 200, { ok: true, skipped: false, saved, kept, fallback: kept ? 'manual' : null, view });
      return;
    }

    const db = await resolveDb(H, { create: true });
    let rows = await readRows(db, H);

    if (action === 'snapshot') {
      const { saved, kept } = await saveSnapshot(body, rows, db, H, today);
      rows = await readRows(db, H);
      send(res, 200, { ok: true, snapshot: saved, kept, view: desk(rows, today, db) });
      return;
    }

    if (action === 'idea') {
      const row = cleanIdea(body, today);
      row.recordedAt = new Date().toISOString();
      const saved = await insertRow(row, db, H);
      let pageWarning = '';
      try { await appendIdea(saved.hook ? saved : row, H); } catch (e) {
        pageWarning = 'The ideas page could not be updated. The board has the idea.';
      }
      rows = await readRows(db, H);
      send(res, 200, { ok: true, idea: saved, pageWarning, view: desk(rows, today, db) });
      return;
    }

    if (action === 'earning') {
      const row = cleanEarning(body, today);
      row.recordedAt = new Date().toISOString();
      const saved = await insertRow(row, db, H);
      rows = await readRows(db, H);
      send(res, 200, { ok: true, earning: saved, view: desk(rows, today, db) });
      return;
    }

    if (action === 'status') {
      if (!IDEA_STATUS.includes(body.status)) { send(res, 400, { ok: false, error: 'Unknown status' }); return; }
      const current = await assertRow(body.id, db, H);
      if (current.kind !== 'Idea') { send(res, 400, { ok: false, error: 'Status belongs to an idea' }); return; }
      await notion('/pages/' + nid(current.id), H, { method: 'PATCH', body: { properties: { Status: { select: { name: body.status } } } } });
      rows = await readRows(db, H);
      send(res, 200, { ok: true, view: desk(rows, today, db) });
      return;
    }

    send(res, 400, { ok: false, error: 'Unknown action' });
  } catch (e) {
    const check = req.method === 'GET' && req.query && (req.query.check === '1' || req.query.check === 1);
    if (check) { send(res, 200, { ok: false, error: String(e.message || e) }); return; }
    const status = e.status || 500;
    const body = { ok: false, error: String(e.message || e) };
    if (e.existing) body.existing = e.existing;
    if (status === 409) body.conflict = true;
    send(res, status, body);
  }
}
