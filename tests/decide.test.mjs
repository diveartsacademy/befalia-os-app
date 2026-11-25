// Fulfil-from decision and Ready to Buy links (25 Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, WORK_FROM, DECIDE_MOVES, skuOf, matchSource, indexCatalog, wantsBuy } from '../api/_sd-business.js';
import { feed as base, products } from './fixture-feed.mjs';

const NOW = new Date('2026-10-13T02:00:00Z');
const C = (v) => ({ d: String(v), v });
const row = (row_no, o) => ({ row_no, cells: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, C(v)])) });

const catalog = [
  { sku: 'SDT-ARS-DAR-ONESIZ', product: 'Arm Sleeve - Dark Pink Patra', sourceCategory: 'SDT PRODUCTION', store: 'GARMENT PRODUCTION', link: '' },
  { sku: 'SDT-MDW-WHI-05', product: 'Manta dive Weight 0,5 KG/ White', sourceCategory: '3rd party', store: 'Arnesh', link: 'https://supplier.example/manta-white' },
  { sku: 'SDT-HD-NOC', product: 'Headband - Noctara', sourceCategory: '3rd party', store: 'SHOPEE LINK', link: 'https://shopee.example/headband' }
];

function feedWith() {
  const f = JSON.parse(JSON.stringify(base));
  f.catalog = catalog;
  f.stockTab = true;
  f.stock = [{ sku: 'SDT-ARS-DAR-ONESIZ', qty: 3 }, { sku: 'SDT-MDW-WHI-05', qty: 0 }];
  f.toDecideTab = true;
  f.toDecide = [{ invoice: 'SDTNov26-7', slot: 1, suggested: 'FROM SHELF', sku: 'SDT-ARS-DAR-ONESIZ' }];
  f.tabs['MANUAL (IG & WA) - OL'].push(
    row(326, { B: 'SDTNov26-1', C: 'Customer J', D: '2026-11-09T16:00:00.000Z',
      J: 'Order from 3rd Party', M: 'Manta dive Weight 0,5 KG/ White', N: 2 }),
    row(332, { A: 'PAID', B: 'SDTNov26-7', C: 'Customer K', D: '2026-11-25T16:00:00.000Z',
      J: 'Need to Create', M: 'Arm Sleeve - Dark Pink Patra, One Size (SKU SDT-ARS-DAR-ONESIZ)', N: 1 })
  );
  f.tabs['SHOPEE - OL'] = [
    row(2, { B: 'No Pesanan', C: 'Name', D: 'Invoice Date', F: 'Status Produksi', I: '1. Item / Description', J: 'Qty' }),
    row(3, { A: 'Status Payment' }),
    row(40, { A: true, B: 'SHP-BLANK-3RD', C: 'buyer', D: '2026-10-05', I: 'Headband - Noctara', J: 1 }),
    row(41, { A: true, B: 'SHP-BLANK-OURS', C: 'buyer', D: '2026-10-05', I: 'Custom studio piece with no source', J: 1 })
  ];
  return f;
}

test('a labelled SKU is the product, and a third-party category is the source test', () => {
  assert.equal(skuOf('Arm Sleeve - Dark Pink Patra (SKU SDT-ARS-DAR-ONESIZ).'), 'SDT-ARS-DAR-ONESIZ');
  const idx = indexCatalog(catalog);
  const hit = matchSource(idx, 'Manta dive Weight 0,5 KG/ White SDT-MDW-WHI-05');
  assert.equal(hit.sku, 'SDT-MDW-WHI-05');
  assert.equal(hit.store, 'Arnesh');
});

test('Elda Need to Create is Decide, with Tabanan quantity and the sheet suggestion', () => {
  const w = build(feedWith(), products, NOW).work;
  const line = w.items.decide.find((x) => x.invoice === 'SDTNov26-7');
  assert.ok(line);
  assert.equal(line.sku, 'SDT-ARS-DAR-ONESIZ');
  assert.equal(line.tabananQty, 3);
  assert.equal(line.suggested, 'FROM SHELF');
  assert.deepEqual(line.moves.map((m) => m.to), DECIDE_MOVES.map((m) => m[0]));
  assert.deepEqual(line.moves.map((m) => m.label), DECIDE_MOVES.map((m) => m[1]));
  assert.equal(w.items.make.some((x) => x.invoice === 'SDTNov26-7'), false);
});

test('a blank-payment manual line is on Ready to Buy, tagged, with supplier and origin', () => {
  const out = build(feedWith(), products, NOW);
  assert.equal(out.orders.find((o) => o.invoice === 'SDTNov26-1').paymentNotConfirmed, true);
  const buy = out.work.items.buy.find((x) => x.invoice === 'SDTNov26-1');
  assert.ok(buy);
  assert.equal(buy.paymentNotConfirmed, true);
  assert.equal(buy.supplier, 'Arnesh');
  assert.equal(buy.originUrl, 'https://supplier.example/manta-white');
  assert.equal(buy.qty, 2);
});

test('a blank Shopee line is Ready to Buy only when the product source is third party', () => {
  const out = build(feedWith(), products, NOW);
  const yes = out.work.items.buy.find((x) => x.invoice === 'SHP-BLANK-3RD');
  const no = out.work.items.buy.find((x) => x.invoice === 'SHP-BLANK-OURS');
  assert.ok(yes);
  assert.equal(yes.reason, 'source');
  assert.equal(yes.supplier, 'SHOPEE LINK');
  assert.equal(yes.originUrl, 'https://shopee.example/headband');
  assert.equal(no, undefined);
  assert.equal(wantsBuy({ channel: 'shopee' }, { physical: true, group: 'blank', thirdParty: false, title: 'x', item: 'x', detail: [] }), false);
});

test('the four decision targets are the only moves from a new line', () => {
  for (const from of ['', 'pending', 'need to create']) {
    assert.deepEqual(WORK_FROM[from], DECIDE_MOVES.map((m) => m[0]));
  }
  assert.equal(WORK_FROM['need to create'].includes('Ready to be shipped'), true);
  assert.equal(WORK_FROM['in the making'].includes('Ready Stock'), false);
});

test('an order that is entirely Ready Stock tells Pack and ship that only the tracking number is left', () => {
  const f = feedWith();
  const manual = f.tabs['MANUAL (IG & WA) - OL'];
  const elda = manual.find((r) => r.cells.B && r.cells.B.d === 'SDTNov26-7');
  elda.cells.J = C('Ready Stock');
  const out = build(f, products, NOW);
  const o = out.orders.find((x) => x.invoice === 'SDTNov26-7');
  assert.equal(o.fromReadyStock, true);
  assert.equal(o.stage, 'ready');
  assert.equal(out.work.items.decide.some((x) => x.invoice === 'SDTNov26-7'), false);
});
