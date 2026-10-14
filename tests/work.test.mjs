// My work (14 Oct 2026). The check, written before the feature:
//   - nothing already packed, shipped or picked up ever shows as work
//   - a Done click changes the line at once, before the sheet catches up,
//     and stops counting once the sheet says something else
//   - every button only offers a move the database also allows
// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, WORK_MOVES, WORK_FROM, workBucket } from '../api/_sd-business.js';
import { feed as base, products } from './fixture-feed.mjs';

const NOW = new Date('2026-10-13T02:00:00Z');
const C = (v) => ({ d: String(v), v });
const row = (row_no, o) => ({ row_no, cells: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, C(v)])) });

function feedWith(extra) {
  const f = JSON.parse(JSON.stringify(base));
  f.tabs['MANUAL (IG & WA) - OL'].push(
    row(310, { A: 'PAID', B: 'SDTOct26-09', C: 'Customer M', D: '2026-10-05T16:00:00.000Z',
      J: 'Need to Create', M: 'Mermaid Crown - Pearl Shell', N: 1,
      T: 'In the Making', W: 'Fluke filler', X: 1,
      AD: 'Sewing / Building', AG: 'Mermaid Tail - Custom - Adult', AH: 1,
      AN: 'Custom Color', AQ: 'Custom Color', AR: 1 }));
  return Object.assign(f, extra || {});
}
const all = (w) => Object.keys(w.items).reduce((a, k) => a.concat(w.items[k].map((x) => Object.assign({ bucket: k }, x))), []);
const find = (w, inv, slot) => all(w).filter((x) => x.invoice === inv && x.slot === slot);

test('every line lands in the right list', () => {
  const w = build(feedWith(), products, NOW).work;
  assert.deepEqual(find(w, 'SDTJun26-23', 1).map((x) => x.bucket), ['design']);
  assert.deepEqual(find(w, 'SDTJun26-23', 3).map((x) => x.bucket), ['printing'], 'Printing waits on Timur Jaya');
  assert.deepEqual(find(w, 'SDTMar26-2', 2).map((x) => x.bucket), ['order']);
  assert.deepEqual(find(w, 'SDTMar26-2', 3).map((x) => x.bucket), ['make'], 'Need to Create');
  assert.deepEqual(find(w, 'SDTOct26-09', 1).map((x) => x.bucket), ['crown'], 'a crown is caught by its name');
  assert.deepEqual(find(w, 'SDTOct26-09', 2).map((x) => x.bucket), ['fluke'], 'a fluke filler is caught by its name');
  assert.deepEqual(find(w, 'SDTOct26-09', 3).map((x) => x.bucket), ['sewing'], 'Sewing waits on Pak Supri');
  assert.deepEqual(find(w, '#1069', 1).map((x) => x.bucket), ['order'], 'Shopify lines count too');
});

test('ready, shipping, DONE, blank, paperwork and QA lines are never work', () => {
  const w = build(feedWith(), products, NOW).work;
  assert.equal(find(w, 'SDTMar26-2', 1).length, 0, 'Ready to be shipped');
  assert.equal(find(w, 'SDTMar26-2', 4).length, 0, 'Shipping Process');
  assert.equal(find(w, 'SDTOct26-09', 4).length, 0, 'Custom Color is paperwork');
  assert.equal(find(w, '#1071', 1).length, 0, 'no status');
  assert.equal(all(w).some((x) => /^QA/i.test(x.invoice)), false);
  assert.equal(find(w, 'SDTOct26-02', 1).length, 0, 'ticked Shipped in the sheet');
});

test('a packed line, an order marked already shipped and a pickup order never show as work', () => {
  const f = feedWith({
    marks: [{ id: 1, click_id: 'c1', src: 'SHOPIFY-OL', invoice: '#1069', slot: 1, at: '2026-10-13T01:00:00Z', by: 'Befa' }],
    shipped: [{ id: 9, src: 'MANUAL (IG & WA) - OL', invoice: 'SDTJun26-23', at: '2026-10-13T01:00:00Z' }]
  });
  const w = build(f, products, NOW, { hidePickup: true }).work;
  assert.equal(find(w, '#1069', 1).length, 0, 'packed');
  assert.equal(find(w, '#1069', 2).length, 1, 'the other product on the same order still shows');
  assert.equal(all(w).some((x) => x.invoice === 'SDTJun26-23'), false, 'already shipped');

  const p = feedWith({
    marks: [1, 2, 3, 4, 5, 6].map((s) => ({ id: s, click_id: 'c2', src: 'MANUAL (IG & WA) - OL', invoice: 'SDTMar26-2', slot: s, at: '2026-10-13T01:00:00Z' })),
    handoff: [{ src: 'MANUAL (IG & WA) - OL', invoice: 'SDTMar26-2', method: 'pickup' }]
  });
  const wp = build(p, products, NOW, { hidePickup: true }).work;
  assert.equal(all(wp).some((x) => x.invoice === 'SDTMar26-2'), false, 'packed for pickup');
});

test('a Done click moves the line at once, and chains', () => {
  const f = feedWith({ work: [
    { id: 1, src: 'SHOPIFY-OL', invoice: '#1065', slot: 1, from: 'Order from 3rd Party', to: 'Ordered', at: '2026-10-13T01:00:00Z' },
    { id: 2, src: 'SHOPIFY-OL', invoice: '#1065', slot: 1, from: 'Ordered', to: 'Ready to be shipped', at: '2026-10-13T01:10:00Z' },
    { id: 3, src: 'MANUAL (IG & WA) - OL', invoice: 'SDTJun26-23', slot: 1, from: 'Design Needs to Be Made', to: 'Printing', at: '2026-10-13T01:00:00Z', write: 'queued' }
  ] });
  const out = build(f, products, NOW);
  assert.equal(find(out.work, '#1065', 1).length, 0, 'ordered, then arrived: no longer work');
  const o = out.orders.find((x) => x.invoice === '#1065');
  assert.equal(o.stage, 'ready', 'and Pack and ship sees it ready');
  assert.equal(o.lines[0].status, 'Ready to be shipped');
  assert.equal(o.lines[0].sheetStatus, 'Order from 3rd Party', 'what the sheet still says is kept');
  const moved = find(out.work, 'SDTJun26-23', 1);
  assert.deepEqual(moved.map((x) => x.bucket), ['printing']);
  assert.equal(moved[0].work.id, 3, 'the last click is there for Undo');
});

test('a click the sheet has moved past is ignored: the sheet wins', () => {
  const f = feedWith({ work: [
    { id: 4, src: 'MANUAL (IG & WA) - OL', invoice: 'SDTMar26-2', slot: 2, from: 'Ordered', to: 'Ready to be shipped', at: '2026-10-13T01:00:00Z' }
  ] });
  const w = build(f, products, NOW).work;
  assert.deepEqual(find(w, 'SDTMar26-2', 2).map((x) => x.bucket), ['order'], 'the sheet says Order from 3rd Party, not Ordered');
});

test('the buttons only offer moves the database allows', () => {
  Object.keys(WORK_MOVES).forEach((b) => WORK_MOVES[b].forEach((m) => {
    assert.ok(Object.values(WORK_FROM).some((tos) => tos.includes(m[0])), b + ' -> ' + m[0]);
  }));
  const w = build(feedWith(), products, NOW).work;
  all(w).filter((x) => !x.tc).forEach((x) => {
    const allowed = WORK_FROM[x.status.toLowerCase()] || [];
    assert.ok(x.moves.length, x.invoice + ' ' + x.slot + ' has a button');
    x.moves.forEach((m) => assert.ok(allowed.includes(m.to), x.status + ' -> ' + m.to));
  });
});

test("Befa's rulings, 14 Oct: design done goes to Printing, fluke filler and crown to Ready to be shipped, bought to Ordered, arrived to Ready", () => {
  assert.ok(WORK_MOVES.design.some((m) => m[0] === 'Printing'));
  assert.equal(WORK_MOVES.fluke[0][0], 'Ready to be shipped');
  assert.equal(WORK_MOVES.crown[0][0], 'Ready to be shipped');
  assert.equal(WORK_MOVES.order[0][0], 'Ordered');
  assert.equal(WORK_MOVES.ordered[0][0], 'Ready to be shipped');
});

test('not paid yet orders show their work, marked not paid', () => {
  const w = build(feedWith(), products, NOW).work;
  const u = find(w, 'SDTOct26-01', 1);
  assert.deepEqual(u.map((x) => x.bucket), ['design']);
  assert.equal(u[0].unpaid, true);
});

test('TailCraft designs sit in the same Designer list', () => {
  const f = feedWith({ tcwork: [
    { project: 'TC-2026-005', customer: 'Studio A', stage: 'design_making', stage_label: 'Custom Design Making', updated_at: '2026-08-26T00:00:00Z', created_at: '2026-08-10T00:00:00Z' },
    { project: 'TC-2026-099', customer: 'Studio B', stage: 'design_sent', stage_label: 'Design options sent', updated_at: '2026-08-26T00:00:00Z' }
  ] });
  const w = build(f, products, NOW).work;
  const tc = w.items.design.filter((x) => x.tc);
  assert.deepEqual(tc.map((x) => x.project), ['TC-2026-005'], 'only designs still to make');
  assert.deepEqual(tc[0].moves.map((m) => m.to), ['design_sent', 'lost']);
  assert.equal(tc[0].days, 48, 'days since the project last changed');
});

test('counts: mine and waiting on someone', () => {
  const w = build(feedWith(), products, NOW).work;
  const n = (k) => w.items[k].length;
  assert.equal(w.counts.mine, n('design') + n('order') + n('ordered') + n('fluke') + n('crown') + n('make'));
  assert.equal(w.counts.waiting, n('printing') + n('sewing'));
  assert.equal(workBucket({ status: 'Ready Stock', group: 'ready', physical: true }), null);
});

test('no Done buttons until the database part is live', () => {
  assert.equal(build(feedWith(), products, NOW).work.live, false);
  assert.equal(build(feedWith({ work: [] }), products, NOW).work.live, true);
});

test('a product ticked in the box is never work, whatever the sheet still says', () => {
  const f = feedWith({ ticks: [1, 2].map((s) => ({ src: 'MANUAL (IG & WA) - OL', invoice: 'SDTJun26-23', slot: s, at: '2026-10-13T16:22:00Z', by: 'Befa' })) });
  const w = build(f, products, NOW).work;
  assert.equal(find(w, 'SDTJun26-23', 1).length, 0);
  assert.equal(find(w, 'SDTJun26-23', 2).length, 0);
  assert.deepEqual(find(w, 'SDTJun26-23', 3).map((x) => x.bucket), ['printing'], 'not ticked, still listed');
});
