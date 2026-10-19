/* Tests for the Finance tab: api/_hutang.js (reading the HUTANG BEFA layout)
   and api/finance.js (read, tick, sync). Run: node tests/finance.test.mjs
   The sheet and Notion are faked with invented rows laid out like Befa's tab.
   No real figure of hers is in this file. */
import assert from 'node:assert/strict';

process.env.OS_KEY = 'os';
process.env.NOTION_TOKEN = 'nt';
delete process.env.DAA_API_URL;
process.env.DAA_API_KEY = 'daa';

const { parseHutang, lenderOf } = await import('../api/_hutang.js');
const { default: handler, rowsOfNotes, planSync, rupiah, SECTIONS } = await import('../api/finance.js');
const { TASKS_DB } = await import('../api/tasks.js');

const T = (s) => ({ t: s });
const D = (iso) => ({ d: iso, t: iso });
const N = (n) => ({ n, t: 'Rp' + n });
// An invented tab in Befa's layout. "today" in these tests is 2026-10-19.
function fixture() {
  return [
    { r: 4, a: false, b: 'Kartu A - 10jt - per 19', c: T(''), d: T(''), e: '', f: T('') },
    { r: 6, a: false, b: 'Pinjaman keluarga', c: N(50000000), d: T(''), e: '', f: T('') },
    { r: 8, a: false, b: 'HUTANG BEFA', c: T(''), d: T(''), e: '', f: T('') },
    { r: 9, a: false, b: 'SEPTEMBER', c: T(''), d: T(''), e: '', f: T('tenor') },
    { r: 10, a: true, b: 'KREDITKU', c: D('2026-09-05'), d: N(500000), e: 'KREDITKU', f: T('') },
    { r: 11, a: false, b: 'TEMAN A', c: T('SEGERA'), d: N(3000000), e: '', f: T('') },
    { r: 12, a: false, b: 'KELUARGA', c: D('2026-06-30'), d: N(4000000), e: 'HUTANG KELUARGA', f: T('') },
    { r: 13, a: false, b: '', c: T(''), d: N(99999), e: '', f: T('') }, // subtotal
    { r: 14, a: false, b: 'OCTOBER', c: T(''), d: N(12345), e: '', f: T('') },
    { r: 15, a: false, b: 'GAJi', c: D('2026-10-01'), d: N(750000), e: 'BEBEN', f: T('REGULAR') },
    { r: 16, a: false, b: 'PINDAM DUIT', c: T('17 OKT'), d: N(1200000), e: 'PINJAM DUIT', f: T('') },
    { r: 17, a: false, b: 'KREDITKU', c: T('5 OKTOBER'), d: N(500000), e: 'KREDITKU', f: T('') },
    { r: 18, a: false, b: 'BLIBLI TIKET PAYLATER', c: D('2026-10-28'), d: N(183000), e: 'TIKET.COM', f: T('6/12') },
    { r: 19, a: false, b: 'NOVEMBER', c: T(''), d: T(''), e: '', f: T('') },
    { r: 20, a: false, b: 'KREDITKU', c: D('2026-11-05'), d: N(500000), e: 'KREDITKU', f: T('') },
    { r: 21, a: false, b: 'INTERNET', c: T('8 OF THE MONTH'), d: N(233000), e: 'INTERNET', f: T('REGULAR') },
    { r: 22, a: false, b: 'DECEMBER', c: T(''), d: T(''), e: '', f: T('') },
    { r: 23, a: false, b: 'KREDITKU', c: D('2026-12-05'), d: N(500000), e: 'KREDITKU', f: T('') },
    { r: 24, a: false, b: '2027', c: T(''), d: T(''), e: '', f: T('') },
    { r: 25, a: false, b: 'JANUARY', c: T(''), d: T(''), e: '', f: T('') },
    { r: 26, a: false, b: 'KREDITKU', c: D('2026-01-05'), d: N(500000), e: 'KREDITKU', f: T('') }, // typed 2026, means 2027
    { r: 27, a: false, b: 'BLIBLI TIKET PAYLATER', c: D('2027-01-28'), d: N(183000), e: 'TIKET.COM', f: T('') },
    { r: 28, a: false, b: 'BLIBLI TIKET PAYLATER', c: D('2027-01-28'), d: N(183000), e: 'TIKET.COM', f: T('') }, // a copy
    { r: 29, a: false, b: 'GAJI LAMA', c: D('2026-06-25'), d: T('?-2.5jt'), e: '', f: T('') },
  ];
}

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', n, name); };

await t('lender names are tidied', () => {
  assert.equal(lenderOf('PINDAM DUIT', ''), 'Pinjam Duit');
  assert.equal(lenderOf('Shopeepay', 'Spaylater'), 'Shopee Paylater');
  assert.equal(lenderOf('Spay pinjam ', ''), 'Spay Pinjam');
  assert.equal(lenderOf('GAJi', 'BEBEN'), 'Gaji Beben');
  assert.equal(lenderOf('', 'iqbal videographer'), 'Iqbal Videographer');
});

await t('notes above the title stay notes and never enter a total', () => {
  const m = parseHutang(fixture(), '2026-10-19');
  assert.deepEqual(m.notes.map((x) => x.row), [4, 6]);
  assert.equal(m.notes[1].amount, 50000000);
  assert.ok(!m.items.some((x) => x.row === 4 || x.row === 6));
});

await t('every row gets the right kind', () => {
  const m = parseHutang(fixture(), '2026-10-19');
  const k = Object.fromEntries(m.items.map((x) => [x.row, x.kind]));
  assert.equal(k[10], 'paid');
  assert.equal(k[11], 'undated');
  assert.equal(k[12], 'overdue');
  assert.equal(k[15], 'regular');
  assert.equal(k[16], 'check');
  assert.equal(k[17], 'check');
  assert.equal(k[18], 'scheduled');
  assert.equal(k[21], 'regular');
  assert.equal(k[26], 'scheduled');
  assert.equal(k[29], 'overdue');
  assert.equal(k[13], undefined, 'subtotal skipped');
  assert.equal(k[14], undefined, 'month header with a sum skipped');
});

await t('text dates and the 2026 typo in the 2027 block', () => {
  const m = parseHutang(fixture(), '2026-10-19');
  const due = Object.fromEntries(m.items.map((x) => [x.row, x.due]));
  assert.equal(due[16], '2026-10-17');
  assert.equal(due[17], '2026-10-05');
  assert.equal(due[21], '2026-11-08');
  assert.equal(due[26], '2027-01-05');
  assert.equal(m.items.find((x) => x.row === 26).fixedYear, true);
  assert.equal(due[11], null);
  assert.equal(m.items.find((x) => x.row === 11).urgent, true);
});

await t('a copied row is flagged and counted once', () => {
  const m = parseHutang(fixture(), '2026-10-19');
  assert.deepEqual(m.dups.map((x) => [x.row, x.dup]), [[28, 27]]);
  const bl = m.lenders.find((l) => l.lender === 'Blibli Tiket');
  assert.equal(bl.left, 2);
  assert.equal(bl.remaining, 366000);
});

await t('totals: debt is scheduled + undated + overdue; bills and checks stay out', () => {
  const m = parseHutang(fixture(), '2026-10-19');
  // scheduled: 183000 + 500000 + 500000 + 500000 + 183000 = 1866000
  assert.equal(m.totals.scheduled, 1866000);
  assert.equal(m.totals.undated, 3000000);
  assert.equal(m.totals.overdue, 4000000);
  assert.equal(m.totals.debt, 8866000);
  assert.equal(m.totals.check, 1700000);
  assert.equal(m.totals.unknownAmounts, 1);
  assert.equal(m.totals.scheduledEnds, '2027-01-28');
  assert.equal(m.totals.noteTotal, 50000000);
});

await t('months, this month and the next list', () => {
  const m = parseHutang(fixture(), '2026-10-19');
  assert.deepEqual(m.months.map((x) => [x.month, x.debt, x.bills]), [['2026-10', 183000, 0], ['2026-11', 500000, 233000], ['2026-12', 500000, 0], ['2027-01', 683000, 0]]);
  assert.equal(m.thisMonth.total, 750000 + 1200000 + 500000 + 183000);
  assert.equal(m.thisMonth.left, 183000);
  assert.equal(m.next[0].row, 18);
  assert.ok(m.next.every((x) => x.due >= '2026-10-19'));
});

await t('notes of a reminder give its rows; other notes give none', () => {
  assert.deepEqual(rowsOfNotes('Pengingat H-1. Jatuh tempo 5 Nov 2026. Dari sheet HUTANG BEFA (FINANCIAL REPORT BEFALIA), baris 146, 147. Setelah bayar, centang juga di sheet.'), [146, 147]);
  assert.deepEqual(rowsOfNotes('Ditandai lunas di tab Finance. Dari sheet HUTANG BEFA (FINANCIAL REPORT BEFALIA), baris 122.'), [122]);
  assert.deepEqual(rowsOfNotes('baris 5 of something else'), []);
  assert.deepEqual(rowsOfNotes(''), []);
  assert.equal(rupiah(1924000), 'Rp1.924.000');
});

const task = (id, done, notes, section = 'Payments (Bayar)') => ({ id, done, notes, section });
await t('sync plan: a done reminder pushes its rows, a sheet tick closes an open reminder', () => {
  const m = parseHutang(fixture(), '2026-10-19');
  const p = planSync(m.items, [
    task('a', true, 'Dari sheet HUTANG BEFA, baris 18.'),
    task('b', false, 'Dari sheet HUTANG BEFA, baris 10.'),
    task('c', false, 'Dari sheet HUTANG BEFA, baris 20.'),
    task('d', true, 'Dari sheet HUTANG BEFA, baris 10.'), // already ticked in the sheet
    task('e', true, 'Dari sheet HUTANG BEFA, baris 20.', 'Other'),
    task('f', false, 'Dari sheet HUTANG BEFA, baris 20.', 'Pembayaran Hutang'),
  ]);
  assert.deepEqual(p.push.map((x) => [x.row, x.name]), [[18, 'BLIBLI TIKET PAYLATER']]);
  assert.deepEqual(p.close, ['b']);
});
await t('the new title "Pembayaran Hutang" counts, and so does the old one', () => {
  assert.deepEqual(SECTIONS, ['Pembayaran Hutang', 'Payments (Bayar)']);
  const m = parseHutang(fixture(), '2026-10-19');
  const p = planSync(m.items, [
    task('new', true, 'Dari sheet HUTANG BEFA, baris 18.', 'Pembayaran Hutang'),
    task('old', true, 'Dari sheet HUTANG BEFA, baris 20.', 'Payments (Bayar)'),
  ]);
  assert.deepEqual(p.push.map((x) => x.row), [18, 20]);
});

/* ---------- the route, with the sheet and Notion faked ---------- */
let rows, tasks, calls, sheetFull, created;
const rt = (s) => [{ plain_text: s, text: { content: s } }];
const page = (x) => ({ id: x.id, parent: { database_id: TASKS_DB }, created_time: '', last_edited_time: '', url: '', properties: {
  Name: { title: rt(x.name || 'x') }, Section: { select: { name: x.section } }, Notes: { rich_text: rt(x.notes) },
  Done: { checkbox: !!x.done }, Status: { select: { name: x.done ? 'Done' : 'To do' } } } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ u, method: init.method || 'GET', body });
  if (u.startsWith('https://script.google.com/')) {
    if (body.key !== 'daa') return new Response(JSON.stringify({ ok: false, error: 'bad key' }));
    if (body.action === 'hutangRead') return new Response(JSON.stringify({ ok: true, rows }));
    if (body.action === 'hutangTick') {
      if (sheetFull) return new Response(JSON.stringify({ ok: false, storage: true, error: 'storage quota exceeded', written: [] }));
      for (const tk of body.ticks) { const r = rows.find((x) => x.r === tk.row); assert.equal(tk.name, r.b || r.e); r.a = tk.paid; }
      return new Response(JSON.stringify({ ok: true, written: body.ticks.map((x) => x.row) }));
    }
  }
  if (u === 'https://api.notion.com/v1/databases/' + TASKS_DB + '/query') {
    assert.deepEqual(body.filter.and[0].or.map((f) => f.select.equals), ['Pembayaran Hutang', 'Payments (Bayar)']);
    return new Response(JSON.stringify({ results: tasks.map(page), has_more: false }));
  }
  if (u.startsWith('https://api.notion.com/v1/pages/') && init.method === 'PATCH') {
    const id = u.split('/').pop();
    const x = tasks.find((y) => y.id === id);
    x.done = body.properties.Done.checkbox;
    return new Response(JSON.stringify(page(x)));
  }
  if (u === 'https://api.notion.com/v1/pages' && init.method === 'POST') {
    const x = { id: 'new' + (++created), section: body.properties.Section.select.name, notes: body.properties.Notes.rich_text[0].text.content, done: body.properties.Done.checkbox, name: body.properties.Name.title[0].text.content };
    tasks.push(x);
    return new Response(JSON.stringify(page(x)));
  }
  return new Response('not faked: ' + u, { status: 500 });
};
const run = async (method, body, key = 'os') => {
  const res = { s: 0, j: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(s) { this.s = s; return this; }, json(j) { this.j = j; return this; } };
  await handler({ method, headers: { 'x-os-key': key }, body }, res);
  return res;
};
const reset = () => { rows = fixture(); calls = []; sheetFull = false; created = 0; tasks = [
  { id: 'rem18', section: 'Pembayaran Hutang', done: false, notes: 'Pengingat H-1. Dari sheet HUTANG BEFA (FINANCIAL REPORT BEFALIA), baris 18.' },
  { id: 'rem20', section: 'Payments (Bayar)', done: false, notes: 'Pengingat H-1. Dari sheet HUTANG BEFA (FINANCIAL REPORT BEFALIA), baris 20.' },
]; };
const sheetWrites = () => calls.filter((c) => c.body && c.body.action === 'hutangTick');

await t('no key, no data', async () => {
  reset();
  const r = await run('GET', null, 'wrong');
  assert.equal(r.s, 401);
  assert.equal(calls.length, 0);
});

await t('GET reads the sheet, never writes, and lists nothing waiting', async () => {
  reset();
  const r = await run('GET');
  assert.equal(r.s, 200);
  assert.equal(r.j.totals.debt, 8866000);
  assert.deepEqual(r.j.waiting, []);
  assert.equal(sheetWrites().length, 0);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
  assert.equal(r.h['Cache-Control'], 'no-store');
});

await t('tick when Google saves: the sheet is ticked and the reminder closes', async () => {
  reset();
  const r = await run('POST', { action: 'tick', ticks: [{ row: 18, paid: true }] });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.saved, true);
  assert.equal(rows.find((x) => x.r === 18).a, true);
  assert.equal(tasks.find((x) => x.id === 'rem18').done, true);
});

await t('tick when storage is full: the sheet stays, the reminder is Done and the row waits', async () => {
  reset(); sheetFull = true;
  const r = await run('POST', { action: 'tick', ticks: [{ row: 18, paid: true }] });
  assert.equal(r.j.saved, false);
  assert.equal(r.j.storage, true);
  assert.equal(rows.find((x) => x.r === 18).a, false);
  assert.equal(tasks.find((x) => x.id === 'rem18').done, true);
  const g = await run('GET');
  assert.deepEqual(g.j.waiting, [18]);
});

await t('a debt without a reminder, ticked while storage is full, gets a Done "Lunas" task that waits', async () => {
  reset(); sheetFull = true;
  const r = await run('POST', { action: 'tick', ticks: [{ row: 11, paid: true }] });
  assert.equal(r.j.saved, false);
  assert.equal(created, 1);
  const x = tasks.find((y) => y.id === 'new1');
  assert.match(x.name, /^Lunas: Teman A Rp3\.000\.000$/);
  assert.deepEqual(rowsOfNotes(x.notes), [11]);
  assert.equal(x.done, true);
  assert.equal(x.section, 'Pembayaran Hutang', 'a waiting tick goes under the new title');
  assert.deepEqual((await run('GET')).j.waiting, [11]);
});

await t('sync, once Google saves again, sends every waiting row and closes reminders already ticked in the sheet', async () => {
  reset(); sheetFull = true;
  await run('POST', { action: 'tick', ticks: [{ row: 18, paid: true }] });
  await run('POST', { action: 'tick', ticks: [{ row: 11, paid: true }] });
  rows.find((x) => x.r === 20).a = true; // Befa ticked row 20 in the sheet herself
  sheetFull = false;
  const s = await run('POST', { action: 'sync' });
  assert.equal(s.s, 200, JSON.stringify(s.j));
  assert.deepEqual(s.j.pushed, [11, 18]);
  assert.equal(s.j.closed, 1);
  assert.equal(rows.find((x) => x.r === 11).a, true);
  assert.equal(rows.find((x) => x.r === 18).a, true);
  assert.equal(tasks.find((x) => x.id === 'rem20').done, true);
  assert.deepEqual((await run('GET')).j.waiting, []);
});

await t('sync while storage is still full reports the rows still waiting and writes nothing', async () => {
  reset(); sheetFull = true;
  await run('POST', { action: 'tick', ticks: [{ row: 18, paid: true }] });
  const s = await run('POST', { action: 'sync' });
  assert.deepEqual(s.j.waiting, [18]);
  assert.equal(s.j.storage, true);
  assert.equal(rows.find((x) => x.r === 18).a, false);
});

await t('untick reopens the reminder and unticks the sheet', async () => {
  reset();
  await run('POST', { action: 'tick', ticks: [{ row: 18, paid: true }] });
  const r = await run('POST', { action: 'tick', ticks: [{ row: 18, paid: false }] });
  assert.equal(r.j.saved, true);
  assert.equal(rows.find((x) => x.r === 18).a, false);
  assert.equal(tasks.find((x) => x.id === 'rem18').done, false);
});

await t('refusals: unknown row, a row without an amount, an empty list, too many', async () => {
  reset();
  assert.equal((await run('POST', { action: 'tick', ticks: [{ row: 999, paid: true }] })).s, 400);
  assert.equal((await run('POST', { action: 'tick', ticks: [{ row: 29, paid: true }] })).s, 400);
  assert.equal((await run('POST', { action: 'tick', ticks: [] })).s, 400);
  assert.equal((await run('POST', { action: 'tick', ticks: Array.from({ length: 41 }, (_, i) => ({ row: i, paid: true })) })).s, 400);
  assert.equal((await run('POST', { action: 'nope' })).s, 400);
  assert.equal(sheetWrites().length, 0);
});

await t('a script without HutangBefa.gs gives a clear message', async () => {
  reset();
  const save = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://script.google.com/')
    ? new Response(JSON.stringify({ ok: false, error: 'unknown action hutangRead' })) : save(url, init));
  const r = await run('GET');
  globalThis.fetch = save;
  assert.equal(r.s, 503);
  assert.match(r.j.error, /HutangBefa\.gs still has to be deployed/);
});

console.log(n + ' passed');
