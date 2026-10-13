// The /api/business route with fetch mocked: the gate, the missing key, a
// refused feed, a broken storefront, and a good answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { feed, products } from './fixture-feed.mjs';

function res() {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
const req = (o = {}) => ({ method: 'GET', headers: {}, query: {}, ...o });

let mode = 'ok';
const calls = [];
let packAnswer = {};
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.notion.com/')) {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ notion: String(url).slice(25), method: init.method, body });
    if (init.method === 'GET') return { ok: true, status: 200, json: async () => ({ object: 'page', id: 'page-1', parent: { database_id: 'ac45a1773bfc4e3c96652745a1ea4c46' } }) };
    return { ok: true, status: 200, json: async () => ({ object: 'page', id: 'aaaa-bbbb', archived: !!(body && body.archived) }) };
  }
  if (init && init.method === 'POST' && !String(url).includes('seadivatails.com')) {
    const body = JSON.parse(init.body);
    calls.push({ pack: body.action, body });
    assert.equal(init.headers['x-feed-key'], 'feed-key-for-tests-0123456789abcdef');
    return { ok: true, status: 200, json: async () => (packAnswer[body.action] || { ok: true }) };
  }
  if (String(url).includes('seadivatails.com')) {
    if (mode === 'noshop') throw new Error('offline');
    return { ok: true, status: 200, json: async () => ({ products: String(url).includes('page=1') ? products : [] }) };
  }
  assert.equal(init.headers['x-feed-key'], 'feed-key-for-tests-0123456789abcdef');
  if (mode === 'refused') return { ok: false, status: 401, json: async () => ({ ok: false, error: 'unauthorised' }) };
  return { ok: true, status: 200, json: async () => feed };
};

process.env.OS_KEY = 'os-key';
const { default: handler } = await import('../api/business.js');

test('health check needs no key and shows booleans only', async () => {
  delete process.env.BIZ_FEED_KEY;
  const r = res(); await handler(req({ query: { check: '1' } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { ok: true, feedKeySet: false, osKeySet: true });
});

test('no OS key is refused', async () => {
  const r = res(); await handler(req(), r);
  assert.equal(r.code, 401);
});

test('missing BIZ_FEED_KEY says what to set', async () => {
  const r = res(); await handler(req({ headers: { 'x-os-key': 'os-key' } }), r);
  assert.equal(r.code, 503);
  assert.match(r.body.error, /BIZ_FEED_KEY/);
});

test('a refused feed key says how to fix it', async () => {
  process.env.BIZ_FEED_KEY = 'feed-key-for-tests-0123456789abcdef';
  mode = 'refused';
  const r = res(); await handler(req({ headers: { 'x-os-key': 'os-key' } }), r);
  assert.equal(r.code, 502);
  assert.match(r.body.error, /SQL editor/);
});

test('good answer, and storefront trouble only costs photos', async () => {
  mode = 'ok';
  const r = res(); await handler(req({ headers: { 'x-os-key': 'os-key' } }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.counts.all, 9);
  assert.equal(r.body.shopProducts, 3);
  assert.equal(r.body.photosNote, '');
});

test('PUT is not allowed', async () => {
  const r = res(); await handler(req({ method: 'PUT', headers: { 'x-os-key': 'os-key' } }), r);
  assert.equal(r.code, 405);
});

test('POST without the OS key is refused before anything is written', async () => {
  calls.length = 0;
  const r = res(); await handler(req({ method: 'POST', body: { action: 'mark' } }), r);
  assert.equal(r.code, 401);
  assert.equal(calls.length, 0);
});

test('POST mark checks its input', async () => {
  calls.length = 0;
  const r = res(); await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'mark', src: 'SOMETHING', row: 5, invoice: 'X', slots: [1] } }), r);
  assert.equal(r.code, 400);
  assert.equal(calls.length, 0);
});

test('POST mark: database first, then one done task on the To-Do, then the link back', async () => {
  process.env.NOTION_TOKEN = 'notion-test';
  calls.length = 0;
  packAnswer = {
    mark: { ok: true, click_id: '44444444-4444-4444-4444-444444444444', marked: 2, lines: [] },
    todo_claim: { ok: true, clicks: [{ click_id: '44444444-4444-4444-4444-444444444444', at: '2026-10-13T03:00:00Z', src: 'MANUAL (IG & WA) - OL',
      invoice: 'SDTMar26-2', customer: 'Customer I', via: 'befalia-os', items: ['Ocean Spark Necklace', 'Dive Socks - Lola'] }] }
  };
  const r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: JSON.stringify({ action: 'mark', src: 'MANUAL (IG & WA) - OL', row: 275, invoice: 'SDTMar26-2', slots: [2, 4] }) }), r);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.todo.logged, 1);
  assert.deepEqual(calls.map((c) => c.pack || (c.method + ' ' + c.notion)), ['mark', 'todo_claim', 'POST /pages', 'todo_set']);
  assert.deepEqual(calls[0].body.slots, [2, 4]);
  const props = calls[2].body.properties;
  assert.equal(props.Name.title[0].text.content, 'Packed SDTMar26-2 · Customer I');
  assert.equal(props.Area.select.name, 'Sea Diva');
  assert.equal(props.Done.checkbox, true);
  assert.equal(props['Completed on'].date.start, '2026-10-13');
  assert.deepEqual(calls[3].body.items, [{ click_id: '44444444-4444-4444-4444-444444444444', page_id: 'aaaabbbb' }]);
});

test('POST mark refused by the database writes nothing to the To-Do', async () => {
  calls.length = 0;
  packAnswer = { mark: { ok: false, error: 'Row 275 of MANUAL no longer holds SDTMar26-2' } };
  const r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'mark', src: 'MANUAL (IG & WA) - OL', row: 275, invoice: 'SDTMar26-2', slots: [2] } }), r);
  assert.equal(r.code, 409);
  assert.match(r.body.error, /no longer holds/);
  assert.deepEqual(calls.map((c) => c.pack || c.notion), ['mark']);
});

test('a click undone on the Sea Diva dashboard loses its To-Do task on the next load', async () => {
  process.env.NOTION_TOKEN = 'notion-test';
  calls.length = 0;
  packAnswer = { todo_claim: { ok: true, clicks: [], orphans: ['page-1'] } };
  const r = res(); await handler(req({ headers: { 'x-os-key': 'os-key' } }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.todo.removed, 1);
  assert.deepEqual(calls.filter((c) => c.pack || c.notion).map((c) => c.pack || (c.method + ' ' + c.notion)),
    ['todo_claim', 'GET /pages/page1', 'PATCH /pages/page1', 'todo_archived', 'overlay']);
});

test('POST contact asks the database for one order and checks its input', async () => {
  calls.length = 0;
  packAnswer = { contact: { ok: true, from: 'Shopify (sheet copy)', name: 'Customer C', phone: '+81 000', lines: ['1-2-3 Street', 'Tokyo 100', 'Japan'], missing: [] } };
  let r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'contact', src: 'SHOPIFY-OL', row: 74, invoice: '#1065' } }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.name, 'Customer C');
  assert.deepEqual(calls.map((c) => c.body), [{ action: 'contact', src: 'SHOPIFY-OL', row: 74, invoice: '#1065' }]);
  r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'contact', src: 'SHOPIFY-OL', invoice: '#1065' } }), r);
  assert.equal(r.code, 400, 'no row, no lookup');
});

test('POST tick sends on and off, and refuses a bad slot', async () => {
  calls.length = 0;
  packAnswer = { tick: { ok: true } };
  let r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'tick', src: 'SHOPEE - OL', invoice: 'X1', slot: 2, on: false } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls[0].body, { action: 'tick', src: 'SHOPEE - OL', invoice: 'X1', slot: 2, on: false });
  r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'tick', src: 'SHOPEE - OL', invoice: 'X1', slot: 13 } }), r);
  assert.equal(r.code, 400);
});

test('a body that arrives as a Buffer is still read (doubled content-type, 13 Oct)', async () => {
  calls.length = 0;
  packAnswer = { tick: { ok: true } };
  const r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key', 'content-type': 'application/json, application/json' },
    body: Buffer.from(JSON.stringify({ action: 'tick', src: 'SHOPEE - OL', invoice: 'X1', slot: 1, on: true })) }), r);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(calls[0].body.action, 'tick');
});

test('POST ship and unship go to the database with the order, and check input', async () => {
  calls.length = 0;
  packAnswer = { ship: { ok: true, id: 7, lines: [] }, unship: { ok: true, undone: 1 } };
  let r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'ship', src: 'SHOPEE - OL', row: 249, invoice: 'X1' } }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.id, 7);
  r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'unship', id: 7 } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls.map((c) => c.body), [{ action: 'ship', src: 'SHOPEE - OL', row: 249, invoice: 'X1' }, { action: 'unship', id: 7 }]);
  r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'ship', src: 'SHOPEE - OL', invoice: 'X1' } }), r);
  assert.equal(r.code, 400);
});

test('POST note saves one product note and refuses one that is too long', async () => {
  calls.length = 0;
  packAnswer = { note: { ok: true } };
  let r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'note', src: 'SHOPIFY-OL', invoice: '#1065', slot: 2, note: 'Grey changed to pink' } }), r);
  assert.equal(r.code, 200);
  assert.deepEqual(calls[0].body, { action: 'note', src: 'SHOPIFY-OL', invoice: '#1065', slot: 2, note: 'Grey changed to pink' });
  r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'note', src: 'SHOPIFY-OL', invoice: '#1065', slot: 2, note: 'x'.repeat(1001) } }), r);
  assert.equal(r.code, 400);
});

test('POST undo archives the To-Do task the database hands back', async () => {
  calls.length = 0;
  packAnswer = { undo: { ok: true, undone: 2, todo_pages: ['page-1'] } };
  const r = res();
  await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' }, body: { action: 'undo', click_id: '44444444-4444-4444-4444-444444444444' } }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.todo.archived, 1);
  assert.deepEqual(calls.map((c) => c.pack || (c.method + ' ' + c.notion)), ['undo', 'GET /pages/page1', 'PATCH /pages/page1', 'todo_archived']);
  delete process.env.NOTION_TOKEN;
});
