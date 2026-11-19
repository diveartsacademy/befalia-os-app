// Daily tasks for the To-Do.
//
// The template and each day's copy live in the Notion Tasks database the
// To-Do already uses. No new database and no new property. Notes holds a
// marker this app owns, and the other fields are the ones tasks already have:
//
//   daily-template:<id>            the repeating line, Status Parked
//   daily-retired:<id>             she removed it; kept so the seed stays gone
//   daily:<id>:<YYYY-MM-DD>        one copy, dated that Makassar day
//
// Parked templates are hidden by the same rule as every other parked row, so
// they cannot add a second count next to today's copy. A copy is an ordinary
// task: ticking it completes that page only. The next morning gets a new page.
//
// Yesterday's unticked copy is archived (Notion trash) when today's copies
// are made. It is not marked Done, and it does not stay overdue. A ticked
// copy stays, with Completed on that day, and leaves the list the next
// morning the way any other ticked task does.
//
// public.tasks in the DiveArts Supabase project (gszjrsvvpajznwdrtjva) is
// unused by this app and holds business data. A daily habit is a To-Do row,
// so it stays in Notion with the rest of the list. Nothing here is applied
// to Supabase, and no new SQL is required.
import { timingSafeEqual } from 'node:crypto';

export const DAILY_AREA = 'Personal';
export const DAILY_SECTION = 'Daily';
// Above the line numbers in her Apple Note, so the Daily title sits at the
// end of Personal instead of pushing into the note's order.
export const DAILY_ORDER_BASE = 100000;

export const DAILY_SEED = [
  { id: 'reply-to-emails', name: 'Reply to emails' },
  { id: 'send-bd-replies', name: 'Send all BD replies' },
  { id: 'send-crm-replies', name: 'Send all CRM replies' },
  { id: 'buy-sea-diva-orders', name: 'Buy all Sea Diva third-party orders' },
  { id: 'design', name: 'Design' },
  { id: 'sea-diva-production', name: 'Sea Diva production' },
  { id: 'take-pills', name: 'Take pills' },
];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDaily(notes) {
  const s = String(notes || '').trim();
  let m = /^daily-template:([a-z0-9][a-z0-9-]{0,62})$/.exec(s);
  if (m) return { kind: 'template', id: m[1] };
  m = /^daily-retired:([a-z0-9][a-z0-9-]{0,62})$/.exec(s);
  if (m) return { kind: 'retired', id: m[1] };
  m = /^daily:([a-z0-9][a-z0-9-]{0,62}):(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (m) return { kind: 'copy', id: m[1], day: m[2] };
  return null;
}

export function dailyTemplateNotes(id) { return 'daily-template:' + id; }
export function dailyRetiredNotes(id) { return 'daily-retired:' + id; }
export function dailyCopyNotes(id, day) { return 'daily:' + id + ':' + day; }

export function isDailyTemplate(notes) {
  const m = parseDaily(notes);
  return !!(m && (m.kind === 'template' || m.kind === 'retired'));
}

// A copy's day, area, title and marker stay put. Ticking, the flags and the
// name of today's copy can still change. Tomorrow's copy is a new page.
export function stripDailyCopyPatch(patch) {
  const next = Object.assign({}, patch || {});
  delete next.date;
  delete next.notes;
  delete next.area;
  delete next.section;
  delete next.parent;
  delete next.order;
  delete next.type;
  return next;
}

export function newDailyId(now = Date.now()) {
  const n = Math.max(0, Math.floor(Number(now) || 0)).toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  const id = ('d' + n + r).replace(/[^a-z0-9]/g, '').slice(0, 40);
  return ID_RE.test(id) ? id : 'd' + r;
}

export function cronAuthorized(header, secret) {
  if (!secret) return false;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(header || '').trim());
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(String(secret));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function byCreated(a, b) {
  const ta = a.created || '';
  const tb = b.created || '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return String(a.id || '') < String(b.id || '') ? -1 : 1;
}

function templateView(rows) {
  return rows.map((t) => ({
    id: t.markerId || (parseDaily(t.notes) || {}).id,
    name: t.name,
    order: t.order,
  })).filter((t) => t.id && ID_RE.test(t.id));
}

// What has to be written so the database matches the daily rule.
// Pure: the same pages in again produce no creates, archives or parks.
// `today` is YYYY-MM-DD in Asia/Makassar.
export function planDaily(tasks, today) {
  const empty = { creates: [], archive: [], park: [], templates: [] };
  if (!DAY_RE.test(String(today || ''))) return empty;
  const live = (tasks || []).filter((t) => t && !t.archived && !t.in_trash);
  const templates = [];
  const retired = [];
  const copies = [];
  for (const t of live) {
    const m = parseDaily(t.notes);
    if (!m) continue;
    if (m.kind === 'template') templates.push(t);
    else if (m.kind === 'retired') retired.push(t);
    else copies.push(t);
  }

  const archive = [];
  const park = [];
  const drop = (id) => { if (id && !archive.includes(id)) archive.push(id); };

  const tplById = new Map();
  for (const t of templates.slice().sort(byCreated)) {
    const id = parseDaily(t.notes).id;
    if (!tplById.has(id)) tplById.set(id, t);
    else drop(t.id);
  }
  const retById = new Map();
  for (const t of retired.slice().sort(byCreated)) {
    const id = parseDaily(t.notes).id;
    if (tplById.has(id)) { drop(t.id); continue; }
    if (!retById.has(id)) retById.set(id, t);
    else drop(t.id);
  }

  const active = [...tplById.values()].sort((a, b) => {
    const oa = typeof a.order === 'number' ? a.order : Infinity;
    const ob = typeof b.order === 'number' ? b.order : Infinity;
    if (oa !== ob) return oa - ob;
    return byCreated(a, b);
  });

  const seedCreates = [];
  if (!active.length && !retById.size) {
    DAILY_SEED.forEach((s, i) => {
      seedCreates.push({
        role: 'template',
        markerId: s.id,
        name: s.name,
        order: DAILY_ORDER_BASE + (i + 1) * 10,
        notes: dailyTemplateNotes(s.id),
        status: 'Parked',
        date: null,
      });
    });
  }

  for (const t of active) {
    if (t.status !== 'Parked' || t.done) park.push(t.id);
  }
  for (const t of retById.values()) {
    if (t.status !== 'Parked' || t.done) park.push(t.id);
  }

  // One live page per template per day. Keep a ticked one when there is one,
  // otherwise the oldest. The rest are archived.
  const groups = new Map();
  for (const t of copies) {
    const m = parseDaily(t.notes);
    const key = m.id + ':' + m.day;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const kept = new Map();
  for (const [key, list] of groups) {
    const sorted = list.slice().sort(byCreated);
    const done = sorted.find((t) => t.done || t.status === 'Done');
    const keep = done || sorted[0];
    kept.set(key, keep);
    for (const t of sorted) if (t.id !== keep.id) drop(t.id);
  }
  const doomed = new Set(archive);
  for (const t of kept.values()) {
    const m = parseDaily(t.notes);
    if (m.day < today && !t.done && t.status !== 'Done') drop(t.id);
  }

  const source = active.length
    ? active.map((t) => ({ markerId: parseDaily(t.notes).id, name: t.name, order: t.order }))
    : seedCreates;
  const copyCreates = [];
  for (const src of source) {
    const name = String(src.name || '').trim();
    if (!name || !src.markerId) continue;
    const key = src.markerId + ':' + today;
    const have = kept.get(key);
    if (have && !doomed.has(have.id) && !archive.includes(have.id)) continue;
    copyCreates.push({
      role: 'copy',
      markerId: src.markerId,
      name,
      order: typeof src.order === 'number' ? src.order : null,
      notes: dailyCopyNotes(src.markerId, today),
      status: 'To do',
      date: { start: today },
    });
  }

  return {
    creates: seedCreates.concat(copyCreates),
    archive,
    park: park.filter((id) => !archive.includes(id)),
    templates: templateView(active.length ? active : seedCreates),
  };
}
