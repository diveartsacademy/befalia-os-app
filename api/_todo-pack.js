// Logs Befa's pack clicks on her To-Do (13 Oct 2026).
//
// "once I pack the order and click to ready to ship, you can log it as pack
//  order on my to-do list so that I know that I've done that on that day"
//
// One done task per click, in the Tasks database, area Sea Diva:
//   Packed SDTOct26-3 · Customer name
// Completed on = the day of the click in Bali time, even when the task is
// written later (a click made on the Sea Diva dashboard is picked up the next
// time the Business tab loads).
//
// Which clicks: every click by Befa (her email) from either dashboard that has
// no task yet. The database hands them out once (todo_claim) so two open tabs
// cannot log the same click twice. A failed Notion call gives the click back
// (todo_release) and it is tried again on the next load.
import { TASKS_DB, buildProps } from './tasks.js';

const NOTION = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const LABEL = { 'MANUAL (IG & WA) - OL': 'Manual', 'SHOPIFY-OL': 'Shopify', 'SHOPEE - OL': 'Shopee', 'TOKOPEDIA/TIKTOK shop -OL': 'Tokopedia/TikTok' };

const nid = (s) => String(s || '').replace(/-/g, '');

export function witaDay(iso) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return null;
  return new Date(t + 8 * 3600000).toISOString().slice(0, 10);
}

export function taskFor(click) {
  const ch = LABEL[click.src] || '';
  const inv = String(click.invoice || '').trim();
  const who = String(click.customer || '').trim();
  const name = 'Packed ' + (ch && ch !== 'Manual' ? ch + ' ' : '') + inv + (who ? ' · ' + who : '');
  const items = (click.items || []).filter(Boolean).map((s) => String(s).split('\n')[0].trim());
  const notes = (items.length ? items.length + (items.length === 1 ? ' product: ' : ' products: ') + items.join('; ') + '. ' : '') +
    'Marked Packed, ready to ship on the ' + (click.via === 'seadiva' ? 'Sea Diva dashboard' : 'Befalia OS Business tab') + '.';
  return { name, area: 'Sea Diva', type: 'Task', done: true, completedOn: witaDay(click.at), notes };
}

function headers() {
  return { 'Authorization': 'Bearer ' + process.env.NOTION_TOKEN, 'Notion-Version': VERSION, 'Content-Type': 'application/json' };
}

async function notion(path, opts) {
  const r = await fetch(NOTION + path, { method: opts.method, headers: headers(), body: opts.body ? JSON.stringify(opts.body) : undefined });
  let d = {};
  try { d = await r.json(); } catch (e) { d = {}; }
  if (!r.ok || d.object === 'error') throw new Error('Notion: ' + ((d && d.message) || ('HTTP ' + r.status)));
  return d;
}

/* pack(action) calls seadiva.befalia_pack through the edge function. */
export async function logPacks(pack, today) {
  if (!process.env.NOTION_TOKEN) return { logged: 0, error: 'NOTION_TOKEN is not set, so packs were not logged on the To-Do.' };
  const c = await pack({ action: 'todo_claim' });
  if (!c || c.ok !== true) return { logged: 0, error: 'Could not read which packs still need a To-Do task.' };
  const done = [], failed = [];
  let error = '';
  for (const click of c.clicks || []) {
    try {
      const t = taskFor(click);
      if (t.completedOn && today && t.completedOn > today) t.completedOn = today;
      const pg = await notion('/pages', { method: 'POST', body: { parent: { database_id: TASKS_DB }, properties: buildProps(t, today) } });
      done.push({ click_id: click.click_id, page_id: nid(pg.id) });
    } catch (e) {
      failed.push(click.click_id);
      error = String(e.message || e);
    }
  }
  if (done.length) await pack({ action: 'todo_set', items: done });
  if (failed.length) await pack({ action: 'todo_release', click_ids: failed });
  return { logged: done.length, error };
}

/* Undo archives the task, but only a page that really sits in the Tasks
   database. */
export async function unlogPacks(pageIds) {
  let archived = 0, error = '';
  if (!process.env.NOTION_TOKEN) return { archived, error: pageIds.length ? 'NOTION_TOKEN is not set, so the To-Do task was left.' : '' };
  for (const id of pageIds || []) {
    try {
      const pg = await notion('/pages/' + nid(id), { method: 'GET' });
      if (nid((pg.parent || {}).database_id) !== TASKS_DB) continue;
      await notion('/pages/' + nid(id), { method: 'PATCH', body: { archived: true } });
      archived++;
    } catch (e) { error = String(e.message || e); }
  }
  return { archived, error };
}
