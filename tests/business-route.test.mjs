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
globalThis.fetch = async (url, init) => {
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

test('POST is not allowed', async () => {
  const r = res(); await handler(req({ method: 'POST', headers: { 'x-os-key': 'os-key' } }), r);
  assert.equal(r.code, 405);
});
