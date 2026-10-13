// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, readTab } from '../api/_sd-business.js';
import { feed, products } from './fixture-feed.mjs';

const NOW = new Date('2026-10-13T02:00:00Z');
const out = build(feed, products, NOW);
const by = (inv) => out.orders.find((o) => o.invoice === inv);

test('both tabs are read by header, not by column letter', () => {
  assert.equal(out.sources.shopify.ok, true, out.sources.shopify.error);
  assert.equal(out.sources.manual.ok, true, out.sources.manual.error);
});

test('Shopify: paid and unfulfilled shows, refunded, cancelled and fulfilled do not', () => {
  assert.ok(by('#1065'));
  assert.ok(by('#1069'));
  assert.ok(by('#1071'));
  assert.equal(by('#1003'), undefined, 'refunded and cancelled');
  assert.equal(by('#1070'), undefined, 'already fulfilled');
});

test('Shopify order whose products are all DONE is flagged to close in Shopify', () => {
  assert.equal(by('#1025').stage, 'close_in_shopify');
});

test('Manual: paid or deposit with an unfinished product shows', () => {
  assert.ok(by('SDTMar26-2'));
  assert.ok(by('SDTJun26-23'));
  assert.ok(by('SDTSep26-14'), 'a deposit counts as paid');
});

test('Manual: waiting for payment, shipped, all DONE and QA rows are left out', () => {
  assert.equal(by('SDTOct26-01'), undefined, 'not paid yet');
  assert.equal(by('SDTOct26-02'), undefined, 'ticked Shipped');
  assert.equal(by('18'), undefined, 'every product DONE');
  assert.equal(out.orders.some((o) => /^QA/i.test(o.invoice)), false);
});

test('DONE lines are hidden on an open order, everything else stays', () => {
  const emily = by('SDTMar26-2');
  assert.equal(emily.lines.length, 5);
  assert.equal(emily.doneCount, 1);
  assert.equal(emily.lines.some((l) => /Rashguard/.test(l.title)), false);
});

test('stages: all ready, partly ready, in production, no status', () => {
  assert.equal(by('SDTMay26-6').stage, 'ready');
  assert.equal(by('SDTMar26-2').stage, 'partly');
  assert.equal(by('SDTJun26-23').stage, 'production');
  assert.equal(by('#1071').stage, 'not_set');
  assert.equal(out.orders[0].stage, 'ready', 'ready to pack comes first');
});

test('quantity is read from the Qty column next to each product', () => {
  assert.equal(by('#1069').lines[1].qty, 2);
  assert.equal(by('SDTMar26-2').lines[0].qty, 1);
});

test('the first line of a cell is the product, the rest is detail', () => {
  const l = by('SDTMar26-2').lines[0];
  assert.equal(l.title, 'Tears of Thalassa Earrings');
  assert.deepEqual(l.detail, ['Earring design: Sun Gold']);
});

test('Shopify photo: the variant photo when the variant is known', () => {
  const l = by('#1071').lines[0];
  assert.equal(l.photo.how, 'exact');
  assert.match(l.photo.url, /white-doff/);
  const chain = by('#1069').lines[0];
  assert.equal(chain.photo.url, 'https://cdn.shopify.com/224.jpg');
});

test('Shopify photo: product photo, labelled, when the variant has none of its own', () => {
  const l = by('#1069').lines[1];
  assert.equal(l.photo.how, 'product');
});

test('Manual photo: from the product list, reading design lines under the name', () => {
  assert.equal(by('SDTMar26-2').lines[0].photo.url, 'https://lh7-rt.example/thalassa-sun');
  assert.equal(by('SDTMar26-2').lines[3].photo.url, 'https://lh7-rt.example/socks-long-lola');
  assert.equal(by('SDTJun26-23').lines[1].photo.url, 'https://lh7-rt.example/kaia-unicorn');
  assert.equal(by('SDTJun26-23').lines[2].photo.url, 'https://lh7-rt.example/tail-ariel89');
});

test('no guessing: an unclear name gets no photo rather than a wrong one', () => {
  assert.equal(by('#1065').lines[0].photo, null, 'Starfish must not borrow the Shell photo');
  assert.equal(by('SDTMar27-4').lines[0].photo, null, 'Blue Mythic socks must not borrow Lola');
});

test('newest Shopify order in the sheet is reported, so a stalled sync shows', () => {
  assert.deepEqual(out.sources.shopify.newest, { invoice: '#1071', date: '2026-09-18' });
});

test('a renamed column refuses that tab by name and keeps the other', () => {
  const broken = JSON.parse(JSON.stringify(feed));
  broken.tabs['SHOPIFY-OL'][1].cells.G = { d: 'Fulfilment', v: 'Fulfilment' };
  const o = build(broken, products, NOW);
  assert.equal(o.sources.shopify.ok, false);
  assert.match(o.sources.shopify.error, /Fulfillment Status/);
  assert.equal(o.sources.manual.ok, true);
  assert.ok(o.orders.length > 0);
});

test('a missing tab says so', () => {
  const t = readTab('manual', [], NOW);
  assert.equal(t.ok, false);
});
