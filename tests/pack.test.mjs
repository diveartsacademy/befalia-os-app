// Shopee, Tokopedia/TikTok and the pack marks (13 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../api/_sd-business.js';
import { taskFor, witaDay } from '../api/_todo-pack.js';
import { feed } from './fixture-pack.mjs';
import { products } from './fixture-feed.mjs';

const NOW = new Date('2026-10-13T02:00:00Z');
const out = build(feed, products, NOW);
const by = (inv) => out.orders.find((o) => o.invoice === inv);

test('Shopee and Tokopedia/TikTok tabs are read by header', () => {
  assert.equal(out.sources.shopee.ok, true, out.sources.shopee.error);
  assert.equal(out.sources.toko.ok, true, out.sources.toko.error);
});

test('marketplace: open product shows, DONE and old blank rows do not, new blank rows ask for a status', () => {
  assert.ok(by('SHP-3RD'));
  assert.ok(by('TOK-1'));
  assert.equal(by('SHP-OLD-DONE'), undefined);
  assert.equal(by('SHP-OLD-BLANK'), undefined, 'blank and older than 45 days: long delivered');
  assert.equal(by('SHP-NEW-BLANK').stage, 'not_set');
  assert.equal(by('SHP-3RD').stage, 'partly');
  assert.equal(by('SHP-3RD').channel, 'shopee');
});

test('marketplace ship-by date and days left', () => {
  const o = by('SHP-3RD');
  assert.equal(o.shipBy, '2026-10-11');
  assert.equal(o.shipByDays, -2, 'two days late');
  assert.equal(by('SHP-NEW-BLANK').shipByDays, 1);
});

test('every order carries its tab and row, every line its slot, for the pack button', () => {
  const o = by('SDTMar26-2');
  assert.equal(o.src, 'MANUAL (IG & WA) - OL');
  assert.equal(o.row, 275);
  assert.deepEqual(o.lines.map((l) => l.slot), [1, 2, 3, 4, 6]);
});

test('a packed line shows the mark and cannot be packed again', () => {
  const l = by('SDTMar26-2').lines.find((x) => x.slot === 1);
  assert.equal(l.packed.id, 11);
  assert.equal(l.packed.by, 'Befa');
  assert.equal(l.packed.written, true);
  assert.equal(l.canPack, false);
  const open = by('SDTMar26-2').lines.find((x) => x.slot === 2);
  assert.equal(open.packed, null);
  assert.equal(open.canPack, true);
});

test('a mark on a line that is DONE in the sheet since is ignored', () => {
  assert.equal(by('SDTMar26-2').lines.some((l) => l.slot === 5), false);
});

test('a packed line counts as ready; all physical lines packed means stage packed', () => {
  assert.equal(by('#1069').stage, 'packed');
  assert.ok(by('#1069').lines.every((l) => l.packed && !l.canPack));
  assert.notEqual(by('SDTMar26-2').stage, 'packed');
});

test('packed orders sort after the ones still to pack', () => {
  const i = out.orders.findIndex((o) => o.stage === 'packed');
  const j = out.orders.findIndex((o) => o.stage === 'ready');
  assert.ok(j < i);
});

test('non-physical lines never get a pack button', () => {
  const l = by('SDTSep26-14').lines.find((x) => /custom color/i.test(x.title));
  assert.equal(l.canPack, false);
  assert.equal(l.physical, false);
});

test('counts: per shop, packed lines, packed today in Bali time', () => {
  assert.equal(out.counts.shopee, 2);
  assert.equal(out.counts.toko, 1);
  assert.equal(out.counts.packed, 1);
  assert.equal(out.counts.packedLines, 4);
  assert.equal(out.counts.packedToday, 2, '01:30 UTC on 13 Oct is 13 Oct in Bali; 15:00 UTC on 12 Oct is 12 Oct 23:00 in Bali');
});

test('To-Do task: name, area, done, and the day of the click in Bali', () => {
  const t = taskFor({ src: 'SHOPEE - OL', invoice: 'SHP-3RD', customer: 'buyer4', via: 'seadiva', at: '2026-10-12T17:30:00Z',
                      items: ['Diving Counterweight Waist Chain - Purple Ocean\nColor: x', 'Belt'] });
  assert.equal(t.name, 'Packed Shopee SHP-3RD · buyer4');
  assert.equal(t.area, 'Sea Diva');
  assert.equal(t.done, true);
  assert.equal(t.completedOn, '2026-10-13');
  assert.match(t.notes, /^2 products: Diving Counterweight Waist Chain - Purple Ocean; Belt\. Marked .* Sea Diva dashboard\.$/);
  assert.equal(taskFor({ src: 'MANUAL (IG & WA) - OL', invoice: 'SDTOct26-3', items: [] }).name, 'Packed SDTOct26-3');
  assert.equal(witaDay('2026-10-12T15:59:00Z'), '2026-10-12');
  assert.equal(witaDay('2026-10-12T16:00:00Z'), '2026-10-13');
});
