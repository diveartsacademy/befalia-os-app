/* Tests for apps-script/daa-instructor/PostClass.gs (the shared after-class
   checklist). Run: node tests/postclass-gs.test.mjs
   tab_, rows_ and now_ from Code.gs are stand-ins with the same contract;
   the sheet is a fake. Nothing touches Google. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const J = (x) => JSON.parse(JSON.stringify(x));

const SRC = fs.readFileSync(new URL('../apps-script/daa-instructor/PostClass.gs', import.meta.url), 'utf8');

let grid, created, basePayloadCalls;
function load({ withPayload = true } = {}) {
  grid = null; created = 0; basePayloadCalls = 0;
  const H = {};
  const sheet = {
    getLastRow: () => grid.length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => grid.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
      setValues: (v) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = v[i][j]; },
    }),
    appendRow: (v) => { grid.push(v.slice()); },
  };
  const ctx = {
    H, WRITES_: {}, module: undefined,
    now_: () => '2026-10-19 14:05',
    tab_: (name) => { if (!grid) { created++; grid = [H[name].slice()]; } return sheet; },
    rows_: (name) => { if (!grid) return []; const head = H[name]; return grid.slice(1).filter((r) => String(r[0]) !== '').map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]))); },
  };
  if (withPayload) {
    ctx.payload_ = function () { basePayloadCalls++; return { ok: true, sessions: [] }; };
  }
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

let n = 0;
const t = (name, fn) => { fn(load()); n++; console.log('ok', n, name); };

t('registers both actions and wraps the dashboard read once', (g) => {
  assert.equal(typeof g.WRITES_.postClassSet, 'function');
  assert.equal(typeof g.WRITES_.postClassRead, 'function');
  assert.equal(g.PC_PAYLOAD_WRAPPED, true);
  assert.equal(g.pcWrapPayload_(), false, 'never wrapped twice');
});

t('first write creates the tab with its header and appends one row', (g) => {
  const out = g.WRITES_.postClassSet({ class_key: 'ev:abc123def', item: 'files', done: true, label: 'Delphine · Open water 2/2', class_date: '2026-10-19' }, 'befa@x');
  assert.equal(out.body.ok, true);
  assert.equal(created, 1);
  assert.deepEqual(J(grid[0]), ['pc_id', 'class_key', 'item', 'done', 'by', 'at', 'label', 'class_date', 'note']);
  assert.deepEqual(J(grid[1].slice(0, 8)), ['ev:abc123def|files', 'ev:abc123def', 'files', true, 'befa@x', '2026-10-19 14:05', 'Delphine · Open water 2/2', '2026-10-19']);
  assert.equal(out.detail, 'files done');
});

t('a second write to the same class and step updates the row, keeping label and date when not sent', (g) => {
  g.WRITES_.postClassSet({ class_key: 'ev:abc123def', item: 'files', done: true, label: 'L', class_date: '2026-10-19' }, 'a');
  g.WRITES_.postClassSet({ class_key: 'ev:abc123def', item: 'certify', done: true }, 'a');
  g.WRITES_.postClassSet({ class_key: 'ev:abc123def', item: 'files', done: false, by: 'rie@x' }, 'proxy');
  assert.equal(grid.length, 3);
  assert.deepEqual(J(grid[1].slice(3, 8)), [false, 'rie@x', '2026-10-19 14:05', 'L', '2026-10-19']);
});

t('read returns only the asked classes, with done as a real boolean', (g) => {
  g.WRITES_.postClassSet({ class_key: 'ev:abc123def', item: 'expenses', done: true }, 'a');
  g.WRITES_.postClassSet({ class_key: 'os:OS-0001', item: 'files', done: true }, 'a');
  grid.push(['junk|x', 'not a key', 'files', 'TRUE', '', '', '', '', '']);
  const out = g.WRITES_.postClassRead({ keys: ['ev:abc123def', 'nt:missing01'] }).body;
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].done, true);
  assert.equal(out.rows[0].item, 'expenses');
});

t('the dashboard read carries every row, and a broken tab never breaks it', (g) => {
  g.WRITES_.postClassSet({ class_key: 'nt:abcdef12', item: 'certify', done: true }, 'a');
  const p = g.payload_();
  assert.equal(basePayloadCalls, 1);
  assert.equal(p.ok, true);
  assert.equal(p.postClass.length, 1);
  g.rows_ = () => { throw new Error('tab gone'); };
  const p2 = g.payload_();
  assert.deepEqual(p2.postClass.length, 0);
  assert.match(p2.postClassError, /tab gone/);
});

t('refusals write nothing', (g) => {
  assert.throws(() => g.WRITES_.postClassSet({ class_key: 'xx:abc', item: 'files', done: true }), /class key/);
  assert.throws(() => g.WRITES_.postClassSet({ class_key: 'ev:abc123def', item: 'dance', done: true }), /Unknown step/);
  assert.throws(() => g.WRITES_.postClassSet({ class_key: 'ev:abc123def', item: 'files', done: 'yes' }), /true or false/);
  assert.throws(() => g.WRITES_.postClassSet({ class_key: 'ev:abc123def', item: 'files', done: true, class_date: '19/10' }), /yyyy-mm-dd/);
  assert.throws(() => g.WRITES_.postClassRead({ keys: Array.from({ length: 301 }, (_, i) => 'ev:k' + String(i).padStart(4, '0')) }), /At most/);
  assert.equal(grid, null, 'the tab was not even created');
});

{ const g = load({ withPayload: false }); assert.equal(g.PC_PAYLOAD_WRAPPED, false); n++; console.log('ok', n, 'without payload_ it does not wrap and does not crash'); }

console.log(n + ' passed');
