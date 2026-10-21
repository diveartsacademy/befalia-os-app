/* Tests for the Subscriptions card: api/_subs.js. Run: node tests/subscriptions.test.mjs
   This is the gate for the card: it checks the money adds up, the two
   currencies never mix, doubtful rows stay out of the headline, and a stale
   date is flagged. The rows here are invented, not Befa's. */
import assert from 'node:assert/strict';

process.env.OS_KEY = 'os';
process.env.NOTION_TOKEN = 'nt';
const { summarize, perMonth, mapSub, daysBetween } = await import('../api/_subs.js');
const { default: handler } = await import('../api/subscriptions.js');

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', n, name); };
const TODAY = '2026-10-21';
const row = (o) => Object.assign({ id: o.name, status: 'Active', amount: null, currency: null, cycle: 'Monthly', next: null, trialEnds: null }, o);

await t('per month: monthly, yearly, every 2 months, usage, one-off', () => {
  assert.equal(perMonth(row({ amount: 120000, currency: 'IDR' })), 120000);
  assert.equal(perMonth(row({ amount: 1200000, currency: 'IDR', cycle: 'Yearly' })), 100000);
  assert.equal(perMonth(row({ amount: 24000, currency: 'IDR', cycle: 'Every 2 months' })), 12000);
  assert.equal(perMonth(row({ amount: 10, currency: 'USD', cycle: 'Usage' })), 10);
  assert.equal(perMonth(row({ amount: 99, currency: 'USD', cycle: 'One-off' })), 0);
  assert.equal(perMonth(row({ amount: null, currency: 'IDR' })), null);
  assert.equal(perMonth(row({ amount: 5, currency: null })), null);
  assert.equal(perMonth(row({ amount: 5, currency: 'IDR', cycle: 'Weekly?' })), null);
});

await t('IDR and USD are summed apart, never together', () => {
  const s = summarize([
    row({ name: 'a', amount: 100000, currency: 'IDR' }),
    row({ name: 'b', amount: 112, currency: 'USD' }),
    row({ name: 'c', amount: 18.82, currency: 'USD' }),
  ], TODAY);
  assert.equal(s.month.IDR.confirmed, 100000);
  assert.equal(s.month.USD.confirmed, 130.82);
  assert.equal(s.year.IDR, 1200000);
  assert.equal(s.year.USD, 1569.84);
});

await t('only Active is confirmed; Check and failing are apart; trials apart; Ended ignored', () => {
  const s = summarize([
    row({ name: 'active', amount: 100000, currency: 'IDR' }),
    row({ name: 'check', status: 'Check', amount: 50000, currency: 'IDR' }),
    row({ name: 'fail', status: 'Payment failing', amount: 30000, currency: 'IDR' }),
    row({ name: 'trial', status: 'Free trial', amount: 89000, currency: 'IDR', trialEnds: '2026-11-04' }),
    row({ name: 'gone', status: 'Ended', amount: 999999, currency: 'IDR', next: '2026-01-01' }),
  ], TODAY);
  assert.deepEqual(s.month.IDR, { confirmed: 100000, unconfirmed: 80000, afterTrials: 89000 });
  assert.equal(s.counts.Ended, 1);
  assert.ok(!s.alerts.some((a) => a.id === 'gone'), 'an ended row raises no alert');
});

await t('a row without an amount is listed as unknown, not counted as zero', () => {
  const s = summarize([row({ name: 'x', status: 'Due' }), row({ name: 'y', amount: 1000, currency: 'IDR' })], TODAY);
  assert.deepEqual(s.unknownAmount, ['x']);
  assert.equal(s.month.IDR.confirmed, 1000);
});

await t('a passed Next charge date is flagged so a stale row is visible', () => {
  const s = summarize([row({ name: 'old', amount: 1, currency: 'IDR', next: '2026-08-23' })], TODAY);
  const a = s.alerts.find((x) => x.id === 'old');
  assert.equal(a.kind, 'date_passed');
  assert.equal(a.days, -59);
});

await t('one alert per subscription: failing beats date passed', () => {
  const s = summarize([row({ name: 'f', status: 'Payment failing', amount: 1, currency: 'IDR', next: '2026-10-03' })], TODAY);
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0].kind, 'failing');
});

await t('trial ending within 7 days alerts; one ending later does not; a trial past its end says so', () => {
  const s = summarize([
    row({ name: 'soon', status: 'Free trial', amount: 1, currency: 'IDR', trialEnds: '2026-10-25' }),
    row({ name: 'later', status: 'Free trial', amount: 1, currency: 'IDR', trialEnds: '2026-11-20' }),
    row({ name: 'over', status: 'Free trial', amount: 1, currency: 'IDR', trialEnds: '2026-10-19' }),
  ], TODAY);
  assert.equal(s.alerts.find((x) => x.id === 'soon').kind, 'trial_ending');
  assert.ok(!s.alerts.some((x) => x.id === 'later'));
  assert.equal(s.alerts[0].id, 'over', 'a trial that already converted comes first');
});

await t('upcoming: next 30 days only, soonest first, today included', () => {
  const s = summarize([
    row({ name: 'today', amount: 1, currency: 'IDR', next: TODAY }),
    row({ name: 'in20', amount: 1, currency: 'IDR', next: '2026-11-10' }),
    row({ name: 'in5', amount: 1, currency: 'IDR', next: '2026-10-26' }),
    row({ name: 'in60', amount: 1, currency: 'IDR', next: '2026-12-20' }),
  ], TODAY);
  assert.deepEqual(s.upcoming.map((x) => x.id), ['today', 'in5', 'in20']);
  assert.equal(daysBetween(TODAY, '2026-11-10'), 20);
});

await t('mapSub reads the Notion row shape', () => {
  const s = mapSub({ id: 'ab-cd', url: 'u', properties: {
    Name: { title: [{ plain_text: 'Thing' }] }, Status: { select: { name: 'Free trial' } }, Amount: { number: 89000 },
    Currency: { select: { name: 'IDR' } }, Cycle: { select: { name: 'Monthly' } },
    'Next charge': { date: { start: '2026-11-04' } }, 'Trial ends': { date: { start: '2026-11-04T00:00:00.000+08:00' } },
    'Billed via': { select: { name: 'Apple (befaliaa)' } }, 'Other option': { rich_text: [{ plain_text: 'Cancel' }] },
  } });
  assert.equal(s.id, 'abcd');
  assert.equal(s.trialEnds, '2026-11-04');
  assert.equal(s.amount, 89000);
  assert.equal(s.option, 'Cancel');
  assert.equal(s.status, 'Free trial');
});

// The route: the list needs the OS key; the health check gives counts only.
function res() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => {};
  return r;
}
const page = (name, status, amount) => ({ id: name, properties: { Name: { title: [{ plain_text: name }] }, Status: { select: { name: status } }, Amount: { number: amount }, Currency: { select: { name: 'IDR' } }, Cycle: { select: { name: 'Monthly' } } } });
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ results: [page('Secret App', 'Active', 50000), page('Other', 'Ended', 1)], has_more: false }) });

await t('route: the list refuses a request without the OS key', async () => {
  const r = res();
  await handler({ method: 'GET', query: {}, headers: {} }, r);
  assert.equal(r.code, 401);
});

await t('route: with the key it returns rows and the summary', async () => {
  const r = res();
  await handler({ method: 'GET', query: {}, headers: { 'x-os-key': 'os' } }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.items.length, 2);
  assert.equal(r.body.summary.month.IDR.confirmed, 50000);
});

await t('route: the health check needs no key and shows no names or amounts', async () => {
  const r = res();
  await handler({ method: 'GET', query: { check: '1' }, headers: {} }, r);
  assert.equal(r.code, 200);
  const txt = JSON.stringify(r.body);
  assert.ok(!/Secret App|50000/.test(txt), 'no name or amount leaks');
  assert.equal(r.body.rows, 2);
});

console.log(n + ' passed');
