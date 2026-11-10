// Due-day display for open "Bayar besok (…)" rows. Parser, filter, and the
// Today renderers are taken from index.html. Dates below are fixed.
// Run: node --test tests/bayar-hari-ini.test.mjs
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

const NAMES = ['tdWita', 'tdIsDT', 'tdDayOf', 'tdTimeOf', 'tdUTC', 'tdAdd', 'tdDays', 'tdLast', 'tdOverdue', 'tdDueToday', 'tdRank', 'tdSort', 'tdHot', 'tdOpenDoing', 'tdAttentionOrder', 'tdHomeSplit', 'tdDayOngoing', 'tdDedupeId', 'tdNormTitle', 'tdDoneOn', 'tdDoneGroups', 'bayarMonth', 'bayarYmd', 'bayarDueDate', 'bayarHariIniLabel', 'bayarHariIniTasks', 'bayarPin', 'tdRowHTML', 'tdRenderDay', 'tdRenderHome'];
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

const { bayarDueDate, bayarHariIniLabel, bayarHariIniTasks, bayarPin, tdRenderHome, tdRenderDay } = ctx;
const ids = (html) => [...String(html).matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
const NOTES = (when) => 'Pengingat H-1. Jatuh tempo ' + when + '. Dari sheet HUTANG BEFA (FINANCIAL REPORT BEFALIA), baris 150. Setelah bayar, centang juga di sheet.';

function task(over) {
  return Object.assign({
    id: 't', name: 'Bayar besok (10 Nov): Kredivo Rp306.310', area: 'Personal', section: 'Pembayaran Hutang',
    status: 'To do', done: false, priority: false, urgent: false, type: 'Task',
    notes: NOTES('10 Nov 2026'), date: { start: '2026-11-09' }, completedOn: null, parent: null,
    created: '2026-10-19T00:53:31Z'
  }, over);
}

test('notes date wins, including Indonesian months', () => {
  assert.equal(bayarDueDate(task()), '2026-11-10');
  assert.equal(bayarDueDate(task({ name: 'Bayar besok (8 Nov): Internet Rp233.000', notes: NOTES('8 Nov 2026'), date: { start: '2026-11-10' } })), '2026-11-08');
  assert.equal(bayarDueDate(task({ name: 'Bayar besok (1 Des): Gaji Beben Rp750.000', notes: NOTES('1 Des 2026'), date: { start: '2026-11-30' } })), '2026-12-01');
  assert.equal(bayarDueDate(task({ name: 'Bayar besok (5 Mei 2027): Spay Pinjam Rp571.085', notes: NOTES('5 Mei 2027'), date: { start: '2027-05-04' } })), '2027-05-05');
  assert.equal(bayarDueDate(task({ notes: 'Pengingat H-1. Jatuh tempo  10 nov 2026. Dari sheet.' })), '2026-11-10');
});

test('a bad notes date falls through to the title', () => {
  const t = task({ notes: 'Pengingat H-1. Jatuh tempo 31 Nov 2026. Dari sheet.', date: { start: '2026-11-09' } });
  assert.equal(bayarDueDate(t), '2026-11-10');
});

test('title date uses the task year, and December rolls into January', () => {
  const nov = task({ notes: '', date: { start: '2026-11-09' } });
  assert.equal(bayarDueDate(nov), '2026-11-10');
  const jan = task({
    name: 'Bayar besok (1 Jan): Gaji Beben Rp750.000', notes: '', date: { start: '2026-12-31' }
  });
  assert.equal(bayarDueDate(jan), '2027-01-01');
  const explicit = task({
    name: 'Bayar besok (10 Jan 2027): Kredivo Rp306.310', notes: '', date: { start: '2027-01-09' }
  });
  assert.equal(bayarDueDate(explicit), '2027-01-10');
  const wita = task({
    name: 'Bayar besok (1 Jan): Gaji Beben Rp750.000', notes: '', date: { start: '2026-12-31T15:00:00.000Z' }
  });
  assert.equal(bayarDueDate(wita), '2027-01-01');
  const alreadyJan = task({
    name: 'Bayar besok (1 Jan): Gaji Beben Rp750.000', notes: '', date: { start: '2026-12-31T17:00:00.000Z' }
  });
  assert.equal(bayarDueDate(alreadyJan), '2027-01-01');
  assert.equal(bayarDueDate(task({ notes: '', date: null })), null);
});

test('the today label keeps the part after the date', () => {
  assert.equal(bayarHariIniLabel('Bayar besok (10 Nov): Kredivo Rp306.310'), 'Bayar hari ini: Kredivo Rp306.310');
  assert.equal(bayarHariIniLabel('Bayar besok (5 Nov): Shopee Paylater Rp342.000 + Spay Pinjam Rp571.085 = Rp913.085'), 'Bayar hari ini: Shopee Paylater Rp342.000 + Spay Pinjam Rp571.085 = Rp913.085');
  assert.equal(bayarHariIniLabel('Bayar besok (10 Jan 2027): Kredivo Rp306.310'), 'Bayar hari ini: Kredivo Rp306.310');
  assert.equal(bayarHariIniLabel('Bayar besok (10 Nov)'), 'Bayar hari ini');
});

test('only an open row due today is selected, and the task is not rewritten', () => {
  const open = task({ id: 'open' });
  const paid = task({ id: 'paid', done: true, status: 'Done', completedOn: '2026-11-09' });
  const statusDone = task({ id: 'status', done: false, status: 'Done' });
  const parked = task({ id: 'parked', status: 'Parked' });
  const tomorrow = task({ id: 'tom', name: 'Bayar besok (11 Nov): Kredivo Rp306.310', notes: NOTES('11 Nov 2026'), date: { start: '2026-11-10' } });
  const other = task({ id: 'other', name: 'Bayar kredivo', notes: '' });
  const moved = task({ id: 'moved', name: 'Bayar besok (8 Nov): Internet Rp233.000', notes: NOTES('8 Nov 2026'), date: { start: TODAY } });
  const before = open.name;
  const got = bayarHariIniTasks([open, paid, statusDone, parked, tomorrow, other, moved], TODAY);
  assert.equal(JSON.stringify(got.map((t) => t.id)), JSON.stringify(['open']));
  assert.equal(open.name, before);
  assert.equal(JSON.stringify(bayarHariIniTasks([open, open], TODAY).map((t) => t.id)), JSON.stringify(['open', 'open']));
  const again = bayarHariIniTasks([open, paid, tomorrow], TODAY);
  assert.equal(JSON.stringify(again.map((t) => t.id)), JSON.stringify(['open']));
});

test('a bill paid today is only in Done today', () => {
  const paid = task({ id: 'paid-today', done: true, status: 'Done', completedOn: TODAY, date: { start: '2026-11-09' }, edited: '2026-11-10T02:21:00Z' });
  const open = task({ id: 'still-open', name: 'Bayar besok (10 Nov): Internet Rp233.000', notes: NOTES('10 Nov 2026'), date: { start: '2026-11-09' } });
  TD.tasks = [paid, open];
  TD.today = TODAY;
  TD.loaded = true;
  TD.area = 'All';
  TD.sel = null;
  tdRenderHome();
  const homePins = [...home.innerHTML.matchAll(/data-pin="bayar-hari-ini"[^>]*data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(homePins, ['still-open']);
  assert.match(home.innerHTML, /Done today \(1\)/);
  assert.deepEqual(ids(between(home.innerHTML, '<li class="td-sub">Done today (1)</li>', '')), ['paid-today']);
  assert.equal(ids(home.innerHTML).filter((id) => id === 'paid-today').length, 1);
  assert.match(home.innerHTML, /Bayar hari ini: Internet Rp233\.000/);
  tdRenderDay();
  const dayPins = [...day.innerHTML.matchAll(/data-pin="bayar-hari-ini"[^>]*data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(dayPins, ['still-open']);
  assert.match(day.innerHTML, /Done today \(1\)/);
  assert.deepEqual(ids(between(day.innerHTML, '<div class="td-sub">Done today (1)</div>', '')), ['paid-today']);
  assert.equal(ids(day.innerHTML).filter((id) => id === 'paid-today').length, 1);
});

test('pin puts the due-day rows in front and the cap applies only to the rest', () => {
  const bill = task({ id: 'bill' });
  const hot = [];
  for (let i = 0; i < 10; i++) hot.push(task({ id: 'h' + i, name: 'Late ' + i, notes: '', date: { start: '2026-10-' + String(i + 1).padStart(2, '0') } }));
  hot.push(bill);
  const placed = bayarPin(hot, [bill], 8);
  assert.deepEqual(placed.pinned.map((t) => t.id), ['bill']);
  assert.deepEqual(placed.shown.map((t) => t.id), hot.slice(0, 8).map((t) => t.id));
  assert.equal(placed.more, 2);
  assert.equal(placed.shown.some((t) => t.id === 'bill'), false);
  assert.equal(hot[hot.length - 1].id, 'bill', 'the source list is left as it was');
  const full = bayarPin(hot, [bill], null);
  assert.equal(full.shown.length, 10);
  assert.equal(full.more, 0);
});

test('home pins the bill above the 8 hot rows and does not draw it twice', () => {
  const bill = task({ id: 'bill', created: '2026-11-09T00:00:00Z' });
  const second = task({ id: 'second', name: 'Bayar besok (10 Nov): Internet Rp233.000', notes: NOTES('10 Nov 2026'), date: { start: '2026-11-09' }, created: '2026-11-09T00:00:01Z' });
  const late = [];
  for (let i = 0; i < 10; i++) {
    late.push(task({
      id: 'h' + i, name: 'Late ' + i, notes: '', section: '',
      date: { start: '2026-10-' + String(i + 1).padStart(2, '0') },
      created: '2026-10-0' + (i < 9 ? i + 1 : 9) + 'T00:00:00Z'
    }));
  }
  const paid = task({ id: 'paid', done: true, status: 'Done', completedOn: '2026-11-09' });
  TD.tasks = late.concat([bill, second, paid]);
  TD.today = TODAY;
  TD.loaded = true;
  TD.area = 'All';
  TD.sel = null;
  tdRenderHome();
  const again = home.innerHTML;
  tdRenderHome();
  assert.equal(home.innerHTML, again);
  assert.equal(bill.name, 'Bayar besok (10 Nov): Kredivo Rp306.310');
  const pin = [...home.innerHTML.matchAll(/data-pin="bayar-hari-ini"[^>]*data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(pin, ['bill', 'second']);
  assert.deepEqual(ids(home.innerHTML).slice(0, 2), ['bill', 'second']);
  assert.match(home.innerHTML, /Bayar hari ini: Kredivo Rp306\.310/);
  assert.match(home.innerHTML, /Bayar hari ini: Internet Rp233\.000/);
  assert.equal(home.innerHTML.includes('Bayar besok'), false);
  const hotPart = home.innerHTML.split('<li class="td-empty">')[0];
  assert.deepEqual(ids(hotPart).filter((id) => id !== 'bill' && id !== 'second'), late.slice(0, 8).map((t) => t.id));
  assert.match(home.innerHTML, /\+2 more in the To-Do tab/);
  assert.equal(ids(home.innerHTML).filter((id) => id === 'bill').length, 1);
  assert.equal(ids(home.innerHTML).includes('paid'), false);
  assert.equal(badge.textContent, '10 hot · 0 done');
});

test('the calendar today pane pins the bill and still lists every other scheduled row', () => {
  const bill = task({ id: 'bill' });
  const onToday = task({ id: 'ontoday', name: 'Bayar besok (10 Nov): Blibli Rp183.000', notes: NOTES('10 Nov 2026'), date: { start: TODAY } });
  const doing = task({ id: 'doing', status: 'Doing', name: 'Bayar besok (10 Nov): Easycash Rp2.450.834', notes: NOTES('10 Nov 2026'), date: { start: '2026-11-01' } });
  const otherDoing = task({ id: 'keepdoing', status: 'Doing', name: 'Still writing', notes: '', date: { start: '2026-11-01' } });
  const sched = [];
  for (let i = 0; i < 10; i++) sched.push(task({ id: 's' + i, name: 'Class ' + i, notes: '', date: { start: TODAY + 'T' + String(8 + (i % 10)).padStart(2, '0') + ':00:00+08:00' } }));
  TD.tasks = sched.concat([bill, onToday, doing, otherDoing]);
  TD.area = 'All';
  TD.sel = null;
  TD.today = TODAY;
  tdRenderDay();
  assert.match(day.innerHTML, /Today · /);
  const bayar = between(day.innerHTML, '<div class="td-sub">Bayar hari ini</div>', '<div class="td-sub">Scheduled</div>');
  const scheduled = between(day.innerHTML, '<div class="td-sub">Scheduled</div>', '<div class="todo-add"');
  const ongoing = between(day.innerHTML, '<div class="td-sub">Ongoing</div>', '<div class="td-sub">Done today');
  assert.deepEqual(ids(bayar), ['bill', 'ontoday', 'doing']);
  assert.match(bayar, /Bayar hari ini: Kredivo Rp306\.310/);
  assert.match(bayar, /data-pin="bayar-hari-ini"/);
  assert.equal(ids(scheduled).includes('bill') || ids(scheduled).includes('ontoday') || ids(scheduled).includes('doing'), false);
  assert.deepEqual(ids(scheduled), sched.map((t) => t.id));
  assert.equal(ids(ongoing).includes('doing'), false);
  assert.deepEqual(ids(ongoing), ['keepdoing']);
  assert.equal(ids(day.innerHTML).filter((id) => id === 'ontoday').length, 1);

  TD.area = 'DiveArts';
  tdRenderDay();
  assert.equal(day.innerHTML.includes('Bayar hari ini'), false);
  TD.area = 'All';
  TD.sel = '2026-11-11';
  tdRenderDay();
  assert.equal(day.innerHTML.includes('>Bayar hari ini<'), false);
  TD.sel = null;
});

function between(html, start, end) {
  const s = html.indexOf(start);
  assert.notEqual(s, -1, 'missing ' + start);
  const from = s + start.length;
  if (!end) return html.slice(from);
  const e = html.indexOf(end, from);
  assert.notEqual(e, -1, 'missing ' + end);
  return html.slice(from, e);
}
