// node --test tests/wardrobe-api.test.mjs
// Exercises /api/wardrobe against the local mocks. No network, no real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, state, seedTasks, TINY_JPEG, TASKS_DB } from './mocks.mjs';

process.env.OS_KEY = 'k';
process.env.NOTION_TOKEN = 'mock';
process.env.ANTHROPIC_API_KEY = 'mock';
process.env.WARDROBE_AI_DAILY_CAP = '6';
install();
const handler = (await import('../api/wardrobe.js')).default;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function call(body, key = 'k', method = 'POST') {
  const req = { method, headers: key ? { 'x-os-key': key } : {}, body };
  let status = 200, out = null;
  const res = { status(s) { status = s; return res; }, json(o) { out = o; return res; }, setHeader() {}, end() {} };
  await handler(req, res);
  return { status, body: out };
}
const jpg = TINY_JPEG.toString('base64');
async function upload() { const r = await call({ action: 'upload', data: jpg, filename: 'x' }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.upload; }
async function item(data, uploads) { const r = await call({ action: 'create', kind: 'items', data, uploads }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.row; }

test('every POST needs the OS key', async () => {
  assert.equal((await call({ action: 'list' }, null)).status, 401);
  assert.equal((await call({ action: 'list' }, 'wrong')).status, 401);
});

test('GET health returns counts only', async () => {
  const r = await call(undefined, null, 'GET');
  assert.equal(r.body.ok, true);
  assert.equal(typeof r.body.counts.items, 'number');
  assert.equal(r.body.tryon, false);
  assert.ok(!JSON.stringify(r.body).includes('Name'));
});

test('fields are validated against fixed lists and types', async () => {
  assert.equal((await call({ action: 'create', kind: 'items', data: { name: 'X', category: 'Spaceships' } })).status, 400);
  assert.equal((await call({ action: 'create', kind: 'items', data: { name: 'X', price: -5 } })).status, 400);
  assert.equal((await call({ action: 'create', kind: 'items', data: { name: '' } })).status, 400);
  assert.equal((await call({ action: 'create', kind: 'items', data: { name: 'X', purchaseDate: { start: '2999-01-01' } } })).status, 400);
  assert.equal((await call({ action: 'create', kind: 'wish', data: { name: 'X', link: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await call({ action: 'create', kind: 'settings', data: { name: 'ai_meter', value: '1' } })).status, 400, 'settings are not writable through create');
  const r = await call({ action: 'create', kind: 'items', data: { name: 'Blouse', category: 'Shirts and blouses', color: 'Ivory, warm', season: ['All year'] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.row.color, 'Ivory  warm'.replace('  ', ' '));
  assert.equal(r.body.row.status, 'In closet');
  assert.equal(r.body.row.laundry, 'Clean');
});

test('uploads must be real images', async () => {
  assert.equal((await call({ action: 'upload', data: Buffer.from('hello world, not a picture').toString('base64') })).status, 400);
  assert.equal((await call({ action: 'upload', data: '' })).status, 400);
  const id = await upload();
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('the original photo is never replaced; a second one is appended', async () => {
  const first = await upload();
  const it = await item({ name: 'Silk dress', category: 'Dresses' }, { photo: first });
  const url0 = it.photo[0].url;
  const second = await upload();
  const r = await call({ action: 'update', kind: 'items', id: it.id, patch: {}, uploads: { photo: second } });
  assert.equal(r.status, 200);
  assert.equal(r.body.appended, true);
  assert.equal(r.body.row.photo[0].url, url0, 'Photo property unchanged');
  const ph = await call({ action: 'photos', kind: 'items', id: it.id });
  assert.equal(ph.body.images.length, 1);
  const cut = await upload();
  const r2 = await call({ action: 'update', kind: 'items', id: it.id, patch: {}, uploads: { cutout: cut } });
  assert.equal(r2.body.row.cutout.length, 1);
  assert.equal(r2.body.row.photo[0].url, url0);
});

test('a page outside the wardrobe databases is refused with 403', async () => {
  const t = seedTasks(today);
  for (const kind of ['items', 'outfits', 'log', 'wish']) {
    const r = await call({ action: 'update', kind, id: t.dinner, patch: { name: 'hijack' } });
    assert.equal(r.status, 403, kind);
  }
  assert.equal((await call({ action: 'archive', kind: 'items', id: t.dinner })).status, 403);
  assert.equal((await call({ action: 'photos', kind: 'items', id: t.dinner })).status, 403);
  const it = await item({ name: 'Shoe', category: 'Shoes' });
  assert.equal((await call({ action: 'update', kind: 'outfits', id: it.id, patch: { name: 'x' } })).status, 403, 'an item is not an outfit');
});

test('worn logs snapshot outfit pieces and refuse future days', async () => {
  const a = await item({ name: 'Top A', category: 'Tops' });
  const b = await item({ name: 'Skirt B', category: 'Skirts' });
  const o = (await call({ action: 'create', kind: 'outfits', data: { name: 'Look AB', items: [a.id, b.id] } })).body.row;
  const tomorrow = new Date(Date.parse(today) + 864e5).toISOString().slice(0, 10);
  assert.equal((await call({ action: 'create', kind: 'log', data: { kind: 'Worn', date: tomorrow, outfit: o.id } })).status, 400);
  const plan = await call({ action: 'create', kind: 'log', data: { kind: 'Planned', date: tomorrow, outfit: o.id } });
  assert.equal(plan.status, 200);
  assert.deepEqual(plan.body.row.items.sort(), [a.id, b.id].sort());
  const worn = await call({ action: 'create', kind: 'log', data: { kind: 'Worn', date: today, outfit: o.id }, markLaundry: true });
  assert.equal(worn.status, 200);
  assert.equal(worn.body.laundry.length, 2, 'both washable pieces move to Worn once');
  // Editing the outfit later does not rewrite the history.
  await call({ action: 'update', kind: 'outfits', id: o.id, patch: { items: [a.id] } });
  const list = await call({ action: 'list', kinds: ['log'] });
  const row = list.body.log.find((l) => l.id === worn.body.row.id);
  assert.equal(row.items.length, 2);
  assert.equal((await call({ action: 'create', kind: 'log', data: { kind: 'Worn', date: today } })).status, 400, 'needs pieces or an outfit');
});

test('relations only accept pages from the right database', async () => {
  const t = seedTasks(today);
  const r = await call({ action: 'create', kind: 'outfits', data: { name: 'Bad', items: [t.dinner] } });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /refused/);
});

test('stylist drops pieces she does not own and falls back when a model is missing', async () => {
  await item({ name: 'Heels', category: 'Shoes' });
  const before = state.anthropicCalls;
  const r = await call({ action: 'ai.style', request: 'dinner in Bali', place: 'Sanur', date: today });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(state.anthropicCalls, before + 1);
  assert.equal(r.body.model, 'claude-haiku-4-5-20251001', 'fell back from the missing model');
  assert.ok(r.body.dropped >= 2, 'invented refs were counted');
  const list = await call({ action: 'list', kinds: ['items'] });
  const owned = new Set(list.body.items.map((i) => i.id));
  for (const lk of r.body.looks) {
    for (const p of lk.pieces) assert.ok(owned.has(p.id), 'every piece is hers');
    for (const a of lk.alternatives) { assert.ok(owned.has(a.with)); assert.ok(owned.has(a.replace)); }
    assert.ok(lk.suggestedPurchases.length, 'ideas stay in their own list');
  }
  assert.ok(r.body.weather && r.body.weather.days.length === 1, 'forecast used');
  assert.ok(!/i999/.test(JSON.stringify(r.body.looks)));
});

test('laundry and gone pieces are not offered to the stylist unless asked', async () => {
  const w = await item({ name: 'Washing gown', category: 'Dresses', laundry: 'In laundry' });
  const s = await item({ name: 'Sold coat', category: 'Outerwear', status: 'Sold' });
  await call({ action: 'ai.style', request: 'anything' });
  assert.ok(!state.lastPrompt.includes('Washing gown'));
  assert.ok(!state.lastPrompt.includes('Sold coat'));
  await call({ action: 'ai.style', request: 'anything', allowLaundry: true });
  assert.ok(state.lastPrompt.includes('Washing gown'));
  assert.ok(!state.lastPrompt.includes('Sold coat'));
  assert.equal((await call({ action: 'ai.style', request: 'x', focusId: w.id })).status, 400, 'cannot focus on a piece in the wash');
  void s;
});

test('scanner keeps unsure fields as questions and never guesses a brand', async () => {
  const r = await call({ action: 'ai.scan', data: jpg });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const it = r.body.scan.items[0];
  assert.ok(it.ask.includes('material'), 'low confidence material must be confirmed');
  assert.equal(it.suggestion.brand, '', 'brand dropped below 0.8 confidence');
  assert.deepEqual(it.suggestion.season, ['Tropical heat'], 'unknown season dropped');
  // A photo already in the closet is answered from the record, with no AI spend.
  const hash = 'a'.repeat(64);
  await item({ name: 'Hashed', category: 'Tops', imageHash: hash, ai: { scan: r.body.scan } });
  const before = state.anthropicCalls;
  const again = await call({ action: 'ai.scan', data: jpg, hash });
  assert.equal(again.body.cached, true);
  assert.equal(again.body.duplicate.name, 'Hashed');
  assert.equal(state.anthropicCalls, before);
});

test('packing keeps only owned pieces and builds a checklist', async () => {
  const end = new Date(Date.parse(today) + 2 * 864e5).toISOString().slice(0, 10);
  const r = await call({ action: 'ai.pack', destination: 'Singapore', start: today, end, luggage: 'Carry-on only' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.plan.days.length, 3);
  assert.ok(r.body.plan.dropped >= 3);
  assert.ok(r.body.plan.pieces.every((p) => p.packed === false));
  assert.equal(r.body.plan.missing[0].description, 'Rain jacket');
  assert.equal((await call({ action: 'ai.pack', start: end, end: today })).status, 400);
});

test('the daily meter caps AI calls and fails closed', async () => {
  // Cap is 6; earlier tests used some. Drain to the cap.
  let r;
  for (let i = 0; i < 10; i++) { r = await call({ action: 'ai.style', request: 'x' }); if (r.status === 429) break; }
  assert.equal(r.status, 429);
  assert.equal(r.body.capped, true);
  const before = state.anthropicCalls;
  assert.equal((await call({ action: 'ai.scan', data: jpg })).status, 429);
  assert.equal(state.anthropicCalls, before, 'no Claude call past the cap');
  state.failSettings = true;
  const down = await call({ action: 'ai.style', request: 'x' });
  state.failSettings = false;
  assert.equal(down.status, 503);
  assert.equal(state.anthropicCalls, before, 'no Claude call when the meter cannot be read');
});

test('photo proxy only fetches Notion file hosts', async () => {
  assert.equal((await call({ action: 'image', url: 'https://evil.example.com/x.jpg' })).status, 400);
  assert.equal((await call({ action: 'image', url: 'http://prod-files-secure.s3.us-west-2.amazonaws.com/x' })).status, 400);
  const ok = await call({ action: 'image', url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/mock/a/b.jpg' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.mime, 'image/jpeg');
});

test('bulk edit, collections and archive', async () => {
  const a = await item({ name: 'Bulk 1', category: 'Tops' });
  const b = await item({ name: 'Bulk 2', category: 'Tops' });
  const r = await call({ action: 'bulk', kind: 'items', ids: [a.id, b.id], patch: { laundry: 'In laundry', name: 'ignored' } });
  assert.equal(r.body.rows.length, 2);
  assert.ok(r.body.rows.every((x) => x.laundry === 'In laundry' && x.name.startsWith('Bulk')));
  const c = (await call({ action: 'create', kind: 'collections', data: { name: 'Test col' } })).body.row;
  const j = await call({ action: 'collect', id: c.id, items: { add: [a.id, b.id] } });
  assert.equal(j.body.row.items.length, 2);
  const j2 = await call({ action: 'collect', id: c.id, items: { remove: [a.id] } });
  assert.deepEqual(j2.body.row.items, [b.id]);
  await call({ action: 'archive', kind: 'items', id: a.id });
  const list = await call({ action: 'list', kinds: ['items'] });
  assert.ok(!list.body.items.some((i) => i.id === a.id));
  void TASKS_DB;
});

test('try-on and server background removal say plainly they are not set up', async () => {
  assert.equal((await call({ action: 'tryon' })).status, 501);
  assert.equal((await call({ action: 'bg', data: jpg })).status, 501);
});
