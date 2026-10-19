/* Tests for apps-script/daa-instructor/HutangBefa.gs (read the HUTANG BEFA
   tab, tick column A). Run: node tests/hutang-gs.test.mjs
   The .gs runs in a sandbox against a fake sheet with invented rows.
   Nothing touches Google, and no real figure of Befa's is in here. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(new URL('../apps-script/daa-instructor/HutangBefa.gs', import.meta.url), 'utf8');

let grid, writes, failWith, flushes;
function shownOf(v) {
  if (v instanceof Date) return (v.getUTCMonth() + 1) + '/' + v.getUTCDate() + '/' + v.getUTCFullYear();
  if (typeof v === 'number') return 'Rp' + v.toLocaleString('en-US');
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v == null ? '' : String(v);
}
function setup() {
  writes = []; failWith = null; flushes = 0;
  const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  grid = [
    [null, null, null, null, null, null],
    [null, 'Bca CC - 10jt - per 19', null, null, null, null],
    [null, 'Lender X', 1000000, null, null, null],
    [null, 'MAY', null, null, null, 'tenor'],
    [true, 'KREDITKU', D(2026, 5, 5), 500000, 'KREDITKU', D(2026, 12, 1)],
    [false, 'KREDITKU', D(2026, 11, 5), 500000, 'KREDITKU', '2/4'],
    [false, '', D(2026, 11, 9), 250000, 'CICIL APP', ''],
    [false, 'Teman A', 'SEGERA', 3000000, '', ''],
    [false, 'NOTE ONLY', null, null, null, null],
  ];
}
function cellRange(r, c, nr, nc) {
  return {
    getValues: () => grid.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
    getDisplayValues: () => grid.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc).map(shownOf)),
    setValue: (v) => { if (failWith) throw new Error(failWith); grid[r - 1][c - 1] = v; writes.push([r, c, v]); },
  };
}
function load() {
  const sh = { getLastRow: () => grid.length, getRange: (r, c, nr = 1, nc = 1) => cellRange(r, c, nr, nc) };
  const ctx = {
    WRITES_: {},
    SpreadsheetApp: {
      openById: (id) => { assert.equal(id, '1iVAYkNJJLYTeuL-xluOW_-HO3nTKBnRFmi8GvMnwhho'); return { getSheetByName: (n) => (n === 'HUTANG BEFA' ? sh : null), getSpreadsheetTimeZone: () => 'Asia/Makassar' }; },
      flush: () => { flushes++; },
    },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    module: undefined,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

let n = 0;
function t(name, fn) { setup(); fn(load()); n++; console.log('ok', n, name); }

t('registers both actions in WRITES_', (g) => {
  assert.equal(typeof g.WRITES_.hutangRead, 'function');
  assert.equal(typeof g.WRITES_.hutangTick, 'function');
});

t('read returns ticks, ISO dates, numbers and text, and writes nothing', (g) => {
  const out = g.WRITES_.hutangRead({}).body;
  assert.equal(out.ok, true);
  const byRow = Object.fromEntries(out.rows.map((r) => [r.r, r]));
  assert.equal(byRow[1], undefined, 'empty row skipped');
  assert.equal(byRow[5].a, true);
  assert.equal(byRow[5].c.d, '2026-05-05');
  assert.equal(byRow[5].d.n, 500000);
  assert.equal(byRow[6].a, false);
  assert.equal(byRow[6].f.t, '2/4');
  assert.equal(byRow[7].e, 'CICIL APP');
  assert.equal(byRow[8].c.t, 'SEGERA');
  assert.equal(byRow[3].c.n, 1000000);
  assert.equal(writes.length, 0);
});

t('read log detail carries a row count, never an amount', (g) => {
  const d = g.WRITES_.hutangRead({}).detail;
  assert.match(d, /^\d+ rows read$/);
});

t('tick writes column A of the named rows and flushes', (g) => {
  const out = g.WRITES_.hutangTick({ ticks: [{ row: 6, paid: true, name: 'KREDITKU' }, { row: 7, paid: true, name: 'CICIL APP' }] });
  assert.equal(out.body.ok, true);
  assert.deepEqual(writes, [[6, 1, true], [7, 1, true]]);
  assert.equal(flushes, 1);
  assert.match(out.detail, /^6 paid, 7 paid$/);
});

t('untick writes false', (g) => {
  const out = g.WRITES_.hutangTick({ ticks: [{ row: 5, paid: false, name: 'KREDITKU' }] });
  assert.equal(out.body.ok, true);
  assert.deepEqual(writes, [[5, 1, false]]);
});

t('a row whose name changed is refused and nothing is written', (g) => {
  assert.throws(() => g.WRITES_.hutangTick({ ticks: [{ row: 6, paid: true, name: 'KREDITKU' }, { row: 7, paid: true, name: 'SOMETHING ELSE' }] }), /changed in the sheet/);
  assert.equal(writes.length, 0);
});

t('rows outside the list, twice, without amount, or without a name are refused', (g) => {
  assert.throws(() => g.WRITES_.hutangTick({ ticks: [{ row: 99, paid: true, name: 'X' }] }), /not inside/);
  assert.throws(() => g.WRITES_.hutangTick({ ticks: [{ row: 0, paid: true, name: 'X' }] }), /not inside/);
  assert.throws(() => g.WRITES_.hutangTick({ ticks: [{ row: 6, paid: true, name: 'KREDITKU' }, { row: 6, paid: true, name: 'KREDITKU' }] }), /twice/);
  assert.throws(() => g.WRITES_.hutangTick({ ticks: [{ row: 9, paid: true, name: 'NOTE ONLY' }] }), /no amount/);
  assert.throws(() => g.WRITES_.hutangTick({ ticks: [{ row: 6, paid: true }] }), /name the app saw/);
  assert.throws(() => g.WRITES_.hutangTick({ ticks: [{ row: 6, paid: 'yes', name: 'KREDITKU' }] }), /true or false/);
  assert.throws(() => g.WRITES_.hutangTick({ ticks: [] }), /No rows/);
  assert.equal(writes.length, 0);
});

t('storage full comes back as storage:true, not a crash', (g) => {
  failWith = 'You have exceeded your storage quota. Free up space.';
  const out = g.WRITES_.hutangTick({ ticks: [{ row: 6, paid: true, name: 'KREDITKU' }] });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.storage, true);
  assert.equal(out.body.written.length, 0);
  assert.match(out.detail, /storage full/);
  assert.equal(grid[5][0], false, 'sheet unchanged');
});

t('another write error is passed on with storage:false', (g) => {
  failWith = 'Service Spreadsheets timed out';
  const out = g.WRITES_.hutangTick({ ticks: [{ row: 6, paid: true, name: 'KREDITKU' }] });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.storage, false);
});

console.log(n + ' passed');
