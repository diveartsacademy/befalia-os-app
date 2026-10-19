/* ---------------------------------------------------------------
   BEFALIA OS: HUTANG BEFA, READ AND TICK               19 October 2026

   Asked by Befa: the Finance tab of Befalia OS reads her own debt list
   (tab "HUTANG BEFA" of the sheet FINANCIAL REPORT BEFALIA), and a
   payment ticked in the app ticks column A of that row. The Google
   Sheet stays the master; Befa keeps editing it by hand.

   hutangRead   read only. Columns A to F of every row, as the app needs
                them: the column A tick, the name in B, the date in C
                (an ISO date when the cell holds a date, its text when
                not), the amount in D (a number when it is one), and the
                text of E and F. Nothing is written.
   hutangTick   writes column A of the rows named, true or false. Every
                row is checked first: it must be inside the list, and
                its column B or E text must still be what the app saw,
                so a sheet that moved under the app is refused instead
                of written. One refusal writes nothing at all.

   When Google refuses the write (Befa's Drive storage is full, so the
   file cannot be saved), the error comes back as storage:true and the
   app keeps the tick to send again later. Nothing else is touched.

   Lives in its own file and registers itself in WRITES_ the way
   BefaliaClass.gs does, so Code.gs is not edited. The activity log
   gets the action name and row numbers only, never an amount.
   --------------------------------------------------------------- */
var HB_ID = '1iVAYkNJJLYTeuL-xluOW_-HO3nTKBnRFmi8GvMnwhho';
var HB_TAB = 'HUTANG BEFA';
var HB_MAX_ROWS = 800;
var HB_MAX_TICKS = 40;

function hbStr_(v) { return String(v == null ? '' : v).trim(); }

function hbSheet_() {
  var ss = SpreadsheetApp.openById(HB_ID);
  var sh = ss.getSheetByName(HB_TAB);
  if (!sh) throw new Error('The tab ' + HB_TAB + ' is not in FINANCIAL REPORT BEFALIA.');
  return { ss: ss, sh: sh, tz: ss.getSpreadsheetTimeZone() || 'Asia/Makassar' };
}

function hbCell_(v, shown, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) return { d: Utilities.formatDate(v, tz, 'yyyy-MM-dd'), t: hbStr_(shown) };
  if (typeof v === 'number') return { n: v, t: hbStr_(shown) };
  if (typeof v === 'boolean') return { b: v, t: hbStr_(shown) };
  return { t: hbStr_(shown) };
}

function hbRead_() {
  var s = hbSheet_();
  var last = Math.min(s.sh.getLastRow(), HB_MAX_ROWS);
  if (last < 1) return { ok: true, rows: [], tz: s.tz };
  var rng = s.sh.getRange(1, 1, last, 6);
  var vals = rng.getValues(), shown = rng.getDisplayValues();
  var rows = [];
  for (var i = 0; i < vals.length; i++) {
    var empty = true;
    for (var c = 0; c < 6; c++) if (hbStr_(shown[i][c]) !== '' && !(c === 0 && vals[i][0] === false)) { empty = false; break; }
    if (empty) continue;
    rows.push({
      r: i + 1,
      a: vals[i][0] === true,
      b: hbStr_(shown[i][1]),
      c: hbCell_(vals[i][2], shown[i][2], s.tz),
      d: hbCell_(vals[i][3], shown[i][3], s.tz),
      e: hbStr_(shown[i][4]),
      f: hbCell_(vals[i][5], shown[i][5], s.tz)
    });
  }
  return { ok: true, rows: rows, tz: s.tz, last: last };
}

function hbIsStorage_(msg) {
  return /storage|quota|penyimpanan|exceeded|limit/i.test(hbStr_(msg));
}

function hbTick_(p) {
  var list = Array.isArray(p.ticks) ? p.ticks : [];
  if (!list.length) throw new Error('No rows to tick.');
  if (list.length > HB_MAX_TICKS) throw new Error('At most ' + HB_MAX_TICKS + ' rows at a time.');
  var s = hbSheet_();
  var last = Math.min(s.sh.getLastRow(), HB_MAX_ROWS);
  var seen = {};
  var plan = list.map(function (t) {
    var r = Number(t && t.row);
    if (!(r >= 1 && r <= last && Math.floor(r) === r)) throw new Error('Row ' + hbStr_(t && t.row) + ' is not inside the list.');
    if (seen[r]) throw new Error('Row ' + r + ' is named twice.');
    seen[r] = 1;
    if (typeof t.paid !== 'boolean') throw new Error('Row ' + r + ': paid must be true or false.');
    var shown = s.sh.getRange(r, 1, 1, 6).getDisplayValues()[0];
    var want = hbStr_(t.name);
    if (!want) throw new Error('Row ' + r + ': the name the app saw is required.');
    if (want !== hbStr_(shown[1]) && want !== hbStr_(shown[4])) {
      throw new Error('Row ' + r + ' changed in the sheet (it now reads "' + hbStr_(shown[1] || shown[4]) + '"). Nothing was written.');
    }
    if (!hbStr_(shown[3])) throw new Error('Row ' + r + ' has no amount. Nothing was written.');
    return { r: r, paid: t.paid };
  });
  var done = [];
  try {
    plan.forEach(function (x) { s.sh.getRange(x.r, 1).setValue(x.paid); done.push(x.r); });
    SpreadsheetApp.flush();
  } catch (e) {
    var msg = hbStr_(e && e.message || e);
    return { ok: false, storage: hbIsStorage_(msg), error: msg, written: done };
  }
  return { ok: true, written: done, rows: plan };
}

function hbRegisterApi_() {
  if (typeof WRITES_ !== 'object' || !WRITES_) return false;
  WRITES_.hutangRead = function () {
    var out = hbRead_();
    return { id: '', detail: out.rows.length + ' rows read', body: out };
  };
  WRITES_.hutangTick = function (p) {
    var out = hbTick_(p);
    var rows = (p.ticks || []).map(function (t) { return t.row + (t.paid ? ' paid' : ' unpaid'); }).join(', ');
    return { id: '', detail: rows + (out.ok ? '' : ' (not saved: ' + (out.storage ? 'storage full' : out.error) + ')'), body: out };
  };
  return true;
}
var HB_API_REGISTERED = hbRegisterApi_();

/* Node test hook. */
if (typeof module !== 'undefined') {
  module.exports = { hbRead_: hbRead_, hbTick_: hbTick_, hbIsStorage_: hbIsStorage_ };
}
