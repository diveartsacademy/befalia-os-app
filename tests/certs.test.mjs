// TailCraft design certificates (8 Nov 2026). The check, written before the
// feature. Befa: "generate the certificate, especially for those who buy out
// the design ... with their name and then send to their account."
//   - every paid (or part paid) order line that buys a design's exclusivity is
//     waiting for a certificate, Sea Diva sheet lines and TailCraft invoices alike
//   - a line that already has a live certificate is not waiting; a revoked one is
//   - nothing unpaid is waiting
//   - an exclusivity right is paperwork: never packed, never production work
// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, CERT_LINE, nonPhysical } from '../api/_sd-business.js';
import { feed as base, products } from './fixture-feed.mjs';

const NOW = new Date('2026-11-08T04:00:00Z');
const M = 'MANUAL (IG & WA) - OL';
const C = (v) => ({ d: String(v), v });
const row = (row_no, o) => ({ row_no, cells: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, C(v)])) });

function feedWith(extra) {
  const f = JSON.parse(JSON.stringify(base));
  f.tabs[M].push(
    row(283, { A: 'PAID', B: 'SDTMay26-99', C: 'Customer K', D: '2026-05-20T16:00:00.000Z',
      J: 'DONE', M: 'Mermaid Tail - Custom - Adult\nOcean Opal', N: 1,
      T: 'DONE', W: 'Design buy out - exclusive design, personal tail', X: 1 }),
    row(311, { A: 'WAITING FOR PAYMENT', B: 'SDTNov26-01', C: 'Customer U', D: '2026-11-01T16:00:00.000Z',
      J: 'Design Needs to Be Made', M: 'Mermaid Tail - Custom - Adult', N: 1,
      T: '', W: 'Exclusivity IP Right - Personal Tail', X: 1 }),
    row(312, { A: 'PAID', B: 'SDTNov26-02', C: 'Studio Z', D: '2026-11-02T16:00:00.000Z',
      J: 'Design Needs to Be Made', M: 'Mermaid Tail - Custom - Adult', N: 1,
      T: '', W: 'Exclusive right for Design', X: 1 }));
  return Object.assign(f, extra || {});
}
const waiting = (out) => out.certs.waiting;
const byRef = (out, ref) => waiting(out).filter((w) => w.source_ref === ref);

test('every paid buy out line waits for a certificate, with what the form needs', () => {
  const out = build(feedWith({ tccerts: [] }), products, NOW);
  const k = byRef(out, M + '|SDTMay26-99|2');
  assert.equal(k.length, 1, 'Customer K, paid, shipped long ago: still owed a certificate');
  assert.equal(k[0].customer, 'Customer K');
  assert.equal(k[0].invoice, 'SDTMay26-99');
  assert.equal(k[0].row, 283);
  assert.equal(k[0].scope, 'personal', 'the line says personal');
  assert.deepEqual(k[0].products, ['Mermaid Tail - Custom - Adult'], 'the tail on the same order, to name the design');
  assert.equal(byRef(out, M + '|SDTNov26-02|2').length, 1, 'Exclusive right for Design counts too');
  assert.equal(byRef(out, M + '|SDTNov26-02|2')[0].scope, '', 'no guess when the line does not say');
});

test('nothing unpaid waits for a certificate', () => {
  const out = build(feedWith({ tccerts: [] }), products, NOW);
  assert.equal(waiting(out).some((w) => w.invoice === 'SDTNov26-01'), false);
});

test('a live certificate takes the line off the list; a revoked one puts it back', () => {
  const ref = M + '|SDTMay26-99|2';
  const done = build(feedWith({ tccerts: [{ cert_no: 'TC-IP-2026-001', source_ref: ref, revoked: false }] }), products, NOW);
  assert.equal(byRef(done, ref).length, 0);
  assert.equal(done.certs.issued.length, 1);
  const back = build(feedWith({ tccerts: [{ cert_no: 'TC-IP-2026-001', source_ref: ref, revoked: true }] }), products, NOW);
  assert.equal(byRef(back, ref).length, 1);
});

test('TailCraft invoices with a buy out line join the same list', () => {
  const out = build(feedWith({ tccerts: [], tccand: [
    { source_ref: 'TAILCRAFT|TC-INV-2026-004|2', invoice_no: 'TC-INV-2026-004', project: 'TC-2026-004', customer: 'Studio A',
      design: 'Coral Queen', line: 'Design ownership, brand', pay: 'paid', date: '2026-10-01', client_type: 'brand' }
  ] }), products, NOW);
  const t = byRef(out, 'TAILCRAFT|TC-INV-2026-004|2');
  assert.equal(t.length, 1);
  assert.equal(t[0].tc, true);
  assert.equal(t[0].invoice, 'TC-INV-2026-004');
  assert.equal(t[0].design, 'Coral Queen');
  assert.equal(t[0].scope, 'brand', 'from the project client type');
});

test('an exclusivity right is paperwork: never packed, never production work', () => {
  assert.ok(nonPhysical('Exclusive Right'));
  assert.ok(nonPhysical('Exclusivity IP Right - Personal Tail'));
  assert.ok(nonPhysical('Exclusive right for Design'));
  assert.ok(CERT_LINE.test('Design buy out - exclusive design, personal tail'));
  assert.equal(CERT_LINE.test('Mermaid Tail - Custom - Adult'), false);
  const out = build(feedWith({ tccerts: [] }), products, NOW);
  const o = out.orders.find((x) => x.invoice === 'SDTNov26-02');
  assert.equal(o.lines.find((l) => l.slot === 2).canPack, false);
  const work = Object.keys(out.work.items).reduce((a, k) => a.concat(out.work.items[k]), []);
  assert.equal(work.some((x) => x.invoice === 'SDTNov26-02' && x.slot === 2), false);
});

test('no Issue button until the database part is live', () => {
  assert.equal(build(feedWith(), products, NOW).certs.live, false);
  assert.equal(build(feedWith({ tccerts: [] }), products, NOW).certs.live, true);
});
