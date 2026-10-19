// The after-class checklist, worked out from what is already known (19 Oct
// 2026). Pure: no network, so tests/postclass.test.mjs can check every rule.
//
// Befa: "each time after the class ... the session expenses, organize the
// files of the students and upload them, and if I need to certify, process
// it. Show that post-class, tick it, and it adds to my to-do list as done that
// day. If I haven't done it, make sure I do."
// Her rulings: one shared list (the sheet tab OS_POSTCLASS) for Befalia OS and
// the instructor dashboard; certification only after the last session of a
// course; certify means processing it in PADI Pros (or MFI).
//
// Steps of a class:
//   expenses  Log the expenses        done by itself once the class is in the
//                                     books (its To-Do row has a session id)
//   files     Organize and upload     done by itself once the videos were
//             the student files       saved and sent from the class form
//   certify   Process the certifi-    only after the last session ("2 of 2",
//             cation in PADI Pros     "3/3"); ticked by hand
//
// Which classes: her own To-Do classes (Section Classes, an event) that have
// ended, from START on (no backlog of old classes), in the last WINDOW days,
// not cancelled or parked.

// POSTCLASS_START exists for the tests only; production uses 19 Oct 2026, the day Befa asked.
export const START = (typeof process !== 'undefined' && process.env && process.env.POSTCLASS_START) || '2026-10-19';
export const WINDOW = 21;
export const SECTION = 'After class';
export const ITEMS = ['expenses', 'files', 'certify'];
export const LABEL = {
  expenses: 'Log the expenses',
  files: 'Organize and upload the student files',
  certify: 'Process the certification in PADI Pros or MFI',
};
const NOTE_RE = /postclass:((?:ev|os|nt):[A-Za-z0-9_@.\-]{4,160}):(expenses|files|certify)\b/;

const S = (v) => String(v == null ? '' : v).trim();
const pad = (n) => (n < 10 ? '0' : '') + n;
export function addDays(ymd, n) {
  const p = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

export function keyOf(task, gcalIds) {
  const ids = gcalIds(task.notes);
  if (ids.length) return 'ev:' + ids[0].replace(/@google\.com$/i, '');
  return 'nt:' + S(task.id).replace(/-/g, '');
}

// "Open water 2 of 2", "Session 3/3", "pertemuan 2 dari 2": the last one.
export function isLastSession(text) {
  const all = Array.from(String(text || '').matchAll(/(\d+)\s*(?:of|\/|dari)\s*(\d+)/gi));
  return all.some((m) => +m[1] > 0 && +m[1] === +m[2]);
}

export function stepsFor(task) {
  return isLastSession(task.name) ? ITEMS.slice() : ['expenses', 'files'];
}

export function autoDone(task, item) {
  const e = task.expenses || {};
  if (item === 'expenses') return !!task.sessionId;
  if (item === 'files') return !!(e.videos && e.videos.at);
  return false;
}

export function shortName(task) {
  return S(task.name).replace(/^Teach:\s*/i, '').replace(/\s*·\s*\d{1,2}[:.]\d{2}\s*(WITA|WIB)?\s*$/i, '').slice(0, 90);
}

export function stepOfNotes(notes) {
  const m = NOTE_RE.exec(String(notes || ''));
  return m ? { key: m[1], item: m[2] } : null;
}

const prettyDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return d + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][m - 1];
};
export function taskName(cls, item) {
  return 'After class · ' + cls.name + ' (' + prettyDay(cls.day) + '): ' + LABEL[item];
}
export function taskNotes(cls, item) {
  return 'postclass:' + cls.key + ':' + item + ' · After-class step for ' + cls.name + ' on ' + cls.day
    + '. Shared with the instructor dashboard (OS_POSTCLASS). Tick it here or there.';
}

// The classes that count, from all To-Do tasks.
export function classesFrom(tasks, { today, nowMs, gcalIds }) {
  const from = addDays(today, -WINDOW) > START ? addDays(today, -WINDOW) : START;
  const out = [];
  for (const t of tasks) {
    if (t.section !== 'Classes' || t.type !== 'Event' || !t.date || !t.date.start) continue;
    if (t.status === 'Parked' || /^CANCELLED/i.test(S(t.name))) continue;
    const day = S(t.date.start).slice(0, 10);
    if (day < from || day > today) continue;
    const endIso = S(t.date.end || t.date.start);
    const endMs = /T\d{2}:\d{2}/.test(endIso) ? Date.parse(endIso) : Date.parse(addDays(endIso.slice(0, 10), 1) + 'T00:00:00+08:00');
    if (!(endMs <= nowMs)) continue;
    out.push({ id: t.id, key: keyOf(t, gcalIds), day, name: shortName(t) || 'Class', steps: stepsFor(t), task: t });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// What has to change. sheetRows: rows from OS_POSTCLASS for these classes.
// stepTasks: the To-Do tasks in Section "After class".
//   create   a step with no To-Do task yet (Done already when it is done)
//   close    an open step task whose step is done (sheet or by itself)
//   reopen   a done step task the sheet now says is not done (unticked in
//            the instructor dashboard) and that is not done by itself
//   write    a step to record in the sheet: done by itself, or ticked in
//            To-Do with nothing in the sheet yet
// The sheet is the master for a tick made by hand; a step done by itself
// is always done.
export function planPostClass(classes, sheetRows, stepTasks) {
  const sheet = new Map(sheetRows.map((r) => [r.class_key + '|' + r.item, r]));
  const tasks = new Map();
  for (const t of stepTasks) {
    const s = stepOfNotes(t.notes);
    if (!s) continue;
    const k = s.key + '|' + s.item;
    if (!tasks.has(k) || (tasks.get(k).done && !t.done)) tasks.set(k, t);
  }
  const plan = { create: [], close: [], reopen: [], write: [], view: [] };
  for (const c of classes) {
    const v = { id: c.id, key: c.key, day: c.day, name: c.name, steps: [] };
    for (const item of c.steps) {
      const k = c.key + '|' + item;
      const row = sheet.get(k);
      const task = tasks.get(k);
      const auto = autoDone(c.task, item);
      let done;
      if (auto) done = true;
      else if (row) done = row.done;
      else done = !!(task && task.done);
      if (auto && !(row && row.done)) plan.write.push({ class_key: c.key, item, done: true, by: 'auto', label: c.name, class_date: c.day });
      else if (!auto && !row && task && task.done) plan.write.push({ class_key: c.key, item, done: true, by: 'Befa via To-Do', label: c.name, class_date: c.day });
      if (!task) plan.create.push({ cls: c, item, done });
      else if (done && !task.done) plan.close.push(task.id);
      else if (!done && task.done) plan.reopen.push(task.id);
      v.steps.push({ item, label: LABEL[item], done, auto, by: row ? row.by : (auto ? 'auto' : ''), at: row ? row.at : '', taskId: task ? task.id : null });
    }
    plan.view.push(v);
  }
  return plan;
}
