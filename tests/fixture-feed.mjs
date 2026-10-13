// A small slice of the real feed, 13 Oct 2026, cut down by hand. Customer names
// are replaced with placeholders because this repo is public. Header rows are
// exactly as the sheet holds them. Photo links are shortened placeholders.
const C = (v) => ({ d: String(v), v });
const row = (row_no, o) => ({ row_no, cells: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, C(v)])) });

const shopHead = {};
['I','P','W','AD','AK','AR'].forEach((s) => { shopHead[s] = 'Status Produksi'; });
Object.assign(shopHead, { A: 'Invoice no', C: 'Customer Name', D: 'Created at', F: 'Financial Status', G: 'Fulfillment Status',
  L: '1. Item / Description', M: 'Qty', S: '2. Item / Description', T: 'Qty', Z: '3. Item / Description', AA: 'Qty',
  AG: '4. Item / Description', AH: 'Qty', AN: '5. Item / Description', AO: 'Qty', AU: '6. Item / Description', AV: 'Qty',
  CX: 'Cancelled at', DS: 'Shipping Country' });

export const feed = {
  ok: true,
  loaded: { 'SHOPIFY-OL': '2026-10-12T18:46:50Z', 'MANUAL (IG & WA) - OL': '2026-10-13T01:46:44Z' },
  tabs: {
    'SHOPIFY-OL': [
      row(1, { I: 'ITEM 1', P: 'ITEM 2' }),
      row(3, shopHead),
      row(6, { A: '#1003', C: 'Customer A', D: '2023-02-27 03:52:42 +0700', F: 'refunded', G: 'unfulfilled', I: 'DONE', L: 'Shell Dive Weight 0.5kg / 1.1 lbs - White', M: 1, CX: '2023-03-06 23:38:42 +0700', DS: 'US' }),
      row(28, { A: '#1025', C: 'Customer B', D: '2024-04-16 17:55:31 +0700', F: 'paid', G: 'unfulfilled', I: 'DONE', L: 'Shell Dive Weight 0.5kg / 1.1 lbs - Pink - Purple', M: 1, P: 'DONE', S: 'Transparent dive belt - Stainless steel', T: 1, DS: 'US' }),
      row(74, { A: '#1065', C: 'Customer C', D: '2026-08-28 19:29:06 +0700', F: 'paid', G: 'unfulfilled', I: 'Order from 3rd Party', L: 'Starfish Dive Weight 1 kg / 2.2 lbs - Purple - Glossy', M: 2, P: 'Ready to be shipped', S: 'Shell Dive Weight 0.5kg / 1.1 lbs - Grey -  Glossy', T: 1, DS: 'JP' }),
      row(79, { A: '#1069', C: 'Customer D', D: '2026-09-07 11:37:24 +0700', F: 'paid', G: 'unfulfilled', I: 'Order from 3rd Party', L: 'Diving Counterweight Waist Chain - Purple Ocean', M: 1, P: 'Order from 3rd Party', S: 'Shell Dive Weight 1 kg / 2.2 lbs - Purple - Glossy', T: 2, DS: 'US' }),
      row(80, { A: '#1070', C: 'Customer E', D: '2026-09-11 07:35:12 +0700', F: 'paid', G: 'fulfilled', I: 'DONE', L: 'Manta Dive Weight 1 KG / 2.2 lbs - White', M: 2, DS: 'JP' }),
      row(81, { A: '#1071', C: 'Customer F', D: '2026-09-18 10:22:38 +0700', F: 'paid', G: 'unfulfilled', L: 'Shell Dive Weight 1 kg / 2.2 lbs - White - Doff (BEST SELLER)', M: 2, S: 'Transparent dive belt - Black Buckle - 2', T: 1, Z: 'Starfish Dive Weight 1 kg / 2.2 lbs - White - Glossy', AA: 1, DS: 'US' })
    ],
    'MANUAL (IG & WA) - OL': [
      row(3, { D: 'Invoice Date', J: 'Status Produksi', M: '1. Item / Description', N: 'Qty', T: 'Status Produksi', W: '2. Item / Description', X: 'QTY',
        AD: 'Status Produksi', AG: '3. Item / Description', AH: 'QTY', AN: 'Status Produksi', AQ: '4. Item / Description', AR: 'QTY',
        AX: 'Status Produksi', BA: '5. Item / Description', BB: 'Qty', BH: 'Status Produksi', BK: '6. Item / Description', BL: 'Qty',
        FW: 'All product ready to be shipped', FZ: 'Shipped' }),
      row(4, { A: 'Production\nPayment \nStatus', B: 'Invoice No', C: 'Name' }),
      row(5, { A: 2023 }),
      row(6, { A: 'PAID', B: 18, C: 'Customer G', D: '2023-12-19T17:00:00.000Z', J: 'DONE', M: 'Mahina Mermaid 40-42 Frankie Willow', N: 1 }),
      row(244, { A: 'PAID', B: 'SDTMar27-4', C: 'Customer H', D: '2026-03-06T17:00:00.000Z', M: 'Dive Socks - Short - Blue Mythic', N: 1, FZ: false }),
      row(275, { A: 'PAID', B: 'SDTMar26-2', C: 'Customer I', D: '2026-03-04T17:00:00.000Z',
        J: 'Ready to be shipped', M: 'Tears of Thalassa Earrings\nEarring design: Sun Gold', N: 1,
        T: 'Order from 3rd Party', W: 'Ocean Spark Necklace\nNecklace design: Pink Starfish Ocean Spark Necklace', X: 1,
        AD: 'Need to Create', AG: 'Mermaid Temporary Tattoo\nColor: Orange\nSize: Small pack', AH: 1,
        AN: 'Shipping Process', AQ: 'Dive Socks - Lola\nSize: Long', AR: 1,
        AX: 'DONE', BA: 'Custom Rashguard\nSize: XS', BB: 1,
        BH: 'Ready to be shipped', BK: 'Sunglasses Case - Mermaid Tail shape\nColor: Jogja', BL: 1, FZ: false }),
      row(282, { A: 'PAID', B: 'SDTJun26-23', C: 'Customer J', D: '2026-06-28T17:00:00.000Z',
        J: 'Design Needs to Be Made', M: 'Shell Dive Weight 1 kg / 2.2 lbs - Pink Glossy', N: 1,
        T: 'Design Needs to Be Made', W: 'Kaia Bottom - Unicorn - M', X: 1,
        AD: 'Printing', AG: 'Mermaid Tail Adult - Ariel 1989', AH: 1, FZ: false }),
      row(283, { A: 'PAID', B: 'SDTMay26-6', C: 'Customer K', D: '2026-05-05T17:00:00.000Z',
        J: 'Ready to Send', M: 'Mermaid Tail - Custom - Adult', N: 1, T: 'Ready to Send', W: 'Custom Design - Top', X: 1 }),
      row(290, { A: 'WAITING FOR PAYMENT', B: 'SDTOct26-01', C: 'Not Paid Yet', D: '2026-10-01T16:00:00.000Z', J: 'Design in Progress', M: 'Headband - Noctara', N: 1 }),
      row(291, { A: 'PAID', B: 'SDTOct26-02', C: 'Shipped Already', D: '2026-10-02T16:00:00.000Z', J: 'Shipping Process', M: 'Headband - Noctara', N: 1, FZ: true }),
      row(299, { A: 'Deposit', B: 'SDTSep26-14', C: 'Customer L', D: '2026-09-22T17:00:00.000Z', T: 'Order from 3rd Party', W: 'Manta dive Weight 0,5 KG/ Black', X: 1, AG: 'Custom Color', AH: 1 }),
      row(300, { A: 'PAID', B: 'QA-TEST-1', C: 'DIVEARTS CEO QA Test - IGNORE', D: '2026-10-02T16:00:00.000Z', J: 'Printing', M: 'Headband - Noctara', N: 1 })
    ]
  },
  photos: [
    { name: 'Shell Dive Weight 1 kg / 2.2 lbs - Pink', category: 'Shell Dive Weight', photo: 'https://lh7-rt.example/pink' },
    { name: 'Shell Dive Weight 1 kg / 2.2 lbs - Pink - Purple', category: 'Shell Dive Weight', photo: 'https://lh7-rt.example/pinkpurple' },
    { name: 'Kaia Bottom - Unicorn', category: 'Kaia Bottom', photo: 'https://lh7-rt.example/kaia-unicorn' },
    { name: 'Kaia Bottom - Ursula', category: 'Kaia Bottom', photo: 'https://lh7-rt.example/kaia-ursula' },
    { name: 'Mermaid Tail - Ariel 1989', category: 'Mermaid Tail', photo: 'https://lh7-rt.example/tail-ariel89' },
    { name: 'Breeze Top - Ariel 1989', category: 'Breeze Top', photo: 'https://lh7-rt.example/breeze-ariel89' },
    { name: 'Tears of Thalassa Sun Gold', category: 'Tears of Thalassa', photo: 'https://lh7-rt.example/thalassa-sun' },
    { name: 'Tears of Thalassa Moon Silver', category: 'Tears of Thalassa', photo: 'https://lh7-rt.example/thalassa-moon' },
    { name: 'Dive Socks Long - Lola', category: 'Dive Socks', photo: 'https://lh7-rt.example/socks-long-lola' },
    { name: 'Dive Socks Short - Lola', category: 'Dive Socks', photo: 'https://lh7-rt.example/socks-short-lola' },
    { name: 'Headband - Noctara', category: 'Headband', photo: 'https://lh7-rt.example/headband-noctara' }
  ]
};

export const products = [
  { title: 'Shell Dive Weight 1 kg / 2.2 lbs', handle: 'shell-1kg', images: [{ src: 'https://cdn.shopify.com/shell-1kg.jpg' }],
    variants: [{ title: 'White / Doff (BEST SELLER)', featured_image: { src: 'https://cdn.shopify.com/shell-1kg-white-doff.jpg' } },
               { title: 'Purple / Glossy', featured_image: null }] },
  { title: 'Diving Counterweight Waist Chain', handle: 'coral-sunset-dive-weight-waist-chain', images: [{ src: 'https://cdn.shopify.com/chain.jpg' }],
    variants: [{ title: 'Coral Sunset', featured_image: { src: 'https://cdn.shopify.com/226.jpg' } },
               { title: 'Purple Ocean', featured_image: { src: 'https://cdn.shopify.com/224.jpg' } }] },
  { title: 'Transparent dive belt', handle: 'belt', images: [{ src: 'https://cdn.shopify.com/belt.jpg' }],
    variants: [{ title: 'Black Buckle / 2', featured_image: null }, { title: 'Stainless steel', featured_image: null }] }
];
