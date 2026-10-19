// After-class checklist for Befa's own classes (19 Oct 2026). The rules are
// in _postclass.js; this route only reads and writes.
//
//   GET                       each recent class that has ended, with its steps
//                             and whether each is done. Writes nothing.
//   POST {action:'sync'}      makes the To-Do and the sheet agree: creates the
//                             step tasks (Section "After class", dated the class
//                             day, so an open one turns overdue the next day),
//                             ticks off a step done by itself or in the
//                             instructor dashboard, reopens one unticked there,
//                             and records in OS_POSTCLASS what was done here.
//   POST {action:'tickTask', id, done}
//                             a step task was ticked or unticked in To-Do:
//                             record it in OS_POSTCLASS straight away.
//
// Gate: the OS key. Env: NOTION_TOKEN, DAA_API_KEY (the sheet service).
import { requireKey } from './_auth.js';
import { TASKS_DB, witaDate, mapPage } from './tasks.js';
import { gcalIds } from './classlog.js';
import { START, WINDOW, SECTION, addDays, classesFrom, planPostClass, stepOfNotes, taskName, taskNotes } from './_postclass.js';

const DAA_FALLBACK_URL = 'https://script.google.com/macros/s/AKfycbwJ5s1d9I6-aEwufZq3HIL6ps4JURIAhqdytcm9vQzdTjmPOD6KfcCwVRxoBJqzxvVvrw/exec';
const daaUrl = () => process.env.DAA_API_URL || DAA_FALLBACK_URL;
const ACTOR = 'diveartsacademy@gmail.com via Personal OS (After class)';
const NOTION = 'https://api.notion.com/v1';
const bad = (m, s = 400) => { const e = new Error(m); e.status = s; return e; };
const nid = (s) => String(s || '').replace(/-/g, '');

function headers() {
  if (!process.env.NOTION_TOKEN) throw bad('NOTION_TOKEN is not set in Vercel.', 500);
  return { Authorization: 'Bearer ' + process.env.NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
}
async function notion(path, H, opts = {}) {
  const r = await fetch(NOTION + path, { method: opts.method || 'GET', headers: H, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let d = {};
  try { d = await r.json(); } catch (e) { d = {}; }
  if (!r.ok || d.object === 'error') throw bad('Notion error: ' + ((d && d.message) || ('HTTP ' + r.status)), 502);
  return d;
}
async function sheet(body) {
  if (!process.env.DAA_API_KEY) throw bad('Not connected yet: DAA_API_KEY is not set in Vercel.', 503);
  const r = await fetch(daaUrl(), { method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, key: process.env.DAA_API_KEY, actor: ACTOR }) });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { throw bad('The sheet service did not answer with JSON (Google is sometimes slow). Try again.', 502); }
  if (!j.ok) {
    if (/unknown action/i.test(j.error || '')) throw bad('The sheet service does not know ' + body.action + ' yet: PostClass.gs still has to be deployed in "DAA Instructor - scripts".', 503);
    throw bad('The sheet service refused: ' + (j.error || 'no reason given'), 502);
  }
  return j;
}

async function recentTasks(today, H) {
  const from = addDays(today, -WINDOW) > START ? addDays(today, -WINDOW) : START;
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const body = { page_size: 100, filter: { and: [
      { or: [{ property: 'Section', select: { equals: 'Classes' } }, { property: 'Section', select: { equals: SECTION } }] },
      { property: 'Date', date: { on_or_after: from } },
    ] } };
    if (cursor) body.start_cursor = cursor;
    const d = await notion('/databases/' + TASKS_DB + '/query', H, { method: 'POST', body });
    for (const pg of d.results || []) out.push(mapPage(pg));
    if (!d.has_more) break;
    cursor = d.next_cursor;
  }
  return out;
}

async function load(today, H) {
  const tasks = await recentTasks(today, H);
  const classes = classesFrom(tasks, { today, nowMs: Date.now(), gcalIds });
  const stepTasks = tasks.filter((t) => t.section === SECTION);
  let rows = [];
  if (classes.length) rows = (await sheet({ action: 'postClassRead', keys: Array.from(new Set(classes.map((c) => c.key))) })).rows || [];
  return { classes, plan: planPostClass(classes, rows, stepTasks) };
}

function doneProps(done, today) {
  return done
    ? { Done: { checkbox: true }, Status: { select: { name: 'Done' } }, 'Completed on': { date: { start: today } } }
    : { Done: { checkbox: false }, Status: { select: { name: 'To do' } }, 'Completed on': { date: null } };
}

export default async function handler(req, res) {
  if (!requireKey(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  const today = witaDate();
  try {
    const H = headers();
    if (req.method === 'GET') {
      const { plan } = await load(today, H);
      const open = plan.view.reduce((a, c) => a + c.steps.filter((s) => !s.done).length, 0);
      res.status(200).json({ ok: true, today, classes: plan.view, open });
      return;
    }
    if (req.method !== 'POST') throw bad('GET or POST only', 405);
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (b.action === 'sync') {
      const { plan } = await load(today, H);
      for (const w of plan.write) await sheet({ action: 'postClassSet', ...w });
      for (const c of plan.create) {
        await notion('/pages', H, { method: 'POST', body: { parent: { database_id: TASKS_DB }, properties: {
          Name: { title: [{ text: { content: taskName(c.cls, c.item) } }] },
          Area: { select: { name: 'DiveArts' } }, Section: { select: { name: SECTION } }, Type: { select: { name: 'Task' } },
          Date: { date: { start: c.cls.day } },
          Notes: { rich_text: [{ text: { content: taskNotes(c.cls, c.item) } }] },
          ...doneProps(c.done, today),
        } } });
      }
      for (const id of plan.close) await notion('/pages/' + nid(id), H, { method: 'PATCH', body: { properties: doneProps(true, today) } });
      for (const id of plan.reopen) await notion('/pages/' + nid(id), H, { method: 'PATCH', body: { properties: doneProps(false, today) } });
      res.status(200).json({ ok: true, created: plan.create.length, closed: plan.close.length, reopened: plan.reopen.length, written: plan.write.length });
      return;
    }

    if (b.action === 'tickTask') {
      if (typeof b.done !== 'boolean') throw bad('done must be true or false');
      const pg = await notion('/pages/' + nid(b.id), H);
      if (nid((pg.parent || {}).database_id) !== TASKS_DB) throw bad('That page is not in the Tasks database', 403);
      const t = mapPage(pg);
      const step = stepOfNotes(t.notes);
      if (t.section !== SECTION || !step) throw bad('That task is not an after-class step');
      const out = await sheet({ action: 'postClassSet', class_key: step.key, item: step.item, done: b.done, by: 'Befa via To-Do',
        class_date: t.date && t.date.start ? String(t.date.start).slice(0, 10) : '' });
      res.status(200).json({ ok: true, set: out.set });
      return;
    }
    throw bad('Unknown action');
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || String(e) });
  }
}
