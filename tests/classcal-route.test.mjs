/* Tests for /api/classlog action 'calendar': cancel, restore or move a class
   (18 Oct 2026). Run: node tests/classcal-route.test.mjs
   Notion and the DAA sheet service are faked; the route runs as written. */
import assert from 'node:assert/strict';

process.env.OS_KEY = 'os';
process.env.NOTION_TOKEN = 'nt';
delete process.env.DAA_API_URL;
process.env.DAA_API_KEY = 'daa';

const { default: handler, gcalIds, cancelNotes, restoreNotes, cleanMove, movedDate } = await import('../api/classlog.js');
const { TASKS_DB, witaDate } = await import('../api/tasks.js');
const TODAY = witaDate();
const plus = (n) => { const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

let page, calls, sheetAnswer, notionFails;
const rt = (s) => [{ plain_text: s, text: { content: s } }];
function mkPage({ start = plus(3) + 'T10:00:00.000+08:00', end = plus(3) + 'T12:00:00.000+08:00', notes, sessionId = '', section = 'Classes', status = 'To do' } = {}) {
  return {
    id: 'page-1', parent: { database_id: TASKS_DB }, created_time: '', last_edited_time: '', url: '',
    properties: {
      Name: { title: rt('Teach: Mermaid Class (Kids) · Regular class') }, Area: { select: { name: 'DiveArts' } },
      Section: { select: { name: section } }, Type: { select: { name: 'Event' } }, Status: { select: { name: status } },
      Date: { date: { start, end } },
      Notes: { rich_text: rt(notes != null ? notes : 'Cakra Hotel Sanur. Regular class. From DiveArts Bali calendar, instructor Befalia. gcal:regularev1') },
      Expenses: { rich_text: [] }, 'Session ID': { rich_text: sessionId ? rt(sessionId) : [] },
    },
  };
}
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ u, method: init.method || 'GET', body });
  if (u.startsWith('https://api.notion.com/v1/pages/')) {
    if ((init.method || 'GET') === 'PATCH') {
      if (notionFails) return new Response(JSON.stringify({ object: 'error', message: 'Notion is down' }), { status: 502 });
      const p = body.properties;
      if (p.Status) page.properties.Status = { select: { name: p.Status.select.name } };
      if (p.Notes) page.properties.Notes = { rich_text: p.Notes.rich_text.map((x) => ({ plain_text: x.text.content })) };
      if (p.Date) page.properties.Date = { date: p.Date.date };
    }
    return new Response(JSON.stringify(page));
  }
  if (u.startsWith('https://script.google.com/')) {
    if (body.key !== 'daa') return new Response(JSON.stringify({ ok: false, error: 'bad key' }));
    if (body.action === 'classCalEdit') return new Response(JSON.stringify(sheetAnswer(body)));
  }
  return new Response('not faked: ' + u, { status: 500 });
};
const run = async (body, key = 'os') => {
  const res = { s: 0, j: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(s) { this.s = s; return this; }, json(j) { this.j = j; return this; } };
  await handler({ method: 'POST', headers: { 'x-os-key': key }, body }, res);
  return res;
};
const sheetCalls = () => calls.filter((c) => c.u.startsWith('https://script.google.com/'));
const patches = () => calls.filter((c) => c.method === 'PATCH');
let n = 0;
const t = async (name, fn) => {
  calls = []; page = mkPage(); notionFails = false;
  sheetAnswer = (b) => ({ ok: true, op: b.op, events: b.ids.map((id) => ({ id, cal: 'Bali' })), calendar: null, deferred: 0, syncError: '' });
  await fn(); n++; console.log('ok', n, name);
};

await t('helpers: ids from notes, notes on cancel and restore', async () => {
  assert.deepEqual(gcalIds('x. gcal:abc12 gcal:def34 gcal:abc12'), ['abc12', 'def34']);
  assert.deepEqual(gcalIds('no markers'), []);
  const c = cancelNotes('Cakra. gcal:abc12', '2026-10-18');
  assert.equal(c, 'Cancelled in Befalia OS on 18 Oct 2026. Cakra. gcal:abc12');
  assert.equal(cancelNotes(c, '2026-10-19'), 'Cancelled in Befalia OS on 19 Oct 2026. Cakra. gcal:abc12', 'never two notes');
  assert.equal(restoreNotes(c), 'Cakra. gcal:abc12');
});

await t('cancel: the calendar first, then the row is hidden (Parked) with a note', async () => {
  const r = await run({ action: 'calendar', op: 'cancel', id: 'page-1' });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  const sc = sheetCalls();
  assert.equal(sc.length, 1);
  assert.deepEqual(sc[0].body.ids, ['regularev1']);
  assert.equal(sc[0].body.op, 'cancel');
  assert.equal(sc[0].body.actor, 'diveartsacademy@gmail.com via Personal OS');
  assert.equal(r.j.task.status, 'Parked');
  assert.match(r.j.task.notes, /^Cancelled in Befalia OS on /);
  const order = calls.map((c) => (c.u.startsWith('https://script') ? 'sheet' : c.method));
  assert.ok(order.indexOf('sheet') < order.indexOf('PATCH'), 'calendar before the row');
});

await t('restore: back on the list, note gone', async () => {
  page = mkPage({ status: 'Parked', notes: 'Cancelled in Befalia OS on 18 Oct 2026. Cakra. gcal:regularev1' });
  const r = await run({ action: 'calendar', op: 'restore', id: 'page-1' });
  assert.equal(r.s, 200);
  assert.equal(r.j.task.status, 'To do');
  assert.equal(r.j.task.notes, 'Cakra. gcal:regularev1');
});

await t('move a timed class: new date in the class zone (WITA for Bali, WIB for Jakarta)', async () => {
  const r = await run({ action: 'calendar', op: 'move', id: 'page-1', move: { date: plus(5), start: '14:00', end: '16:00' } });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.deepEqual(sheetCalls()[0].body.move, { date: plus(5), start: '14:00', end: '16:00' });
  assert.deepEqual(r.j.task.date, { start: plus(5) + 'T14:00:00.000+08:00', end: plus(5) + 'T16:00:00.000+08:00' });
  page = mkPage({ notes: 'GBK. From DiveArts Jakarta calendar, instructor Befalia. gcal:jktev0001' });
  sheetAnswer = (b) => ({ ok: true, events: [{ id: 'jktev0001', cal: 'Jakarta' }] });
  const r2 = await run({ action: 'calendar', op: 'move', id: 'page-1', move: { date: plus(5), start: '09:00', end: '11:00' } });
  assert.equal(r2.j.task.date.start, plus(5) + 'T09:00:00.000+07:00');
});

await t('move an all-day block: first and last day, no times', async () => {
  page = mkPage({ start: plus(1), end: plus(5), notes: 'All day. From DiveArts Bali calendar, instructor Befalia. gcal:blockev001' });
  const r = await run({ action: 'calendar', op: 'move', id: 'page-1', move: { date: plus(8), endDate: plus(10), start: '10:00' } });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.deepEqual(sheetCalls()[0].body.move, { date: plus(8), endDate: plus(10) }, 'times are dropped for a block');
  assert.deepEqual(r.j.task.date, { start: plus(8), end: plus(10) });
  const one = await run({ action: 'calendar', op: 'move', id: 'page-1', move: { date: plus(12) } });
  assert.deepEqual(one.j.task.date, { start: plus(12), end: null });
});

await t('refusals before anything is written', async () => {
  const no = async (body, re, status = 400) => {
    calls = [];
    const r = await run(body);
    assert.equal(r.s, status, JSON.stringify(r.j));
    assert.match(r.j.error, re);
    assert.equal(patches().length, 0, 'no Notion write');
    return r;
  };
  await no({ action: 'calendar', op: 'delete', id: 'page-1' }, /Unknown change/);
  await no({ action: 'calendar', op: 'move', id: 'page-1', move: { date: plus(-1), start: '10:00', end: '12:00' } }, /cannot move into the past/);
  await no({ action: 'calendar', op: 'move', id: 'page-1', move: { date: plus(2), start: '12:00', end: '10:00' } }, /end time has to be after/);
  await no({ action: 'calendar', op: 'move', id: 'page-1', move: { date: plus(2), start: '9', end: '10:00' } }, /start and end time/);
  await no({ action: 'calendar', op: 'move', id: 'page-1', move: { date: 'tomorrow' } }, /Pick the new date/);
  assert.equal(sheetCalls().length, 0);
  page = mkPage({ notes: 'Added by hand, no calendar link' });
  await no({ action: 'calendar', op: 'cancel', id: 'page-1' }, /no Google Calendar link/, 409);
  page = mkPage({ sessionId: 'SES-20261013-1' });
  await no({ action: 'calendar', op: 'cancel', id: 'page-1' }, /already in the DiveArts books/, 409);
  page = mkPage({ section: 'ADMIN' });
  await no({ action: 'calendar', op: 'cancel', id: 'page-1' }, /only be logged on a class/, 403);
  page = mkPage();
  const r = await run({ action: 'calendar', op: 'cancel', id: 'page-1' }, 'wrong');
  assert.equal(r.s, 401);
});

await t('the sheet service says no: the row is left as it was', async () => {
  sheetAnswer = () => ({ ok: false, error: '"Meeting with PADI" does not look like a class. Nothing changed.' });
  const r = await run({ action: 'calendar', op: 'cancel', id: 'page-1' });
  assert.equal(r.s, 502);
  assert.match(r.j.error, /does not look like a class/);
  assert.equal(patches().length, 0);
  assert.equal(page.properties.Status.select.name, 'To do');
});

await t('the calendar changed but Notion did not: it says so and nothing needs redoing', async () => {
  notionFails = true;
  const r = await run({ action: 'calendar', op: 'cancel', id: 'page-1' });
  assert.equal(r.s, 502);
  assert.match(r.j.error, /The calendar changed, but the To-Do row did not/);
});

await t('without DAA_API_KEY nothing is sent', async () => {
  delete process.env.DAA_API_KEY;
  const r = await run({ action: 'calendar', op: 'cancel', id: 'page-1' });
  process.env.DAA_API_KEY = 'daa';
  assert.equal(r.s, 503);
  assert.equal(sheetCalls().length, 0);
});

await t('cleanMove and movedDate on their own', async () => {
  const timed = { date: { start: '2026-10-25T10:00:00.000+08:00' } };
  assert.deepEqual(cleanMove(timed, { date: '2026-10-26', start: '08:30', end: '10:00', endDate: 'x' }, '2026-10-18'), { date: '2026-10-26', start: '08:30', end: '10:00' });
  assert.deepEqual(movedDate({ date: '2026-10-26', start: '08:30', end: '10:00' }, 'Jakarta'), { start: '2026-10-26T08:30:00.000+07:00', end: '2026-10-26T10:00:00.000+07:00' });
  assert.throws(() => cleanMove(timed, { date: '2026-10-17', start: '08:30', end: '10:00' }, '2026-10-18'), /past/);
});

console.log(n + ' passed');
