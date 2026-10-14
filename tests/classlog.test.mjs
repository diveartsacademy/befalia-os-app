/* Tests for /api/classlog, the class session form (14 Oct 2026).
   Run: node tests/classlog.test.mjs
   Notion, the DAA sheet service and the student portal door are faked; the
   route code runs as written. */
import assert from 'node:assert/strict';

process.env.OS_KEY = 'os';
process.env.NOTION_TOKEN = 'nt';
process.env.BIZ_FEED_KEY = 'f'.repeat(40);
delete process.env.DAA_API_URL;
process.env.DAA_API_KEY = 'daa';

const { default: handler, normalizeLog, driveLink, videoRows } = await import('../api/classlog.js');
const { TASKS_DB } = await import('../api/tasks.js');

const PID1 = '11111111-1111-4111-8111-111111111111';
const PID2 = '22222222-2222-4222-8222-222222222222';
const V1 = 'https://drive.google.com/file/d/AAA/view';
const VS = 'https://drive.google.com/drive/folders/SESSION';

let page, calls;
function mkPage({ date = '2026-10-13', expenses = null, sessionId = '' } = {}) {
  const rt = (s) => [{ plain_text: s, text: { content: s } }];
  return {
    id: 'page-1', parent: { database_id: TASKS_DB }, created_time: '', last_edited_time: '', url: '',
    properties: {
      Name: { title: rt('Teach: Claire + Naomi · Pool 2/4') }, Area: { select: { name: 'DiveArts' } },
      Section: { select: { name: 'Classes' } }, Type: { select: { name: 'Event' } }, Status: { select: { name: 'To do' } },
      Date: { date: { start: date } }, Notes: { rich_text: rt('Cakra Hotel Sanur. DiveArts Bali.') },
      Expenses: { rich_text: expenses ? rt(JSON.stringify(expenses)) : [] }, 'Session ID': { rich_text: sessionId ? rt(sessionId) : [] },
    },
  };
}
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ u, method: init.method || 'GET', body });
  if (u.startsWith('https://api.notion.com/v1/pages/')) {
    if ((init.method || 'GET') === 'PATCH') {
      const p = body.properties;
      if (p.Expenses) page.properties.Expenses = { rich_text: p.Expenses.rich_text.map((x) => ({ plain_text: x.text.content })) };
      if (p['Session ID']) page.properties['Session ID'] = { rich_text: p['Session ID'].rich_text.map((x) => ({ plain_text: x.text.content })) };
    }
    return new Response(JSON.stringify(page));
  }
  if (u.startsWith('https://script.google.com/')) {
    if (body.key !== 'daa') return new Response(JSON.stringify({ ok: false, error: 'bad key' }));
    if (body.action === 'saveSession') return new Response(JSON.stringify({ ok: true, session_id: 'S-2026-10-13-1' }));
    if (body.action === 'saveSessionDetail') return new Response(JSON.stringify({ ok: true, session_id: body.session_id, day_total_idr: 150000, expenses_row: 412 }));
    if (body.action === 'setVideo') return new Response(JSON.stringify(body.attendance_id === 'S-1-A9' ? { ok: false, error: 'No attendance row with that id.' } : { ok: true }));
  }
  if (u.includes('/functions/v1/befalia-academy')) {
    if (init.headers['x-feed-key'] !== 'f'.repeat(40)) return new Response(JSON.stringify({ ok: false, error: 'unauthorised' }), { status: 401 });
    if (body.action === 'match') return new Response(JSON.stringify({ ok: true, matches: body.names.map((q) => ({ q, candidates: q === 'Claire' ? [{ profile_id: PID1, name: 'Claire', has_email: true, score: 100 }] : [] })) }));
    if (body.action === 'video') return new Response(JSON.stringify({ ok: true, queued: body.rows.length, already: 0, no_email: 0, refused: [] }));
  }
  return new Response('not faked: ' + u, { status: 500 });
};
const run = async (method, body, key = 'os') => {
  const res = { s: 0, j: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(s) { this.s = s; return this; }, json(j) { this.j = j; return this; } };
  await handler({ method, headers: { 'x-os-key': key }, body }, res);
  return res;
};
let n = 0; const t = async (name, fn) => { calls = []; await fn(); n++; console.log('ok', n, name); };

await t('only Google Drive links are taken, by name', async () => {
  assert.equal(driveLink('', 'x'), '');
  assert.equal(driveLink(V1, 'x'), V1);
  assert.throws(() => driveLink('https://evil.example/x', 'The video link for Claire'), /The video link for Claire is not a Google Drive link/);
  const l = normalizeLog({ video: VS, students: [{ name: 'Claire', video: V1, profile_id: PID1.toUpperCase() }, { name: 'Naomi', profile_id: 'nope' }], costs: [] });
  assert.equal(l.students[0].profile_id, PID1); assert.equal(l.students[1].profile_id, ''); assert.equal(l.video, VS); assert.equal(l.lang, 'id');
});

await t('portal rows: own link wins, else the session link; unmatched students wait', async () => {
  const l = normalizeLog({ video: VS, students: [{ name: 'Claire', video: V1, profile_id: PID1 }, { name: 'Naomi', profile_id: PID2 }, { name: 'Tia' }], costs: [] });
  const rows = videoRows(l, '2026-10-13', 'Pool 2/4');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.drive_url, r.kind]), [[V1, 'personal'], [VS, 'session']]);
});

await t('GET says whether sending and the portal are switched on, booleans only', async () => {
  const r = await run('GET');
  assert.deepEqual(r.j, { ok: true, sendReady: true, portalReady: true, notion: true });
});

await t('match goes to the portal door with the feed key, no class needed', async () => {
  const r = await run('POST', { action: 'match', names: ['Claire', 'Naomi'] });
  assert.equal(r.s, 200); assert.equal(r.j.matches[0].candidates[0].profile_id, PID1); assert.equal(r.j.matches[1].candidates.length, 0);
  assert.equal(calls.length, 1);
});

await t('send: links reach OS_ATTENDANCE and the portal queue; the sheet address falls back', async () => {
  page = mkPage();
  const r = await run('POST', { action: 'send', id: 'page-1', log: { venue: 'Cakra', video: VS, costs: [{ component: 'pool_ticket', amount: 150000 }],
    students: [{ name: 'Claire', video: V1, profile_id: PID1 }, { name: 'Naomi', profile_id: PID2 }] } });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  const detail = calls.find((c) => c.body && c.body.action === 'saveSessionDetail');
  assert.ok(calls.find((c) => c.body && c.body.action === 'saveSession').u.startsWith('https://script.google.com/macros/s/AKfycbwJ5s1d9I6-'));
  assert.deepEqual(detail.body.attendance.map((a) => a.video_url), [V1, VS]);
  const vid = calls.find((c) => c.body && c.body.action === 'video');
  assert.equal(vid.body.rows.length, 2); assert.equal(vid.body.rows[0].class_date, '2026-10-13'); assert.equal(vid.body.rows[0].class_label, 'Claire + Naomi · Pool 2/4');
  assert.equal(r.j.videos.portal.queued, 2);
  assert.equal(page.properties['Session ID'].rich_text[0].plain_text, 'S-2026-10-13-1');
});

await t('videos after the class: setVideo per attendance row, unchanged links skipped, portal queued', async () => {
  page = mkPage({ sessionId: 'S-1', expenses: { v: 1, sessionId: 'S-1', costs: [{ component: 'pool_ticket', amount: 150000 }], video: '',
    students: [{ name: 'Claire', video: V1, profile_id: PID1 }, { name: 'Naomi', video: '', profile_id: '' }] } });
  const r = await run('POST', { action: 'videos', id: 'page-1', log: { video: VS, students: [{ name: 'Claire', video: V1, profile_id: PID1 }, { name: 'Naomi', profile_id: PID2 }] } });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  const sv = calls.filter((c) => c.body && c.body.action === 'setVideo');
  assert.deepEqual(sv.map((c) => [c.body.attendance_id, c.body.video_url]), [['S-1-A2', VS]], 'Claire unchanged, Naomi gets the session link');
  assert.deepEqual(r.j.videos.sheet.map((x) => x.sheet), ['unchanged', 'saved']);
  assert.equal(r.j.videos.portal.queued, 2);
  const stored = JSON.parse(page.properties.Expenses.rich_text.map((x) => x.plain_text).join(''));
  assert.equal(stored.sessionId, 'S-1'); assert.equal(stored.costs[0].amount, 150000, 'costs stay as sent'); assert.equal(stored.students[1].profile_id, PID2);
});

await t('videos refuses: not sent yet, a future class, a changed student list, no link, a bad link', async () => {
  page = mkPage();
  assert.equal((await run('POST', { action: 'videos', id: 'page-1', log: { video: VS } })).s, 400);
  page = mkPage({ date: '2099-01-01', sessionId: 'S-1', expenses: { sessionId: 'S-1', costs: [], students: [{ name: 'Claire' }] } });
  assert.match((await run('POST', { action: 'videos', id: 'page-1', log: { video: VS } })).j.error, /on or after/);
  page = mkPage({ sessionId: 'S-1', expenses: { sessionId: 'S-1', costs: [], students: [{ name: 'Claire' }] } });
  assert.equal((await run('POST', { action: 'videos', id: 'page-1', log: { students: [{ name: 'Someone else', video: V1 }] } })).s, 409);
  assert.match((await run('POST', { action: 'videos', id: 'page-1', log: {} })).j.error, /Paste a Drive link/);
  assert.match((await run('POST', { action: 'videos', id: 'page-1', log: { video: 'https://example.com/v' } })).j.error, /not a Google Drive link/);
  assert.equal(calls.filter((c) => c.body && c.body.action === 'setVideo').length, 0, 'nothing written on any refusal');
});

await t('without DAA_API_KEY nothing is sent and the message names the one key to set', async () => {
  delete process.env.DAA_API_KEY;
  page = mkPage();
  const r = await run('POST', { action: 'send', id: 'page-1', log: { costs: [{ component: 'pool_ticket', amount: 1000 }], students: [] } });
  assert.equal(r.s, 503); assert.match(r.j.error, /DAA_API_KEY needs to be added in Vercel/);
  assert.equal(calls.filter((c) => c.u.startsWith('https://script.google.com/')).length, 0);
  process.env.DAA_API_KEY = 'daa';
});

await t('wrong OS key: nothing happens', async () => {
  const r = await run('POST', { action: 'match', names: ['Claire'] }, 'nope');
  assert.equal(r.s, 401); assert.equal(calls.length, 0);
});

console.log(`\n${n} passed`);
