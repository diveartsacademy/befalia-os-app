/* ---------------------------------------------------------------
   BEFALIA OS: CANCEL, RESTORE OR MOVE A CLASS          18 October 2026

   Asked by Befa: "click the X to delete a schedule in my calendar
   that shows in my to-do list, or reschedule it, all synchronized."

   Befalia OS knows a class by the Google Calendar event id(s) the
   morning sync wrote into its To-Do row (gcal:<id>). This action
   (WRITES_.classCalEdit) takes those ids and changes the class at its
   source, so the calendar, OS_SCHEDULE, the instructor pages, packing,
   reminders and the To-Do all agree:

     - a student course session is MANAGED from an OS_SCHEDULE row (its
       description says so, and the row holds its Event ID). It is
       changed through scApiSave_, exactly as the /academy Schedule
       screen does: status cancelled, status scheduled, or a new date,
       start and end. That save syncs the calendar itself.
     - a Bali regular class ("... · Regular class") or an all-day class
       block has no sheet row. Its event is edited directly, the same
       way scSync marks a cancelled class: title "CANCELLED · ...",
       grey, never deleted.

   op cancel   marks it cancelled (undo with restore)
   op restore  takes the cancel back
   op move     new date and times (timed class), or new first and last
               day (all-day block). Never to a day before today.

   It refuses, before writing anything: an id that is not on the
   DiveArts Bali or Jakarta calendar, an event that is part of a
   repeating series, an event that is not a class, a managed event
   whose OS_SCHEDULE row is gone, moving a cancelled or finished class,
   and a move that changes a timed class into an all-day one or back.
   Nobody is invited to any event, so Google emails no one. Nothing
   here sends a message to a student.

   Lives in its own file and registers itself in WRITES_ the way
   ScheduleCalendar.gs does, so Code.gs is not edited.
   --------------------------------------------------------------- */
var BC_MAX_IDS = 12;
var BC_CANCEL = 'CANCELLED · ';
var BC_CLASS_WORDS = /class|mermaid|dance|\buw\b|course/i;

function bcStr_(v) { return String(v == null ? '' : v).trim(); }
function bcBare_(id) { return bcStr_(id).replace(/@google\.com$/i, ''); }
function bcRealDate_(v) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bcStr_(v));
  if (!m) return false;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
function bcTime_(v) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(bcStr_(v));
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return (+m[1] < 10 ? '0' : '') + (+m[1]) + ':' + m[2];
}
function bcAddDays_(ymd, n) {
  var p = ymd.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

/** The event on either DiveArts calendar, by its id with or without @google.com. */
function bcFind_(bare) {
  var keys = ['Bali', 'Jakarta'];
  for (var i = 0; i < keys.length; i++) {
    var ev = scFindEvent(keys[i], bare + '@google.com') || scFindEvent(keys[i], bare);
    if (ev) return { calKey: keys[i], ev: ev };
  }
  return null;
}

/** The move the caller asked for, checked. Timed: date, start, end. All-day: date, endDate. */
function bcMove_(p, today) {
  var m = p.move || {};
  var date = bcStr_(m.date);
  if (!bcRealDate_(date)) throw new Error('Pick the new date.');
  if (date < today) throw new Error('The new date ' + date + ' is before today. A class can only move to today or later.');
  var start = bcStr_(m.start), end = bcStr_(m.end);
  if (start || end) {
    var s = bcTime_(start), e = bcTime_(end);
    if (!s || !e) throw new Error('Give the new start and end as times, for example 10:00 and 12:00.');
    if (e <= s) throw new Error('The end time has to be after the start time.');
    return { allDay: false, date: date, start: s, end: e };
  }
  var last = bcStr_(m.endDate) || date;
  if (!bcRealDate_(last) || last < date) throw new Error('The last day has to be on or after the first day.');
  if (bcAddDays_(date, 31) < last) throw new Error('A class block can be at most a month long.');
  return { allDay: true, date: date, endDate: last };
}

function bcStamp_() { return Utilities.formatDate(new Date(), 'Asia/Makassar', 'd MMM yyyy HH:mm') + ' WITA'; }

function bcNote_(ev, line) {
  try { ev.setDescription(bcStr_(ev.getDescription()) + (bcStr_(ev.getDescription()) ? '\n' : '') + line); } catch (e) { /* the change itself is what matters */ }
}

/** One event as it is now, for the answer. */
function bcState_(bare) {
  var h = bcFind_(bare);
  if (!h) return { id: bare, missing: true };
  var ev = h.ev, tz = SC.CAL[h.calKey].tz, all = ev.isAllDayEvent();
  var stz = Session.getScriptTimeZone();
  return {
    id: bare, cal: h.calKey, title: ev.getTitle(), allDay: all,
    cancelled: ev.getTitle().indexOf('CANCELLED') === 0,
    start: all ? Utilities.formatDate(ev.getAllDayStartDate(), stz, 'yyyy-MM-dd') : Utilities.formatDate(ev.getStartTime(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    end: all ? Utilities.formatDate(ev.getAllDayEndDate(), stz, 'yyyy-MM-dd') : Utilities.formatDate(ev.getEndTime(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX")
  };
}

function bcClassEdit_(p, actor) {
  var op = bcStr_(p && p.op);
  if (['cancel', 'restore', 'move'].indexOf(op) === -1) throw new Error('Unknown change "' + op.slice(0, 20) + '".');
  var raw = Array.isArray(p.ids) ? p.ids : [];
  var ids = [], seenId = {};
  raw.forEach(function (x) { var b = bcBare_(x); if (b && !seenId[b]) { seenId[b] = true; ids.push(b); } });
  if (!ids.length) throw new Error('Which class? No calendar event id came with the request.');
  if (ids.length > BC_MAX_IDS) throw new Error('At most ' + BC_MAX_IDS + ' calendar events in one change.');
  ids.forEach(function (b) { if (!/^[A-Za-z0-9_]{5,200}$/.test(b)) throw new Error('"' + b.slice(0, 40) + '" is not a calendar event id.'); });

  var today = Utilities.formatDate(new Date(), 'Asia/Makassar', 'yyyy-MM-dd');
  var mv = op === 'move' ? bcMove_(p, today) : null;

  // 1. Find every event and its sheet row. Nothing is written until all of them pass.
  var ss = scSs(), tz = ss.getSpreadsheetTimeZone(), S = scReadSchedule(ss, false);
  var byEv = {};
  for (var r = S.hr + 1; r < S.values.length; r++) {
    var o = scRowObj(S, r, tz);
    if (scIsBlankRow(o)) continue;
    var e = bcBare_(o.eventId);
    if (e) (byEv[e] = byEv[e] || []).push(o);
  }
  var managed = [], direct = [];
  ids.forEach(function (bare) {
    var rows = byEv[bare] || [];
    if (rows.length > 1) throw new Error('Two OS_SCHEDULE rows point at the same calendar event (' + rows.map(function (x) { return bcStr_(x.osId); }).join(', ') + '). Nothing changed. Fix the sheet first.');
    var hit = bcFind_(bare);
    if (rows.length) {
      var row = rows[0], st = scNorm(row.status);
      if (op === 'move') {
        if (/cancel|done|no_show|resched/.test(st)) throw new Error(bcStr_(row.student) + ' ' + bcStr_(row.session) + ' is ' + st + '. Only a class still to come can be moved. Nothing changed.');
        if (!scCityKey(row.city)) throw new Error(bcStr_(row.student) + ' ' + bcStr_(row.session) + ' has no City on OS_SCHEDULE. Nothing changed.');
        if (mv.allDay) throw new Error('A student session needs a start and end time. Nothing changed.');
      }
      if (op === 'cancel' && /done|no_show/.test(st)) throw new Error(bcStr_(row.student) + ' ' + bcStr_(row.session) + ' is already ' + st + '. Nothing changed.');
      managed.push({ id: bare, row: row, hit: hit });
      return;
    }
    if (!hit) throw new Error('Calendar event ' + bare + ' is not on the DiveArts Bali or Jakarta calendar any more. Nothing changed.');
    var ev = hit.ev, desc = bcStr_(ev.getDescription());
    if (/Managed from OS_SCHEDULE row/i.test(desc)) throw new Error('"' + ev.getTitle() + '" belongs to an OS_SCHEDULE row that no longer holds its Event ID. Nothing changed. Fix it on the /academy Schedule screen.');
    if (ev.isRecurringEvent()) throw new Error('"' + ev.getTitle() + '" is part of a repeating series, which this does not change. Nothing changed.');
    var title = ev.getTitle().replace(/^(CANCELLED|MOVED TO [A-Z]+) · /, '');
    var isClass = /·\s*regular class\s*$/i.test(title) || (ev.isAllDayEvent() && BC_CLASS_WORDS.test(title));
    if (!isClass) throw new Error('"' + ev.getTitle() + '" does not look like a class. Nothing changed.');
    if (op === 'move') {
      if (ev.getTitle().indexOf('CANCELLED') === 0) throw new Error('"' + title + '" is cancelled. Restore it first, then move it. Nothing changed.');
      if (ev.isAllDayEvent() !== mv.allDay) throw new Error(mv.allDay ? '"' + title + '" has times. Give a start and end time.' : '"' + title + '" is an all-day block. Give the first and last day, no times.');
    }
    direct.push({ id: bare, hit: hit, title: title });
  });

  // 2. Classes with an OS_SCHEDULE row: one save, the same path as /academy Schedule.
  var save = null, changes = [];
  managed.forEach(function (m) {
    var st = scNorm(m.row.status), set = null;
    if (op === 'cancel' && !/cancel/.test(st)) set = { status: 'cancelled' };
    if (op === 'restore' && /cancel/.test(st)) set = { status: 'scheduled' };
    if (op === 'move') set = { date: mv.date, start: mv.start, end: mv.end };
    if (set) changes.push({ osId: bcStr_(m.row.osId), invoice: bcStr_(m.row.invoice), student: bcStr_(m.row.student), set: set });
  });
  if (changes.length) save = scApiSave_({ changes: changes, adds: [] }, actor);
  // scSync renames a cancelled event but keeps its "Status:" line; packing reads that line.
  if (op === 'cancel') managed.forEach(function (m) {
    var h = bcFind_(m.id);
    if (!h) return;
    var d0 = bcStr_(h.ev.getDescription());
    if (/^Status:.*$/m.test(d0) && !/^Status:\s*cancel/im.test(d0)) { try { h.ev.setDescription(d0.replace(/^Status:.*$/m, 'Status: cancelled')); } catch (e) {} }
  });

  // 3. Regular classes and all-day blocks: the event itself.
  var stamp = bcStamp_(), errors = [];
  direct.forEach(function (d) {
    var ev = d.hit.ev;
    try {
      if (op === 'cancel') {
        if (ev.getTitle().indexOf('CANCELLED') !== 0) {
          ev.setTitle(BC_CANCEL + ev.getTitle());
          ev.setColor(CalendarApp.EventColor.GRAY);
          bcNote_(ev, 'Cancelled by Befa in Befalia OS on ' + stamp + '.');
        }
      } else if (op === 'restore') {
        if (ev.getTitle().indexOf(BC_CANCEL) === 0) {
          ev.setTitle(ev.getTitle().slice(BC_CANCEL.length));
          try { ev.setColor(''); } catch (colourErr) { /* title is what counts */ }
          bcNote_(ev, 'Restored by Befa in Befalia OS on ' + stamp + '.');
        }
      } else if (mv.allDay) {
        var stz = Session.getScriptTimeZone();
        var was = bcState_(d.id);
        var first = Utilities.parseDate(mv.date + ' 12:00', stz, 'yyyy-MM-dd HH:mm');
        if (mv.endDate === mv.date) ev.setAllDayDate(first);
        else ev.setAllDayDates(first, Utilities.parseDate(bcAddDays_(mv.endDate, 1) + ' 12:00', stz, 'yyyy-MM-dd HH:mm'));
        bcNote_(ev, 'Moved by Befa in Befalia OS on ' + stamp + ', was ' + was.start + ' to ' + bcAddDays_(was.end, -1) + '.');
      } else {
        var ctz = SC.CAL[d.hit.calKey].tz;
        var was2 = bcState_(d.id);
        ev.setTime(Utilities.parseDate(mv.date + ' ' + mv.start, ctz, 'yyyy-MM-dd HH:mm'),
                   Utilities.parseDate(mv.date + ' ' + mv.end, ctz, 'yyyy-MM-dd HH:mm'));
        bcNote_(ev, 'Moved by Befa in Befalia OS on ' + stamp + ', was ' + was2.start + ' to ' + was2.end + '.');
      }
    } catch (err) { errors.push(d.title + ': ' + (err && err.message || err)); }
  });

  var cal = save && save.calendar;
  return {
    ok: errors.length === 0, op: op, by: bcStr_(actor),
    error: errors.length ? 'Not every calendar event changed: ' + errors.join('; ') : undefined,
    managed: managed.length, changed: changes.length, direct: direct.length,
    calendar: cal || null, syncError: (save && save.syncError) || '',
    deferred: (cal && cal.deferred) || 0,
    events: ids.map(bcState_)
  };
}

function bcRegisterApi_() {
  if (typeof WRITES_ !== 'object' || !WRITES_) return false;
  WRITES_.classCalEdit = function (p, actor) {
    var out = bcClassEdit_(p, actor);
    return { id: out.events.map(function (e) { return e.id; }).join(' '),
             detail: out.op + ' ' + out.managed + ' sheet, ' + out.direct + ' calendar' + (out.ok ? '' : ' (' + out.error + ')'), body: out };
  };
  return true;
}
var BC_API_REGISTERED = bcRegisterApi_();

/* Node test hook. */
if (typeof module !== 'undefined') {
  module.exports = { bcClassEdit_: bcClassEdit_, bcMove_: bcMove_, bcBare_: bcBare_ };
}
