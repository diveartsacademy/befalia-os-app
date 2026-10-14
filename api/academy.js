/* /api/academy — Befa's instructor dashboard on the Business tab (14 Oct 2026).
   ---------------------------------------------------------------------------
   Asked by Befa: in Business, DiveArts Academy, her own instructor view. The
   students who have not finished, her schedule, the courses that are finished
   but still need a certificate, a button to make the DiveArts (DAA)
   certificate and to process the PADI or MFI one, and every certificate
   showing in the student's portal.

   Reads
     GET   the instructor sheet service ("DAA Instructor - scripts", action
           bootstrap), cut to Befa's own rows (diveartsacademy@gmail.com):
             enrolments  her open courses, as her "2. STUDENTS" sheet has them
             certQueue   her courses with status "course done, waiting for
                         certificate"
             upcoming    her classes from today on (the Schedule Manager)
           plus, from the student portal, the certificates Befalia OS already
           made for those invoices and the portal students whose names match.
           The sheet read takes 30 to 45 seconds; the page keeps the last answer.

   Writes (POST, each one thing)
     {action:'status', sheet_row, student, invoice_no, to:'wait'|'done'}
           column A of that one block in her sheet: "course done, waiting for
           certificate" or "done (certificate issued-if required)". The sheet
           service refuses if the row no longer holds that student and invoice.
     {action:'cert', step:'submit'|'unsubmit'|'issue', invoice_no, agency,
           profile_id, course_name, number, issued_on, file_url}
           one certificate in the student portal (portal.befalia_certs).
     {action:'cert_file', profile_id, data_base64}
           stores the DAA certificate image, returns its address.
     {action:'match', names}
           portal students that could be these names.

   Gate: the OS key (x-os-key). Env: DAA_API_KEY (the sheet service key, the
   same one /api/classlog uses), BIZ_FEED_KEY (the portal door).
   --------------------------------------------------------------------------- */
import { createHash } from 'node:crypto';
import { requireKey } from './_auth.js';
import { academy, UUID_RE } from './_academy.js';

export const config = { maxDuration: 60 };

export const ME = 'diveartsacademy@gmail.com';
const DAA_FALLBACK_URL = 'https://script.google.com/macros/s/AKfycbwJ5s1d9I6-aEwufZq3HIL6ps4JURIAhqdytcm9vQzdTjmPOD6KfcCwVRxoBJqzxvVvrw/exec';
const daaUrl = () => process.env.DAA_API_URL || DAA_FALLBACK_URL;
export const STATUS_TO = { wait: 'course done, waiting for certificate', done: 'done (certificate issued-if required)' };
const AGENCIES = ['PADI', 'MFI', 'AIDA', 'EFR', 'DiveArts'];
export const REF_RE = /^[0-9a-f]{16}(-[0-9]{1,2})?(\.[a-z0-9]{1,8})?$/;

/* Packages (14 Oct 2026, Befa): a package is several courses, and every course
   in it gets its own certificate, both the DAA one and the agency one. Names
   follow PADI standards naming for Underwater Dance (her choice). The course
   text in her sheet decides which package it is; anything else is one course.
   Order is the order the student takes them. */
export const PACKAGES = [
  { test: (c) => /underwater dance/i.test(c) && /zero\s*to\s*hero/i.test(c),
    parts: [{ key: 'uwd', title: 'PADI Underwater Dance Specialty', agencies: ['PADI'] },
            { key: 'auwd', title: 'PADI Advanced Underwater Dance Specialty', agencies: ['PADI'] },
            { key: 'uwdi', title: 'PADI Underwater Dance Distinctive Specialty Instructor', agencies: ['PADI'] }] },
  { test: (c) => /mermaid instructor/i.test(c) && /zero\s*to\s*hero/i.test(c),
    parts: [{ key: 'mer', title: 'PADI Mermaid', agencies: ['PADI'] },
            { key: 'amer', title: 'PADI Advanced Mermaid', agencies: ['PADI'] },
            { key: 'efr', title: 'Emergency First Response (EFR)', agencies: ['EFR'] },
            { key: 'mi', title: 'PADI Mermaid Instructor', agencies: ['PADI'] }] },
  { test: (c) => /mermaid instructor/i.test(c) && /\bEFR\b|Emergency First Response/i.test(c),
    parts: [{ key: 'mi', title: 'PADI Mermaid Instructor', agencies: ['PADI'] },
            { key: 'efr', title: 'Emergency First Response (EFR)', agencies: ['EFR'] }] },
];
/* The courses inside one sheet block. A package lists its parts; any other
   course is a single part with no key, whose name the desk proposes. */
export function partsFor(course) {
  const pk = PACKAGES.find((p) => p.test(String(course || '')));
  if (pk) return pk.parts.map((x) => ({ ...x, agencies: x.agencies.slice() }));
  return [{ key: '', title: '', agencies: agenciesFor(course) }];
}

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

export function witaDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/* Which agency certificates a course leads to, read from its name. The DAA
   certificate is offered for every course, so it is not in this list. A
   bundle can name two. Nothing is guessed when the name says nothing. */
export function agenciesFor(course) {
  const c = String(course || '');
  const out = [];
  if (/\bPADI\b/i.test(c)) out.push('PADI');
  if (/\bMFI\b/i.test(c)) out.push('MFI');
  if (/\bAIDA\b/i.test(c)) out.push('AIDA');
  if (/\bEFR\b|Emergency First Response/i.test(c)) out.push('EFR');
  return out;
}

const enrolOut = (e) => ({
  sheet_row: Number(e.sheet_row) || 0, status: str(e.status, 60) || 'Status not set', student: str(e.student, 120),
  student_id: str(e.student_id, 40), has_email: !!str(e.email, 200), invoice_no: str(e.invoice_no, 40),
  course: str(e.course, 200), last_seen: str(e.last_seen, 40),
  sessions: Number(e.sessions) || 0, done: Number(e.done) || 0, plan: Number(e.plan) || 0,
  agencies: agenciesFor(e.course),
  parts: partsFor(e.course),
});

/* One reference per course block (14 Oct 2026, after review): invoice, student
   and course together. One invoice can hold two blocks (DAAMAY26-14 does: one
   student, two courses), so the invoice alone is not enough to tell them apart,
   and a sheet row number moves when rows are inserted. Identical blocks get
   -2, -3 in sheet order. The certificate in the portal carries this reference. */
export function refOf(e) {
  const k = [e.invoice_no, e.student, e.course].map((x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
  return createHash('sha1').update(k).digest('hex').slice(0, 16);
}
export function addRefs(lists) {
  const all = [].concat(...lists).sort((a, b) => a.sheet_row - b.sheet_row);
  const seen = {};
  all.forEach((e) => { const r = refOf(e); seen[r] = (seen[r] || 0) + 1; e.ref = seen[r] > 1 ? r + '-' + seen[r] : r; });
  const per = {};
  all.forEach((e) => { per[e.invoice_no] = (per[e.invoice_no] || 0) + 1; });
  all.forEach((e) => { e.blocks_on_invoice = per[e.invoice_no]; });
}

/* Befa's slice of the sheet service's bootstrap. Pure, so it can be tested. */
export function cut(boot, today) {
  const mine = (x) => String(x && x.instructor_email || '').toLowerCase() === ME;
  const enrolments = (boot.enrolments || []).filter(mine).map((e) => ({ ...enrolOut(e), whatsapp: str(e.whatsapp, 40) }));
  /* Each course carries the student's WhatsApp number, so the certificate can
     be sent from the card (also right after "Course finished" moves it).
     Befa's own desk, behind her key; she sends it herself. */
  const certQueue = (boot.certQueue || []).filter(mine).map((e) => ({ ...enrolOut(e), whatsapp: str(e.whatsapp, 40) }));
  addRefs([enrolments, certQueue]);
  const upcoming = (boot.assignments || [])
    .filter((a) => mine(a) && String(a.date || '') >= today && !/cancel/i.test(String(a.status || '')))
    .map((a) => ({ date: str(a.date, 10), start: str(a.start, 5), end: str(a.end, 5), student: str(a.student_name, 120),
                   course: str(a.course, 200), label: str(a.session_label, 80), venue: str(a.venue, 120), city: str(a.city, 40),
                   status: str(a.status, 30), invoice_no: str(a.invoice_no, 40) }))
    .sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
  return { enrolments, certQueue, upcoming };
}

async function bootstrap(fetchImpl) {
  const key = process.env.DAA_API_KEY;
  let r;
  try { r = await fetchImpl(daaUrl() + '?action=bootstrap&key=' + encodeURIComponent(key), { redirect: 'follow' }); }
  catch (e) { throw bad('The DAA sheet service could not be reached.', 502); }
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { throw bad('The DAA sheet service did not answer with JSON (it sometimes does when Google is slow). Refresh.', 502); }
  if (!j.ok) throw bad('The DAA sheet service refused: ' + (j.error || 'no reason given'), 502);
  return j;
}

async function sheetWrite(body, fetchImpl) {
  let r;
  try {
    r = await fetchImpl(daaUrl(), { method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key: process.env.DAA_API_KEY, actor: 'Befalia OS' }) });
  } catch (e) { throw bad('The DAA sheet service could not be reached. Nothing changed.', 502); }
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { throw bad('The DAA sheet service did not answer with JSON. Refresh before trying again.', 502); }
  if (!j.ok) throw bad(j.error || 'The DAA sheet service refused.', 409);
  return j;
}

export async function read(fetchImpl = fetch) {
  const today = witaDate();
  const boot = await bootstrap(fetchImpl);
  const out = cut(boot, today);
  const keys = [];
  /* Finished courses first: they are the ones whose certificates matter if the
     list is ever cut. */
  out.certQueue.concat(out.enrolments).filter((e) => e.invoice_no).forEach((e) => {
    e.parts.forEach((pt) => keys.push(e.invoice_no + ':' + e.ref + (pt.key ? '.' + pt.key : '')));
  });
  keys.splice(120);
  const names = [...new Set(out.certQueue.map((e) => e.student).filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < names.length; i += 20) chunks.push(names.slice(i, i + 20));
  const [certs, ...matched] = await Promise.all([
    keys.length ? academy({ action: 'certs', keys }, fetchImpl) : Promise.resolve({ ok: true, certs: [] }),
    ...chunks.map((c) => academy({ action: 'match', names: c }, fetchImpl)),
  ]);
  const badMatch = matched.find((m) => !m.ok);
  const portalError = !certs.ok ? certs.error : (badMatch ? badMatch.error : '');
  return { ok: true, at: new Date().toISOString(), today, ...out,
           certs: certs.ok ? certs.certs || [] : [], matches: badMatch ? [] : [].concat(...matched.map((m) => m.matches || [])),
           certQueueKnown: Array.isArray(boot.certQueue), portalError: portalError || '' };
}

export async function write(b, fetchImpl = fetch) {
  if (b.action === 'status') {
    const to = STATUS_TO[b.to];
    if (!to) throw bad('Unknown status.');
    const row = Number(b.sheet_row);
    if (!(row > 5)) throw bad('Which row? Refresh and try again.');
    if (!str(b.student, 120) || !str(b.invoice_no, 40)) throw bad('The student and invoice are needed so the sheet can check the row. Refresh and try again.');
    const j = await sheetWrite({ action: 'setEnrolStatus', instructor_email: ME, sheet_row: row,
      student: str(b.student, 120), invoice_no: str(b.invoice_no, 40), status: to }, fetchImpl);
    return { ok: true, sheet_row: j.sheet_row, from: j.from, to: j.to };
  }
  if (b.action === 'cert') {
    if (['submit', 'unsubmit', 'issue'].indexOf(b.step) < 0) throw bad('Unknown step.');
    if (AGENCIES.indexOf(b.agency) < 0) throw bad('Unknown agency.');
    if (!UUID_RE.test(String(b.profile_id || ''))) throw bad('Pick the student in the portal first.');
    if (!REF_RE.test(String(b.ref || ''))) throw bad('Which course? Refresh and try again.');
    const p = { action: 'cert_set', step: b.step, agency: b.agency, invoice_no: str(b.invoice_no, 40), ref: String(b.ref),
                profile_id: String(b.profile_id), course_name: str(b.course_name, 200), level: str(b.level, 120) };
    if (b.step === 'issue') {
      p.number = str(b.number, 60);
      p.issued_on = str(b.issued_on, 10);
      if (b.file_url) p.file_url = str(b.file_url, 300);
    }
    const j = await academy(p, fetchImpl);
    if (!j.ok) throw bad(j.error || 'The student portal refused.', 409);
    return { ok: true, cert: j.cert };
  }
  if (b.action === 'cert_file') {
    if (!UUID_RE.test(String(b.profile_id || ''))) throw bad('Pick the student in the portal first.');
    const data = String(b.data_base64 || '');
    if (data.length < 1000 || data.length > 4200000 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw bad('The certificate image did not arrive whole.');
    const j = await academy({ action: 'cert_file', profile_id: String(b.profile_id), data_base64: data }, fetchImpl);
    if (!j.ok) throw bad(j.error || 'The image could not be stored.', 502);
    return { ok: true, file_url: j.file_url };
  }
  if (b.action === 'match') {
    const names = (Array.isArray(b.names) ? b.names : []).map((n) => str(n, 80)).filter(Boolean).slice(0, 12);
    if (!names.length) return { ok: true, matches: [] };
    const j = await academy({ action: 'match', names }, fetchImpl);
    if (!j.ok) throw bad(j.error || 'The student portal did not answer.', 502);
    return { ok: true, matches: j.matches || [] };
  }
  throw bad('Unknown action.');
}

export default async function handler(req, res) {
  if (!requireKey(req, res)) return;
  if (!process.env.DAA_API_KEY && req.method === 'GET') {
    res.status(503).json({ ok: false, notConnected: true, error: 'Not connected yet: DAA_API_KEY needs to be added in Vercel (the Script Property DAA_API_KEY of "DAA Instructor - scripts").' });
    return;
  }
  try {
    if (req.method === 'GET') { res.status(200).json(await read()); return; }
    if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'GET or POST only' }); return; }
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = {}; } }
    b = b || {};
    if (b.action === 'status' && !process.env.DAA_API_KEY) throw bad('Not connected yet: DAA_API_KEY needs to be added in Vercel. Nothing changed.', 503);
    res.status(200).json(await write(b));
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Something failed.' });
  }
}
