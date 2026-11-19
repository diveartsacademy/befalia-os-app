// Daily tasks: one template, one copy per day, no double count, no overdue pile.
// Run: node --test tests/daily.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  DAILY_ORDER_BASE, DAILY_SEED, cronAuthorized, dailyCopyNotes, newDailyId, parseDaily, planDaily, stripDailyCopyPatch,
} from '../api/_daily.js';
import { todayCounts } from '../api/_todo-today.js';

const TODAY = '2026-11-19';
const YESTERDAY = '2026-11-18';

function page(over) {
  return Object.assign({
    id: 'p', name: 'Task', area: 'Personal', section: 'Daily', status: 'To do',
    done: false, notes: '', date: null, order: null, completedOn: null,
    created: '2026-11-01T00:00:00.000Z',
  }, over);
}

function apply(pages, today) {
  const plan = planDaily(pages, today);
  const kept = pages.filter((p) => !plan.archive.includes(p.id)).map((p) => Object.assign({}, p));
  for (const id of plan.park) {
    const t = kept.find((p) => p.id === id);
    if (t) { t.status = 'Parked'; t.done = false; }
  }
  plan.creates.forEach((c, i) => {
    kept.push(page({
      id: 'made-' + i,
      name: c.name,
      notes: c.notes,
      status: c.status,
      done: false,
      date: c.date,
      order: c.order,
      created: '2026-11-19T01:00:' + String(i).padStart(2, '0') + '.000Z',
    }));
  });
  return { pages: kept, plan };
}

test('the seed is the seven lines, in order, above the note\'s line numbers', () => {
  assert.deepEqual(DAILY_SEED.map((s) => s.name), [
    'Reply to emails',
    'Send all BD replies',
    'Send all CRM replies',
    'Buy all Sea Diva third-party orders',
    'Design',
    'Sea Diva production',
    'Take pills',
  ]);
  const plan = planDaily([], TODAY);
  assert.deepEqual(plan.templates.map((t) => t.name), DAILY_SEED.map((s) => s.name));
  assert.deepEqual(plan.templates.map((t) => t.order), DAILY_SEED.map((_, i) => DAILY_ORDER_BASE + (i + 1) * 10));
  const copies = plan.creates.filter((c) => c.role === 'copy');
  const templates = plan.creates.filter((c) => c.role === 'template');
  assert.equal(copies.length, 7);
  assert.equal(templates.length, 7);
  assert.deepEqual(copies.map((c) => c.notes), DAILY_SEED.map((s) => dailyCopyNotes(s.id, TODAY)));
  assert.ok(templates.every((c) => c.status === 'Parked' && c.date == null));
  assert.ok(copies.every((c) => c.status === 'To do' && c.date.start === TODAY));
});

test('a second plan writes nothing, and a removed line is not seeded again', () => {
  const first = apply([], TODAY);
  const again = planDaily(first.pages, TODAY);
  assert.deepEqual(again.creates, []);
  assert.deepEqual(again.archive, []);
  assert.deepEqual(again.park, []);
  assert.equal(again.templates.length, 7);

  const retired = first.pages.map((p) => {
    const m = parseDaily(p.notes);
    if (m && m.kind === 'template') return Object.assign({}, p, { notes: 'daily-retired:' + m.id, status: 'Parked' });
    return p;
  });
  const after = planDaily(retired.filter((p) => parseDaily(p.notes).kind !== 'copy'), TODAY);
  assert.equal(after.creates.length, 0);
  assert.equal(after.templates.length, 0);
});

test('today\'s copy is left alone when the template changes, and created when it is missing', () => {
  const { pages } = apply([], TODAY);
  const design = pages.find((p) => p.notes === 'daily-template:design');
  design.name = 'Design block';
  design.order = DAILY_ORDER_BASE + 10;
  const copy = pages.find((p) => p.notes === 'daily:design:' + TODAY);
  const plan = planDaily(pages, TODAY);
  assert.equal(plan.creates.length, 0);
  assert.equal(copy.name, 'Design');

  const missing = pages.filter((p) => p.notes !== 'daily:design:' + TODAY);
  const made = planDaily(missing, TODAY);
  assert.equal(made.creates.length, 1);
  assert.equal(made.creates[0].name, 'Design block');
  assert.equal(made.creates[0].notes, 'daily:design:' + TODAY);
  assert.equal(made.creates[0].order, design.order);
});

test('yesterday\'s unticked copy is archived, a ticked one stays, and a duplicate is archived', () => {
  const { pages } = apply([], TODAY);
  const open = page({
    id: 'y-open', name: 'Take pills', notes: 'daily:take-pills:' + YESTERDAY,
    date: { start: YESTERDAY }, created: '2026-11-18T00:00:00.000Z',
  });
  const done = page({
    id: 'y-done', name: 'Design', notes: 'daily:design:' + YESTERDAY, done: true, status: 'Done',
    completedOn: YESTERDAY, date: { start: YESTERDAY }, created: '2026-11-18T00:00:01.000Z',
  });
  const todayCopy = pages.find((p) => p.notes === 'daily:take-pills:' + TODAY);
  const dup = page({
    id: 'dup', name: 'Take pills', notes: todayCopy.notes, date: { start: TODAY },
    created: '2099-01-01T00:00:00.000Z',
  });
  const olderDone = page({
    id: 'dup-done', name: 'Reply to emails', notes: 'daily:reply-to-emails:' + TODAY,
    done: true, status: 'Done', completedOn: TODAY, date: { start: TODAY },
    created: '2020-01-01T00:00:00.000Z',
  });
  const plan = planDaily(pages.concat([open, done, dup, olderDone]), TODAY);
  assert.ok(plan.archive.includes('y-open'));
  assert.equal(plan.archive.includes('y-done'), false);
  assert.ok(plan.archive.includes('dup'));
  assert.equal(plan.archive.includes(todayCopy.id), false);
  const emails = pages.find((p) => p.notes === 'daily:reply-to-emails:' + TODAY);
  assert.ok(plan.archive.includes(emails.id), 'the open duplicate goes, the ticked one stays');
  assert.equal(plan.archive.includes('dup-done'), false);
  assert.equal(plan.creates.length, 0);
});

test('an unparked template is parked and still not counted beside today\'s copy', () => {
  const { pages } = apply([], TODAY);
  const template = pages.find((p) => p.notes === 'daily-template:take-pills');
  template.status = 'To do';
  template.done = false;
  const plan = planDaily(pages, TODAY);
  assert.ok(plan.park.includes(template.id));
  assert.equal(plan.creates.length, 0);
  const future = page({ id: 'later', name: 'Later', date: { start: '2026-11-20' }, section: '' });
  const counts = todayCounts(pages.concat([future]), TODAY);
  assert.equal(counts.open, 7);
  assert.deepEqual(counts.areas, { Personal: 7 });
});

test('markers, locked fields, ids and the cron header', () => {
  assert.deepEqual(parseDaily('daily-template:take-pills'), { kind: 'template', id: 'take-pills' });
  assert.deepEqual(parseDaily('daily-retired:take-pills'), { kind: 'retired', id: 'take-pills' });
  assert.deepEqual(parseDaily('daily:take-pills:2026-11-19'), { kind: 'copy', id: 'take-pills', day: '2026-11-19' });
  assert.equal(parseDaily('daily-template:Nope'), null);
  assert.equal(parseDaily('packed yesterday'), null);
  const stripped = stripDailyCopyPatch({ name: 'Take pills', date: { start: '2026-11-01' }, notes: '', done: true, priority: true });
  assert.deepEqual(stripped, { name: 'Take pills', done: true, priority: true });
  assert.match(newDailyId(), /^d[a-z0-9]+$/);
  assert.equal(cronAuthorized('Bearer secret-value', 'secret-value'), true);
  assert.equal(cronAuthorized('Bearer other', 'secret-value'), false);
  assert.equal(cronAuthorized('', 'secret-value'), false);
  assert.equal(cronAuthorized('Bearer secret-value', ''), false);
  assert.deepEqual(planDaily([], 'tomorrow'), { creates: [], archive: [], park: [], templates: [] });
});

const SRC = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function ' + name);
  let i = src.indexOf('{', start);
  let depth = 0;
  let quote = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unclosed function ' + name);
}

test('Manage daily list can add, rename, reorder and remove', () => {
  const html = extractFn(SRC, 'tdDailyPanelHTML');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`
function escapeHtml(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function attr(s){return escapeHtml(s);}
` + html, ctx);
  const rows = [
    { id: 'reply-to-emails', name: 'Reply to emails' },
    { id: 'take-pills', name: 'Take pills <today>' },
  ];
  const out = ctx.tdDailyPanelHTML(rows, {});
  assert.match(out, /Reply to emails/);
  assert.match(out, /Take pills &lt;today&gt;/);
  assert.match(out, /data-d="rename"/);
  assert.match(out, /data-d="remove"/);
  assert.match(out, /data-d="up"/);
  assert.match(out, /data-d="down"/);
  assert.match(out, /data-d="up" disabled/);
  assert.match(out, /data-d="down" disabled/);
  assert.match(SRC, /Manage daily list/);
  assert.match(SRC, /A change here starts tomorrow/);
  const editing = ctx.tdDailyPanelHTML(rows, { edit: 'take-pills', arm: 'reply-to-emails' });
  assert.match(editing, /data-d="name"/);
  assert.match(editing, /Remove\?/);
});

const HOME_NAMES = [
  'tdWita', 'tdIsDT', 'tdDayOf', 'tdTimeOf', 'tdUTC', 'tdAdd', 'tdDays', 'tdLast', 'tdOverdue', 'tdDueToday',
  'tdDaily', 'tdDailyHidden', 'tdRank', 'tdSort', 'tdHot', 'tdOpenDoing', 'tdAttentionOrder', 'tdHomeSplit',
  'tdDedupeId', 'tdNormTitle', 'tdDoneOn', 'tdDoneGroups', 'bayarMonth', 'bayarYmd', 'bayarDueDate',
  'bayarHariIniLabel', 'bayarHariIniTasks', 'bayarPin', 'tdPretty', 'tdColor', 'tdRowHTML', 'tdRenderHome',
];

test('Home counts today\'s daily copy once and does not count the template', () => {
  const home = { innerHTML: '' };
  const badge = { textContent: '' };
  const document = {
    activeElement: null,
    getElementById(id) {
      if (id === 'td-home-list') return home;
      if (id === 'td-home-count') return badge;
      return null;
    },
  };
  const TD = { tasks: [], today: TODAY, loaded: true, err: '', area: 'All', sel: null };
  const ctx = { TD, TD_TZ: 'Asia/Makassar', TD_AREAS: [{ key: 'Personal', icon: '🏠', color: '#f59ac8' }], document, TD_EDIT: null };
  vm.createContext(ctx);
  vm.runInContext(`
function tdKids(){return [];}
function tdClChangeable(){return false;}
function tdRp(){return '';}
function escapeHtml(s){return String(s==null?'':s);}
function attr(s){return escapeHtml(s);}
` + HOME_NAMES.map((name) => extractFn(SRC, name)).join('\n'), ctx);
  const copy = page({ id: 'copy', name: 'Take pills', notes: 'daily:take-pills:' + TODAY, date: { start: TODAY } });
  const template = page({ id: 'tpl', name: 'Take pills', notes: 'daily-template:take-pills', status: 'To do', urgent: true, date: null });
  const urgent = page({ id: 'hot', name: 'Call the bank', section: '', notes: '', urgent: true, date: null });
  TD.tasks = [copy, template, urgent];
  ctx.tdRenderHome();
  const ids = [...home.innerHTML.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.filter((id) => id === 'copy').length, 1);
  assert.equal(ids.includes('tpl'), false);
  assert.match(home.innerHTML, /↻ Daily/);
  assert.equal(home.innerHTML.includes('daily:take-pills'), false);
  assert.equal(badge.textContent, '2 hot · 0 done');
  copy.done = true;
  copy.status = 'Done';
  copy.completedOn = TODAY;
  ctx.tdRenderHome();
  const after = [...home.innerHTML.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(after.filter((id) => id === 'copy').length, 1, 'the ticked copy is only in Done today');
  assert.match(home.innerHTML, /Done today \(1\)/);
  assert.equal(badge.textContent, '1 hot · 1 done');
});

process.env.NOTION_TOKEN = 'notion-test';
process.env.OS_KEY = 'os-key';
process.env.CRON_SECRET = 'cron-test-secret';
delete process.env.BIZ_FEED_KEY;

const db = [];
let seq = 0;
let clock = Date.parse('2026-11-01T00:00:00.000Z');
function stamp() { clock += 1000; return new Date(clock).toISOString(); }
function notionPage(spec) {
  const text = (s) => ({ rich_text: s ? [{ text: { content: String(s) } }] : [] });
  const title = (s) => ({ title: [{ text: { content: String(s || '') } }] });
  const sel = (s) => ({ select: s ? { name: s } : null });
  return {
    object: 'page', id: spec.id, archived: !!spec.archived, in_trash: false,
    created_time: spec.created || stamp(), last_edited_time: spec.created || stamp(),
    url: 'https://www.notion.so/' + spec.id,
    parent: { database_id: 'ac45a1773bfc4e3c96652745a1ea4c46' },
    properties: {
      Name: title(spec.name), Area: sel(spec.area || 'Personal'), Section: sel(spec.section || ''),
      Status: sel(spec.status || 'To do'), Done: { checkbox: !!spec.done },
      '⏰ Priority': { checkbox: false }, '🚨 Urgent': { checkbox: false }, Type: sel('Task'),
      Notes: text(spec.notes || ''), Date: { date: spec.date ? { start: spec.date, end: null } : null },
      'Completed on': { date: spec.completedOn ? { start: spec.completedOn } : null },
      'Parent task': { relation: [] }, Order: { number: spec.order == null ? null : spec.order },
      Expenses: text(''), 'Session ID': text(''),
    },
  };
}
function reset() { db.length = 0; seq = 0; }
function creates() {
  return db.filter((p) => String(p.id).startsWith('made'));
}

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const method = (init && init.method) || 'GET';
  const body = init && init.body ? JSON.parse(init.body) : null;
  if (u.includes('/databases/') && u.endsWith('/query')) {
    return { ok: true, status: 200, json: async () => ({ object: 'list', results: db.filter((p) => !p.archived && !p.in_trash), has_more: false }) };
  }
  if (u.includes('/databases/')) {
    return { ok: true, status: 200, json: async () => ({ properties: { Section: { select: { options: [] } } } }) };
  }
  if (method === 'POST' && u.endsWith('/pages')) {
    const id = 'made' + (++seq);
    const pg = {
      object: 'page', id, archived: false, in_trash: false,
      created_time: stamp(), last_edited_time: stamp(), url: 'https://www.notion.so/' + id,
      parent: { database_id: 'ac45a1773bfc4e3c96652745a1ea4c46' }, properties: body.properties,
    };
    db.push(pg);
    return { ok: true, status: 200, json: async () => pg };
  }
  const bare = (s) => String(s || '').replace(/-/g, '');
  const id = (u.split('/pages/')[1] || '').split('?')[0];
  const pg = db.find((p) => bare(p.id) === bare(id));
  if (method === 'PATCH' && pg) {
    if (body && body.properties) Object.assign(pg.properties, body.properties);
    if (body && body.archived) pg.archived = true;
    pg.last_edited_time = stamp();
    return { ok: true, status: 200, json: async () => pg };
  }
  if (method === 'GET' && pg) return { ok: true, status: 200, json: async () => pg };
  if (u.includes('/blocks/')) return { ok: true, status: 200, json: async () => ({ results: [] }) };
  return { ok: false, status: 404, json: async () => ({ object: 'error', message: 'missing ' + u }) };
};

const { default: tasksHandler, witaDate } = await import('../api/tasks.js');
const { default: dailyHandler } = await import('../api/daily.js');

function res() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const post = (body) => ({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body });
const copiesOf = (tasks, day) => (tasks || []).filter((t) => parseDaily(t.notes) && parseDaily(t.notes).kind === 'copy' && (!day || parseDaily(t.notes).day === day));

test('the list and the cron each create today\'s copies once, and a refresh does not duplicate them', async () => {
  reset();
  const day = witaDate();
  const health = res();
  await tasksHandler({ method: 'GET', headers: {} }, health);
  assert.equal(health.code, 200);
  assert.equal(health.body.open, 0);
  assert.equal(creates().length, 0, 'the public health check writes nothing');

  const listed = res();
  await tasksHandler(post({ action: 'list' }), listed);
  assert.equal(listed.code, 200);
  assert.equal(listed.body.daily.created, 7);
  assert.equal(listed.body.daily.templates.length, 7);
  assert.deepEqual(listed.body.daily.templates.map((t) => t.name), DAILY_SEED.map((s) => s.name));
  const copies = copiesOf(listed.body.tasks, day);
  assert.equal(copies.length, 7);
  assert.ok(copies.every((t) => t.date.start === day && !t.done && t.status === 'To do'));
  assert.equal(new Set(copies.map((t) => t.notes)).size, 7);
  const templates = listed.body.tasks.filter((t) => parseDaily(t.notes) && parseDaily(t.notes).kind === 'template');
  assert.equal(templates.length, 7);
  assert.ok(templates.every((t) => t.status === 'Parked'));
  const made = creates().length;

  const again = res();
  await tasksHandler(post({ action: 'list' }), again);
  assert.equal(again.body.daily.created, 0);
  assert.equal(again.body.daily.archived, 0);
  assert.equal(copiesOf(again.body.tasks, day).length, 7);
  assert.equal(creates().length, made);

  const cron = res();
  await dailyHandler({ method: 'GET', headers: { authorization: 'Bearer cron-test-secret' } }, cron);
  assert.equal(cron.code, 200);
  assert.equal(cron.body.ok, true);
  assert.equal(cron.body.created, 0);
  assert.equal(cron.body.templates, 7);
  assert.equal(cron.body.today, day);
  assert.equal(creates().length, made);

  const after = res();
  await tasksHandler({ method: 'GET', headers: {} }, after);
  assert.equal(after.body.open, 7);
  assert.equal(after.body.areas.Personal, 7);
  assert.equal(after.body.total, 14);
});

test('the cron refuses a missing or wrong secret and does not write', async () => {
  reset();
  const before = creates().length;
  delete process.env.CRON_SECRET;
  const missing = res();
  await dailyHandler({ method: 'GET', headers: { authorization: 'Bearer cron-test-secret' } }, missing);
  assert.equal(missing.code, 500);
  process.env.CRON_SECRET = 'cron-test-secret';
  const wrong = res();
  await dailyHandler({ method: 'GET', headers: { authorization: 'Bearer no' } }, wrong);
  assert.equal(wrong.code, 401);
  const postOnly = res();
  await dailyHandler({ method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }, postOnly);
  assert.equal(postOnly.code, 405);
  assert.equal(creates().length, before);
});

test('a template edit does not rewrite today\'s copy, and yesterday\'s unticked copy is archived', async () => {
  reset();
  const day = witaDate();
  const y = (() => { const p = day.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] - 1)).toISOString().slice(0, 10); })();
  db.push(notionPage({ id: 'old-open', name: 'Take pills', notes: 'daily:take-pills:' + y, date: y, status: 'To do', created: '2026-11-18T00:00:00.000Z' }));
  db.push(notionPage({ id: 'old-done', name: 'Design', notes: 'daily:design:' + y, date: y, status: 'Done', done: true, completedOn: y, created: '2026-11-18T00:00:01.000Z' }));

  const listed = res();
  await tasksHandler(post({ action: 'list' }), listed);
  const copy = listed.body.tasks.find((t) => t.notes === 'daily:take-pills:' + day);
  assert.ok(copy);
  assert.equal(copy.name, 'Take pills');
  assert.equal(listed.body.tasks.some((t) => t.id === 'oldopen'), false);
  assert.equal(db.find((p) => p.id === 'old-open').archived, true);
  assert.equal(listed.body.tasks.some((t) => t.id === 'olddone'), true);

  const renamed = res();
  await tasksHandler(post({ action: 'daily', op: 'rename', id: 'take-pills', name: 'Take the pills' }), renamed);
  assert.equal(renamed.code, 200);
  assert.equal(renamed.body.templates.find((t) => t.id === 'take-pills').name, 'Take the pills');
  const still = res();
  await tasksHandler(post({ action: 'list' }), still);
  assert.equal(still.body.tasks.find((t) => t.notes === 'daily:take-pills:' + day).name, 'Take pills');
  assert.equal(copiesOf(still.body.tasks, day).length, 7);

  const orders = still.body.daily.templates.map((t) => t.id);
  const flipped = orders.slice().reverse();
  const reordered = res();
  await tasksHandler(post({ action: 'daily', op: 'reorder', ids: flipped }), reordered);
  assert.deepEqual(reordered.body.templates.map((t) => t.id), flipped);
  const copyOrder = still.body.tasks.find((t) => t.notes === 'daily:reply-to-emails:' + day).order;
  const afterOrder = res();
  await tasksHandler(post({ action: 'list' }), afterOrder);
  assert.equal(afterOrder.body.tasks.find((t) => t.notes === 'daily:reply-to-emails:' + day).order, copyOrder);

  const removed = res();
  await tasksHandler(post({ action: 'daily', op: 'remove', id: 'design' }), removed);
  assert.equal(removed.body.templates.some((t) => t.id === 'design'), false);
  const kept = res();
  await tasksHandler(post({ action: 'list' }), kept);
  assert.equal(kept.body.tasks.filter((t) => t.notes === 'daily:design:' + day).length, 1, 'today\'s copy stays');
  assert.equal(copiesOf(kept.body.tasks, day).length, 7);

  const added = res();
  await tasksHandler(post({ action: 'daily', op: 'add', name: 'Stretch' }), added);
  assert.equal(added.code, 200);
  assert.ok(added.body.templates.some((t) => t.name === 'Stretch'));
  const withNew = res();
  await tasksHandler(post({ action: 'list' }), withNew);
  const stretch = withNew.body.tasks.filter((t) => t.name === 'Stretch' && parseDaily(t.notes) && parseDaily(t.notes).kind === 'copy' && parseDaily(t.notes).day === day);
  assert.equal(stretch.length, 1);
  assert.equal(stretch[0].date.start, day);

  const locked = res();
  await tasksHandler(post({ action: 'update', id: copy.id, patch: { date: { start: y }, notes: 'nope', name: 'Take pills now' } }), locked);
  assert.equal(locked.code, 200);
  assert.equal(locked.body.task.date.start, day);
  assert.equal(locked.body.task.notes, 'daily:take-pills:' + day);
  assert.equal(locked.body.task.name, 'Take pills now');

  const ticked = res();
  await tasksHandler(post({ action: 'update', id: copy.id, patch: { done: true } }), ticked);
  assert.equal(ticked.code, 200);
  assert.equal(ticked.body.task.done, true);
  assert.equal(ticked.body.task.completedOn, day);
  assert.equal(ticked.body.task.notes, 'daily:take-pills:' + day);
  assert.equal(ticked.body.task.date.start, day);
  const once = res();
  await tasksHandler(post({ action: 'list' }), once);
  assert.equal(once.body.daily.created, 0);
  assert.equal(once.body.tasks.filter((t) => t.notes === 'daily:take-pills:' + day).length, 1, 'ticking does not create another copy');

  const gone = res();
  await tasksHandler(post({ action: 'archive', id: copy.id }), gone);
  assert.equal(gone.code, 400);
  const finalList = res();
  await tasksHandler(post({ action: 'list' }), finalList);
  assert.equal(finalList.body.tasks.filter((t) => parseDaily(t.notes) && parseDaily(t.notes).kind === 'copy' && parseDaily(t.notes).id === 'take-pills' && parseDaily(t.notes).day === day).length, 1);
});
