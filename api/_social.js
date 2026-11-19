// Personal social tracker (19 Nov 2026). Pure rules for Befa's own accounts.
// Instagram @befalia and @mermaidbefa were confirmed on 8 Nov 2026.
// TikTok @befalia and YouTube channel UCD8NyW-e1aadBdEulOxC3eA were confirmed
// on 19 Nov 2026. They are live personal accounts. Business accounts are not
// in this list. This module never talks to Zernio, Notion, or the network,
// and it never turns a blank into zero.
//
// History lives in a Notion database titled "Personal Social Tracker" under
// the Social Media page. It is not DiveArts public.social_metrics.

export const TZ = 'Asia/Makassar';
export const DB_TITLE = 'Personal Social Tracker';
export const SOCIAL_PAGE = '3a1eb411ed7a81dca2c4f1f711083f41';
export const IDEAS_PAGE = '3a3eb411ed7a81db81fad03bc31258cd';
export const MONEY_PAGE = '3a3eb411ed7a81af8db0ee520467b0fc';
export const REPORT_PAGES = [
  { label: 'Old Instagram notes', id: '3a1eb411ed7a810cbbd4efd16b9126c6' },
  { label: 'Old TikTok notes', id: '3a1eb411ed7a818bbf95e9d85f8d3ea7' },
  { label: 'Old YouTube notes', id: '3a1eb411ed7a818f9c21f5f7737d3fac' },
  { label: 'Facebook notes (not tracked here)', id: '3a1eb411ed7a8173825cf806a563a742' },
];

export const PLATFORM_LABEL = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };
export const PLATFORMS = Object.keys(PLATFORM_LABEL);
export const IDEA_STATUS = ['Idea', 'Drafting', 'Ready', 'Posted', 'Parked'];
export const CURRENCIES = ['IDR', 'USD'];
export const CORE = [
  { key: 'followers', label: 'Followers' },
  { key: 'reach', label: 'Reach' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'posts', label: 'Posts' },
];
export const EXTRAS = {
  instagram: [
    { key: 'saves', label: 'Saves', integer: true },
    { key: 'shares', label: 'Shares', integer: true },
    { key: 'profileVisits', label: 'Profile visits', integer: true },
  ],
  tiktok: [
    { key: 'views', label: 'Views', integer: true },
    { key: 'likes', label: 'Likes', integer: true },
  ],
  youtube: [
    { key: 'views', label: 'Views', integer: true },
    { key: 'watchHours', label: 'Watch hours', integer: false },
  ],
};

export const ACCOUNTS = [
  {
    key: 'instagram:@befalia', platform: 'instagram', handle: '@befalia',
    url: 'https://www.instagram.com/befalia/', label: 'Personal', status: 'live',
    confirmed: '2026-11-08',
  },
  {
    key: 'instagram:@mermaidbefa', platform: 'instagram', handle: '@mermaidbefa',
    url: 'https://www.instagram.com/mermaidbefa/', label: 'Personal', status: 'live',
    confirmed: '2026-11-08',
  },
  {
    key: 'tiktok:@befalia', platform: 'tiktok', handle: '@befalia',
    url: 'https://www.tiktok.com/@befalia', label: 'Personal', status: 'live',
    confirmed: '2026-11-19',
  },
  {
    key: 'youtube:UCD8NyW-e1aadBdEulOxC3eA', platform: 'youtube', handle: 'UCD8NyW-e1aadBdEulOxC3eA',
    url: 'https://www.youtube.com/channel/UCD8NyW-e1aadBdEulOxC3eA', label: 'Personal', status: 'live',
    confirmed: '2026-11-19',
  },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function witaDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function accountByKey(key) {
  return ACCOUNTS.find((a) => a.key === key) || null;
}

export function notionUrl(id) {
  return 'https://www.notion.so/' + String(id || '').replace(/-/g, '');
}

export function databaseSchema() {
  const sel = (names) => ({ select: { options: names.map((name) => ({ name })) } });
  return {
    Name: { title: {} },
    Kind: sel(['Snapshot', 'Idea', 'Earning']),
    Platform: sel(['Instagram', 'TikTok', 'YouTube']),
    Account: { rich_text: {} },
    When: { date: {} },
    Grain: sel(['Day', 'Month']),
    Source: sel(['Manual', 'Zernio']),
    Status: sel(IDEA_STATUS),
    Active: { checkbox: {} },
    Followers: { number: { format: 'number' } },
    Reach: { number: { format: 'number' } },
    Engagement: { number: { format: 'number' } },
    Posts: { number: { format: 'number' } },
    Amount: { number: { format: 'number' } },
    Currency: sel(CURRENCIES),
    Body: { rich_text: {} },
  };
}

export function chooseDb(blocks, title = DB_TITLE) {
  const hits = (blocks || []).filter((b) => b && b.type === 'child_database' && b.child_database && b.child_database.title === title && b.id);
  if (!hits.length) return null;
  return String(hits[0].id).replace(/-/g, '');
}

export function readCount(raw, label, opts = {}) {
  const integer = opts.integer !== false;
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s === '') return null;
    if (!/^\d+(\.\d+)?$/.test(s)) throw fail(label + ' needs a plain number, with no commas');
    raw = Number(s);
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw fail(label + ' needs a plain number');
  if (raw < 0) throw fail(label + ' cannot be negative');
  if (raw > 1e12) throw fail(label + ' is too large');
  if (integer) {
    if (!Number.isInteger(raw)) throw fail(label + ' needs a whole number');
    return raw;
  }
  const rounded = Math.round(raw * 100) / 100;
  if (Math.abs(raw - rounded) > 1e-6) throw fail(label + ' can have at most two decimal places');
  return rounded;
}

export function cleanText(raw, max, label, required = false) {
  if (raw == null) {
    if (required) throw fail(label + ' is required');
    return '';
  }
  const s = String(raw).replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim();
  if (!s) {
    if (required) throw fail(label + ' is required');
    return '';
  }
  if (s.length > max) throw fail(label + ' is too long');
  return s;
}

export function parseDay(s, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) throw fail('The date must look like 2026-11-19');
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw fail('That date does not exist');
  if (today && s > today) throw fail('That date is after today in WITA');
  return s;
}

function cleanExtras(platform, raw) {
  const allowed = EXTRAS[platform] || [];
  const known = new Set(allowed.map((x) => x.key));
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const k of Object.keys(src)) {
    if (!known.has(k)) throw fail('That extra does not belong on ' + (PLATFORM_LABEL[platform] || 'this platform'));
  }
  const extras = {};
  for (const spec of allowed) {
    if (Object.prototype.hasOwnProperty.call(src, spec.key)) {
      const n = readCount(src[spec.key], spec.label, { integer: spec.integer });
      if (n != null) extras[spec.key] = n;
    }
  }
  return extras;
}

function baseRow(kind, platform, when) {
  return {
    kind, platform, account: '', when, grain: null, source: 'Manual', active: true, status: null,
    followers: null, reach: null, engagement: null, posts: null, extras: {},
    note: '', hook: '', caption: '', outcome: '', amount: null, currency: null,
  };
}

// A snapshot Befa types in. Source is always Manual. A blank field stays empty.
export function cleanSnapshot(body, today) {
  const b = body || {};
  const account = accountByKey(b.account);
  if (!account || account.status !== 'live') throw fail('Choose one of your personal accounts');
  if (b.grain !== 'Day' && b.grain !== 'Month') throw fail('Choose a day or a month');
  const day = parseDay(b.date || b.when, today);
  if (b.source != null && String(b.source).trim() !== '' && String(b.source).toLowerCase() !== 'manual') {
    throw fail('Manual entry is the only source you can save from here');
  }
  const row = baseRow('Snapshot', account.platform, b.grain === 'Month' ? day.slice(0, 7) + '-01' : day);
  row.account = account.key;
  row.grain = b.grain;
  row.note = cleanText(b.note, 500, 'Note');
  for (const c of CORE) row[c.key] = readCount(b[c.key], c.label, { integer: true });
  row.extras = cleanExtras(account.platform, b.extras);
  const any = CORE.some((c) => row[c.key] != null) || Object.keys(row.extras).length > 0;
  if (!any) throw fail('Enter at least one number. A blank is left empty, not saved as zero.');
  return row;
}

export function cleanIdea(body, today) {
  const b = body || {};
  if (!PLATFORMS.includes(b.platform)) throw fail('Choose Instagram, TikTok or YouTube');
  const row = baseRow('Idea', b.platform, b.date ? parseDay(b.date, today) : today);
  row.hook = cleanText(b.hook, 300, 'Hook', true);
  row.caption = cleanText(b.caption, 4000, 'Caption');
  row.status = b.status ? String(b.status) : 'Idea';
  if (!IDEA_STATUS.includes(row.status)) throw fail('Unknown status');
  return row;
}

export function cleanEarning(body, today) {
  const b = body || {};
  if (!PLATFORMS.includes(b.platform)) throw fail('Choose Instagram, TikTok or YouTube');
  const row = baseRow('Earning', b.platform, parseDay(b.date, today));
  row.amount = readCount(b.amount, 'Amount', { integer: false });
  row.outcome = cleanText(b.outcome, 300, 'Outcome');
  row.note = cleanText(b.note, 500, 'Note');
  if (row.amount == null && !row.outcome) throw fail('Add an amount or an outcome. Nothing is filled in for you.');
  if (row.amount != null) {
    const currency = String(b.currency || '').toUpperCase();
    if (!CURRENCIES.includes(currency)) throw fail('Choose IDR or USD for the amount');
    row.currency = currency;
  }
  return row;
}

export function rowTitle(row) {
  const account = accountByKey(row.account);
  const who = account
    ? (account.platform === 'youtube' ? 'YouTube ' + account.handle : PLATFORM_LABEL[account.platform] + ' ' + account.handle)
    : (PLATFORM_LABEL[row.platform] || '');
  if (row.kind === 'Snapshot') return (row.grain === 'Month' ? row.when.slice(0, 7) : row.when) + ' · ' + who;
  if (row.kind === 'Idea') return row.when + ' · ' + (PLATFORM_LABEL[row.platform] || '') + ' · ' + String(row.hook || '').slice(0, 80);
  const bit = row.amount != null ? ((row.currency || '') + ' ' + row.amount) : String(row.outcome || '').slice(0, 40);
  return row.when + ' · ' + who + ' · ' + bit;
}

function rich(s) {
  s = String(s || '');
  if (!s) return { rich_text: [] };
  const out = [];
  for (let i = 0; i < s.length; i += 1900) out.push({ type: 'text', text: { content: s.slice(i, i + 1900) } });
  return { rich_text: out };
}

export function plain(arr) {
  return (arr || []).map((x) => (x && x.plain_text != null ? x.plain_text : ((x && x.text && x.text.content) || ''))).join('');
}

const sel = (p) => (p && p.select && p.select.name) || null;
const num = (p) => (p && typeof p.number === 'number' ? p.number : null);

export function toProperties(row) {
  const body = JSON.stringify({
    note: row.note || '', hook: row.hook || '', caption: row.caption || '',
    outcome: row.outcome || '', extras: row.extras || {}, recordedAt: row.recordedAt || '',
  });
  const props = {
    Name: { title: [{ type: 'text', text: { content: rowTitle(row).slice(0, 200) } }] },
    Kind: { select: { name: row.kind } },
    Platform: { select: { name: PLATFORM_LABEL[row.platform] } },
    Account: rich(row.account || ''),
    When: { date: { start: row.when } },
    Source: { select: { name: row.source || 'Manual' } },
    Active: { checkbox: row.active !== false },
    Body: rich(body),
  };
  if (row.grain) props.Grain = { select: { name: row.grain } };
  if (row.status) props.Status = { select: { name: row.status } };
  for (const c of CORE) if (row[c.key] != null) props[c.label] = { number: row[c.key] };
  if (row.amount != null) props.Amount = { number: row.amount };
  if (row.currency) props.Currency = { select: { name: row.currency } };
  return props;
}

function parseBody(text) {
  if (!text) return {};
  try {
    const j = JSON.parse(text);
    return j && typeof j === 'object' ? j : {};
  } catch (e) { return {}; }
}

export function mapPage(pg) {
  const pr = (pg && pg.properties) || {};
  const body = parseBody(plain(pr.Body && pr.Body.rich_text));
  const platformLabel = sel(pr.Platform);
  const platform = PLATFORMS.find((k) => PLATFORM_LABEL[k] === platformLabel) || null;
  const extras = body.extras && typeof body.extras === 'object' && !Array.isArray(body.extras) ? body.extras : {};
  return {
    id: String((pg && pg.id) || '').replace(/-/g, ''),
    url: (pg && pg.url) || notionUrl(pg && pg.id),
    kind: sel(pr.Kind),
    platform,
    account: plain(pr.Account && pr.Account.rich_text),
    when: (pr.When && pr.When.date && String(pr.When.date.start || '').slice(0, 10)) || '',
    grain: sel(pr.Grain),
    source: sel(pr.Source) || 'Manual',
    status: sel(pr.Status),
    active: pr.Active ? !!pr.Active.checkbox : true,
    followers: num(pr.Followers),
    reach: num(pr.Reach),
    engagement: num(pr.Engagement),
    posts: num(pr.Posts),
    amount: num(pr.Amount),
    currency: sel(pr.Currency),
    note: typeof body.note === 'string' ? body.note : '',
    hook: typeof body.hook === 'string' ? body.hook : '',
    caption: typeof body.caption === 'string' ? body.caption : '',
    outcome: typeof body.outcome === 'string' ? body.outcome : '',
    extras,
    recordedAt: (typeof body.recordedAt === 'string' && body.recordedAt) || (pg && pg.created_time) || '',
  };
}

export function sameSlot(a, b) {
  return a.kind === 'Snapshot' && b.kind === 'Snapshot' && a.active !== false && b.active !== false
    && a.account === b.account && a.grain === b.grain && a.when === b.when;
}

function byWhen(a, b) {
  return String(a.when).localeCompare(String(b.when)) || String(a.recordedAt).localeCompare(String(b.recordedAt));
}

function newest(a, b) {
  return String(b.recordedAt).localeCompare(String(a.recordedAt)) || String(b.when).localeCompare(String(a.when));
}

export function sparkPath(values, w = 128, h = 32) {
  const list = Array.isArray(values) ? values : [];
  const pts = [];
  list.forEach((v, i) => { if (typeof v === 'number' && Number.isFinite(v)) pts.push({ i, v }); });
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const n = Math.max(list.length - 1, 1);
  const d = pts.map((p, idx) => {
    const x = (p.i / n) * (w - 4) + 2;
    const y = (h - 3) - ((p.v - min) / span) * (h - 8);
    return (idx ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
  return { d, w, h };
}

export function compareMonths(months) {
  if (!months || months.length < 2) return null;
  const prev = months[months.length - 2];
  const last = months[months.length - 1];
  const deltas = {};
  let any = false;
  for (const c of CORE) {
    if (prev[c.key] == null || last[c.key] == null) { deltas[c.key] = null; continue; }
    deltas[c.key] = { from: prev[c.key], to: last[c.key], delta: last[c.key] - prev[c.key] };
    any = true;
  }
  return { prev: prev.when, last: last.when, deltas, any };
}

export function viewModel(rows, today) {
  const all = Array.isArray(rows) ? rows : [];
  const ideas = all.filter((r) => r.kind === 'Idea' && r.active !== false).sort(newest);
  const earnings = all.filter((r) => r.kind === 'Earning' && r.active !== false).sort(newest);
  const cards = ACCOUNTS.map((account) => {
    const mine = all.filter((r) => r.kind === 'Snapshot' && r.account === account.key);
    const active = mine.filter((r) => r.active !== false).sort(byWhen);
    const months = active.filter((r) => r.grain === 'Month');
    const days = active.filter((r) => r.grain === 'Day');
    const headline = months.length ? months[months.length - 1] : (days.length ? days[days.length - 1] : null);
    return {
      account,
      headline,
      compare: compareMonths(months),
      spark: sparkPath(months.map((r) => r.followers)),
      dailySpark: sparkPath(days.map((r) => r.followers)),
      months: months.length,
      days: days.length,
      history: mine.slice().sort(newest).slice(0, 8),
    };
  });
  return {
    ok: true,
    today: today || witaDate(),
    desk: {
      trends: 'Scout',
      analytics: 'Sonar',
      planner: 'Muse',
    },
    accounts: ACCOUNTS,
    extras: EXTRAS,
    cards,
    ideas,
    earnings,
    notion: {
      databaseTitle: DB_TITLE,
      ideas: notionUrl(IDEAS_PAGE),
      ideasId: IDEAS_PAGE,
      plan: notionUrl(MONEY_PAGE),
      reports: REPORT_PAGES.map((p) => ({ label: p.label, url: notionUrl(p.id) })),
    },
  };
}

export function formatMetric(n, integer = true) {
  if (n == null || typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (!integer) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return Math.round(n).toLocaleString('en-US');
}

export function formatMoney(amount, currency) {
  if (amount == null || typeof amount !== 'number') return '';
  if (currency === 'IDR') return 'Rp' + Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (currency === 'USD') return 'US$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(amount);
}

export function formatDay(iso, grain) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (grain === 'Month') return MONTHS[m - 1] + ' ' + y;
  return d + ' ' + MONTHS[m - 1].slice(0, 3) + ' ' + y;
}

export function formatWita(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return date + ', ' + time + ' WITA';
}

export function ideaLine(row) {
  const head = row.when + ' · ' + (PLATFORM_LABEL[row.platform] || '') + ' · ' + (row.status || 'Idea') + ' · ' + (row.hook || '');
  const cap = row.caption ? String(row.caption).slice(0, 700) : '';
  return [head, cap].filter(Boolean).join('\n').slice(0, 1800);
}

export function counts(rows) {
  const all = Array.isArray(rows) ? rows : [];
  return {
    snapshots: all.filter((r) => r.kind === 'Snapshot').length,
    ideas: all.filter((r) => r.kind === 'Idea').length,
    earnings: all.filter((r) => r.kind === 'Earning').length,
  };
}
