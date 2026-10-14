

/* ---------------------------------------------------------------
   CERTIFICATES                                      14 October 2026

   Asked by Befalia: in Befalia OS, the courses that are finished but
   still need a certificate, with buttons to process them.

   certQueue_() is read only. It returns every block in an instructor's
   own "2. STUDENTS" whose column A reads "course done, waiting for
   certificate", in the same shape as enrolments_(), so the Business tab
   can list them. payload_() carries it as certQueue.

   setEnrolStatus (a WRITES_ action) changes column A of ONE block, and
   only when the row still holds the same student name (column B) and
   invoice (column G) the caller saw, so a sheet that moved under it is
   refused instead of written. The status must be one of the course
   statuses this file already knows. Where the cell has a dropdown, the
   value is written exactly as the dropdown spells it.
   --------------------------------------------------------------- */
var CERT_WAIT_ = 'course done, waiting for certificate';
/* Read when called, not at load: these lists may live in another file. */
function enrolStatuses_(){ return ENROL_OPEN_.concat(ENROL_DONE_); }

function certQueue_(){
  var out = [];
  var plan_ = enrolCurriculum_();
  ENROL_BOOKS_.forEach(function(book){
    var ss;
    try { ss = SpreadsheetApp.openById(book.id); } catch(e){ return; }
    var sh = ss.getSheetByName(ENROL_TAB_);
    if(!sh || !enrolLayoutOk_(sh)) return;
    var last = sh.getLastRow();
    if(last <= ENROL_HEAD_) return;
    var vals = sh.getRange(1, 1, last, 20).getDisplayValues();
    for(var a = ENROL_HEAD_; a < vals.length; a++){
      if(!(S_(vals[a][1]) && S_(vals[a][7]))) continue;
      if(S_(vals[a][0]).toLowerCase() !== CERT_WAIT_) continue;
      var b = a + 1, done = enrolTaught_(vals[a][15]) ? 1 : 0, lastSeen = S_(vals[a][15]);
      while (b < vals.length && !S_(vals[b][1])) {
        var anyCell = false;
        for (var c = 15; c <= 19; c++) if (S_(vals[b][c])) { anyCell = true; break; }
        if (!anyCell) break;
        if (enrolTaught_(vals[b][15])) { done++; lastSeen = S_(vals[b][15]); }
        b++;
      }
      out.push({
        instructor_email: book.email,
        sheet_row:  a + 1,
        status:     S_(vals[a][0]),
        student:    S_(vals[a][1]),
        student_id: S_(vals[a][2]),
        email:      S_(vals[a][4]),
        invoice_no: S_(vals[a][6]),
        course:     S_(vals[a][7]),
        last_seen:  lastSeen,
        sessions:   b - a,
        done:       done,
        plan:       enrolSessionsFor_(S_(vals[a][7]), plan_)
      });
    }
  });
  return out;
}

WRITES_.setEnrolStatus = function(p, actor){
  var want = S_(p.status).toLowerCase();
  if(enrolStatuses_().indexOf(want) < 0) throw new Error('Unknown course status "' + S_(p.status) + '".');
  var book = null;
  for(var i = 0; i < ENROL_BOOKS_.length; i++) if(ENROL_BOOKS_[i].email === S_(p.instructor_email).toLowerCase()) book = ENROL_BOOKS_[i];
  if(!book) throw new Error('No instructor workbook for ' + S_(p.instructor_email) + '.');
  var row = Number(p.sheet_row);
  if(!(row > ENROL_HEAD_)) throw new Error('A sheet row is required.');
  /* Both are needed for the row check below: a blank name and invoice would
     match the empty B and G of a row in the middle of a block (14 Oct 2026). */
  if(!S_(p.student) || !S_(p.invoice_no)) throw new Error('The student name and invoice are required. Nothing changed.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = SpreadsheetApp.openById(book.id).getSheetByName(ENROL_TAB_);
    if(!sh || !enrolLayoutOk_(sh)) throw new Error('The 2. STUDENTS tab is not in the expected layout. Nothing changed.');
    if(row > sh.getLastRow()) throw new Error('Row ' + row + ' is past the end of the sheet. Refresh.');
    var r = sh.getRange(row, 1, 1, 8).getDisplayValues()[0];
    if(S_(r[1]) !== S_(p.student) || S_(r[6]) !== S_(p.invoice_no))
      throw new Error('Row ' + row + ' no longer holds ' + S_(p.student) + ' / ' + S_(p.invoice_no) + '. The sheet changed. Refresh and try again.');
    var cell = sh.getRange(row, 1);
    var from = S_(r[0]);
    var write = S_(p.status);
    try {
      var rule = cell.getDataValidation();
      if(rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST){
        var opts = rule.getCriteriaValues()[0] || [];
        for(var k = 0; k < opts.length; k++) if(S_(opts[k]).toLowerCase() === want) write = S_(opts[k]);
      }
    } catch(e){ /* no dropdown: write as given */ }
    cell.setValue(write);
    SpreadsheetApp.flush();
    return { id: book.email + ' row ' + row,
             detail: S_(p.student) + ' ' + S_(p.invoice_no) + ': "' + from + '" -> "' + write + '"',
             body: { ok: true, sheet_row: row, from: from, to: write } };
  } finally {
    lock.releaseLock();
  }
};
