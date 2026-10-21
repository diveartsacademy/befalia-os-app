// The Subscriptions card on the Finance tab (21 Oct 2026). Read only.
//
//   GET ?check=1   free health check: {ok, rows, statuses}. Counts only, no
//                  names, dates or amounts, so a deploy can be checked
//                  without the OS key.
//   GET            the rows of the Notion database "Subscriptions" under
//                  Personal Life plus the summary from _subs.js. Needs the
//                  OS key, like every route that returns her data.
//
// Nothing here writes. Edits happen in Notion (or by the morning inbox check).
import { requireKey } from './_auth.js';
import { witaDate } from './tasks.js';
import { mapSub, summarize } from './_subs.js';

export const SUBS_DB = (process.env.SUBS_DB_ID || 'b60c4bae06b74e8a98efe6ee3fba9e2d').replace(/-/g, '');
const NOTION = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

async function readAll(token) {
  const H = { 'Authorization': 'Bearer ' + token, 'Notion-Version': VERSION, 'Content-Type': 'application/json' };
  const out = [];
  let cursor;
  for (let i = 0; i < 5; i++) {
    const q = { page_size: 100 };
    if (cursor) q.start_cursor = cursor;
    const r = await fetch(NOTION + '/databases/' + SUBS_DB + '/query', { method: 'POST', headers: H, body: JSON.stringify(q) });
    let d = {};
    try { d = await r.json(); } catch (e) { d = {}; }
    if (!r.ok || d.object === 'error') {
      const e = new Error(d.code === 'object_not_found'
        ? 'Notion says the Subscriptions database is not shared with the Befalia OS integration.'
        : 'Notion error: ' + ((d && d.message) || ('HTTP ' + r.status)));
      e.status = 502;
      throw e;
    }
    for (const pg of d.results || []) if (!pg.archived && !pg.in_trash) out.push(mapSub(pg));
    if (!d.has_more) break;
    cursor = d.next_cursor;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'GET only' }); return; }
  const token = process.env.NOTION_TOKEN;
  const check = req.query && (req.query.check === '1' || req.query.check === 1);
  if (check) {
    if (!token) { res.status(200).json({ ok: false, error: 'NOTION_TOKEN is not set' }); return; }
    try {
      const items = await readAll(token);
      const statuses = {};
      items.forEach((s) => { statuses[s.status] = (statuses[s.status] || 0) + 1; });
      res.status(200).json({ ok: true, rows: items.length, statuses });
    } catch (e) { res.status(200).json({ ok: false, error: String(e.message || e) }); }
    return;
  }
  if (!requireKey(req, res)) return;
  if (!token) { res.status(500).json({ ok: false, error: 'NOTION_TOKEN env var is not set in Vercel' }); return; }
  try {
    const items = await readAll(token);
    const today = witaDate();
    res.status(200).json({ ok: true, today, items, summary: summarize(items, today), notion: 'https://www.notion.so/' + SUBS_DB });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: String(e.message || e) });
  }
}
