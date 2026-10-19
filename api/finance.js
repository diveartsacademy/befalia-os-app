// Finance tab backend (19 Oct 2026). Befa: "I usually just take in the Google
// Sheet", so her sheet FINANCIAL REPORT BEFALIA, tab HUTANG BEFA, is the
// master. This route reads it through the DAA sheet service (HutangBefa.gs,
// actions hutangRead and hutangTick) and never keeps a copy of her numbers.
//
//   GET                         the debt list, parsed by _hutang.js, plus the
//                               ticks still waiting to reach the sheet.
//   POST {action:'tick', ticks:[{row, paid}]}
//                               mark rows paid or unpaid. Written to the sheet
//                               when Google lets us; when it does not (Drive
//                               storage full), a paid tick is kept as a Done
//                               task in To-Do (Personal, Payments (Bayar)) and
//                               sent again by the next sync.
//   POST {action:'sync'}        sends every waiting tick to the sheet, and
//                               ticks off the To-Do reminder of any row Befa
//                               already ticked in the sheet herself.
//
// The waiting list is the To-Do itself: a Done task in Payments (Bayar)
// whose Notes name "HUTANG BEFA" and "baris N" means row N should be ticked.
// The H-1 reminders written on 19 Oct carry exactly that, so ticking a
// reminder in To-Do ticks its rows in the sheet too.
//
// Gate: the OS key. Env: DAA_API_KEY (the sheet service), NOTION_TOKEN.
import { requireKey } from './_auth.js';
import { TASKS_DB, witaDate, mapPage } from './tasks.js';
import { parseHutang } from './_hutang.js';

const DAA_FALLBACK_URL = 'https://script.google.com/macros/s/AKfycbwJ5s1d9I6-aEwufZq3HIL6ps4JURIAhqdytcm9vQzdTjmPOD6KfcCwVRxoBJqzxvVvrw/exec';
const daaUrl = () => process.env.DAA_API_URL || DAA_FALLBACK_URL;
const ACTOR = 'diveartsacademy@gmail.com via Personal OS (Finance)';
const NOTION = 'https://api.notion.com/v1';
const SECTION = 'Payments (Bayar)';
const SOURCE_RE = /HUTANG BEFA/i;
const ROWS_RE = /baris\s+([\d\s,dan&]+)/i;
const MAX_TICKS = 40;

const bad = (m, s = 400) => { const e = new Error(m); e.status = s; return e; };
const nid = (s) => String(s || '').replace(/-/g, '');

export function rowsOfNotes(notes) {
  const s = String(notes || '');
  if (!SOURCE_RE.test(s)) return [];
  const m = ROWS_RE.exec(s);
  if (!m) return [];
  return Array.from(new Set((m[1].match(/\d+/g) || []).map(Number).filter((n) => n > 0 && n < 5000)));
}

export function rupiah(n) { return 'Rp' + Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

// What has to happen, from the sheet's items and the To-Do tasks. Pure.
//   push   rows a Done task asks for that the sheet has not ticked yet
//   close  open reminder tasks whose rows are all ticked in the sheet
export function planSync(items, tasks) {
  const byRow = new Map(items.map((x) => [x.row, x]));
  const push = new Map();
  const close = [];
  for (const t of tasks) {
    if (t.section !== SECTION) continue;
    const rows = rowsOfNotes(t.notes).filter((r) => byRow.has(r));
    if (!rows.length) continue;
    if (t.done) {
      for (const r of rows) if (!byRow.get(r).paid) push.set(r, { row: r, paid: true, name: byRow.get(r).sheetName, task: t.id });
    } else if (rows.every((r) => byRow.get(r).paid)) {
      close.push(t.id);
    }
  }
  return { push: Array.from(push.values()).sort((a, b) => a.row - b.row), close };
}

function notionHeaders() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw bad('NOTION_TOKEN is not set in Vercel.', 500);
  return { Authorization: 'Bearer ' + token, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
}

async function notion(path, H, opts = {}) {
  const r = await fetch(NOTION + path, { method: opts.method || 'GET', headers: H, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let d = {};
  try { d = await r.json(); } catch (e) { d = {}; }
  if (!r.ok || d.object === 'error') throw bad('Notion error: ' + ((d && d.message) || ('HTTP ' + r.status)), 502);
  return d;
}

async function paymentTasks(H) {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const body = { page_size: 100, filter: { and: [
      { property: 'Section', select: { equals: SECTION } },
      { property: 'Notes', rich_text: { contains: 'HUTANG BEFA' } },
    ] } };
    if (cursor) body.start_cursor = cursor;
    const d = await notion('/databases/' + TASKS_DB + '/query', H, { method: 'POST', body });
    for (const pg of d.results || []) out.push(mapPage(pg));
    if (!d.has_more) break;
    cursor = d.next_cursor;
  }
  return out;
}

async function setTaskDone(id, done, today, H) {
  const props = done
    ? { Done: { checkbox: true }, Status: { select: { name: 'Done' } }, 'Completed on': { date: { start: today } } }
    : { Done: { checkbox: false }, Status: { select: { name: 'To do' } }, 'Completed on': { date: null } };
  await notion('/pages/' + nid(id), H, { method: 'PATCH', body: { properties: props } });
}

async function createPaidTask(it, today, H) {
  const name = 'Lunas: ' + it.lender + (it.amount != null ? ' ' + rupiah(it.amount) : '');
  const notes = 'Ditandai lunas di tab Finance. Dari sheet HUTANG BEFA (FINANCIAL REPORT BEFALIA), baris ' + it.row + '.';
  const pg = await notion('/pages', H, { method: 'POST', body: { parent: { database_id: TASKS_DB }, properties: {
    Name: { title: [{ text: { content: name } }] },
    Area: { select: { name: 'Personal' } }, Section: { select: { name: SECTION } }, Type: { select: { name: 'Task' } },
    Notes: { rich_text: [{ text: { content: notes } }] },
    Done: { checkbox: true }, Status: { select: { name: 'Done' } }, 'Completed on': { date: { start: today } },
  } } });
  return nid(pg.id);
}

async function sheet(body) {
  if (!process.env.DAA_API_KEY) throw bad('Not connected yet: DAA_API_KEY is not set in Vercel.', 503);
  const r = await fetch(daaUrl(), {
    method: 'POST', redirect: 'follow',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, key: process.env.DAA_API_KEY, actor: ACTOR }),
  });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { throw bad('The sheet service did not answer with JSON (Google is sometimes slow). Try again.', 502); }
  return j;
}

async function readSheet() {
  const j = await sheet({ action: 'hutangRead' });
  if (!j.ok) {
    if (/unknown action/i.test(j.error || '')) throw bad('The sheet service does not know hutangRead yet: HutangBefa.gs still has to be deployed in "DAA Instructor - scripts".', 503);
    throw bad('The sheet service refused: ' + (j.error || 'no reason given'), 502);
  }
  return j.rows || [];
}

// Tries the sheet. Returns { saved, storage, error }.
async function writeSheet(ticks) {
  if (!ticks.length) return { saved: true, written: [] };
  const j = await sheet({ action: 'hutangTick', ticks: ticks.map((t) => ({ row: t.row, paid: t.paid, name: t.name })) });
  if (j.ok) return { saved: true, written: j.written || [] };
  return { saved: false, storage: !!j.storage, error: j.error || 'not saved', written: j.written || [] };
}

async function load(today, H) {
  const [rows, tasks] = await Promise.all([readSheet(), paymentTasks(H)]);
  const model = parseHutang(rows, today);
  const plan = planSync(model.items, tasks);
  return { model, tasks, plan };
}

export default async function handler(req, res) {
  if (!requireKey(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  const today = witaDate();
  try {
    const H = notionHeaders();
    if (req.method === 'GET') {
      const { model, plan } = await load(today, H);
      res.status(200).json({ ok: true, ...model, waiting: plan.push.map((p) => p.row), closable: plan.close.length });
      return;
    }
    if (req.method !== 'POST') throw bad('GET or POST only', 405);
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (b.action === 'sync') {
      const { plan } = await load(today, H);
      const w = await writeSheet(plan.push);
      for (const id of plan.close) await setTaskDone(id, true, today, H);
      res.status(200).json({ ok: true, pushed: w.saved ? plan.push.map((p) => p.row) : [], waiting: w.saved ? [] : plan.push.map((p) => p.row),
        storage: !!w.storage, error: w.saved ? null : w.error, closed: plan.close.length });
      return;
    }

    if (b.action === 'tick') {
      const list = Array.isArray(b.ticks) ? b.ticks : [];
      if (!list.length) throw bad('No rows to tick.');
      if (list.length > MAX_TICKS) throw bad('At most ' + MAX_TICKS + ' rows at a time.');
      const { model, tasks } = await load(today, H);
      const byRow = new Map(model.items.map((x) => [x.row, x]));
      const ticks = list.map((t) => {
        const it = byRow.get(Number(t && t.row));
        if (!it) throw bad('Row ' + (t && t.row) + ' is not a payment in HUTANG BEFA. Nothing changed.');
        if (it.amount == null) throw bad('Row ' + it.row + ' has no amount yet. Fill it in the sheet first.');
        return { row: it.row, paid: !!t.paid, name: it.sheetName, it };
      });
      const w = await writeSheet(ticks);
      // The To-Do follows the tick either way, so the reminder leaves the list
      // and, when the sheet could not be saved, the tick waits there.
      const touched = [];
      for (const t of ticks) {
        const mine = tasks.filter((x) => rowsOfNotes(x.notes).includes(t.row));
        if (t.paid) {
          if (mine.length) { for (const x of mine) if (!x.done) { await setTaskDone(x.id, true, today, H); touched.push(x.id); } }
          else if (!w.saved) touched.push(await createPaidTask(t.it, today, H));
        } else {
          for (const x of mine) if (x.done) { await setTaskDone(x.id, false, today, H); touched.push(x.id); }
        }
      }
      res.status(200).json({ ok: true, saved: w.saved, storage: !!w.storage, error: w.saved ? null : w.error,
        rows: ticks.map((t) => ({ row: t.row, paid: t.paid })), tasks: touched.length });
      return;
    }
    throw bad('Unknown action');
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || String(e) });
  }
}
