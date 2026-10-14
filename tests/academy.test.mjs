/* Tests for /api/academy, Befa's instructor desk (14 Oct 2026).
   Run: node tests/academy.test.mjs
   The sheet service and the student portal door are faked; the route runs as written. */
import assert from 'node:assert/strict';

process.env.OS_KEY = 'os';
process.env.BIZ_FEED_KEY = 'f'.repeat(40);
process.env.DAA_API_KEY = 'daa';
delete process.env.DAA_API_URL;

const { default: handler, cut, agenciesFor, witaDate, ME, refOf, partsFor, REF_RE } = await import('../api/academy.js');

const PID = '11111111-1111-4111-8111-111111111111';
const today = witaDate();
const tomorrow = witaDate(new Date(Date.now() + 864e5));
const yesterday = witaDate(new Date(Date.now() - 864e5));

const enrol = (o) => ({ instructor_email: ME, sheet_row: 20, status: 'In Progress', student: 'Claire Moon', student_id: 'DAA-1', whatsapp: '+62 1',
  email: 'c@x.com', invoice_no: 'DAAOCT26-1', course: 'Mermaid Course - Adult - Beginner - PADI Mermaid', price: 'Rp1', last_seen: '1 Oct 2026', sessions: '4', done: '2', plan: '4', ...o });
const BOOT = {
  ok: true,
  enrolments: [enrol({}), enrol({ instructor_email: 'rie@x.com', student: 'Rie Student', invoice_no: 'RIE-1' }), enrol({ status: 'Not Started yet', student: 'Naomi', invoice_no: 'DAAOCT26-2', sheet_row: 30 })],
  certQueue: [enrol({ status: 'course done, waiting for certificate', student: 'Laura Fitz', invoice_no: 'DAAJUN26-26', sheet_row: 114, course: 'Underwater Dance Course - Adult - MFI D1 Beginner' })],
  assignments: [
    { instructor_email: ME, date: tomorrow, start: '09:00', end: '11:00', student_name: 'Claire Moon', course: 'x', session_label: 'Pool 3 of 4', venue: 'Cakra', city: 'Bali', status: 'scheduled' },
    { instructor_email: ME, date: yesterday, start: '09:00', student_name: 'Old', status: 'scheduled' },
    { instructor_email: ME, date: today, start: '08:00', student_name: 'Early', status: 'scheduled' },
    { instructor_email: ME, date: tomorrow, start: '13:00', student_name: 'Gone', status: 'cancelled' },
    { instructor_email: 'rie@x.com', date: tomorrow, start: '10:00', student_name: 'Rie class', status: 'scheduled' },
  ],
};

let calls, sheetReply, portal;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ u, method: init.method || 'GET', body });
  if (u.startsWith('https://script.google.com/')) {
    if (!init.method) {
      assert.ok(u.includes('AKfycbwJ5s1d9I6-'), 'reads the instructor script, not the order script');
      return new Response(u.includes('key=daa') ? JSON.stringify(BOOT) : JSON.stringify({ ok: false, error: 'bad key' }));
    }
    if (body.key !== 'daa') return new Response(JSON.stringify({ ok: false, error: 'bad key' }));
    return new Response(JSON.stringify(sheetReply(body)));
  }
  if (u.includes('/functions/v1/befalia-academy')) {
    if (init.headers['x-feed-key'] !== 'f'.repeat(40)) return new Response(JSON.stringify({ ok: false, error: 'unauthorised' }), { status: 401 });
    return new Response(JSON.stringify(portal(body)));
  }
  return new Response('not faked: ' + u, { status: 500 });
};
const run = async (method, body, key = 'os') => {
  const res = { s: 0, j: null, status(s) { this.s = s; return this; }, json(j) { this.j = j; return this; } };
  await handler({ method, headers: { 'x-os-key': key }, body }, res);
  return res;
};
const reset = () => {
  calls = [];
  sheetReply = (b) => ({ ok: true, sheet_row: b.sheet_row, from: 'In Progress', to: b.status });
  portal = (b) => {
    if (b.action === 'certs') return { ok: true, certs: [{ invoice_no: 'DAAJUN26-26', agency: 'MFI', status: 'submitted_to_agency', profile_id: PID, name: 'Laura Fitz' }] };
    if (b.action === 'match') return { ok: true, matches: b.names.map((q) => ({ q, candidates: [{ profile_id: PID, name: q, score: 100 }] })) };
    if (b.action === 'cert_set') return { ok: true, cert: { invoice_no: b.invoice_no, agency: b.agency, status: b.step === 'issue' ? 'issued' : 'submitted_to_agency', number: b.number || null } };
    if (b.action === 'cert_file') return { ok: true, file_url: 'https://gszjrsvvpajznwdrtjva.supabase.co/storage/v1/object/public/certificates/' + PID + '/x.jpg' };
    return { ok: false, error: 'unknown action' };
  };
};

let n = 0; const t = async (name, fn) => { reset(); await fn(); n++; console.log('ok', n, name); };

await t('agencies are read from the course name, never guessed', () => {
  assert.deepEqual(agenciesFor('Mermaid Course - Adult - Beginner - PADI Mermaid'), ['PADI']);
  assert.deepEqual(agenciesFor('Mermaid Course - Kids - MFI J1 (Mermaid Explorer)'), ['MFI']);
  assert.deepEqual(agenciesFor('Mermaid Course - Adult - PADI Mermaid Instructor + EFR (Bundle)'), ['PADI', 'EFR']);
  assert.deepEqual(agenciesFor('Mermaid Course - Adult - Elite Performance'), []);
  assert.deepEqual(agenciesFor('Mermaid Course - Adult - '), []);
});

await t('cut keeps only Befa\'s rows, upcoming from today, no cancelled, sorted, phone only on finished courses', () => {
  const c = cut(BOOT, today);
  assert.equal(c.enrolments.length, 2);
  assert.ok(c.enrolments.every((e) => e.student !== 'Rie Student'));
  assert.equal(c.certQueue.length, 1);
  assert.deepEqual(c.certQueue[0].agencies, ['MFI']);
  assert.deepEqual(c.upcoming.map((u) => u.student), ['Early', 'Claire Moon']);
  assert.ok(!JSON.stringify(c.upcoming).includes('+62'), 'the schedule carries no phone number');
  assert.equal(c.certQueue[0].whatsapp, '+62 1', 'a finished course carries the number for sending the certificate');
  assert.equal(c.enrolments[0].whatsapp, '+62 1', 'so does one in progress, for when it moves to Finished');
  assert.equal(c.enrolments[0].has_email, true);
});

await t('GET: one sheet read, then the portal certs and name matches for the queue', async () => {
  const r = await run('GET');
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.ok, true);
  assert.equal(r.j.certs.length, 1);
  assert.equal(r.j.matches[0].q, 'Laura Fitz');
  const certsCall = calls.find((c) => c.body && c.body.action === 'certs');
  assert.deepEqual(certsCall.body.keys.map((k) => k.split(':')[0]).sort(), ['DAAJUN26-26', 'DAAOCT26-1', 'DAAOCT26-2']);
  assert.ok(certsCall.body.keys.every((k) => /^[A-Z0-9-]+:[0-9a-f]{16}(-\d+)?$/.test(k)), 'each key is invoice:ref');
  assert.equal(r.j.portalError, '');
});

await t('GET: a portal failure still shows the sheet, and says so', async () => {
  portal = () => ({ ok: false, error: 'down' });
  const r = await run('GET');
  assert.equal(r.s, 200);
  assert.equal(r.j.enrolments.length, 2);
  assert.equal(r.j.portalError, 'down');
});

await t('wrong OS key: nothing is read', async () => {
  const r = await run('GET', null, 'nope');
  assert.equal(r.s, 401);
  assert.equal(calls.length, 0);
});

await t('status: writes one row as Befa, with the guard fields, exact wording', async () => {
  const r = await run('POST', { action: 'status', sheet_row: 114, student: 'Laura Fitz', invoice_no: 'DAAJUN26-26', to: 'done', instructor_email: 'rie@x.com' });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  const w = calls[0].body;
  assert.equal(w.action, 'setEnrolStatus');
  assert.equal(w.instructor_email, ME, 'never someone else\'s sheet');
  assert.equal(w.status, 'done (certificate issued-if required)');
  assert.equal(w.student, 'Laura Fitz'); assert.equal(w.invoice_no, 'DAAJUN26-26'); assert.equal(w.sheet_row, 114);
  assert.equal((await run('POST', { action: 'status', sheet_row: 114, to: 'passed' })).s, 400);
  assert.equal((await run('POST', { action: 'status', sheet_row: 3, to: 'wait' })).s, 400, 'header rows refused');
});

await t('status: a sheet refusal comes back as the reason, not as success', async () => {
  sheetReply = () => ({ ok: false, error: 'Row 114 no longer holds Laura Fitz / DAAJUN26-26. The sheet changed. Refresh and try again.' });
  const r = await run('POST', { action: 'status', sheet_row: 114, student: 'Laura Fitz', invoice_no: 'DAAJUN26-26', to: 'wait' });
  assert.equal(r.s, 409);
  assert.match(r.j.error, /no longer holds/);
});

await t('two course blocks on one invoice get different refs; identical blocks get -2', () => {
  const B = { ok: true, enrolments: [
    enrol({ sheet_row: 131, student: 'Michaella Neyssa', invoice_no: 'DAAMAY26-14', course: 'Mermaid Course - Adult - Avanced Open Water - PADI Advanced Mermaid 1D' }),
    enrol({ sheet_row: 134, student: 'Michaella Neyssa', invoice_no: 'DAAMAY26-14', course: 'Mermaid Course - Adult - Avanced Open Water - PADI Advanced Mermaid 2D' }),
    enrol({ sheet_row: 140, student: 'Twin', invoice_no: 'DAAMAY26-15', course: 'C' }),
    enrol({ sheet_row: 150, student: 'Twin', invoice_no: 'DAAMAY26-15', course: 'C' }),
  ], certQueue: [enrol({ sheet_row: 120, status: 'course done, waiting for certificate', student: 'Michaella Neyssa', invoice_no: 'DAAMAY26-14', course: 'Elite' })] };
  const c = cut(B, today);
  const [m1, m2, t1, t2] = c.enrolments;
  assert.notEqual(m1.ref, m2.ref, 'same student, same invoice, two courses: two refs');
  assert.equal(m1.blocks_on_invoice, 3, 'the queue block on the same invoice is counted too');
  assert.equal(t1.ref, refOf(t1)); assert.equal(t2.ref, refOf(t2) + '-2', 'identical block later in the sheet gets -2');
  assert.equal(cut(B, today).enrolments[1].ref, m2.ref, 'refs are stable between reads');
  const moved = cut({ ...B, enrolments: B.enrolments.slice(1), certQueue: B.certQueue.concat([B.enrolments[0]]) }, today);
  assert.equal(moved.certQueue.find((e) => e.sheet_row === 131).ref, m1.ref, 'a block keeps its ref when it moves to the certificate queue');
});

await t('status needs the student and the invoice for the sheet\'s row check', async () => {
  assert.equal((await run('POST', { action: 'status', sheet_row: 131, student: '', invoice_no: 'DAAMAY26-14', to: 'wait' })).s, 400);
  assert.equal((await run('POST', { action: 'status', sheet_row: 131, student: 'Michaella Neyssa', invoice_no: ' ', to: 'wait' })).s, 400);
  assert.equal(calls.length, 0, 'nothing reached the sheet');
});

await t('more than 20 finished students: every name is looked up, in batches of 20', async () => {
  const many = Array.from({ length: 27 }, (_, i) => enrol({ status: 'course done, waiting for certificate', student: 'S' + i, invoice_no: 'INV-' + i, sheet_row: 200 + i }));
  const save = BOOT.certQueue; BOOT.certQueue = many;
  const r = await run('GET');
  BOOT.certQueue = save;
  const m = calls.filter((c) => c.body && c.body.action === 'match');
  assert.deepEqual(m.map((c) => c.body.names.length), [20, 7]);
  assert.equal(r.j.matches.length, 27);
});

await t('cert: only known steps and agencies, a real portal id, a ref, issue carries number and date', async () => {
  const REF = '0123456789abcdef';
  assert.equal((await run('POST', { action: 'cert', step: 'submit', agency: 'PADI', invoice_no: 'X-1', profile_id: PID })).s, 400, 'no ref, refused');
  assert.equal((await run('POST', { action: 'cert', step: 'submit', agency: 'PADI', invoice_no: 'X-1', ref: 'X-1', profile_id: PID })).s, 400, 'a bad ref, refused');
  assert.equal((await run('POST', { action: 'cert', step: 'issue', agency: 'NAUI', invoice_no: 'X-1', profile_id: PID })).s, 400);
  assert.equal((await run('POST', { action: 'cert', step: 'delete', agency: 'PADI', invoice_no: 'X-1', profile_id: PID })).s, 400);
  assert.equal((await run('POST', { action: 'cert', step: 'submit', agency: 'PADI', invoice_no: 'X-1', profile_id: 'Laura' })).s, 400);
  calls = [];
  const r = await run('POST', { action: 'cert', step: 'issue', agency: 'PADI', invoice_no: 'X-1', ref: REF, profile_id: PID, number: ' 12345 ', issued_on: '2026-10-14', course_name: 'c', level: ' PADI Mermaid ' });
  assert.equal(r.s, 200);
  const b = calls[0].body;
  assert.equal(b.action, 'cert_set'); assert.equal(b.number, '12345'); assert.equal(b.issued_on, '2026-10-14');
  assert.equal(b.ref, REF); assert.equal(b.level, 'PADI Mermaid');
  calls = [];
  await run('POST', { action: 'cert', step: 'submit', agency: 'MFI', invoice_no: 'X-1', ref: REF, profile_id: PID, number: 'sneak' });
  assert.equal(calls[0].body.number, undefined, 'a submit never carries a number');
});

await t('cert: the portal\'s refusal is passed on word for word', async () => {
  portal = () => ({ ok: false, error: 'The issue date is in the future.' });
  const r = await run('POST', { action: 'cert', step: 'issue', agency: 'PADI', invoice_no: 'X-1', ref: '0123456789abcdef', profile_id: PID, number: '1', issued_on: '2099-01-01' });
  assert.equal(r.s, 409); assert.equal(r.j.error, 'The issue date is in the future.');
});

await t('cert_file: only base64 of a sensible size goes through', async () => {
  assert.equal((await run('POST', { action: 'cert_file', profile_id: PID, data_base64: 'abc' })).s, 400);
  assert.equal((await run('POST', { action: 'cert_file', profile_id: PID, data_base64: '<script>'.repeat(200) })).s, 400);
  const r = await run('POST', { action: 'cert_file', profile_id: PID, data_base64: '/9j/' + 'A'.repeat(2000) });
  assert.equal(r.s, 200); assert.match(r.j.file_url, /\/certificates\//);
});

await t('no DAA_API_KEY: the page is told plainly, nothing is called', async () => {
  delete process.env.DAA_API_KEY;
  const r = await run('GET');
  assert.equal(r.s, 503); assert.equal(r.j.notConnected, true);
  const w = await run('POST', { action: 'status', sheet_row: 114, student: 'a', invoice_no: 'b', to: 'wait' });
  assert.equal(w.s, 503);
  assert.equal(calls.length, 0);
  process.env.DAA_API_KEY = 'daa';
});

await t('packages split into their courses, each with its own certificates (Befa, 14 Oct 2026)', () => {
  const uwd = partsFor('Underwater Dance Course - Adult - PADI Instructor (Zero to Hero) PADI Instructor Guide PADI Underwater Dance Instructor Application Fee');
  assert.deepEqual(uwd.map((p) => p.title), ['PADI Underwater Dance Specialty', 'PADI Advanced Underwater Dance Specialty', 'PADI Underwater Dance Distinctive Specialty Instructor']);
  assert.ok(uwd.every((p) => p.agencies.join() === 'PADI'));
  const mi = partsFor('Mermaid Course - Adult - PADI Mermaid Instructor Zero to Hero PADI Instructor Guide PADI Mermaid Instructor Application Fee');
  assert.deepEqual(mi.map((p) => p.key + ':' + p.agencies.join()), ['mer:PADI', 'amer:PADI', 'efr:EFR', 'mi:PADI']);
  assert.deepEqual(partsFor('Mermaid Course - Adult - PADI Mermaid Instructor + EFR (Bundle)').map((p) => p.key), ['mi', 'efr']);
  assert.deepEqual(partsFor('PADI Mermaid Instructor Course + EFR Course\nRedeem PADI Mermaid Instructor e-learning').map((p) => p.key), ['mi', 'efr']);
  for (const single of ['Underwater Dance Course - Adult - PADI Instructor', 'Mermaid Course - Adult - Beginner - PADI Mermaid', 'Mermaid Course - Kids - MFI J2 (Mermaid Pioneers)']) {
    const p = partsFor(single); assert.equal(p.length, 1); assert.equal(p[0].key, '', single + ' stays one course');
  }
  partsFor('Mermaid Course - Adult - PADI Mermaid Instructor + EFR (Bundle)')[0].agencies.push('X');
  assert.deepEqual(partsFor('Mermaid Course - Adult - PADI Mermaid Instructor + EFR (Bundle)')[0].agencies, ['PADI'], 'the package list is never changed by a caller');
  assert.ok(REF_RE.test('0123456789abcdef.uwdi') && REF_RE.test('0123456789abcdef-2.mer') && !REF_RE.test('0123456789abcdef.UWD!'));
});

await t('GET asks the portal for every course in a package', async () => {
  const save = BOOT.certQueue;
  BOOT.certQueue = [enrol({ status: 'course done, waiting for certificate', student: 'Ching Chien', invoice_no: 'DAAAUG26-4', sheet_row: 172, course: 'Underwater Dance Course - Adult - PADI Instructor (Zero to Hero) PADI Instructor Guide' })];
  const r = await run('GET');
  BOOT.certQueue = save;
  const keys = calls.find((c) => c.body && c.body.action === 'certs').body.keys.filter((k) => k.startsWith('DAAAUG26-4:'));
  assert.deepEqual(keys.map((k) => k.split('.')[1]), ['uwd', 'auwd', 'uwdi']);
  const all = calls.find((c) => c.body && c.body.action === 'certs').body.keys;
  assert.ok(all[0].startsWith('DAAAUG26-4:'), 'finished courses are asked for first');
  assert.equal(r.j.certQueue[0].parts.length, 3);
});

console.log(`\n${n} passed`);
