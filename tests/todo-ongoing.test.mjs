// To-Do today: open Doing tasks (status "Doing") get their own Ongoing group.
// The helpers and the two renderers are taken from index.html, so this checks
// the page itself. Run: node --test tests/todo-ongoing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const TODAY = '2026-11-10';

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

const NAMES = ['tdWita', 'tdIsDT', 'tdDayOf', 'tdTimeOf', 'tdUTC', 'tdAdd', 'tdDays', 'tdLast', 'tdOverdue', 'tdDueToday', 'tdRank', 'tdSort', 'tdHot', 'tdOpenDoing', 'tdAttentionOrder', 'tdHomeSplit', 'tdDayOngoing', 'tdDedupeId', 'tdNormTitle', 'tdDoneOn', 'tdDoneGroups', 'tdRowHTML', 'tdRenderDay', 'tdRenderHome'];
const page = NAMES.map((name) => extractFn(SRC, name)).join('\n');

const home = { innerHTML: '' };
const badge = { textContent: '' };
const day = { innerHTML: '', contains() { return false; } };
const document = {
  activeElement: null,
  getElementById(id) {
    if (id === 'td-home-list') return home;
    if (id === 'td-home-count') return badge;
    if (id === 'td-day') return day;
    return null;
  }
};
const TD = { tasks: [], today: TODAY, loaded: true, err: '', area: 'All', sel: null, clOpen: null };
const ctx = { TD, TD_TZ: 'Asia/Makassar', TD_AREAS: [], document, TD_EDIT: null, CL: null };
vm.createContext(ctx);
vm.runInContext(`
function tdKids(){return [];}
function tdColor(){return '#8fb6cc';}
function tdPretty(d){return String(d);}
function tdIsClass(){return false;}
function tdClChangeable(){return false;}
function tdRp(){return '';}
function tdClCardsHTML(){return '';}
function tdNoteHTML(){return '';}
function escapeHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function attr(s){return escapeHtml(s).replace(/"/g,'&quot;');}
` + page, ctx);

const { tdHomeSplit, tdDayOngoing, tdOpenDoing, tdRenderHome, tdRenderDay } = ctx;
const ids = (html) => [...String(html).matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
let seq = 0;
function task(over) {
  seq += 1;
  return Object.assign({
    id: 't' + seq, name: 'Task ' + seq, area: 'Personal', section: '', status: 'To do',
    done: false, priority: false, urgent: false, type: 'Task', notes: '', date: null,
    completedOn: null, parent: null, created: '2026-11-01T00:00:' + String(seq).padStart(2, '0') + 'Z'
  }, over);
}
// Same cut the page makes before anything is drawn.
function shown(list) { return list.filter((t) => t.status !== 'Parked' && t.area !== 'Focus'); }

test('only the Notion status Doing, still open, counts as ongoing', () => {
  assert.equal(tdOpenDoing(task({ status: 'Doing' })), true);
  assert.equal(tdOpenDoing(task({ status: 'Doing', done: true })), false);
  assert.equal(tdOpenDoing(task({ status: 'doing' })), false);
  assert.equal(tdOpenDoing(task({ status: 'To do' })), false);
  assert.equal(tdOpenDoing(task({ status: 'Parked' })), false);
  assert.equal(tdOpenDoing(task({ status: 'Done', done: true })), false);
});

test('home keeps every open Doing task out of the hot rows', () => {
  const overdueDoing = task({ status: 'Doing', name: 'Overdue doing', date: { start: '2026-11-01' } });
  const todayDoing = task({ status: 'Doing', name: 'Due today', date: { start: TODAY } });
  const spanDoing = task({ status: 'Doing', name: 'Spans today', date: { start: '2026-11-09', end: '2026-11-11' } });
  const futureDoing = task({ status: 'Doing', name: 'Later', date: { start: '2026-11-20' } });
  const undatedDoing = task({ status: 'Doing', name: 'No date' });
  const otherDoing = task({ status: 'Doing', name: 'Other area', area: 'DiveArts' });
  const urgentDoing = task({ status: 'Doing', name: 'Urgent doing', urgent: true });
  const overdueTodo = task({ name: 'Overdue todo', date: { start: '2026-11-02' } });
  const urgent = task({ name: 'Urgent', urgent: true });
  const priority = task({ name: 'Priority', priority: true });
  const later = task({ name: 'Later todo', date: { start: '2026-11-18' } });
  const doneToday = task({ status: 'Doing', name: 'Finished', done: true, completedOn: TODAY });
  const parked = task({ status: 'Parked', name: 'Parked' });
  const focus = task({ status: 'Doing', area: 'Focus', name: 'Focus row' });
  const wrongCase = task({ status: 'doing', name: 'Not the status' });
  const all = [overdueDoing, todayDoing, spanDoing, futureDoing, undatedDoing, otherDoing, urgentDoing, overdueTodo, urgent, priority, later, doneToday, parked, focus, wrongCase];
  const split = tdHomeSplit(shown(all));
  assert.deepEqual(split.ongoing.map((t) => t.id), [overdueDoing, spanDoing, todayDoing, urgentDoing, futureDoing, undatedDoing, otherDoing].map((t) => t.id));
  assert.deepEqual(split.hot.map((t) => t.id), [overdueTodo, urgent, priority].map((t) => t.id));
  const ongoingIds = new Set(split.ongoing.map((t) => t.id));
  assert.equal(split.hot.some((t) => ongoingIds.has(t.id)), false);

  TD.tasks = shown(all);
  TD.loaded = true;
  TD.area = 'All';
  TD.sel = null;
  tdRenderHome();
  assert.equal(badge.textContent, '3 hot · 7 ongoing · 1 done');
  const parts = home.innerHTML.split('<li class="td-sub">Ongoing</li>');
  assert.equal(parts.length, 2);
  assert.deepEqual(ids(parts[0]), [overdueTodo.id, urgent.id, priority.id]);
  assert.deepEqual(ids(parts[1]), [overdueDoing, spanDoing, todayDoing, urgentDoing, futureDoing, undatedDoing, otherDoing, doneToday].map((t) => t.id));
  assert.equal(home.innerHTML.includes('td-grip'), false, 'home rows stay without a drag handle');
  assert.match(home.innerHTML, /data-act="done"/);
  assert.match(home.innerHTML, /td-pill doing/);
  assert.match(home.innerHTML, /Overdue doing/);
  assert.match(parts[1], /late/);
});

test('the 8 hot slots do not count or hide ongoing tasks', () => {
  const doing = [task({ status: 'Doing', name: 'Undated A' }), task({ status: 'Doing', name: 'Undated B' })];
  const late = [];
  for (let i = 0; i < 10; i++) late.push(task({ name: 'Late ' + i, date: { start: '2026-10-' + String(i + 1).padStart(2, '0') } }));
  TD.tasks = late.concat(doing);
  tdRenderHome();
  assert.equal(badge.textContent, '10 hot · 2 ongoing · 0 done');
  const parts = home.innerHTML.split('<li class="td-sub">Ongoing</li>');
  assert.deepEqual(ids(parts[0]), late.slice(0, 8).map((t) => t.id));
  assert.match(parts[0], /\+2 more in the To-Do tab/);
  assert.deepEqual(ids(parts[1]), doing.map((t) => t.id));
});

test('an empty today still says the hot list is clear, with no Ongoing heading', () => {
  TD.tasks = [];
  tdRenderHome();
  assert.equal(badge.textContent, '0 hot · 0 done');
  assert.equal(home.innerHTML.includes('Ongoing'), false);
  assert.match(home.innerHTML, /Nothing urgent, flagged or due today/);
});

test('today’s calendar lists Doing tasks that are not already scheduled', () => {
  const overdueDoing = task({ status: 'Doing', name: 'Overdue doing', date: { start: '2026-11-01' } });
  const todayDoing = task({ status: 'Doing', name: 'On today', date: { start: TODAY } });
  const spanDoing = task({ status: 'Doing', name: 'Spans today', date: { start: '2026-11-09', end: '2026-11-11' } });
  const undatedDoing = task({ status: 'Doing', name: 'No date' });
  const futureDoing = task({ status: 'Doing', name: 'Next week', date: { start: '2026-11-20' } });
  const otherDoing = task({ status: 'Doing', name: 'DiveArts doing', area: 'DiveArts' });
  const parked = task({ status: 'Parked', name: 'Parked doing' });
  const focus = task({ status: 'Doing', area: 'Focus', name: 'Focus doing' });
  TD.tasks = shown([overdueDoing, todayDoing, spanDoing, undatedDoing, futureDoing, otherDoing, parked, focus]);
  TD.area = 'All';
  TD.sel = null;
  TD.today = TODAY;
  tdRenderDay();
  assert.match(day.innerHTML, /Today · /);
  const scheduled = between(day.innerHTML, '<div class="td-sub">Scheduled</div>', '<div class="todo-add"');
  const ongoing = between(day.innerHTML, '<div class="td-sub">Ongoing</div>', '<div class="td-sub">Done today');
  assert.deepEqual(ids(scheduled).sort(), [todayDoing.id, spanDoing.id].sort());
  assert.deepEqual(ids(ongoing), [overdueDoing, futureDoing, undatedDoing, otherDoing].map((t) => t.id));
  assert.equal(ids(ongoing).includes(todayDoing.id), false);
  assert.equal(ids(ongoing).includes(spanDoing.id), false);
  assert.match(ongoing, /data-act="done"/);
  assert.match(ongoing, /td-grip/);
  assert.equal(day.innerHTML.includes('Parked doing') || day.innerHTML.includes('Focus doing'), false);

  TD.area = 'Personal';
  tdRenderDay();
  const personal = between(day.innerHTML, '<div class="td-sub">Ongoing</div>', '<div class="td-sub">Done today');
  assert.equal(ids(personal).includes(otherDoing.id), false);
  assert.equal(ids(personal).includes(undatedDoing.id), true);
  TD.area = 'All';
});

test('another day does not grow an Ongoing section', () => {
  const undatedDoing = task({ status: 'Doing', name: 'Still doing' });
  const tomorrowDoing = task({ status: 'Doing', name: 'Tomorrow', date: { start: '2026-11-11' } });
  TD.tasks = [undatedDoing, tomorrowDoing];
  TD.area = 'All';
  TD.sel = '2026-11-11';
  tdRenderDay();
  assert.equal(day.innerHTML.includes('>Ongoing<'), false);
  assert.equal(day.innerHTML.includes('Today · '), false);
  assert.deepEqual(ids(between(day.innerHTML, '<div class="td-sub">Scheduled</div>', '<div class="todo-add"')), [tomorrowDoing.id]);
  assert.equal(tdDayOngoing(TD.tasks, '2026-11-11').length, 0);
  assert.deepEqual(tdDayOngoing(TD.tasks, TODAY).map((t) => t.id), [tomorrowDoing.id, undatedDoing.id]);
  TD.sel = null;
});

test('Parked and Focus are dropped before the To-Do lists are drawn', () => {
  assert.match(SRC, /TD\.tasks=all\.filter\(t=>t\.status!=='Parked'&&t\.area!=='Focus'\)/);
  assert.match(extractFn(SRC, 'tdHot'), /t\.status==='Doing'/);
});

function between(html, start, end) {
  const s = html.indexOf(start);
  assert.notEqual(s, -1, 'missing ' + start);
  const from = s + start.length;
  const e = html.indexOf(end, from);
  assert.notEqual(e, -1, 'missing ' + end);
  return html.slice(from, e);
}
