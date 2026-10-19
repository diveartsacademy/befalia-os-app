// Reads Befa's HUTANG BEFA tab (rows as hutangRead in HutangBefa.gs returns
// them) into what the Finance tab shows. Pure: no network, no clock unless
// `today` is passed in, so it is tested in tests/hutang-parse.test.mjs.
//
// How the tab is laid out (19 Oct 2026), and the rules taken from it:
//   - Above the title row "HUTANG BEFA" are loose notes (balances, due days).
//     They are shown as notes, never added to a total: nobody knows if they
//     are still true.
//   - Then month blocks: a row whose B is a month name (MAY ... APRIL), then
//     one row per payment. A: the tick (paid). B: who. C: the due day, as a
//     date or as text ("10 mei", "14 OKT", "8 OF THE MONTH", "SEGERA").
//     D: the amount. E: a note or the lender again. F: "REGULAR", a tenor,
//     or a note.
//   - The year turns when the months go back (DECEMBER then JANUARY). The
//     2027 rows were typed with the year 2026, so a date whose month is the
//     block's month takes the block's year.
//   - A row with an amount but no name (B and E empty) is a subtotal: skipped.
//
// What each unpaid row becomes:
//   regular    F says REGULAR (salary, internet, phone, card bill): a bill,
//              not a debt. Reminded, never in the debt total.
//   scheduled  a due date today or later.
//   check      a due date in the last 45 days, not ticked. Usually paid and
//              not ticked yet, so it is shown to tick, not added to the debt.
//   overdue    a due date more than 45 days ago, still not ticked: a debt.
//   undated    no date (SEGERA, blank): a debt.
// A second unpaid row with the same lender, day and amount is marked dup and
// left out of the totals, and shown so Befa can delete one.

const MONTHS = {
  JAN: 1, JANUARY: 1, JANUARI: 1, FEB: 2, FEBRUARY: 2, FEBRUARI: 2, MAR: 3, MARCH: 3, MARET: 3,
  APR: 4, APRIL: 4, MAY: 5, MEI: 5, JUN: 6, JUNE: 6, JUNI: 6, JUL: 7, JULY: 7, JULI: 7,
  AUG: 8, AGU: 8, AGS: 8, AUGUST: 8, AGUSTUS: 8, SEP: 9, SEPT: 9, SEPTEMBER: 9,
  OCT: 10, OKT: 10, OCTOBER: 10, OKTOBER: 10, NOV: 11, NOVEMBER: 11, DEC: 12, DES: 12, DECEMBER: 12, DESEMBER: 12,
};
const CHECK_DAYS = 45;

const S = (v) => String(v == null ? '' : v).trim();
const up = (s) => S(s).toUpperCase();
const pad = (n) => (n < 10 ? '0' : '') + n;
const ymd = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
function realDate(y, m, d) {
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}
function addDays(iso, n) {
  const p = iso.split('-').map(Number);
  const x = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}
function monthOfHeader(b) {
  const k = up(b).replace(/[^A-Z]/g, '');
  return k.length >= 3 && MONTHS[k] && k === up(b).replace(/\s+/g, '') ? MONTHS[k] : 0;
}

// Name shown in the app for a row.
const LENDERS = [
  [/^PIN[JD]AM\s*DUIT/, 'Pinjam Duit'], [/^BLIBLI/, 'Blibli Tiket'], [/^SHOPEE\s*PAY|^SPAYLATER/, 'Shopee Paylater'],
  [/^SPAY\s*PINJAM/, 'Spay Pinjam'], [/^INDODANA/, 'Indodana'], [/^KREDIVO/, 'Kredivo'], [/^EASY\s*CASH/, 'Easycash'],
  [/^ADAKAMI/, 'Adakami'], [/^GO\s*PAY\s*LAT/, 'Gopay Later'], [/^FIN\+/, 'FIN+'], [/^INTERNET/, 'Internet'],
  [/^IM3/, 'IM3'], [/^JENIUS/, 'Jenius'], [/^BCA/, 'BCA'],
];
function title(s) { return S(s).split(/\s+/).map((w) => (/^[A-Z0-9+]{2,4}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' '); }
export function lenderOf(b, e) {
  const n = up(b) || up(e);
  if (/^GAJI/.test(n)) return /BEBEN/.test(up(e)) || /BEBEN/.test(n) ? 'Gaji Beben' : (/DIA/.test(n) || /DIA/.test(up(e)) ? 'Gaji Dia' : 'Gaji');
  for (const [re, name] of LENDERS) if (re.test(n)) return name;
  return title(S(b) || S(e));
}

function dueOf(c, year, month) {
  // c: { d: 'YYYY-MM-DD' } | { n } | { t }
  if (c && c.d) {
    const p = c.d.split('-').map(Number);
    if (month && p[1] === month && p[0] !== year && year) return { due: ymd(year, p[1], p[2]), fixedYear: true };
    return { due: c.d };
  }
  const t = up(c && c.t);
  if (!t) return { due: null };
  if (/SEGERA|ASAP|URGENT/.test(t)) return { due: null, urgent: true };
  const m = /^(\d{1,2})\b\s*([A-Z]+)?/.exec(t);
  if (!m) return { due: null, text: S(c.t) };
  const day = +m[1];
  let mon = month, yr = year;
  if (m[2] && MONTHS[m[2]]) {
    mon = MONTHS[m[2]];
    if (month && mon > month + 6) yr = year - 1; // "28 DEC" written in a January block
    else if (month && mon + 6 < month) yr = year + 1;
  }
  if (!mon || !yr || !realDate(yr, mon, day)) return { due: null, text: S(c.t) };
  return { due: ymd(yr, mon, day) };
}

export function parseHutang(rows, today) {
  const list = (rows || []).slice().sort((x, y) => x.r - y.r);
  const notes = [];
  const items = [];
  let started = false, year = 0, month = 0, lastMonth = 0;
  // The year of the first block: the first real date after the first month header.
  let firstYear = 0;
  { let seen = false; for (const r of list) { if (monthOfHeader(r.b)) seen = true; else if (seen && r.c && r.c.d) { firstYear = +r.c.d.slice(0, 4); break; } } }
  for (const r of list) {
    const mh = monthOfHeader(r.b);
    if (!started) {
      if (mh) started = true;
      else {
        if (up(r.b) === 'HUTANG BEFA') continue;
        const amt = (r.c && typeof r.c.n === 'number') ? r.c.n : ((r.d && typeof r.d.n === 'number') ? r.d.n : null);
        if (S(r.b) || amt != null) notes.push({ row: r.r, text: S(r.b), amount: amt });
        continue;
      }
    }
    if (mh) {
      if (!year) year = firstYear || +today.slice(0, 4);
      else if (lastMonth && mh < lastMonth) year += 1;
      month = mh; lastMonth = mh;
      continue;
    }
    if (/^\d{4}$/.test(S(r.b))) continue; // a year marker row, e.g. "2027"
    const name = S(r.b) || S(r.e);
    const amount = r.d && typeof r.d.n === 'number' ? r.d.n : null;
    const amountText = amount == null ? S(r.d && r.d.t) : '';
    if (!name) continue; // a subtotal row
    if (amount == null && !amountText) continue; // a note without an amount
    const dd = dueOf(r.c, year, month);
    const f = r.f || {};
    const regular = up(f.t) === 'REGULAR';
    const it = {
      row: r.r, paid: !!r.a, sheetName: S(r.b) || S(r.e), lender: lenderOf(r.b, r.e),
      note: S(r.b) && S(r.e) && up(r.e) !== up(r.b) ? S(r.e) : '',
      detail: f.t && !regular && !f.d ? S(f.t) : '',
      due: dd.due, dueText: dd.due ? '' : (dd.text || S(r.c && r.c.t)), urgent: !!dd.urgent,
      fixedYear: !!dd.fixedYear, amount, amountText, regular, block: month ? ymd(year, month, 1).slice(0, 7) : null,
    };
    items.push(it);
  }
  // Kinds
  const checkFrom = addDays(today, -CHECK_DAYS);
  for (const it of items) {
    if (it.paid) it.kind = 'paid';
    else if (it.regular) it.kind = 'regular';
    else if (!it.due) it.kind = 'undated';
    else if (it.due >= today) it.kind = 'scheduled';
    else if (it.due >= checkFrom) it.kind = 'check';
    else it.kind = 'overdue';
  }
  // Duplicates among unpaid rows
  const seen = new Map();
  for (const it of items) {
    if (it.paid || it.amount == null || !it.due) continue;
    const k = it.lender + '|' + it.due + '|' + it.amount;
    if (seen.has(k)) { it.dup = seen.get(k); } else seen.set(k, it.row);
  }
  return summarise(items, notes, today);
}

function sum(list) { return list.reduce((a, x) => a + (x.amount || 0), 0); }

function summarise(items, notes, today) {
  const live = items.filter((x) => !x.dup);
  const scheduled = live.filter((x) => x.kind === 'scheduled');
  const undated = live.filter((x) => x.kind === 'undated');
  const overdue = live.filter((x) => x.kind === 'overdue');
  const check = live.filter((x) => x.kind === 'check');
  const regular = live.filter((x) => x.kind === 'regular' && x.due && x.due >= today);
  const debt = scheduled.concat(undated, overdue);
  const unknownAmounts = debt.filter((x) => x.amount == null).length;

  const byLender = {};
  for (const x of scheduled) {
    const l = byLender[x.lender] || (byLender[x.lender] = { lender: x.lender, remaining: 0, left: 0, next: null, last: null, paid: 0 });
    l.remaining += x.amount || 0; l.left += 1;
    if (!l.next || x.due < l.next) l.next = x.due;
    if (!l.last || x.due > l.last) l.last = x.due;
  }
  for (const x of items) if (x.paid && byLender[x.lender]) byLender[x.lender].paid += 1;
  const lenders = Object.values(byLender).sort((a, b) => b.remaining - a.remaining);

  const byMonth = {};
  for (const x of scheduled.concat(regular)) {
    const k = x.due.slice(0, 7);
    const m = byMonth[k] || (byMonth[k] = { month: k, debt: 0, bills: 0 });
    if (x.kind === 'regular') m.bills += x.amount || 0; else m.debt += x.amount || 0;
  }
  const months = Object.values(byMonth).sort((a, b) => (a.month < b.month ? -1 : 1));

  const ym = today.slice(0, 7);
  const inMonth = items.filter((x) => !x.dup && x.due && x.due.slice(0, 7) === ym && x.amount != null);
  const thisMonth = {
    month: ym,
    total: sum(inMonth),
    paid: sum(inMonth.filter((x) => x.paid)),
    left: sum(inMonth.filter((x) => !x.paid && x.due >= today)),
    unticked: sum(inMonth.filter((x) => !x.paid && x.due < today)),
  };
  const next = scheduled.concat(regular).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.row - b.row)).slice(0, 14);
  const end = scheduled.reduce((m, x) => (x.due > m ? x.due : m), '');

  return {
    today,
    totals: {
      debt: sum(debt), scheduled: sum(scheduled), undated: sum(undated), overdue: sum(overdue),
      check: sum(check), unknownAmounts, scheduledEnds: end || null,
      noteTotal: notes.reduce((a, n) => a + (n.amount || 0), 0),
    },
    thisMonth, lenders, months, next,
    undated: undated.concat(overdue).sort((a, b) => (b.urgent - a.urgent) || ((b.amount || 0) - (a.amount || 0))),
    check: check.sort((a, b) => (a.due < b.due ? -1 : 1)),
    dups: items.filter((x) => x.dup),
    notes,
    items,
  };
}
