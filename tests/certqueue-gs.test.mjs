/* Tests for the certificate additions to "DAA Instructor - scripts"
   (apps-script/daa-instructor/Certificates.gs, appended to its main file on
   14 Oct 2026). Run: node tests/certqueue-gs.test.mjs
   The .gs code runs in a sandbox against a fake "2. STUDENTS" tab; the
   helpers it calls are small stand-ins with the same contract as the real
   ones in the instructor script. Nothing touches a real sheet. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const HEAD = ['Status', 'Name', 'Student ID', 'Whatsapp', 'Email', 'F', 'Invoice', 'Course', 'I', 'J', 'K', 'Price', 'M', 'N', 'O', 'Date', 'Location', 'Session', 'Cost', 'Note'];
function sheetRows() {
  const blank = () => Array(20).fill('');
  const rows = [blank(), blank(), blank(), blank(), HEAD.slice()];
  const block = (status, name, inv, course, dates) => {
    dates.forEach((d, i) => { const r = blank(); if (i === 0) { r[0] = status; r[1] = name; r[4] = name.toLowerCase() + '@x.id'; r[6] = inv; r[7] = course; } r[15] = d; rows.push(r); });
  };
  block('In Progress', 'Claire', 'DAAJUN26-3', 'Mermaid Kids', ['2026-09-01', '2026-09-08', '3']);
  block('Course done, waiting for certificate', 'Teneille Douglas', 'DAAJUL26-9', 'Mermaid Course - Adult - Beginner - PADI Mermaid', ['2026-09-02', '2026-09-03', '2026-09-04']);
  block('Done (certificate issued-if required)', 'Viola', 'DAAMAY26-1', 'MFI M1', ['2026-05-01']);
  return rows;
}
let rows, written, validation, locks;
function fakeSheet() {
  return {
    getLastRow: () => rows.length,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getDisplayValues: () => rows.slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)),
        setValue(v) { rows[r - 1][c - 1] = v; written.push([r, c, v]); },
        getDataValidation: () => validation,
      };
    },
  };
}
const ctx = vm.createContext({
  console,
  SpreadsheetApp: {
    openById: (id) => { if (id !== 'BOOK') throw new Error('no access'); return { getSheetByName: (n) => (n === '2. STUDENTS' ? fakeSheet() : null) }; },
    flush() {},
    DataValidationCriteria: { VALUE_IN_LIST: 'VALUE_IN_LIST' },
  },
  LockService: { getScriptLock: () => ({ waitLock() { locks++; }, releaseLock() { locks--; } }) },
});
vm.runInContext(`
  var S_ = function(v){ return String(v == null ? '' : v).trim(); };
  var ENROL_BOOKS_ = [{ email: 'diveartsacademy@gmail.com', id: 'BOOK' }];
  var ENROL_TAB_ = '2. STUDENTS', ENROL_HEAD_ = 5;
  var ENROL_OPEN_ = ['in progress', 'not passed', 'not started yet'];
  var ENROL_DONE_ = ['course done, waiting for certificate', 'done (certificate issued-if required)', 'done'];
  function enrolCurriculum_(){ return {}; }
  function enrolSessionsFor_(course){ return /PADI Mermaid/.test(course) ? 3 : 0; }
  function enrolTaught_(v){ return /^\\d{4}-\\d{2}-\\d{2}/.test(S_(v)); }
  function enrolLayoutOk_(sh){ var h = sh.getRange(ENROL_HEAD_, 1, 1, 20).getDisplayValues()[0]; return /^name/i.test(h[1]) && /^inv/i.test(h[6]) && /^course/i.test(h[7]); }
  var WRITES_ = {};
`, ctx);
vm.runInContext(fs.readFileSync(new URL('../apps-script/daa-instructor/Certificates.gs', import.meta.url), 'utf8'), ctx);
const certQueue = vm.runInContext('certQueue_', ctx);
const setStatus = vm.runInContext('WRITES_.setEnrolStatus', ctx);
const reset = () => { rows = sheetRows(); written = []; validation = null; locks = 0; };
let n = 0; const t = (name, fn) => { reset(); fn(); n++; console.log('ok', n, name); };

t('certQueue lists only "course done, waiting for certificate", with its block counted', () => {
  const q = certQueue();
  assert.equal(q.length, 1);
  assert.equal(q[0].student, 'Teneille Douglas'); assert.equal(q[0].sheet_row, 9); assert.equal(q[0].done, 3); assert.equal(q[0].plan, 3);
  assert.equal(q[0].last_seen, '2026-09-04'); assert.equal(q[0].email, 'teneille douglas@x.id');
});

t('setEnrolStatus writes column A of that one row, spelled as the dropdown spells it', () => {
  validation = { getCriteriaType: () => 'VALUE_IN_LIST', getCriteriaValues: () => [['In Progress', 'Course done, waiting for certificate', 'Done (certificate issued-if required)']] };
  const out = setStatus({ instructor_email: 'diveartsacademy@gmail.com', sheet_row: 6, student: 'Claire', invoice_no: 'DAAJUN26-3', status: 'course done, waiting for certificate' }, 'test');
  assert.equal(out.body.ok, true); assert.equal(out.body.from, 'In Progress'); assert.equal(out.body.to, 'Course done, waiting for certificate');
  assert.deepEqual(written, [[6, 1, 'Course done, waiting for certificate']]);
  assert.equal(locks, 0, 'lock released');
  assert.equal(certQueue().length, 2, 'Claire now waits for her certificate too');
});

t('a row that moved, an unknown status, an unknown workbook and a bad row write nothing', () => {
  const base = { instructor_email: 'diveartsacademy@gmail.com', sheet_row: 6, student: 'Claire', invoice_no: 'DAAJUN26-3', status: 'done' };
  assert.throws(() => setStatus({ ...base, student: 'Someone Else' }), /no longer holds/);
  assert.throws(() => setStatus({ ...base, invoice_no: 'DAAJUN26-4' }), /no longer holds/);
  assert.throws(() => setStatus({ ...base, status: 'Graduated' }), /Unknown course status/);
  assert.throws(() => setStatus({ ...base, instructor_email: 'x@y.z' }), /No instructor workbook/);
  assert.throws(() => setStatus({ ...base, sheet_row: 3 }), /A sheet row is required/);
  assert.throws(() => setStatus({ ...base, sheet_row: 999 }), /past the end/);
  assert.deepEqual(written, []);
  assert.equal(locks, 0, 'lock always released');
});

t('without a dropdown the status is written as given', () => {
  const out = setStatus({ instructor_email: 'diveartsacademy@gmail.com', sheet_row: 9, student: 'Teneille Douglas', invoice_no: 'DAAJUL26-9', status: 'Done (certificate issued-if required)' }, 'test');
  assert.equal(out.body.to, 'Done (certificate issued-if required)');
  assert.equal(certQueue().length, 0);
});

console.log(`\n${n} passed`);
