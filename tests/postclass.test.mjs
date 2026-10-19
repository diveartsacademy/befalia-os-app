/* Tests for the after-class checklist in Befalia OS: api/_postclass.js (the
   rules) and api/postclass.js (the route). Run: node tests/postclass.test.mjs
   Notion and the sheet service are faked. Classes and names are invented. */
import assert from 'node:assert/strict';

process.env.OS_KEY = 'os';
process.env.NOTION_TOKEN = 'nt';
delete process.env.DAA_API_URL;
process.env.DAA_API_KEY = 'daa';
process.env.POSTCLASS_START = '2026-01-01';

const P = await import('../api/_postclass.js');
const { default: handler } = await import('../api/postclass.js');
const { TASKS_DB, witaDate } = await import('../api/tasks.js');
const { gcalIds } = await import('../api/classlog.js');
const TODAY = witaDate();
const plus = (n) => P.addDays(TODAY, n);

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', n, name); };

const cls = (o) => Object.assign({ id: 'c' + Math.random().toString(36).slice(2, 8), section: 'Classes', type: 'Event', status: 'To do',
  name: 'Teach: Ana · Open water 1 of 2 · 09:00 WITA', notes: 'From DiveArts Bali calendar. gcal:evAAAA1', date: { start: plus(-1) + 'T09:00:00+08:00', end: plus(-1) + 'T11:00:00+08:00' } }, o);

await t('last session: "2 of 2", "3/3", "2 dari 2" yes; "1 of 2" and no count no', () => {
  assert.equal(P.isLastSession('Ana · Open water 2 of 2'), true);
  assert.equal(P.isLastSession('Session 3/3'), true);
  assert.equal(P.isLastSession('pertemuan 2 dari 2'), true);
  assert.equal(P.isLastSession('Open water 1 of 2'), false);
  assert.equal(P.isLastSession('Mermaid Class (Kids) · Regular class'), false);
  assert.deepEqual(P.stepsFor({ name: 'X 2 of 2' }), ['expenses', 'files', 'certify']);
  assert.deepEqual(P.stepsFor({ name: 'Regular class' }), ['expenses', 'files']);
});

await t('the class key is the calendar event, else the To-Do id', () => {
  assert.equal(P.keyOf({ notes: 'x gcal:evAAAA1 gcal:evBBBB2', id: 'zz' }, gcalIds), 'ev:evAAAA1');
  assert.equal(P.keyOf({ notes: 'no calendar', id: 'ab-cd-ef-12' }, gcalIds), 'nt:abcdef12');
  assert.deepEqual(P.stepOfNotes('postclass:ev:evAAAA1:files · After-class step'), { key: 'ev:evAAAA1', item: 'files' });
  assert.equal(P.stepOfNotes('nothing here'), null);
});

await t('which classes count: ended, from the start date, in the window, not cancelled', () => {
  const now = Date.now();
  const list = P.classesFrom([
    cls({ id: 'past' }),
    cls({ id: 'future', date: { start: plus(1) + 'T09:00:00+08:00', end: plus(1) + 'T11:00:00+08:00' } }),
    cls({ id: 'old', date: { start: '2026-09-01T09:00:00+08:00', end: '2026-09-01T11:00:00+08:00' } }),
    cls({ id: 'parked', status: 'Parked' }),
    cls({ id: 'cancel', name: 'CANCELLED · Teach: Ana' }),
    cls({ id: 'task', type: 'Task' }),
    cls({ id: 'allday', date: { start: plus(-2) } }),
  ], { today: TODAY, nowMs: now, gcalIds });
  const ids = list.map((c) => c.id);
  if (plus(-2) >= P.START) assert.deepEqual(ids, ['allday', 'past']);
  else assert.deepEqual(ids.filter((x) => x === 'future' || x === 'old' || x === 'parked' || x === 'cancel' || x === 'task'), []);
  assert.equal(list.find((c) => c.id === 'past') ? list.find((c) => c.id === 'past').name : 'Ana · Open water 1 of 2', 'Ana · Open water 1 of 2');
});

const C = (o) => ({ id: o.id, key: o.key, day: plus(-1), name: o.name || 'Ana · Open water 2 of 2', steps: o.steps || ['expenses', 'files', 'certify'], task: o.task || {} });
await t('plan: new class gets a task per step; done-by-itself steps are Done and written to the sheet', () => {
  const p = P.planPostClass([C({ id: 'c1', key: 'ev:kk11', task: { sessionId: 'SES-1', expenses: { videos: { at: 'x' } } } })], [], []);
  assert.deepEqual(p.create.map((x) => [x.item, x.done]), [['expenses', true], ['files', true], ['certify', false]]);
  assert.deepEqual(p.write.map((w) => [w.item, w.by]), [['expenses', 'auto'], ['files', 'auto']]);
});

await t('plan: a tick in the dashboard closes the To-Do task; an untick there reopens it', () => {
  const task = (id, item, done) => ({ id, done, notes: 'postclass:ev:kk11:' + item });
  const p = P.planPostClass([C({ id: 'c1', key: 'ev:kk11' })],
    [{ class_key: 'ev:kk11', item: 'files', done: true, by: 'rie@x' }, { class_key: 'ev:kk11', item: 'certify', done: false, by: 'rie@x' }],
    [task('t1', 'expenses', false), task('t2', 'files', false), task('t3', 'certify', true)]);
  assert.deepEqual(p.close, ['t2']);
  assert.deepEqual(p.reopen, ['t3']);
  assert.deepEqual(p.create, []);
  assert.deepEqual(p.write, []);
});

await t('plan: a To-Do tick with nothing in the sheet yet is written to the sheet', () => {
  const p = P.planPostClass([C({ id: 'c1', key: 'ev:kk11', steps: ['expenses', 'files'] })], [],
    [{ id: 't1', done: true, notes: 'postclass:ev:kk11:files' }, { id: 't2', done: false, notes: 'postclass:ev:kk11:expenses' }]);
  assert.deepEqual(p.write.map((w) => [w.item, w.by]), [['files', 'Befa via To-Do']]);
  assert.deepEqual(p.close, []);
  assert.deepEqual(p.view[0].steps.map((s) => s.done), [false, true]);
});

await t('plan: done by itself always wins, even over an untick in the sheet', () => {
  const p = P.planPostClass([C({ id: 'c1', key: 'ev:kk11', steps: ['expenses', 'files'], task: { sessionId: 'SES-2' } })],
    [{ class_key: 'ev:kk11', item: 'expenses', done: false }], [{ id: 't1', done: false, notes: 'postclass:ev:kk11:expenses' }]);
  assert.deepEqual(p.close, ['t1']);
  assert.deepEqual(p.write.map((w) => w.item), ['expenses']);
});

await t('task name and notes carry the step, the class and the day', () => {
  const c = { key: 'ev:kk11', day: '2026-10-19', name: 'Ana · Open water 2 of 2' };
  assert.equal(P.taskName(c, 'certify'), 'After class · Ana · Open water 2 of 2 (19 Okt): Process the certification in PADI Pros or MFI');
  assert.deepEqual(P.stepOfNotes(P.taskNotes(c, 'certify')), { key: 'ev:kk11', item: 'certify' });
});

/* ---------- the route ---------- */
let pages, sheetRows, calls, created;
const rt = (s) => [{ plain_text: s, text: { content: s } }];
const page = (x) => ({ id: x.id, parent: { database_id: TASKS_DB }, created_time: '', last_edited_time: '', url: '', properties: {
  Name: { title: rt(x.name) }, Section: { select: x.section ? { name: x.section } : null }, Type: { select: { name: x.type || 'Task' } },
  Status: { select: { name: x.status || (x.done ? 'Done' : 'To do') } }, Done: { checkbox: !!x.done }, Notes: { rich_text: rt(x.notes || '') },
  Date: { date: x.date || null }, 'Session ID': { rich_text: x.sessionId ? rt(x.sessionId) : [] },
  Expenses: { rich_text: x.expenses ? rt(JSON.stringify(x.expenses)) : [] } } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ u, method: init.method || 'GET', body });
  if (u === 'https://api.notion.com/v1/databases/' + TASKS_DB + '/query') return new Response(JSON.stringify({ results: pages.map(page), has_more: false }));
  if (u === 'https://api.notion.com/v1/pages' && init.method === 'POST') {
    const p = body.properties; const x = { id: 'new' + (++created), name: p.Name.title[0].text.content, section: p.Section.select.name, notes: p.Notes.rich_text[0].text.content, done: p.Done.checkbox, date: p.Date.date };
    pages.push(x); return new Response(JSON.stringify(page(x)));
  }
  if (u.startsWith('https://api.notion.com/v1/pages/')) {
    const id = u.split('/').pop(); const x = pages.find((y) => y.id === id);
    if (init.method === 'PATCH') x.done = body.properties.Done.checkbox;
    return new Response(JSON.stringify(page(x)));
  }
  if (u.startsWith('https://script.google.com/')) {
    if (body.key !== 'daa') return new Response(JSON.stringify({ ok: false, error: 'bad key' }));
    if (body.action === 'postClassRead') return new Response(JSON.stringify({ ok: true, rows: sheetRows.filter((r) => body.keys.includes(r.class_key)) }));
    if (body.action === 'postClassSet') {
      const i = sheetRows.findIndex((r) => r.class_key === body.class_key && r.item === body.item);
      const row = { class_key: body.class_key, item: body.item, done: body.done, by: body.by || '', at: 'now' };
      if (i >= 0) sheetRows[i] = row; else sheetRows.push(row);
      return new Response(JSON.stringify({ ok: true, set: row }));
    }
  }
  return new Response('not faked: ' + u, { status: 500 });
};
const run = async (method, body, key = 'os') => {
  const res = { s: 0, j: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(s) { this.s = s; return this; }, json(j) { this.j = j; return this; } };
  await handler({ method, headers: { 'x-os-key': key }, body }, res);
  return res;
};
const reset = () => {
  calls = []; created = 0; sheetRows = [];
  pages = [
    { id: 'cls1', name: 'Teach: Ana · Open water 2 of 2 · 09:00 WITA', section: 'Classes', type: 'Event', notes: 'gcal:evAAAA1', sessionId: 'SES-9',
      date: { start: plus(-1) + 'T09:00:00+08:00', end: plus(-1) + 'T11:00:00+08:00' } },
    { id: 'cls2', name: 'Teach: Kids · Regular class', section: 'Classes', type: 'Event', notes: 'gcal:evBBBB2',
      date: { start: plus(-1) + 'T14:00:00+08:00', end: plus(-1) + 'T15:00:00+08:00' } },
    { id: 'clsF', name: 'Teach: Later · 1 of 2', section: 'Classes', type: 'Event', notes: 'gcal:evFFFF9',
      date: { start: plus(2) + 'T09:00:00+08:00', end: plus(2) + 'T10:00:00+08:00' } },
  ];
};
const afterStart = plus(-1) >= P.START;
assert.ok(afterStart, 'the route tests must really run');

await t('no key, nothing', async () => { reset(); const r = await run('GET', null, 'bad'); assert.equal(r.s, 401); assert.equal(calls.length, 0); });

await t('GET lists the ended classes and their steps and writes nothing', async () => {
  reset();
  const r = await run('GET');
  assert.equal(r.s, 200, JSON.stringify(r.j));
  if (!afterStart) { assert.equal(r.j.classes.length, 0); return; }
  assert.deepEqual(r.j.classes.map((c) => [c.name, c.steps.map((s) => s.item + (s.done ? '+' : '-'))]),
    [['Ana · Open water 2 of 2', ['expenses+', 'files-', 'certify-']], ['Kids · Regular class', ['expenses-', 'files-']]]);
  assert.equal(r.j.open, 4);
  assert.equal(calls.filter((c) => c.method === 'PATCH' || (c.method === 'POST' && c.u.endsWith('/pages'))).length, 0);
  assert.equal(calls.filter((c) => c.body && c.body.action === 'postClassSet').length, 0);
});

await t('sync creates five step tasks dated the class day, records the automatic one, and is idempotent', async () => {
  reset();
  if (!afterStart) return;
  const s = await run('POST', { action: 'sync' });
  assert.equal(s.s, 200, JSON.stringify(s.j));
  assert.equal(s.j.created, 5);
  assert.equal(s.j.written, 1);
  const steps = pages.filter((p) => p.section === 'After class');
  assert.ok(steps.every((p) => p.date.start === plus(-1)));
  assert.equal(steps.find((p) => /cls|Ana/.test(p.name) && /expenses/.test(p.notes)).done, true);
  assert.deepEqual(sheetRows.map((r) => [r.class_key, r.item, r.by]), [['ev:evAAAA1', 'expenses', 'auto']]);
  const again = await run('POST', { action: 'sync' });
  assert.deepEqual([again.j.created, again.j.closed, again.j.reopened, again.j.written], [0, 0, 0, 0]);
});

await t('a tick in To-Do reaches the sheet; a tick in the dashboard reaches To-Do', async () => {
  reset();
  if (!afterStart) return;
  await run('POST', { action: 'sync' });
  const files1 = pages.find((p) => p.notes.startsWith('postclass:ev:evAAAA1:files'));
  files1.done = true; // ticked in To-Do (tdPatch), then the hook:
  const r = await run('POST', { action: 'tickTask', id: files1.id, done: true });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.ok(sheetRows.some((x) => x.class_key === 'ev:evAAAA1' && x.item === 'files' && x.done === true && x.by === 'Befa via To-Do'));
  sheetRows.push({ class_key: 'ev:evBBBB2', item: 'expenses', done: true, by: 'rie@x' }); // ticked in the dashboard
  const s = await run('POST', { action: 'sync' });
  assert.equal(s.j.closed, 1);
  assert.equal(pages.find((p) => p.notes.startsWith('postclass:ev:evBBBB2:expenses')).done, true);
});

await t('tickTask refuses a task that is not an after-class step', async () => {
  reset();
  const r = await run('POST', { action: 'tickTask', id: 'cls1', done: true });
  assert.equal(r.s, 400);
  assert.equal((await run('POST', { action: 'tickTask', id: 'cls1', done: 'yes' })).s, 400);
  assert.equal((await run('POST', { action: 'other' })).s, 400);
});

await t('a script without PostClass.gs gives a clear message', async () => {
  reset();
  if (!afterStart) return;
  const save = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://script.google.com/') ? new Response(JSON.stringify({ ok: false, error: 'unknown action postClassRead' })) : save(url, init));
  const r = await run('GET');
  globalThis.fetch = save;
  assert.equal(r.s, 503);
  assert.match(r.j.error, /PostClass\.gs still has to be deployed/);
});

console.log(n + ' passed');
