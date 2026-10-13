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

test('marketplace: open product shows, DONE does not, old blank rows get their own tile, new blank rows ask for a status', () => {
  assert.ok(by('SHP-3RD'));
  assert.ok(by('TOK-1'));
  assert.equal(by('SHP-OLD-DONE'), undefined);
  assert.equal(by('SHP-OLD-BLANK').stage, 'old_no_status', 'blank and older than 45 days: shown under its own tile, not hidden (Befa, 14 Oct)');
  assert.equal(out.counts.all, out.orders.filter((o) => o.stage !== 'old_no_status').length, 'All leaves the old no-status ones out');
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

test('in-the-box ticks land on their own product line only', () => {
  const f = JSON.parse(JSON.stringify(feed));
  f.ticks = [{ src: 'MANUAL (IG & WA) - OL', invoice: 'SDTMar26-2', slot: 2, at: '2026-10-13T14:00:00Z', by: 'Befa' }];
  const o = build(f, products, NOW).orders.find((x) => x.invoice === 'SDTMar26-2');
  assert.equal(o.lines.find((l) => l.slot === 2).inBox.by, 'Befa');
  assert.equal(o.lines.filter((l) => l.inBox).length, 1);
});

test('an order marked Already shipped leaves the list and shows under recently shipped', () => {
  const f = JSON.parse(JSON.stringify(feed));
  f.shipped = [{ id: 3, src: 'SHOPEE - OL', invoice: 'SHP-3RD', at: '2026-10-13T01:00:00Z', by: 'Befa', customer: 'buyer4', lines: 2, byHand: 2 },
               { id: 2, src: 'MANUAL (IG & WA) - OL', invoice: 'SDTJun26-23', at: '2026-09-01T01:00:00Z', by: 'Befa', lines: 3, byHand: 0 }];
  const r = build(f, products, NOW);
  assert.equal(r.orders.find((o) => o.invoice === 'SHP-3RD'), undefined);
  assert.equal(r.orders.find((o) => o.invoice === 'SDTJun26-23'), undefined, 'old marks still hide the order');
  assert.equal(r.counts.shippedHidden, 2);
  assert.deepEqual(r.shipped.map((k) => k.invoice), ['SHP-3RD'], 'only the last three days are listed for Undo');
});

test('a product note lands on its own line, and an empty note is no note', () => {
  const f = JSON.parse(JSON.stringify(feed));
  f.notes = [{ src: 'MANUAL (IG & WA) - OL', invoice: 'SDTMar26-2', slot: 4, note: 'Changed to size M after checkout', at: '2026-10-13T14:30:00Z', by: 'Befa' },
             { src: 'MANUAL (IG & WA) - OL', invoice: 'SDTMar26-2', slot: 2, note: '   ', by: 'Befa' }];
  const o = build(f, products, NOW).orders.find((x) => x.invoice === 'SDTMar26-2');
  assert.equal(o.lines.find((l) => l.slot === 4).note.text, 'Changed to size M after checkout');
  assert.equal(o.lines.find((l) => l.slot === 2).note, null);
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

test('pickup or send: a packed order moves to Waiting for pickup or To send; not before it is packed', () => {
  const f = JSON.parse(JSON.stringify(feed));
  f.handoff = [{ src: 'SHOPIFY-OL', invoice: '#1069', method: 'send', at: '2026-10-13T14:40:00Z', by: 'Befa' },
               { src: 'MANUAL (IG & WA) - OL', invoice: 'SDTMar26-2', method: 'pickup', by: 'Befa' }];
  let r = build(f, products, NOW);
  const o = r.orders.find((x) => x.invoice === '#1069');
  assert.equal(o.stage, 'to_send');
  assert.equal(o.handoff.method, 'send');
  assert.equal(r.counts.to_send, 1);
  assert.notEqual(r.orders.find((x) => x.invoice === 'SDTMar26-2').stage, 'pickup', 'only a fully packed order changes stage');
  f.handoff[0].method = 'pickup';
  r = build(f, products, NOW);
  assert.equal(r.orders.find((x) => x.invoice === '#1069').stage, 'pickup', 'the Sea Diva dashboard still lists it');
  assert.equal(r.counts.pickup, 1);
  r = build(f, products, NOW, { hidePickup: true });
  assert.equal(r.orders.find((x) => x.invoice === '#1069'), undefined, 'Befalia OS does not list pickup orders');
  assert.equal(r.counts.pickupHidden, 1);
  f.handoff[0].method = 'none';
  assert.equal(build(f, products, NOW).orders.find((x) => x.invoice === '#1069').stage, 'packed', 'none clears the choice');
});

test('To send sorts after packed-without-a-choice and before pickup', () => {
  const f = JSON.parse(JSON.stringify(feed));
  f.handoff = [{ src: 'SHOPIFY-OL', invoice: '#1069', method: 'send' }];
  const r = build(f, products, NOW);
  const i = r.orders.findIndex((o) => o.stage === 'to_send');
  const j = r.orders.findIndex((o) => o.stage === 'ready');
  assert.ok(j < i);
});

test('TailCraft: paid invoices are listed from the invoice lines, by project stage', () => {
  const f = JSON.parse(JSON.stringify(feed));
  f.tailcraft = [
    { invoice: 'INV-TC-AUG26-1', customer: 'Customer TC', project: 'TC-2026-002', stage: 'deposit_paid', stage_label: 'Paid, Process Order',
      date: '2026-07-31', country: 'Bali', pay: 'paid', lines: [{ slot: 1, title: 'TailCraft Mermaid Tail, Dark Pink Patra', qty: 1 }, { slot: 2, title: 'Swimmable Corset', qty: 1 }] },
    { invoice: 'INV-TC-X', customer: 'Customer TX', project: 'TC-2026-099', stage: 'ready_ship', stage_label: 'Ready to be shipped',
      date: '2026-09-01', pay: 'paid', lines: [{ slot: 1, title: 'TailCraft Mermaid Tail, Test', qty: 1 }] }];
  f.marks = (f.marks || []).concat([{ id: 99, click_id: 'c-tc', src: 'TAILCRAFT', invoice: 'INV-TC-X', slot: 1, at: '2026-10-13T01:00:00Z', by: 'Befa', write: 'tailcraft' }]);
  const r = build(f, products, NOW);
  const a = r.orders.find((o) => o.invoice === 'INV-TC-AUG26-1');
  assert.equal(a.channel, 'tailcraft');
  assert.equal(a.src, 'TAILCRAFT');
  assert.equal(a.row, 0);
  assert.equal(a.stage, 'production', 'still being made');
  assert.deepEqual(a.lines.map((l) => l.title), ['TailCraft Mermaid Tail, Dark Pink Patra', 'Swimmable Corset'], 'follows the invoice');
  assert.ok(a.lines.every((l) => l.photo === null && l.canPack));
  assert.equal(r.orders.find((o) => o.invoice === 'INV-TC-X').stage, 'packed');
  assert.equal(r.counts.tailcraft, 2);
});

test('TailCraft: a feed without TailCraft still builds (older feeds)', () => {
  const r = build(feed, products, NOW);
  assert.equal(r.counts.tailcraft, 0);
  assert.equal(r.sources.tailcraft, undefined);
});
