// Today's to-do, as a pure rule. The page in index.html (isFuture, the list,
// and every count) must agree with this file. tests/todo-today.test.mjs checks
// that. Nothing here writes a task.
//
// "Today" is a YYYY-MM-DD calendar day in Asia/Makassar. A date-only value is
// that calendar day. A datetime is the clock time in Makassar, never the UTC
// date: 17:30Z is already the next morning in Bali.

export const TODO_TZ = 'Asia/Makassar';

export function scheduledDay(value) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (s.length <= 10) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TODO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// True when the task is scheduled to start after `today`. Undated tasks, a
// range that already covers today, and overdue tasks are false.
export function isFuture(task, today) {
  if (!task || !today) return false;
  const start = task.date && task.date.start;
  const day = scheduledDay(start);
  if (!day) return false;
  return day > today;
}

// Open tasks for the health-check counts: not done, not parked, not future.
// `total` on that route stays the full database size. This does not drop
// Focus rows; the page does that before it draws the To-Do.
export function todayCounts(tasks, today) {
  const areas = {};
  let open = 0;
  for (const x of tasks || []) {
    if (!x || x.done || x.status === 'Parked' || isFuture(x, today)) continue;
    open += 1;
    const k = x.area || 'none';
    areas[k] = (areas[k] || 0) + 1;
  }
  return { open, areas };
}
