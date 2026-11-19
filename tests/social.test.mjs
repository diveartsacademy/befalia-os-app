/* Personal social desk. Run: node tests/social.test.mjs
   The numbers here are invented. None of them are Befa's. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.OS_KEY = 'os-key';
process.env.NOTION_TOKEN = 'notion-token-test';
process.env.SOCIAL_DB_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
delete process.env.ZERNIO_API_KEY;
delete process.env.ZERNIO_PERSONAL_ACCOUNT_IDS;
delete process.env.ZERNIO_API_BASE;

const social = await import('../api/_social.js');
const zernio = await import('../api/_zernio-sync.js');
const { default: handler, resetDbCache } = await import('../api/social.js');

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', n, name); };
const today = social.witaDate();
const nextDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

await t('the four confirmed personal accounts are live, and the business ones are absent', () => {
  const keys = social.ACCOUNTS.map((a) => a.key);
  assert.deepEqual(keys, [
    'instagram:@befalia',
    'instagram:@mermaidbefa',
    'tiktok:@befalia',
    'youtube:UCD8NyW-e1aadBdEulOxC3eA',
  ]);
  assert.ok(social.ACCOUNTS.every((a) => a.label === 'Personal' && a.status === 'live' && a.url.startsWith('https://')));
  assert.equal(social.ACCOUNTS.filter((a) => a.confirmed === '2026-11-19').length, 2);
  const blob = JSON.stringify(social.ACCOUNTS);
  assert.equal(/seadivatails|seadiva\.official|@divearts|needs confirm/i.test(blob), false);
  assert.equal(JSON.stringify(social.databaseSchema()).includes('Facebook'), false);
  const src = fs.readFileSync(new URL('../api/_social.js', import.meta.url), 'utf8');
  assert.equal(src.includes("from('social_metrics'"), false);
  assert.equal(src.includes('supabase'), false);
});

await t('a blank is empty, zero is zero, and a comma is refused', () => {
  assert.equal(social.readCount('', 'Followers'), null);
  assert.equal(social.readCount(null, 'Followers'), null);
  assert.equal(social.readCount(0, 'Followers'), 0);
  assert.equal(social.readCount('1200', 'Followers'), 1200);
  assert.throws(() => social.readCount('1,200', 'Followers'), /commas/);
  assert.throws(() => social.readCount(-1, 'Followers'), /negative/);
  assert.throws(() => social.readCount(1.5, 'Followers'), /whole number/);
  assert.equal(social.formatMetric(null), '—');
  assert.equal(social.formatMetric(0), '0');
  assert.equal(social.formatMetric(1200), '1,200');
});

await t('a snapshot needs one real number and cannot claim to be from Zernio', () => {
  const row = social.cleanSnapshot({
    account: 'instagram:@befalia', grain: 'Month', date: today, followers: '', reach: '40', note: ' typed ',
  }, today);
  assert.equal(row.followers, null);
  assert.equal(row.reach, 40);
  assert.equal(row.when, today.slice(0, 7) + '-01');
  assert.equal(row.source, 'Manual');
  assert.equal(row.note, 'typed');
  assert.throws(() => social.cleanSnapshot({
    account: 'instagram:@seadivatails', grain: 'Month', date: today, followers: 1,
  }, today), /personal accounts/);
  assert.throws(() => social.cleanSnapshot({
    account: 'instagram:@befalia', grain: 'Month', date: today, source: 'Zernio', followers: 1,
  }, today), /Manual entry/);
  assert.throws(() => social.cleanSnapshot({
    account: 'instagram:@befalia', grain: 'Month', date: today,
  }, today), /at least one number/);
  assert.throws(() => social.cleanSnapshot({
    account: 'instagram:@befalia', grain: 'Month', date: nextDay(today), followers: 1,
  }, today), /after today/);
  assert.throws(() => social.cleanSnapshot({
    account: 'instagram:@befalia', grain: 'Day', date: today, followers: 1, extras: { watchHours: 2 },
  }, today), /does not belong/);
  const yt = social.cleanSnapshot({
    account: 'youtube:UCD8NyW-e1aadBdEulOxC3eA', grain: 'Day', date: today, extras: { watchHours: 1.5, views: 10 },
  }, today);
  assert.equal(yt.extras.watchHours, 1.5);
  assert.equal(yt.followers, null);
});

await t('ideas need a hook, earnings need an amount or an outcome, and history does not invent a comparison', () => {
  assert.throws(() => social.cleanIdea({ platform: 'instagram', hook: '  ' }, today), /Hook/);
  const idea = social.cleanIdea({ platform: 'tiktok', hook: 'A quiet harbour', caption: 'line', status: 'Drafting' }, today);
  assert.equal(idea.status, 'Drafting');
  assert.throws(() => social.cleanEarning({ platform: 'youtube', date: today }, today), /amount or an outcome/);
  assert.throws(() => social.cleanEarning({ platform: 'youtube', date: today, amount: 10 }, today), /IDR or USD/);
  const earned = social.cleanEarning({ platform: 'instagram', date: today, outcome: 'A brand said no' }, today);
  assert.equal(earned.amount, null);
  assert.equal(earned.currency, null);
  assert.equal(social.formatMoney(1200000, 'IDR'), 'Rp1.200.000');
  const rows = [
    { kind: 'Snapshot', account: 'instagram:@befalia', grain: 'Month', when: '2026-10-01', active: true, followers: 1000, reach: null, engagement: 5, posts: 2, recordedAt: '2026-10-02T00:00:00Z', source: 'Manual' },
    { kind: 'Snapshot', account: 'instagram:@befalia', grain: 'Month', when: '2026-11-01', active: true, followers: 1200, reach: 40, engagement: null, posts: 2, recordedAt: '2026-11-02T00:00:00Z', source: 'Manual' },
    { kind: 'Idea', account: '', platform: 'instagram', active: true, hook: 'older', recordedAt: '2026-11-01T00:00:00Z', when: '2026-11-01' },
    { kind: 'Idea', account: '', platform: 'tiktok', active: true, hook: 'newer', recordedAt: '2026-11-18T00:00:00Z', when: '2026-11-18' },
  ];
  const view = social.viewModel(rows, today);
  const card = view.cards.find((c) => c.account.key === 'instagram:@befalia');
  assert.equal(card.headline.followers, 1200);
  assert.equal(card.compare.deltas.followers.delta, 200);
  assert.equal(card.compare.deltas.reach, null);
  assert.equal(card.compare.deltas.engagement, null);
  assert.ok(card.spark && card.spark.d.startsWith('M'));
  assert.equal(social.sparkPath([100]), null);
  assert.equal(social.compareMonths([rows[0]]), null);
  assert.deepEqual(view.ideas.map((i) => i.hook), ['newer', 'older']);
  assert.equal(view.earnings.length, 0);
  const empty = social.viewModel([], today);
  assert.ok(empty.cards.every((c) => c.headline == null && c.spark == null && c.compare == null));
});

await t('a stored row round-trips, and an earlier row stays when a later one replaces it in the model only by being inactive', () => {
  const row = social.cleanSnapshot({ account: 'tiktok:@befalia', grain: 'Day', date: today, followers: 10, note: 'kept' }, today);
  row.recordedAt = '2026-11-19T10:47:00.000Z';
  const back = social.mapPage({ id: 'abc', created_time: row.recordedAt, properties: social.toProperties(row) });
  assert.equal(back.followers, 10);
  assert.equal(back.reach, null);
  assert.equal(back.note, 'kept');
  assert.equal(back.account, 'tiktok:@befalia');
  assert.equal(back.active, true);
  assert.match(social.formatWita('2026-11-19T10:47:00.000Z'), /18:47/);
  assert.match(social.formatWita('2026-11-19T10:47:00.000Z'), /WITA/);
  assert.equal(social.sameSlot(row, back), true);
  back.active = false;
  assert.equal(social.sameSlot(row, back), false);
});

await t('Zernio does nothing until a personal account id is configured, and it never reads a business id', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('{}', { status: 200 }); };
  const none = await zernio.pullZernio({ env: {}, fetchImpl, today });
  assert.equal(none.skipped, true);
  assert.equal(none.reason, 'no personal account id configured');
  assert.equal(calls, 0);
  const bad = await zernio.pullZernio({
    env: { ZERNIO_PERSONAL_ACCOUNT_IDS: JSON.stringify({ 'instagram:@seadivatails': 'business12345678' }), ZERNIO_API_KEY: 'zk' },
    fetchImpl, today,
  });
  assert.equal(bad.ok, false);
  assert.equal(calls, 0);
  const status = zernio.zernioStatus({});
  assert.equal(status.connected, false);
  assert.equal(status.control, 'ask Befa');
  assert.match(status.costNote, /monthly cost/);
  const src = fs.readFileSync(new URL('../api/_zernio-sync.js', import.meta.url), 'utf8');
  assert.equal(src.includes("method: 'POST'"), false);
  assert.equal(src.includes('social_metrics'), false);
});

await t('a Zernio reading keeps only the asked account, drops a disagreed date, and does not turn impressions into reach', () => {
  const id = 'acctbefalia01';
  const parsed = zernio.extractFollowerPoints({
    accounts: [
      { accountId: id, history: [{ date: '2026-10-01', followers: 100 }, { date: '2026-11-02', followers: 110 }, { date: '2026-11-02', followers: 150 }] },
      { accountId: 'business999999', history: [{ date: '2026-11-01', followers: 99999 }] },
    ],
  }, id);
  assert.deepEqual(parsed.points.map((p) => p.followers), [100]);
  assert.deepEqual(parsed.dropped, ['2026-11-02']);
  const daily = zernio.extractDailyPoints({
    days: [
      { date: '2026-11-18', reach: 40, postCount: 1, likes: 3 },
      { date: '2026-11-19', impressions: 90 },
    ],
  }, id, 'tiktok');
  assert.equal(daily.length, 1);
  assert.equal(daily[0].reach, 40);
  assert.equal(daily[0].posts, 1);
  assert.equal(daily[0].engagement, null);
  assert.equal(daily[0].extras.likes, 3);
});

/* ---------- the route, Notion faked, Zernio not connected ---------- */
const DB = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SOCIAL_PAGE = '3a1eb411ed7a81dca2c4f1f711083f41';
const IDEAS = '3a3eb411ed7a81db81fad03bc31258cd';
let pages, calls, children, createdDb;
const pageOf = (id, props) => ({
  id, url: 'https://www.notion.so/' + id, archived: false, in_trash: false,
  parent: { database_id: DB }, created_time: '2026-11-19T10:47:00.000Z', properties: props,
});
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ u, method: init.method || 'GET', body, auth: (init.headers && init.headers.Authorization) || '' });
  if (u.includes('zernio.com')) {
    if (u.includes('follower-stats')) {
      return new Response(JSON.stringify({ accounts: [{ accountId: 'acctbefalia01', history: [{ date: '2026-10-01', followers: 80 }, { date: '2026-11-01', followers: 90 }] }] }), { status: 200 });
    }
    if (u.includes('daily-metrics')) return new Response(JSON.stringify({ days: [{ date: today, reach: 15, postCount: 1 }] }), { status: 200 });
    return new Response('no', { status: 500 });
  }
  if (u.includes('/blocks/' + SOCIAL_PAGE + '/children') && (init.method || 'GET') === 'GET') {
    return new Response(JSON.stringify({ results: children, has_more: false }), { status: 200 });
  }
  if (u.endsWith('/databases') && init.method === 'POST') {
    createdDb++;
    assert.equal(body.parent.page_id, SOCIAL_PAGE);
    assert.equal(body.title[0].text.content, 'Personal Social Tracker');
    assert.equal(JSON.stringify(body.properties.Platform).includes('Facebook'), false);
    children.push({ id: DB, type: 'child_database', child_database: { title: 'Personal Social Tracker' } });
    return new Response(JSON.stringify({ id: DB, object: 'database' }), { status: 200 });
  }
  if (u.includes('/databases/' + DB + '/query')) {
    return new Response(JSON.stringify({ results: pages, has_more: false }), { status: 200 });
  }
  if (u.endsWith('/pages') && init.method === 'POST') {
    const id = 'p' + pages.length;
    const pg = pageOf(id, body.properties);
    pages.push(pg);
    return new Response(JSON.stringify(pg), { status: 200 });
  }
  if (u.includes('/pages/') && init.method === 'GET') {
    const id = u.split('/pages/')[1];
    return new Response(JSON.stringify(pages.find((p) => p.id === id) || {}), { status: 200 });
  }
  if (u.includes('/pages/') && init.method === 'PATCH') {
    const id = u.split('/pages/')[1];
    const pg = pages.find((p) => p.id === id);
    Object.assign(pg.properties, body.properties);
    return new Response(JSON.stringify(pg), { status: 200 });
  }
  if (u.includes('/blocks/' + IDEAS + '/children') && init.method === 'PATCH') {
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }
  return new Response('not faked: ' + u, { status: 500 });
};
const run = async (method, body, key = 'os-key', query) => {
  const res = { s: 0, j: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(s) { this.s = s; return this; }, json(j) { this.j = j; return this; } };
  await handler({ method, headers: { 'x-os-key': key }, body, query }, res);
  return res;
};
const reset = () => {
  pages = [];
  calls = [];
  children = [];
  createdDb = 0;
  process.env.SOCIAL_DB_ID = DB;
  delete process.env.ZERNIO_API_KEY;
  delete process.env.ZERNIO_PERSONAL_ACCOUNT_IDS;
  resetDbCache();
};
const zernioCalls = () => calls.filter((c) => c.u.includes('zernio.com'));
const leaked = (j) => {
  const s = JSON.stringify(j);
  assert.equal(s.includes('notion-token-test'), false);
  assert.equal(s.includes('zernio-key-test'), false);
  assert.equal(s.includes('acctbefalia01'), false);
};

await t('no key means no data and no Notion call', async () => {
  reset();
  const r = await run('GET', null, 'nope');
  assert.equal(r.s, 401);
  assert.equal(calls.length, 0);
});

await t('the health check is counts only and does not create a database or call Zernio', async () => {
  reset();
  delete process.env.SOCIAL_DB_ID;
  pages.push(pageOf('secret1', social.toProperties(Object.assign(social.cleanSnapshot({
    account: 'instagram:@befalia', grain: 'Month', date: today, followers: 999,
  }, today), { recordedAt: '2026-11-19T10:47:00.000Z', note: 'secret note' }))));
  const r = await run('GET', null, '', { check: '1' });
  assert.equal(r.s, 200);
  assert.equal(r.j.database, false);
  assert.equal(r.j.accounts, 4);
  assert.equal(createdDb, 0);
  assert.equal(zernioCalls().length, 0);
  const s = JSON.stringify(r.j);
  assert.equal(s.includes('999'), false);
  assert.equal(s.includes('secret'), false);
  assert.equal(s.includes('@befalia'), false);
});

await t('manual entry saves a snapshot, leaves blanks empty, and refuses a silent overwrite', async () => {
  reset();
  const first = await run('POST', { action: 'snapshot', account: 'instagram:@mermaidbefa', grain: 'Month', date: today, followers: 1200, reach: '' });
  assert.equal(first.s, 200, JSON.stringify(first.j));
  assert.equal(first.j.snapshot.followers, 1200);
  assert.equal(first.j.snapshot.reach, null);
  assert.equal(first.j.snapshot.source, 'Manual');
  assert.equal(zernioCalls().length, 0);
  leaked(first.j);
  const card = first.j.view.cards.find((c) => c.account.handle === '@mermaidbefa');
  assert.equal(card.headline.followers, 1200);
  assert.equal(card.account.label, 'Personal');
  assert.equal(card.account.status, 'live');
  const again = await run('POST', { action: 'snapshot', account: 'instagram:@mermaidbefa', grain: 'Month', date: today, followers: 5 });
  assert.equal(again.s, 409);
  assert.equal(again.j.conflict, true);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].properties.Followers.number, 1200);
  const kept = await run('POST', { action: 'snapshot', account: 'instagram:@mermaidbefa', grain: 'Month', date: today, followers: 1300, correct: true });
  assert.equal(kept.s, 200, JSON.stringify(kept.j));
  assert.equal(pages.length, 2);
  assert.equal(social.mapPage(pages[0]).active, false);
  assert.equal(social.mapPage(pages[1]).followers, 1300);
  const headline = kept.j.view.cards.find((c) => c.account.handle === '@mermaidbefa').headline;
  assert.equal(headline.followers, 1300);
  assert.equal(headline.source, 'Manual');
});

await t('the first save can create the tracker database, once', async () => {
  reset();
  delete process.env.SOCIAL_DB_ID;
  const r = await run('POST', { action: 'snapshot', account: 'tiktok:@befalia', grain: 'Day', date: today, posts: 2 });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(createdDb, 1);
  assert.equal(r.j.snapshot.account, 'tiktok:@befalia');
  const again = await run('GET');
  assert.equal(again.s, 200);
  assert.equal(createdDb, 1);
  assert.equal(zernioCalls().length, 0);
});

await t('ideas are newest first and earnings stay empty until one is logged', async () => {
  reset();
  const empty = await run('GET');
  assert.equal(empty.j.earnings.length, 0);
  assert.equal(empty.j.ideas.length, 0);
  const a = await run('POST', { action: 'idea', platform: 'instagram', hook: 'First harbour', caption: 'A short script' });
  assert.equal(a.s, 200, JSON.stringify(a.j));
  assert.ok(calls.some((c) => c.u.includes(IDEAS) && c.method === 'PATCH'));
  await new Promise((r) => setTimeout(r, 15));
  const b = await run('POST', { action: 'idea', platform: 'youtube', hook: 'Second tide', status: 'Ready' });
  assert.equal(b.j.view.ideas[0].hook, 'Second tide');
  assert.equal(b.j.view.ideas[1].hook, 'First harbour');
  const bad = await run('POST', { action: 'earning', platform: 'instagram', date: today });
  assert.equal(bad.s, 400);
  const ok = await run('POST', { action: 'earning', platform: 'youtube', date: today, outcome: 'No payment this month', note: 'asked' });
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  assert.equal(ok.j.view.earnings[0].amount, null);
  assert.equal(ok.j.view.earnings[0].outcome, 'No payment this month');
  assert.equal(ok.j.view.earnings[0].platform, 'youtube');
});

await t('sync with no personal id does not call Zernio, and a failure leaves the manual row', async () => {
  reset();
  await run('POST', { action: 'snapshot', account: 'instagram:@befalia', grain: 'Month', date: today, followers: 50 });
  calls = [];
  const skipped = await run('POST', { action: 'sync', accountId: 'acctbefalia01' });
  assert.equal(skipped.s, 200);
  assert.equal(skipped.j.skipped, true);
  assert.equal(zernioCalls().length, 0);
  assert.equal(skipped.j.view.cards.find((c) => c.account.handle === '@befalia').headline.followers, 50);
  leaked(skipped.j);
  process.env.ZERNIO_API_KEY = 'zernio-key-test';
  process.env.ZERNIO_PERSONAL_ACCOUNT_IDS = JSON.stringify({ 'instagram:@befalia': 'acctbefalia01' });
  const save = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('zernio.com')) return new Response('down', { status: 503 });
    return save(url, init);
  };
  const failed = await run('POST', { action: 'sync' });
  globalThis.fetch = save;
  assert.equal(failed.j.ok, false);
  assert.equal(failed.j.fallback, 'manual');
  assert.equal(failed.j.saved, 0);
  assert.equal(failed.j.view.cards.find((c) => c.account.handle === '@befalia').headline.followers, 50);
  assert.equal(failed.j.view.cards.find((c) => c.account.handle === '@befalia').headline.source, 'Manual');
  leaked(failed.j);
});

await t('a configured sync is GET only, skips a month already logged, and hides the key', async () => {
  reset();
  process.env.ZERNIO_API_KEY = 'zernio-key-test';
  process.env.ZERNIO_PERSONAL_ACCOUNT_IDS = JSON.stringify({ 'instagram:@befalia': 'acctbefalia01' });
  await run('POST', { action: 'snapshot', account: 'instagram:@befalia', grain: 'Month', date: '2026-11-15', followers: 50 });
  calls = [];
  const r = await run('POST', { action: 'sync', accountId: 'ignore-me-please' });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.skipped, false);
  assert.ok(zernioCalls().length >= 1);
  assert.ok(zernioCalls().every((c) => c.method === 'GET'));
  assert.ok(zernioCalls().every((c) => c.u.includes('acctbefalia01')));
  assert.ok(zernioCalls().every((c) => !c.u.includes('ignore-me-please')));
  assert.ok(zernioCalls().every((c) => c.auth === 'Bearer zernio-key-test'));
  const manual = r.j.view.cards.find((c) => c.account.handle === '@befalia');
  const nov = manual.history.find((h) => h.when === '2026-11-01' && h.active !== false);
  assert.equal(nov.source, 'Manual');
  assert.equal(nov.followers, 50);
  assert.ok(r.j.kept >= 1);
  leaked(r.j);
  const again = await run('POST', { action: 'sync' });
  assert.equal(again.j.saved, 0);
});

await t('the page shows the personal accounts, an honest empty log, and a disabled Zernio control', () => {
  const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tab = src.slice(src.indexOf('id="tab-social"'), src.indexOf('id="tab-agents"'));
  assert.match(tab, /soc-root/);
  assert.match(tab, /Scout, Sonar and Muse/);
  assert.equal(/seadivatails|seadiva\.official|@divearts|buildSocial/.test(tab), false);
  const panel = fs.readFileSync(new URL('../social-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /Connect with Zernio · ask Befa/);
  assert.match(panel, /never downloads audio/);
  assert.match(panel, /copyrighted audio/);
  assert.equal(panel.includes('notion-token'), false);
  assert.equal(panel.includes('ZERNIO_API_KEY'), false);
  const root = { innerHTML: '', dataset: {}, addEventListener() {} };
  const document = {
    getElementById(id) { return id === 'soc-root' ? root : (id === 'soc-css' ? { id: 'soc-css' } : null); },
    createElement() { return {}; },
    head: { appendChild() {} },
  };
  const ctx = { window: {}, document, console, Intl, isNaN, isFinite, Date, fetch };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(panel, ctx);
  const view = social.viewModel([], today);
  view.zernio = zernio.zernioStatus({});
  const html = ctx.__socRender(view);
  for (const bit of ['@befalia', '@mermaidbefa', 'UCD8NyW-e1aadBdEulOxC3eA', 'Personal', 'ask Befa', 'monthly cost', 'Scout', 'Sonar', 'Muse', 'Nothing logged yet', 'not logged']) {
    assert.ok(html.includes(bit), bit);
  }
  assert.equal(/seadivatails|seadiva\.official|@divearts/.test(html), false);
  assert.match(html, /id="soc-zernio"[^>]*disabled/);
});

console.log(n + ' social tests passed');
