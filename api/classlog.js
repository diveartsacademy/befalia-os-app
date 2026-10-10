// Class expenses. Tap a class you teach (a Classes event in the To-Do) and log
// what the day cost: pool ticket, Grab, toll, parking and so on.
//
// Where the money goes: NOT into a new system. This route calls the same DAA
// sheet service ("DAA Instructor - scripts", Apps Script) that the DiveArts OS
// instructor page uses, with the same two actions, saveSession then
// saveSessionDetail. That writes OS_SESSIONS, OS_SESSION_COSTS, OS_ATTENDANCE,
// the "1. SESSION EXPENSES" tab in Befa's own workbook, and the student blocks.
// One record, the one DiveArts already keeps.
//
// Two steps, on purpose:
//   draft  saves the list on the Notion row only. Edit it as often as needed.
//   send   writes it to the books, once. The sheet service copies a session
//          into "1. SESSION EXPENSES" the first time only (it stamps the
//          session id in column K and skips it after), so a second send would
//          change OS_SESSION_COSTS but not her books. After a send the row is
//          read only here; a correction is made in the sheet itself.
//
// Gates, checked before anything is written:
//   - the OS key (same as every route)
//   - the page must be in the Tasks database, Section Classes, Type Event
//   - nothing is sent twice: a row with a Session ID refuses draft and send
//   - a class cannot be sent before its day (WITA)
//   - components come from the DiveArts OS list, amounts are whole rupiah
//     between 0 and 20,000,000 per line, at most 20 lines and 12 students
//   - instructor is always Befa's account, source is always "personal-os"
// The sheet service address and key live in Vercel env (DAA_API_URL,
// DAA_API_KEY), the same values the DiveArts OS has on Cloudflare. They never
// reach a browser. Without them, draft still works and send says what is missing.
import { requireKey } from './_auth.js';
import { TASKS_DB, mapPage, witaDate } from './tasks.js';

const NOTION = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
export const COMPONENTS = ['pool_ticket', 'fuel', 'toll', 'parking', 'transport_grab', 'accommodation',
  'consumables', 'videographer_fee', 'equipment', 'other'];
export const TYPES = ['pool', 'theory', 'ocean', 'aquarium', 'studio', 'event'];
const INSTRUCTOR = 'diveartsacademy@gmail.com';
const ACTOR = 'diveartsacademy@gmail.com via Personal OS';
const MAX_LINE = 20000000;

const nid = (s) => String(s || '').replace(/-/g, '');
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const plain = (arr) => (arr || []).map((x) => x.plain_text != null ? x.plain_text : ((x.text && x.text.content) || '')).join('');
function rt(s) {
  s = String(s || '');
  const out = [];
  for (let i = 0; i < s.length; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
}
const bad = (m, status = 400) => { const e = new Error(m); e.status = status; return e; };

// The only shape that is ever stored or sent. Anything else is dropped.
export function normalizeLog(raw) {
  const l = raw && typeof raw === 'object' ? raw : {};
  const type = TYPES.includes(l.type) ? l.type : 'pool';
  const students = (Array.isArray(l.students) ? l.students : []).map((s) => ({
    name: str(s && s.name, 80), invoice: str(s && s.invoice, 40), course: str(s && s.course, 150),
  })).filter((s) => s.name);
  if (students.length > 12) throw bad('At most 12 students in one class');
  const costs = (Array.isArray(l.costs) ? l.costs : []).map((c) => {
    const amount = typeof (c && c.amount) === 'number' ? c.amount : (Number(String(c && c.amount != null ? c.amount : '').replace(/[^0-9]/g, '')) || 0);
    return {
      component: COMPONENTS.includes(c && c.component) ? c.component : 'other',
      description: str(c && c.description, 200),
      amount: Math.round(amount),
    };
  }).filter((c) => c.description || c.amount);
  if (costs.length > 20) throw bad('At most 20 cost lines in one class');
  for (const c of costs) if (c.amount > MAX_LINE) throw bad('One line is over Rp20.000.000. Check the number.');
  return {
    v: 1, venue: str(l.venue, 100), city: str(l.city, 40), type, students, costs,
    note: str(l.note, 300),
    total: costs.reduce((t, c) => t + c.amount, 0),
  };
}

export function parseLog(text) {
  if (!text) return null;
  try { const j = JSON.parse(text); return j && typeof j === 'object' ? j : null; } catch (e) { return null; }
}

async function notion(path, H, opts = {}) {
  const r = await fetch(NOTION + path, { method: opts.method || 'GET', headers: H, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let d = {};
  try { d = await r.json(); } catch (e) { d = {}; }
  if (!r.ok || d.object === 'error') throw bad('Notion error: ' + ((d && d.message) || ('HTTP ' + r.status)), 502);
  return d;
}

// The row must be a class in the Tasks database. Returns the raw page.
async function assertClass(id, H) {
  const pg = await notion('/pages/' + nid(id), H);
  if (nid((pg.parent || {}).database_id) !== TASKS_DB) throw bad('That page is not in the Tasks database', 403);
  const t = mapPage(pg);
  if (t.section !== 'Classes' || t.type !== 'Event') throw bad('Expenses can only be logged on a class (Section Classes, an event)', 403);
  return { pg, t };
}

async function sheet(body) {
  const r = await fetch(process.env.DAA_API_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, key: process.env.DAA_API_KEY, actor: ACTOR }),
  });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { throw bad('The DAA sheet service did not answer with JSON (it sometimes does when Google is slow). Try Send again.', 502); }
  if (!j.ok) throw bad('The DAA sheet service refused: ' + (j.error || 'no reason given'), 502);
  return j;
}

function cityOf(t, log) {
  if (log.city) return log.city;
  if (/DiveArts Bali/i.test(t.notes || '')) return 'Bali';
  if (/DiveArts Jakarta/i.test(t.notes || '')) return 'Jakarta';
  return '';
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Says only whether sending is switched on. No values.
    res.status(200).json({ ok: true, sendReady: !!(process.env.DAA_API_URL && process.env.DAA_API_KEY), notion: !!process.env.NOTION_TOKEN });
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
    if (!body.id) throw bad('Which class? The request has no id');
    const { t } = await assertClass(body.id, H);
    if (t.sessionId) throw bad('This class was already sent to the DiveArts books as ' + t.sessionId + '. Correct it in the sheet.', 409);
    const prev = t.expenses || {};

    if (body.action === 'draft') {
      const log = normalizeLog(body.log);
      const keep = prev.pendingSessionId ? { pendingSessionId: prev.pendingSessionId } : {};
      const stored = { ...log, ...keep, savedAt: new Date().toISOString() };
      const pg = await notion('/pages/' + nid(body.id), H, { method: 'PATCH', body: { properties: { 'Expenses': { rich_text: rt(JSON.stringify(stored)) } } } });
      res.status(200).json({ today, task: mapPage(pg) });
      return;
    }

    if (body.action === 'send') {
      const log = normalizeLog(body.log || prev);
      if (!log.costs.some((c) => c.amount > 0)) throw bad('Add at least one cost with an amount before sending');
      const day = t.date && t.date.start ? (String(t.date.start).length > 10 ? witaDate(new Date(t.date.start)) : String(t.date.start).slice(0, 10)) : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw bad('This class has no date');
      if (day > today) throw bad('This class is on ' + day + '. Send its expenses on or after that day. You can save a draft now.');
      if (!process.env.DAA_API_URL || !process.env.DAA_API_KEY) {
        throw bad('Sending is not switched on yet: DAA_API_URL and DAA_API_KEY need to be added in Vercel (same values as the DiveArts OS on Cloudflare). Your draft is safe.', 503);
      }
      // Save the draft first so nothing typed is lost if the sheet is slow.
      const draft = { ...log, pendingSessionId: prev.pendingSessionId || '', savedAt: new Date().toISOString() };
      await notion('/pages/' + nid(body.id), H, { method: 'PATCH', body: { properties: { 'Expenses': { rich_text: rt(JSON.stringify(draft)) } } } });

      const s1 = await sheet({ action: 'saveSession', session: {
        session_id: prev.pendingSessionId || '', date: day, city: cityOf(t, log), venue: log.venue,
        instructor_email: INSTRUCTOR, session_type: log.type, status: 'logged',
        note: str('Personal OS: ' + (t.name || '') + (log.note ? ' | ' + log.note : ''), 300), source: 'personal-os',
      } });
      const sid = String(s1.session_id || '');
      if (!sid) throw bad('The sheet service saved the day but returned no session id', 502);
      let s2;
      try {
        s2 = await sheet({ action: 'saveSessionDetail', session_id: sid,
          costs: log.costs.map((c) => ({ component: c.component, description: c.description || c.component.replace(/_/g, ' '), amount_idr: c.amount })),
          attendance: log.students.map((s) => ({ student_name: s.name, invoice_no: s.invoice, course: s.course, units: 1 })) });
      } catch (e) {
        // The day exists in OS_SESSIONS without its lines. Remember its id so
        // the next Send fills that same session instead of making a second one.
        const keep = { ...draft, pendingSessionId: sid };
        await notion('/pages/' + nid(body.id), H, { method: 'PATCH', body: { properties: { 'Expenses': { rich_text: rt(JSON.stringify(keep)) } } } });
        throw bad('The day was created as ' + sid + ' but its cost lines did not save: ' + e.message + ' Press Send again to finish it.', 502);
      }
      const sent = { ...log, sessionId: sid, sentAt: new Date().toISOString(), total: Number(s2.day_total_idr) || log.total,
        result: { expensesRow: s2.expenses_row || 0, expensesError: s2.expenses_error || '', studentBlock: s2.student_block || '', studentBlockError: s2.student_block_error || '' } };
      const pg = await notion('/pages/' + nid(body.id), H, { method: 'PATCH', body: { properties: {
        'Expenses': { rich_text: rt(JSON.stringify(sent)) },
        'Session ID': { rich_text: rt(sid) },
      } } });
      res.status(200).json({ today, task: mapPage(pg), result: sent.result, sessionId: sid });
      return;
    }
    throw bad('unknown action');
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
}
