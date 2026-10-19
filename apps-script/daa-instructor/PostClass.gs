/* ---------------------------------------------------------------
   AFTER CLASS: ONE CHECKLIST PER CLASS, SHARED          19 October 2026

   Asked by Befa: "each time after the class, not just the session
   expenses, I need to organize the files of the students and upload
   them, and if I need to certify, process it. Make sure that to-do
   list shows up post-class, that I tick, and it adds to my to-do list
   as done that day. If I haven't done it, make sure I do."
   Her rulings (19 Oct): one shared list for Befalia OS and the
   instructor dashboard; certification only after the last session of
   a course; "certify" means processing it in PADI Pros (or MFI).

   Tab OS_POSTCLASS in ADMIN DIVEARTS ACADEMY, one row per class and
   step, created by tab_() the first time something is written:
     pc_id       class_key|item, unique
     class_key   ev:<Google Calendar event id> for any class on the
                 calendar (Befalia OS and Schedule Manager both carry
                 it), os:<os_id> for a Schedule Manager row without an
                 event, nt:<To-Do id> for a class only in Befa's To-Do
     item        expenses | files | certify
     done        TRUE or FALSE
     by, at      who ticked it and when (WITA)
     label       the class, as the app showed it
     class_date  yyyy-mm-dd
   postClassSet   writes one row (insert or update), checked first
   postClassRead  returns the rows for up to 300 keys (Befalia OS)
   payload_ (the instructor dashboard read) gains postClass: every row.

   Lives in its own file and registers itself in WRITES_; payload_ is
   wrapped once, so Code.gs is not edited. Nothing here sends a message.
   --------------------------------------------------------------- */
var T_PC = 'OS_POSTCLASS';
H[T_PC] = ['pc_id', 'class_key', 'item', 'done', 'by', 'at', 'label', 'class_date', 'note'];
var PC_ITEMS = ['expenses', 'files', 'certify'];
var PC_KEY_RE = /^(ev|os|nt):[A-Za-z0-9_@.\-]{4,160}$/;
var PC_MAX_KEYS = 300;

function pcStr_(v) { return String(v == null ? '' : v).trim(); }
function pcBool_(v) { return v === true || /^(true|yes|1)$/i.test(pcStr_(v)); }

function pcRows_() {
  return rows_(T_PC).map(function (r) {
    return { class_key: pcStr_(r.class_key), item: pcStr_(r.item), done: pcBool_(r.done),
      by: pcStr_(r.by), at: pcStr_(r.at), label: pcStr_(r.label), class_date: pcStr_(r.class_date).slice(0, 10) };
  }).filter(function (r) { return PC_KEY_RE.test(r.class_key) && PC_ITEMS.indexOf(r.item) >= 0; });
}

function pcSet_(p, actor) {
  var key = pcStr_(p.class_key), item = pcStr_(p.item);
  if (!PC_KEY_RE.test(key)) throw new Error('That class key is not one the apps make.');
  if (PC_ITEMS.indexOf(item) < 0) throw new Error('Unknown step ' + item + '.');
  if (typeof p.done !== 'boolean') throw new Error('done must be true or false.');
  var date = pcStr_(p.class_date);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('class_date must be yyyy-mm-dd.');
  var label = pcStr_(p.label).slice(0, 200);
  var sh = tab_(T_PC), id = key + '|' + item;
  var last = sh.getLastRow(), row = 0;
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (pcStr_(ids[i][0]) === id) { row = i + 2; break; }
  }
  var who = pcStr_(p.by) || pcStr_(actor);
  var vals = [id, key, item, p.done, who, now_(), label, date, pcStr_(p.note).slice(0, 300)];
  if (row) {
    var old = sh.getRange(row, 1, 1, vals.length).getValues()[0];
    if (!label) vals[6] = old[6];
    if (!date) vals[7] = old[7];
    sh.getRange(row, 1, 1, vals.length).setValues([vals]);
  } else {
    sh.appendRow(vals);
    row = sh.getLastRow();
  }
  return { ok: true, row: row, set: { class_key: key, item: item, done: p.done, by: who, at: vals[5] } };
}

function pcRead_(p) {
  var keys = Array.isArray(p.keys) ? p.keys.map(pcStr_).filter(function (k) { return PC_KEY_RE.test(k); }) : [];
  if (keys.length > PC_MAX_KEYS) throw new Error('At most ' + PC_MAX_KEYS + ' classes at a time.');
  var want = {};
  keys.forEach(function (k) { want[k] = 1; });
  return { ok: true, rows: pcRows_().filter(function (r) { return want[r.class_key]; }) };
}

function pcRegisterApi_() {
  if (typeof WRITES_ !== 'object' || !WRITES_) return false;
  WRITES_.postClassSet = function (p, actor) {
    var out = pcSet_(p, actor);
    return { id: pcStr_(p.class_key), detail: pcStr_(p.item) + (p.done ? ' done' : ' not done'), body: out };
  };
  WRITES_.postClassRead = function (p) {
    var out = pcRead_(p);
    return { id: '', detail: out.rows.length + ' rows for ' + (p.keys || []).length + ' classes', body: out };
  };
  return true;
}
var PC_API_REGISTERED = pcRegisterApi_();

/* The instructor dashboard reads everything through payload_ (bootstrap).
   Wrap it once so that read also carries the checklist. A failure here
   never breaks the dashboard: postClass comes back empty with the reason. */
function pcWrapPayload_() {
  if (typeof payload_ !== 'function' || payload_.__postClass) return false;
  var base = payload_;
  payload_ = function () {
    var out = base.apply(this, arguments);
    try { out.postClass = pcRows_(); } catch (e) { out.postClass = []; out.postClassError = String(e && e.message || e); }
    return out;
  };
  payload_.__postClass = true;
  return true;
}
var PC_PAYLOAD_WRAPPED = pcWrapPayload_();

/* Node test hook. */
if (typeof module !== 'undefined') {
  module.exports = { pcSet_: pcSet_, pcRead_: pcRead_, pcRows_: pcRows_ };
}
