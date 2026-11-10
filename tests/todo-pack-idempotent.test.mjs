// A pack click whose page was already written must not create a second one.
// The list route gives up after 4 seconds, and a claim with no page id is
// handed out again after 10 minutes. Run: node --test tests/todo-pack-idempotent.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NOTION_TOKEN = 'notion-test';
let mode = 'existing';
const calls = [];
globalThis.fetch = async (url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: init && init.method, body });
  if (String(url).includes('/query')) {
    const results = mode === 'existing' ? [{ id: 'page-existing', archived: false }] : mode === 'trash' ? [{ id: 'page-gone', archived: false, in_trash: true }] : [];
    return { ok: true, status: 200, json: async () => ({ results }) };
  }
  return { ok: true, status: 200, json: async () => ({ object: 'page', id: 'new-page' }) };
};

const { logPacks } = await import('../api/_todo-pack.js');
const click = { click_id: 'c1', at: '2026-11-10T02:00:00Z', src: 'MANUAL (IG & WA) - OL', invoice: 'SDTNov26-1', customer: 'A', via: 'befalia-os', items: [] };

async function run() {
  calls.length = 0;
  const packCalls = [];
  const out = await logPacks(async (p) => {
    packCalls.push(p);
    if (p.action === 'todo_claim') return { ok: true, clicks: [click] };
    return { ok: true };
  }, '2026-11-10');
  return { out, packCalls };
}

test('an existing pack page is linked and no second page is created', async () => {
  mode = 'existing';
  const { out, packCalls } = await run();
  assert.equal(out.logged, 1);
  assert.equal(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pages')), false);
  assert.equal(calls.find((c) => c.url.includes('/query')).body.filter.and[0].title.equals, 'Packed SDTNov26-1 · A');
  assert.deepEqual(packCalls[1].items, [{ click_id: 'c1', page_id: 'pageexisting' }]);
});

test('a trashed match is not reused, so the click gets one new page', async () => {
  mode = 'trash';
  const { out, packCalls } = await run();
  assert.equal(out.logged, 1);
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pages')).length, 1);
  assert.deepEqual(packCalls[1].items, [{ click_id: 'c1', page_id: 'newpage' }]);
});

test('no matching page means one create', async () => {
  mode = 'none';
  const { out } = await run();
  assert.equal(out.logged, 1);
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pages')).length, 1);
});
