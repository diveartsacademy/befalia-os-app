// Done today is one group. A ticked task is not also scheduled, hot, or ongoing,
// and two pages with the same title finished the same day draw as one row.
// The functions are taken from index.html. Run: node --test tests/todo-done.test.mjs
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
function escapeHtml(s){return String(s==null?'':s);}
function attr(s){return escapeHtml(s);}
` + NAMES.map((name) => extractFn(SRC, name)).join('\n'), ctx);

const { tdRenderHome, tdRenderDay, tdDoneGroups } = ctx;
const ids = (html) => [...String(html).matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
function between(html, start, end) {
  const s = start ? html.indexOf(start) : 0;
  assert.notEqual(s, -1, 'missing ' + start);
  const from = s + (start ? start.length : 0);
  if (!end) return html.slice(from);
  const e = html.indexOf(end, from);
  assert.notEqual(e, -1, 'missing ' + end);
  return html.slice(from, e);
}
let seq = 0;
function task(over) {
  seq += 1;
  return Object.assign({
    id: 't' + seq, name: 'Task ' + seq, area: 'Personal', status: 'To do', done: false,
    priority: false, urgent: false, type: 'Task', notes: '', date: null, completedOn: null,
    created: '2026-11-10T01:00:' + String(seq).padStart(2, '0') + 'Z', edited: '2026-11-10T09:00:' + String(seq).padStart(2, '0') + 'Z'
  }, over);
}

test('a task finished today is only in Done today, on the home card and the calendar', () => {
  const kredivo = task({ name: 'Bayar besok (10 Nov): Kredivo Rp306.310', done: true, status: 'Done', completedOn: TODAY, date: { start: TODAY }, edited: '2026-11-10T02:00:00Z' });
  const kredivoAgain = task({ id: kredivo.id, name: kredivo.name, done: true, status: 'Done', completedOn: TODAY, date: { start: TODAY }, edited: '2026-11-10T02:00:00Z' });
  const kredivoCopy = task({ name: '  bayar besok (10 Nov):   Kredivo Rp306.310 ', done: true, status: 'Done', completedOn: TODAY, date: { start: TODAY }, edited: '2026-11-10T03:00:00Z' });
  const outreach = task({ name: 'OUTREACH - tawarkan padi instructor course ke semua amed dan tulamben', done: true, status: 'Done', completedOn: TODAY, date: { start: TODAY }, edited: '2026-11-10T04:00:00Z' });
  const stillOpen = task({ name: 'Still open today', date: { start: TODAY } });
  const doing = task({ name: 'Still doing', status: 'Doing' });
  TD.tasks = [kredivo, kredivoAgain, kredivoCopy, outreach, stillOpen, doing];
  TD.loaded = true;
  TD.area = 'All';
  TD.sel = null;
  TD.today = TODAY;
  tdRenderHome();
  assert.equal(badge.textContent, '1 hot · 1 ongoing · 2 done');
  assert.match(home.innerHTML, /Done today \(2\)/);
  const homeDone = between(home.innerHTML, '<li class="td-sub">Done today (2)</li>', '');
  assert.deepEqual(ids(homeDone), [kredivo.id, outreach.id]);
  assert.match(homeDone, /×2/);
  assert.equal(ids(between(home.innerHTML, '', '<li class="td-sub">Ongoing</li>')).includes(kredivo.id), false);
  assert.equal(ids(between(home.innerHTML, '<li class="td-sub">Ongoing</li>', '<li class="td-sub">Done today (2)</li>')).includes(kredivo.id), false);

  tdRenderDay();
  const scheduled = between(day.innerHTML, '<div class="td-sub">Scheduled</div>', '<div class="todo-add"');
  const done = between(day.innerHTML, '<div class="td-sub">Done today (2)</div>', '');
  assert.deepEqual(ids(scheduled), [stillOpen.id]);
  assert.deepEqual(ids(done), [kredivo.id, outreach.id]);
  assert.match(done, /×2/);
  assert.equal(day.innerHTML.includes('>Ongoing<'), true);
  assert.equal(ids(between(day.innerHTML, '<div class="td-sub">Ongoing</div>', '<div class="td-sub">Done today')).includes(kredivo.id), false);
});

test('blank titles and a different day stay separate, and the tick order is earliest first', () => {
  const later = task({ name: '', done: true, completedOn: TODAY, edited: '2026-11-10T08:00:00Z' });
  const earlier = task({ name: '', done: true, completedOn: TODAY, edited: '2026-11-10T01:00:00Z' });
  const otherDay = task({ name: 'Bayar besok (10 Nov): Kredivo Rp306.310', done: true, completedOn: '2026-11-09', edited: '2026-11-09T01:00:00Z' });
  const statusOnly = task({ name: 'Status says done', status: 'Done', done: false, completedOn: TODAY, date: { start: TODAY }, edited: '2026-11-10T05:00:00Z' });
  const groups = tdDoneGroups([later, earlier, statusOnly, earlier]);
  assert.deepEqual(Array.from(groups.map((g) => g.task.id)), [earlier.id, statusOnly.id, later.id]);
  assert.deepEqual(Array.from(groups.map((g) => g.n)), [1, 1, 1]);
  const across = tdDoneGroups([otherDay, task({ name: otherDay.name, done: true, completedOn: TODAY })]);
  assert.equal(across.length, 2, 'the same title on another day is a different task');
  TD.tasks = [statusOnly, task({ name: 'Open with the same words', status: 'To do', date: { start: TODAY } })];
  TD.tasks[1].name = statusOnly.name;
  tdRenderDay();
  const scheduled = between(day.innerHTML, '<div class="td-sub">Scheduled</div>', '<div class="todo-add"');
  assert.deepEqual(ids(scheduled), [TD.tasks[1].id]);
  assert.match(day.innerHTML, /Done today \(1\)/);
});

test('another day keeps its own Done count and does not list those ticks under Scheduled', () => {
  const y = task({ name: 'Yesterday', done: true, status: 'Done', completedOn: '2026-11-09', date: { start: '2026-11-09' } });
  const y2 = task({ name: 'yesterday', done: true, status: 'Done', completedOn: '2026-11-09', date: { start: '2026-11-09' } });
  const open = task({ name: 'Still on that day', date: { start: '2026-11-09' } });
  TD.tasks = [y, y2, open];
  TD.sel = '2026-11-09';
  tdRenderDay();
  assert.match(day.innerHTML, /Done this day \(1\)/);
  assert.equal(day.innerHTML.includes('Done today'), false);
  const scheduled = between(day.innerHTML, '<div class="td-sub">Scheduled</div>', '<div class="todo-add"');
  assert.deepEqual(ids(scheduled), [open.id]);
  assert.match(between(day.innerHTML, '<div class="td-sub">Done this day (1)</div>', ''), /×2/);
  TD.sel = null;
});
