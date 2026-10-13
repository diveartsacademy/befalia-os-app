// Shopee and Tokopedia/TikTok header rows as the sheet holds them (13 Oct 2026),
// with made up orders, plus pack marks as the database feed returns them.
// Names and order numbers are placeholders: this repo is public.
import { feed as base } from './fixture-feed.mjs';

const C = (v) => ({ d: String(v), v });
const row = (row_no, o) => ({ row_no, cells: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, C(v)])) });

const shopee2 = { A: 'SHOPEE INVOICE', D: 'Invoice Date', E: 'Batas Pengiriman' };
const shopee3 = { A: 'Production Payment Status', B: 'No Pesanan', C: 'Name' };
[['F', 'I', 'J'], ['O', 'R', 'S'], ['X', 'AA', 'AB'], ['AG', 'AJ', 'AK'], ['AP', 'AS', 'AT'], ['AY', 'BB', null]].forEach((x, i) => {
  shopee2[x[0]] = 'Status Produksi'; shopee2[x[1]] = (i + 1) + '. Item / Description'; if (x[2]) shopee2[x[2]] = 'Qty';
});
const toko3 = { A: 'Status Payment', B: 'Invoice Month No', C: 'Name', D: 'Invoice Date', E: 'Batas Pengiriman' };
[['F', 'I', 'J'], ['O', 'R', 'S'], ['X', 'AA', 'AB'], ['AG', 'AJ', 'AK'], ['AP', 'AS', 'AT']].forEach((x, i) => {
  toko3[x[0]] = 'Status Produksi'; toko3[x[1]] = (i + 1) + '. Item / Description'; toko3[x[2]] = 'Qty';
});

export const feed = JSON.parse(JSON.stringify(base));
feed.tabs['SHOPEE - OL'] = [
  row(1, { F: 'ITEM 1', O: 'ITEM 2' }),
  row(2, shopee2),
  row(3, shopee3),
  row(4, { A: 2025 }),
  row(5, { A: true, B: 'SHP-OLD-DONE', C: 'buyer1', D: '2025-02-19', F: 'done', I: 'Ariel Mermaid Tail (2023) - Kids', J: 1 }),
  row(40, { A: true, B: 'SHP-OLD-BLANK', C: 'buyer2', D: '2026-05-01', I: 'Headband - Noctara', J: 1 }),
  row(300, { A: true, B: 'SHP-NEW-BLANK', C: 'buyer3', D: '2026-10-05', E: '2026-10-14', I: 'Headband - Noctara', J: 1 }),
  row(301, { A: true, B: 'SHP-3RD', C: 'buyer4', D: '1-Oct-26', E: '2026-10-11', F: 'Order from 3rd Party', I: 'Diving Counterweight Waist Chain - Purple Ocean', J: 1,
    O: 'Ready to be shipped', R: 'Transparent dive belt - Stainless steel', S: 1 })
];
feed.tabs['TOKOPEDIA/TIKTOK shop -OL'] = [
  row(1, { A: 'TOKOPEDIA/ TIKTOK SHOP', F: 'ITEM 1' }),
  row(3, toko3),
  row(4, { B: 2025 }),
  row(37, { A: true, B: 'TOK-1', C: 'buyer5', D: '08 May 2026', F: 'Order from 3rd Party', I: 'Shell Dive Weight 1 kg / 2.2 lbs - White - Doff (BEST SELLER)', J: 1 })
];
feed.loaded['SHOPEE - OL'] = '2026-10-12T18:46:50Z';
feed.loaded['TOKOPEDIA/TIKTOK shop -OL'] = '2026-10-12T18:46:50Z';

// SDTMar26-2 slots 1 and 4 packed from the Sea Diva dashboard; #1069 fully packed
// (both slots) in Befalia OS; one mark on a line that is DONE since is ignored.
feed.marks = [
  { id: 11, click_id: '11111111-1111-1111-1111-111111111111', src: 'MANUAL (IG & WA) - OL', invoice: 'SDTMar26-2', slot: 1, row: 275,
    at: '2026-10-13T01:30:00Z', by: 'Befa', via: 'seadiva', write: 'queued', written: true, writeError: null, todo: true },
  { id: 12, click_id: '11111111-1111-1111-1111-111111111111', src: 'MANUAL (IG & WA) - OL', invoice: 'SDTMar26-2', slot: 3, row: 275,
    at: '2026-10-13T01:30:00Z', by: 'Befa', via: 'seadiva', write: 'person_word', written: false, writeError: null, todo: true },
  { id: 13, click_id: '22222222-2222-2222-2222-222222222222', src: 'SHOPIFY-OL', invoice: '#1069', slot: 1, row: 79,
    at: '2026-10-12T15:00:00Z', by: 'Befa', via: 'befalia-os', write: 'waiting_bridge', written: false, writeError: null, todo: false },
  { id: 14, click_id: '22222222-2222-2222-2222-222222222222', src: 'SHOPIFY-OL', invoice: '#1069', slot: 2, row: 79,
    at: '2026-10-12T15:00:00Z', by: 'Befa', via: 'befalia-os', write: 'waiting_bridge', written: false, writeError: null, todo: false },
  { id: 15, click_id: '33333333-3333-3333-3333-333333333333', src: 'MANUAL (IG & WA) - OL', invoice: 'SDTMar26-2', slot: 5, row: 275,
    at: '2026-10-10T01:30:00Z', by: 'rie@example.com', via: 'seadiva', write: 'queued', written: true, writeError: null, todo: false }
];
