// Today's to-do hides tasks scheduled after today (Asia/Makassar) from the
// list and from every count. The calendar still shows them. The rule on the
// page and the rule in api/_todo-today.js must be the same one.
// Run: node --test tests/todo-today.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { isFuture as isFutureMod, scheduledDay, todayCounts } from '../api/_todo-today.js';

const SRC = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const TODAY = '2026-11-18';

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

const NAMES = [
  'tdWita', 'tdIsDT', 'tdDayOf', 'tdTimeOf', 'tdUTC', 'tdPretty', 'tdAdd', 'tdDays', 'tdLast',
  'tdOnList', 'tdOverdue', 'tdDueToday', 'isFuture', 'tdDaily', 'tdDailyHidden', 'tdTodayOpen', 'tdShowOnList',
  'tdColor', 'tdIcon', 'tdRank', 'tdSort', 'tdOrd', 'tdMinOrd', 'tdMatches',
  'tdSecKey', 'tdTitlesFor', 'tdSectionOrder', 'tdInlineHTML', 'tdIndentParent', 'tdRowHTML',
  'tdRenderStats', 'tdRenderChips', 'tdRenderList', 'tdMonth', 'tdRenderCal',
  'tdDedupeId', 'tdNormTitle', 'tdDoneOn', 'tdDoneGroups', 'tdDayOngoing', 'tdRenderDay',
];

const stats = { innerHTML: '' };
const chips = { innerHTML: '' };
const list = { innerHTML: '', contains() { return false; } };
const cal = { innerHTML: '' };
const day = { innerHTML: '', contains() { return false; } };
const document = {
  activeElement: null,
  getElementById(id) {
    if (id === 'td-stats') return stats;
    if (id === 'td-chips') return chips;
    if (id === 'td-list') return list;
    if (id === 'td-cal') return cal;
    if (id === 'td-day') return day;
    return null;
  },
};
const TD_AREAS = [
  { key: 'Main', icon: '📌', color: '#ffd36b' },
  { key: 'DiveArts', icon: '🌊', color: '#2ee6ff' },
  { key: 'Sea Diva', icon: '🧜‍♀️', color: '#b79cff' },
  { key: 'TailCraft', icon: '🧵', color: '#ffb46b' },
  { key: 'Personal', icon: '🏠', color: '#f59ac8' },
  { key: 'Schedule', icon: '🗓', color: '#ff8a8a' },
];
const TD = {
  tasks: [], today: TODAY, loaded: true, err: '', area: 'All', flag: '', q: '',
  view: 'list', month: '2026-11', sel: null, titles: {}, indent: {}, closed: {},
  sections: [], newTitleFor: null, renaming: null, focusKey: null, clOpen: null,
};
const ctx = { TD, TD_TZ: 'Asia/Makassar', TD_AREAS, document, TD_EDIT: null, CL: null };
vm.createContext(ctx);
vm.runInContext(`
function tdKids(){return [];}
function tdClChangeable(){return false;}
function tdRp(){return '';}
function tdClCardsHTML(){return '';}
function tdNoteHTML(){return '';}
function bayarHariIniTasks(){return [];}
function bayarHariIniLabel(n){return n;}
function escapeHtml(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function attr(s){return escapeHtml(s).replace(/"/g,'&quot;');}
const LS={get(k,d){return d;},set(){}};
` + NAMES.map((name) => extractFn(SRC, name)).join('\n'), ctx);

const { isFuture, tdDayOf, tdRenderStats, tdRenderChips, tdRenderList, tdRenderCal, tdRenderDay } = ctx;
const ids = (html) => [...String(html).matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
function stat(html, flag) {
  const m = String(html).match(new RegExp('data-flag="' + flag + '"[^>]*><b>(\\d+)</b>'));
  assert.ok(m, 'missing stat ' + JSON.stringify(flag) + ' in ' + html);
  return Number(m[1]);
}
function chip(html, area) {
  const m = String(html).match(new RegExp('data-area="' + area + '"[^>]*>[\\s\\S]*?<i>(\\d+)</i>'));
  assert.ok(m, 'missing chip ' + area + ' in ' + html);
  return Number(m[1]);
}

// Fixed day so the counts in the PR description stay checkable.
// Before = every open task. After = isFuture removed.
function task(over) {
  return Object.assign({
    area: 'Personal', section: '', status: 'To do', done: false, priority: false,
    urgent: false, type: 'Task', notes: '', date: null, completedOn: null, parent: null,
    created: '2026-11-01T00:00:00Z',
  }, over);
}
const tasks = [
  task({ id: 'u1', name: 'Undated personal' }),
  task({ id: 'u2', name: 'Undated dive', area: 'DiveArts' }),
  task({ id: 'd1', name: 'Due today', date: { start: TODAY } }),
  task({ id: 'o1', name: 'Overdue bill', date: { start: '2026-11-01' } }),
  task({ id: 'o2', name: 'Overdue urgent', area: 'Sea Diva', urgent: true, date: { start: '2026-11-10' } }),
  task({ id: 'f1', name: 'Tomorrow', date: { start: '2026-11-19' } }),
  task({ id: 'f2', name: 'In five days', area: 'DiveArts', date: { start: '2026-11-23' } }),
  // 17:30Z is 01:30 the next morning in Makassar. A UTC date would call this today.
  task({ id: 'f3', name: 'UTC evening', date: { start: '2026-11-18T17:30:00Z' } }),
  // 10:00Z is 18:00 the same day in Makassar.
  task({ id: 'n1', name: 'Still today WITA', date: { start: '2026-11-18T10:00:00Z' } }),
  task({ id: 's1', name: 'Spans today', date: { start: '2026-11-17', end: '2026-11-20' } }),
  task({ id: 's2', name: 'Starts tomorrow', area: 'TailCraft', date: { start: '2026-11-19', end: '2026-11-21' } }),
  task({ id: 'f4', name: 'Later doing', status: 'Doing', urgent: true, priority: true, date: { start: '2026-11-20' } }),
  task({ id: 'c1', name: 'Ticked today', done: true, status: 'Done', completedOn: TODAY, date: { start: TODAY } }),
  task({ id: 'c2', name: 'Ticked early', done: true, status: 'Done', completedOn: TODAY, date: { start: '2026-11-19' } }),
];
const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
const HIDDEN = ['f1', 'f2', 'f3', 's2', 'f4'];
// c2 is dated tomorrow but already ticked today, so the date is future and the row stays.
const DATED_FUTURE = HIDDEN.concat(['c2']);
const TODAY_OPEN = ['u1', 'u2', 'd1', 'o1', 'o2', 'n1', 's1'];

test('the page and the module share one isFuture answer, in Makassar not UTC', () => {
  const values = [null, '', TODAY, '2026-11-19', '2026-11-18T10:00:00Z', '2026-11-18T17:30:00Z', '2026-11-18T16:00:00.000Z', '2026-11-18T15:59:00Z', '2026-11-19T00:30:00+08:00'];
  for (const v of values) assert.equal(scheduledDay(v), tdDayOf(v), 'day of ' + v);
  assert.equal(scheduledDay('2026-11-18T17:30:00Z'), '2026-11-19');
  assert.equal(scheduledDay('2026-11-18T10:00:00Z'), '2026-11-18');
  assert.equal(scheduledDay('2026-11-18T16:00:00.000Z'), '2026-11-19');
  assert.equal(isFutureMod(null, TODAY), false);
  assert.equal(isFutureMod({ date: null }, TODAY), false);
  for (const t of tasks) {
    assert.equal(isFuture(t, TODAY), isFutureMod(t, TODAY), t.id);
    assert.equal(isFuture(t), isFutureMod(t, TODAY), t.id + ' uses TD.today');
    assert.equal(isFutureMod(t, TODAY), DATED_FUTURE.includes(t.id), t.id);
  }
  // A range that already covers today is today's work, even if it ends later.
  assert.equal(isFutureMod(byId.s1, TODAY), false);
  assert.equal(isFutureMod(byId.s2, TODAY), true);
});

test('list and every count drop future tasks, and they agree', () => {
  const legacy = tasks.filter((t) => !t.done && t.status !== 'Parked');
  const counted = todayCounts(tasks, TODAY);
  assert.equal(legacy.length, 12, 'before: All');
  assert.equal(counted.open, 7, 'after: All');
  assert.deepEqual(counted.areas, { Personal: 5, DiveArts: 1, 'Sea Diva': 1 });
  const legacyAreas = {};
  for (const t of legacy) legacyAreas[t.area] = (legacyAreas[t.area] || 0) + 1;
  assert.deepEqual(legacyAreas, { Personal: 8, DiveArts: 2, 'Sea Diva': 1, TailCraft: 1 });

  TD.tasks = tasks;
  TD.area = 'All';
  TD.flag = '';
  TD.q = '';
  TD.sel = null;
  TD.today = TODAY;
  tdRenderStats();
  tdRenderChips();
  tdRenderList();
  assert.equal(stat(stats.innerHTML, ''), 7, 'Open');
  assert.equal(chip(chips.innerHTML, 'All'), 7, 'All');
  assert.equal(chip(chips.innerHTML, 'Personal'), 5);
  assert.equal(chip(chips.innerHTML, 'DiveArts'), 1);
  assert.equal(chip(chips.innerHTML, 'Sea Diva'), 1);
  assert.equal(chips.innerHTML.includes('TailCraft'), false, 'an area whose only tasks are future is not a chip');
  assert.equal(stat(stats.innerHTML, 'urgent'), 1);
  assert.equal(stat(stats.innerHTML, 'priority'), 0);
  assert.equal(stat(stats.innerHTML, 'doing'), 0);
  assert.equal(stat(stats.innerHTML, 'late'), 2);
  assert.equal(stat(stats.innerHTML, 'donetoday'), 2);
  assert.equal(counted.open, chip(chips.innerHTML, 'All'));

  const shown = ids(list.innerHTML);
  const openShown = shown.filter((id) => !byId[id].done);
  assert.deepEqual(openShown.slice().sort(), TODAY_OPEN.slice().sort());
  assert.equal(openShown.length, chip(chips.innerHTML, 'All'), 'open rows and All are the same tasks');
  for (const id of HIDDEN) {
    assert.equal(shown.includes(id), false, id + ' is hidden');
    assert.equal(list.innerHTML.includes(byId[id].name), false, byId[id].name);
  }
  assert.equal(shown.includes('c1'), true, 'ticked today stays');
  assert.equal(shown.includes('c2'), true, 'ticked today stays even if the date was later');
  assert.match(list.innerHTML, /Undated personal/);
  assert.match(list.innerHTML, /Undated dive/);
});

test('a search or a flag still cannot bring a future task back', () => {
  TD.tasks = tasks;
  TD.q = 'Tomorrow';
  TD.flag = '';
  tdRenderList();
  // The filter bar repeats the query. The rows themselves must not.
  assert.deepEqual(ids(list.innerHTML), []);
  TD.q = '';
  TD.flag = 'urgent';
  tdRenderList();
  tdRenderStats();
  assert.deepEqual(ids(list.innerHTML), ['o2']);
  assert.equal(stat(stats.innerHTML, 'urgent'), 1);
  TD.flag = 'donetoday';
  tdRenderList();
  assert.deepEqual(ids(list.innerHTML).slice().sort(), ['c1', 'c2']);
  TD.flag = '';
});

test('the calendar still shows future tasks, and its renderers do not use isFuture', () => {
  assert.equal(extractFn(SRC, 'tdRenderCal').includes('isFuture'), false);
  assert.equal(extractFn(SRC, 'tdRenderDay').includes('isFuture'), false);
  assert.equal(extractFn(SRC, 'tdRenderHome').includes('isFuture'), false);
  TD.tasks = tasks;
  TD.area = 'All';
  TD.flag = '';
  TD.q = '';
  TD.view = 'list';
  TD.month = '2026-11';
  TD.sel = '2026-11-19';
  TD.today = TODAY;
  tdRenderCal();
  tdRenderDay();
  for (const id of HIDDEN) assert.match(cal.innerHTML, new RegExp(byId[id].name), id + ' stays on the calendar');
  const scheduled = day.innerHTML.slice(day.innerHTML.indexOf('Scheduled'), day.innerHTML.indexOf('todo-add'));
  for (const id of ['f1', 'f3', 's2']) assert.match(scheduled, new RegExp('data-id="' + id + '"'), id + ' is on 19 Nov');
  assert.equal(scheduled.includes('data-id="f4"'), false, '20 Nov is not the 19th');
  assert.match(day.innerHTML, /Spans today/, 'a range that covers the 19th is still on that day');
  TD.sel = null;
});

test('today\'s daily copy counts once, and the template does not', () => {
  const copy = task({
    id: 'daily1', name: 'Take pills', section: 'Daily',
    notes: 'daily:take-pills:' + TODAY, date: { start: TODAY },
  });
  const template = task({
    id: 'tpl', name: 'Take pills', section: 'Daily', status: 'To do',
    notes: 'daily-template:take-pills',
  });
  const retired = task({ id: 'ret', name: 'Old daily', notes: 'daily-retired:old-one' });
  const counted = todayCounts(tasks.concat([copy, template, retired]), TODAY);
  assert.equal(counted.open, 8, 'the seven of today plus the one copy');
  assert.equal(counted.areas.Personal, 6);

  TD.tasks = tasks.concat([copy, template, retired]);
  TD.area = 'All';
  TD.flag = '';
  TD.q = '';
  TD.sel = null;
  TD.today = TODAY;
  tdRenderStats();
  tdRenderChips();
  tdRenderList();
  assert.equal(stat(stats.innerHTML, ''), 8, 'Open');
  assert.equal(chip(chips.innerHTML, 'All'), 8, 'All');
  assert.equal(chip(chips.innerHTML, 'Personal'), 6);
  const shown = ids(list.innerHTML);
  assert.equal(shown.filter((id) => id === 'daily1').length, 1);
  assert.equal(shown.includes('tpl'), false, 'the template is not a second row');
  assert.equal(shown.includes('ret'), false);
  assert.match(list.innerHTML, /↻ Daily/);
  assert.equal(list.innerHTML.includes('daily:take-pills'), false, 'the marker is not shown as a note');
  for (const id of HIDDEN) assert.equal(shown.includes(id), false, id + ' stays hidden');
  TD.tasks = tasks;
});

test('health-check counts ignore parked, done, and future, and keep an undated focus row', () => {
  const n = todayCounts([
    task({ id: 'p', status: 'Parked', date: { start: '2026-11-01' } }),
    task({ id: 'dn', done: true, status: 'Done', completedOn: TODAY, date: { start: TODAY } }),
    task({ id: 'ff', area: 'Focus', date: { start: '2026-11-25' } }),
    task({ id: 'fu', area: 'Focus' }),
  ], TODAY);
  assert.equal(n.open, 1);
  assert.deepEqual(n.areas, { Focus: 1 });
});
