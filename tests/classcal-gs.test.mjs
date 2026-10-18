/* Tests for apps-script/daa-instructor/BefaliaClass.gs (cancel, restore or
   move a class from Befalia OS). Run: node tests/classcal-gs.test.mjs
   The .gs runs in a sandbox. The helpers it borrows from ScheduleCalendar.gs
   (scFindEvent, scReadSchedule, scApiSave_ ...) are stand-ins with the same
   contract, and the calendar is a fake. Nothing touches Google. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(new URL('../apps-script/daa-instructor/BefaliaClass.gs', import.meta.url), 'utf8');

function pad(n) { return (n < 10 ? '0' : '') + n; }
// Formats a Date in a fixed-offset zone, enough for the patterns the file uses.
function fmt(d, tz, pat) {
  const off = { 'Asia/Makassar': 8, 'Asia/Jakarta': 7 }[tz] ?? 8;
  const x = new Date(d.getTime() + off * 3600000);
  const ymd = x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
  const hm = pad(x.getUTCHours()) + ':' + pad(x.getUTCMinutes());
  if (pat === 'yyyy-MM-dd') return ymd;
  if (pat === "yyyy-MM-dd'T'HH:mm:ssXXX") return ymd + 'T' + hm + ':00+' + pad(off) + ':00';
  return ymd + ' ' + hm;
}
function parse(s, tz) {
  const off = { 'Asia/Makassar': 8, 'Asia/Jakarta': 7 }[tz] ?? 8;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - off, +m[5]));
}

let events, rows, saves, NOW;
function ev(o) {
  const e = { id: o.id, cal: o.cal, title: o.title, desc: o.desc || '', allDay: !!o.allDay, rec: !!o.rec, color: '',
    start: o.start, end: o.end };
  return Object.assign(e, {
    getTitle: () => e.title, setTitle: (t) => { e.title = t; },
    getDescription: () => e.desc, setDescription: (d) => { e.desc = d; },
    setColor: (c) => { e.color = c; }, isAllDayEvent: () => e.allDay, isRecurringEvent: () => e.rec,
    getStartTime: () => e.start, getEndTime: () => e.end,
    getAllDayStartDate: () => e.start, getAllDayEndDate: () => e.end,
    setTime: (s, x) => { e.start = s; e.end = x; },
    setAllDayDate: (d) => { e.start = d; e.end = new Date(d.getTime() + 86400000); },
    setAllDayDates: (s, x) => { e.start = s; e.end = x; },
  });
}
function setup() {
  NOW = new Date(Date.UTC(2026, 9, 18, 15, 0)); // 18 Oct 2026 23:00 WITA
  events = [
    ev({ id: 'courseev01', cal: 'Bali', title: 'Delphine Putri Oka · Open water 2 of 2 · 09:00 WITA',
      desc: 'Course: Mermaid\nInvoice: DAAOCT26-6\nInstructor: Befalia Aisarahmadani\nStatus: scheduled\n\nManaged from OS_SCHEDULE row DAAOCT26-6-S1-OW2. Change the sheet, not this event: the sheet wins on the next sync.',
      start: parse('2026-10-25 09:00', 'Asia/Makassar'), end: parse('2026-10-25 11:00', 'Asia/Makassar') }),
    ev({ id: 'regularev1', cal: 'Bali', title: 'Mermaid Class (Kids) · Regular class', desc: 'Regular class, confirmed by Befa.',
      start: parse('2026-10-25 10:00', 'Asia/Makassar'), end: parse('2026-10-25 12:00', 'Asia/Makassar') }),
    ev({ id: 'blockev001', cal: 'Bali', title: 'UW Dance', allDay: true,
      start: parse('2026-10-19 12:00', 'Asia/Makassar'), end: parse('2026-10-24 12:00', 'Asia/Makassar') }),
    ev({ id: 'placeholdr', cal: 'Bali', title: 'Mermaid Course', rec: true,
      start: parse('2026-10-24 13:00', 'Asia/Makassar'), end: parse('2026-10-24 15:00', 'Asia/Makassar') }),
    ev({ id: 'meetingev1', cal: 'Jakarta', title: 'Meeting with PADI', desc: '',
      start: parse('2026-10-26 10:00', 'Asia/Jakarta'), end: parse('2026-10-26 11:00', 'Asia/Jakarta') }),
    ev({ id: 'orphanev01', cal: 'Bali', title: 'Ghost · Pool 1 of 2 · 10:00 WITA', desc: 'Managed from OS_SCHEDULE row X-1.',
      start: parse('2026-10-27 10:00', 'Asia/Makassar'), end: parse('2026-10-27 12:00', 'Asia/Makassar') }),
  ];
  rows = [
    { osId: 'DAAOCT26-6-S1-OW2', invoice: 'DAAOCT26-6', student: 'Delphine Putri Oka', session: 'Open water 2 of 2', status: 'scheduled', city: 'Bali', eventId: 'courseev01@google.com' },
  ];
  saves = [];
}
const ctx = vm.createContext({
  console,
  SC: { CAL: { Bali: { tz: 'Asia/Makassar' }, Jakarta: { tz: 'Asia/Jakarta' } } },
  Session: { getScriptTimeZone: () => 'Asia/Makassar' },
  Utilities: { formatDate: (d, tz, p) => fmt(d.getTime ? d : new Date(d), tz, p), parseDate: (s, tz) => parse(s, tz) },
  CalendarApp: { EventColor: { GRAY: '8' } },
  scFindEvent: (calKey, id) => events.find((e) => e.cal === calKey && (e.id + '@google.com' === id)) || null,
  scSs: () => ({ getSpreadsheetTimeZone: () => 'Asia/Makassar' }),
  scReadSchedule: () => ({ hr: 0, values: [null].concat(rows) }),
  scRowObj: (S, r) => S.values[r],
  scIsBlankRow: (o) => !o.student && !o.invoice,
  scNorm: (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(),
  scCityKey: (c) => (/bali/i.test(c) ? 'Bali' : /jakarta|bogor/i.test(c) ? 'Jakarta' : ''),
  scApiSave_: (p, actor) => {
    saves.push({ p, actor });
    p.changes.forEach((c) => {
      const row = rows.find((r) => r.osId === c.osId);
      Object.assign(row, c.set);
      const e = events.find((x) => x.id + '@google.com' === row.eventId);
      if (c.set.status === 'cancelled' && e.title.indexOf('CANCELLED') !== 0) e.title = 'CANCELLED · ' + e.title;
      if (c.set.status === 'scheduled') e.title = e.title.replace(/^CANCELLED · /, '');
      if (c.set.date) { e.start = parse(c.set.date + ' ' + c.set.start, 'Asia/Makassar'); e.end = parse(c.set.date + ' ' + c.set.end, 'Asia/Makassar'); }
    });
    return { calendar: { created: 0, updated: p.changes.length, cancelled: 0, deferred: 0, errors: [] }, syncError: '' };
  },
});
vm.runInContext(SRC, ctx);
// The fake clock: the file reads "today" through Utilities.formatDate(new Date()).
const RealDate = Date;
ctx.Date = class extends RealDate { constructor(...a) { if (!a.length) return new RealDate(NOW); super(...a); } static UTC(...a) { return RealDate.UTC(...a); } };
vm.runInContext('Date = this.Date', ctx);
const run = (p) => vm.runInContext('bcClassEdit_', ctx)(p, 'Befalia OS');
const find = (id) => events.find((e) => e.id === id);

let n = 0;
function test(name, fn) { setup(); try { fn(); n++; console.log('ok', name); } catch (e) { console.error('FAIL', name); throw e; } }

test('cancel a student session goes through the sheet, not the event', () => {
  const out = run({ op: 'cancel', ids: ['courseev01'] });
  assert.equal(out.ok, true);
  assert.equal(saves.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0].p.changes)), [{ osId: 'DAAOCT26-6-S1-OW2', invoice: 'DAAOCT26-6', student: 'Delphine Putri Oka', set: { status: 'cancelled' } }]);
  assert.equal(rows[0].status, 'cancelled');
  assert.match(find('courseev01').desc, /^Status: cancelled$/m, 'packing reads the Status line');
  assert.equal(out.events[0].cancelled, true);
});

test('cancel twice changes nothing the second time', () => {
  run({ op: 'cancel', ids: ['courseev01'] });
  const out = run({ op: 'cancel', ids: ['courseev01'] });
  assert.equal(saves.length, 1);
  assert.equal(out.changed, 0);
});

test('restore a cancelled student session sets it back to scheduled', () => {
  run({ op: 'cancel', ids: ['courseev01'] });
  const out = run({ op: 'restore', ids: ['courseev01'] });
  assert.equal(out.ok, true);
  assert.equal(rows[0].status, 'scheduled');
  assert.equal(find('courseev01').title.indexOf('CANCELLED'), -1);
});

test('move a student session writes date, start and end to the sheet', () => {
  const out = run({ op: 'move', ids: ['courseev01'], move: { date: '2026-10-26', start: '14:00', end: '16:00' } });
  assert.equal(out.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0].p.changes[0].set)), { date: '2026-10-26', start: '14:00', end: '16:00' });
  assert.equal(out.events[0].start, '2026-10-26T14:00:00+08:00');
});

test('cancel a regular class edits the event: CANCELLED, grey, a note, never deleted', () => {
  const out = run({ op: 'cancel', ids: ['regularev1'] });
  assert.equal(out.ok, true);
  assert.equal(saves.length, 0);
  const e = find('regularev1');
  assert.equal(e.title, 'CANCELLED · Mermaid Class (Kids) · Regular class');
  assert.equal(e.color, '8');
  assert.match(e.desc, /Cancelled by Befa in Befalia OS on .*2026.* WITA\./);
  assert.ok(events.includes(e));
});

test('restore a regular class takes the prefix and grey off', () => {
  run({ op: 'cancel', ids: ['regularev1'] });
  run({ op: 'restore', ids: ['regularev1'] });
  const e = find('regularev1');
  assert.equal(e.title, 'Mermaid Class (Kids) · Regular class');
  assert.equal(e.color, '');
});

test('move a regular class keeps its length rules and says where it was', () => {
  const out = run({ op: 'move', ids: ['regularev1'], move: { date: '2026-11-01', start: '10:30', end: '12:30' } });
  assert.equal(out.ok, true);
  assert.equal(out.events[0].start, '2026-11-01T10:30:00+08:00');
  assert.equal(out.events[0].end, '2026-11-01T12:30:00+08:00');
  assert.match(find('regularev1').desc, /was 2026-10-25T10:00:00\+08:00 to 2026-10-25T12:00:00\+08:00/);
});

test('move an all-day block to new first and last days', () => {
  const out = run({ op: 'move', ids: ['blockev001'], move: { date: '2026-10-26', endDate: '2026-10-30' } });
  assert.equal(out.ok, true);
  assert.equal(out.events[0].start, '2026-10-26');
  assert.equal(out.events[0].end, '2026-10-31', 'end is exclusive on the calendar');
  const one = run({ op: 'move', ids: ['blockev001'], move: { date: '2026-11-02' } });
  assert.equal(one.events[0].start, '2026-11-02');
  assert.equal(one.events[0].end, '2026-11-03');
});

test('refusals write nothing', () => {
  const before = JSON.stringify(events.map((e) => [e.title, e.desc, e.start, e.end])) + JSON.stringify(rows);
  const no = (p, re) => assert.throws(() => run(p), re);
  no({ op: 'delete', ids: ['regularev1'] }, /Unknown change/);
  no({ op: 'cancel', ids: [] }, /No calendar event id/);
  no({ op: 'cancel', ids: ['bad id!'] }, /not a calendar event id/);
  no({ op: 'cancel', ids: ['nosuchev01'] }, /not on the DiveArts Bali or Jakarta calendar/);
  no({ op: 'cancel', ids: ['placeholdr'] }, /repeating series/);
  no({ op: 'cancel', ids: ['meetingev1'] }, /does not look like a class/);
  no({ op: 'cancel', ids: ['orphanev01'] }, /no longer holds its Event ID/);
  no({ op: 'move', ids: ['regularev1'], move: { date: '2026-10-17', start: '10:00', end: '12:00' } }, /before today/);
  no({ op: 'move', ids: ['regularev1'], move: { date: '2026-02-30', start: '10:00', end: '12:00' } }, /Pick the new date/);
  no({ op: 'move', ids: ['regularev1'], move: { date: '2026-10-26', start: '12:00', end: '10:00' } }, /end time has to be after/);
  no({ op: 'move', ids: ['regularev1'], move: { date: '2026-10-26' } }, /has times/);
  no({ op: 'move', ids: ['blockev001'], move: { date: '2026-10-26', start: '10:00', end: '12:00' } }, /all-day block/);
  no({ op: 'move', ids: ['blockev001'], move: { date: '2026-10-26', endDate: '2026-10-25' } }, /last day has to be on or after/);
  no({ op: 'move', ids: ['courseev01'], move: { date: '2026-10-26' } }, /needs a start and end time/);
  // a mix: one good id and one bad one changes neither
  no({ op: 'cancel', ids: ['regularev1', 'meetingev1'] }, /does not look like a class/);
  assert.equal(JSON.stringify(events.map((e) => [e.title, e.desc, e.start, e.end])) + JSON.stringify(rows), before);
  assert.equal(saves.length, 0);
});

test('a cancelled class cannot be moved until it is restored', () => {
  run({ op: 'cancel', ids: ['regularev1', 'courseev01'] });
  assert.throws(() => run({ op: 'move', ids: ['regularev1'], move: { date: '2026-10-26', start: '10:00', end: '12:00' } }), /Restore it first/);
  assert.throws(() => run({ op: 'move', ids: ['courseev01'], move: { date: '2026-10-26', start: '10:00', end: '12:00' } }), /is cancelled/);
});

test('ids with @google.com and duplicates are folded together', () => {
  const out = run({ op: 'cancel', ids: ['regularev1@google.com', 'regularev1'] });
  assert.equal(out.events.length, 1);
  assert.equal(out.direct, 1);
});

console.log(n + ' passed');
