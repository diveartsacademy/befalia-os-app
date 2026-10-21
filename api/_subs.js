// Subscriptions (21 Oct 2026). Befa: "I want to know all the subscriptions
// that I do, the date that I need to repay, the other option that I can do,
// how much I spend on subscriptions, and free trials flagged."
//
// The rows live in the Notion database "Subscriptions" under Personal Life,
// filled from her inboxes and kept current by the morning inbox check. This
// file only reads and sums. It is pure so the tests can check the money.
//
// Rules the summary keeps (the gate for this card):
//   - IDR and USD are never added together. No exchange rate is guessed.
//   - Only Active rows count as "confirmed". Check and Payment failing rows
//     are summed apart as "not confirmed", so a doubtful row never hides
//     inside the headline number.
//   - A trial counts at its after-trial price, apart, until it converts.
//   - A row with no amount is listed as "amount unknown", never as zero.
//   - A Next charge date that has already passed on a row that is not Ended
//     is flagged "date passed", so a stale row is visible instead of quietly
//     looking current.

export const STATUSES = ['Active', 'Free trial', 'Payment failing', 'Due', 'Check', 'Ended'];
export const CYCLES = { 'Monthly': 1, 'Yearly': 1 / 12, 'Every 2 months': 1 / 2, 'Usage': 1, 'One-off': 0 };

const plain = (arr) => (arr || []).map((x) => x.plain_text != null ? x.plain_text : ((x.text && x.text.content) || '')).join('');
const sel = (p) => (p && p.select && p.select.name) || null;
const day = (p) => (p && p.date && p.date.start ? String(p.date.start).slice(0, 10) : null);
const num = (p) => (p && typeof p.number === 'number' ? p.number : null);
const nid = (s) => String(s || '').replace(/-/g, '');

export function mapSub(pg) {
  const pr = pg.properties || {};
  return {
    id: nid(pg.id),
    name: plain(pr.Name && pr.Name.title),
    status: sel(pr.Status) || 'Check',
    amount: num(pr.Amount),
    currency: sel(pr.Currency),
    cycle: sel(pr.Cycle),
    next: day(pr['Next charge']),
    trialEnds: day(pr['Trial ends']),
    via: sel(pr['Billed via']),
    account: plain(pr.Account && pr.Account.rich_text),
    area: sel(pr.Area),
    option: plain(pr['Other option'] && pr['Other option'].rich_text),
    evidence: plain(pr.Evidence && pr.Evidence.rich_text),
    verified: day(pr['Last verified']),
    url: pg.url || null,
  };
}

export function daysBetween(fromIso, toIso) {
  const a = String(fromIso).split('-').map(Number), b = String(toIso).split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

// What one row costs per month, or null when it cannot be known.
export function perMonth(s) {
  if (s.amount == null || !s.currency) return null;
  const f = CYCLES[s.cycle];
  if (f == null) return null;
  return s.amount * f;
}

const round = (cur, n) => (cur === 'IDR' ? Math.round(n) : Math.round(n * 100) / 100);

export function summarize(items, today) {
  const blank = () => ({ confirmed: 0, unconfirmed: 0, afterTrials: 0 });
  const month = { IDR: blank(), USD: blank() };
  const unknownAmount = [];
  const alerts = [];
  const upcoming = [];
  const counts = {};
  STATUSES.forEach((k) => { counts[k] = 0; });

  for (const s of items) {
    counts[s.status] = (counts[s.status] || 0) + 1;
    if (s.status === 'Ended') continue;

    const m = perMonth(s);
    if (m == null) {
      unknownAmount.push(s.id);
    } else if (month[s.currency]) {
      if (s.status === 'Active') month[s.currency].confirmed += m;
      else if (s.status === 'Free trial') month[s.currency].afterTrials += m;
      else month[s.currency].unconfirmed += m;
    }

    const left = s.next ? daysBetween(today, s.next) : null;
    if (s.status === 'Free trial' && s.trialEnds) {
      const t = daysBetween(today, s.trialEnds);
      if (t <= 7) alerts.push({ id: s.id, kind: t < 0 ? 'trial_over' : 'trial_ending', days: t });
    }
    if (s.status === 'Payment failing') alerts.push({ id: s.id, kind: 'failing' });
    if (s.status === 'Due') alerts.push({ id: s.id, kind: 'due', days: left });
    if (left != null && left < 0) alerts.push({ id: s.id, kind: 'date_passed', days: left });
    if (left != null && left >= 0 && left <= 30) upcoming.push({ id: s.id, date: s.next, days: left });
  }

  for (const c of Object.keys(month)) for (const k of Object.keys(month[c])) month[c][k] = round(c, month[c][k]);
  upcoming.sort((a, b) => a.days - b.days);
  const order = { trial_over: 0, failing: 1, due: 2, trial_ending: 3, date_passed: 4 };
  alerts.sort((a, b) => (order[a.kind] - order[b.kind]) || ((a.days ?? 99) - (b.days ?? 99)));
  // One alert per subscription: keep the most urgent kind only.
  const seen = new Set();
  const unique = alerts.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  alerts.length = 0;
  alerts.push(...unique);
  const year = {};
  for (const c of Object.keys(month)) year[c] = round(c, month[c].confirmed * 12);
  return { today, month, year, counts, upcoming, alerts, unknownAmount };
}
