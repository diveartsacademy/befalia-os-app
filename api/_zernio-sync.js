// Read-only Zernio pull for personal accounts (19 Nov 2026).
// It does nothing until ZERNIO_PERSONAL_ACCOUNT_IDS names one of Befa's
// personal account keys. It never connects an account, never posts, and
// never sends the key or the account id back to the browser.
// Manual entry stays the source when this is skipped or when a call fails.
// A point that is already logged is left as it is.

import { ACCOUNTS, EXTRAS, accountByKey, witaDate } from './_social.js';

const DEFAULT_BASE = 'https://zernio.com/api/v1';
const ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

export function readAccountMap(env = process.env) {
  const raw = env && env.ZERNIO_PERSONAL_ACCOUNT_IDS;
  if (raw == null || String(raw).trim() === '') return { ids: {}, error: '' };
  let parsed;
  try { parsed = JSON.parse(String(raw)); } catch (e) {
    return { ids: {}, error: 'ZERNIO_PERSONAL_ACCOUNT_IDS is not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ids: {}, error: 'ZERNIO_PERSONAL_ACCOUNT_IDS must name personal accounts' };
  }
  const ids = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!ACCOUNTS.some((a) => a.key === k && a.status === 'live')) {
      return { ids: {}, error: 'A key in ZERNIO_PERSONAL_ACCOUNT_IDS is not a personal account' };
    }
    if (typeof v !== 'string' || !ID_RE.test(v.trim())) {
      return { ids: {}, error: 'A personal account id is missing or not a plain id' };
    }
    ids[k] = v.trim();
  }
  return { ids, error: '' };
}

export function zernioStatus(env = process.env) {
  const map = readAccountMap(env);
  const configured = !map.error && Object.keys(map.ids).length > 0;
  return {
    configured,
    connected: false,
    control: 'ask Befa',
    costNote: 'Each extra account adds a monthly cost.',
    reason: map.error
      ? map.error
      : (configured
        ? 'A personal account id is set on the server. Connect stays off until Befa asks.'
        : 'No personal account id is configured.'),
  };
}

function baseUrl(env) {
  const b = (env && env.ZERNIO_API_BASE) || DEFAULT_BASE;
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?\/api\/v1$/i.test(b)) {
    const e = new Error('Zernio base URL is not allowed');
    e.status = 500;
    throw e;
  }
  return b.replace(/\/$/, '');
}

function windowOf(today) {
  const [y, m] = today.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1 - 5, 1)).toISOString().slice(0, 10);
  return { from, to: today };
}

function takeInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1e12 ? v : null;
}

function takeDecimal(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e12) return null;
  return Math.round(v * 100) / 100;
}

function asDay(v) {
  if (typeof v !== 'string') return null;
  if (/^\d{4}-\d{2}$/.test(v)) return v + '-01';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

function bucketList(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  return [].concat(json.accounts || [], json.data || [], json.stats || []);
}

// Keep a date only when every reading of it agrees. Two different numbers
// for one date are dropped, not averaged.
function collapse(points, field) {
  const by = new Map();
  const dropped = [];
  for (const p of points) {
    if (!by.has(p.date)) by.set(p.date, p);
    else if (by.get(p.date)[field] !== p[field]) {
      dropped.push(p.date);
      by.delete(p.date);
    }
  }
  for (const d of dropped) by.delete(d);
  return { points: Array.from(by.values()).sort((a, b) => a.date.localeCompare(b.date)), dropped };
}

export function extractFollowerPoints(json, accountId) {
  const points = [];
  const buckets = bucketList(json);
  const lists = buckets.length ? buckets : [json];
  for (const bucket of lists) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    const bid = bucket.accountId || bucket.account_id || bucket._id;
    if (bid && String(bid) !== String(accountId)) continue;
    const series = bucket.history || bucket.stats || bucket.series || bucket.data || [];
    if (!Array.isArray(series)) continue;
    for (const row of series) {
      if (!row || typeof row !== 'object') continue;
      const rid = row.accountId || row.account_id;
      if (rid && String(rid) !== String(accountId)) continue;
      const date = asDay(row.date || row.day || row.month);
      const followers = takeInt(row.followers != null ? row.followers : (row.followerCount != null ? row.followerCount : row.followersCount));
      if (date && followers != null) points.push({ date, followers });
    }
  }
  return collapse(points, 'followers');
}

export function extractDailyPoints(json, accountId, platform) {
  const allowed = new Set((EXTRAS[platform] || []).map((x) => x.key));
  const points = [];
  const raw = json && (json.days || json.daily || json.metrics || json.data);
  const rows = Array.isArray(raw) ? raw : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rid = row.accountId || row.account_id;
    if (rid && String(rid) !== String(accountId)) continue;
    const date = asDay(row.date || row.day);
    if (!date) continue;
    const reach = takeInt(row.reach);
    const engagement = takeInt(row.engagement);
    const posts = takeInt(row.postCount != null ? row.postCount : row.posts);
    const extras = {};
    for (const spec of EXTRAS[platform] || []) {
      if (!allowed.has(spec.key) || row[spec.key] == null) continue;
      const n = spec.integer ? takeInt(row[spec.key]) : takeDecimal(row[spec.key]);
      if (n != null) extras[spec.key] = n;
    }
    if (reach == null && engagement == null && posts == null && !Object.keys(extras).length) continue;
    points.push({ date, reach, engagement, posts, extras });
  }
  return points;
}

async function getJson(fetchImpl, url, apiKey) {
  const r = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' },
  });
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  if (!r || !r.ok) {
    const e = new Error('Zernio did not answer (' + ((r && r.status) || 'network') + ')');
    e.status = 502;
    throw e;
  }
  return body;
}

function latestPerMonth(points) {
  const by = new Map();
  for (const p of points) {
    const month = p.date.slice(0, 7);
    const prev = by.get(month);
    if (!prev || p.date > prev.date) by.set(month, p);
  }
  return Array.from(by.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function monthRow(account, point, recordedAt) {
  return {
    kind: 'Snapshot', platform: account.platform, account: account.key,
    when: point.date.slice(0, 7) + '-01', grain: 'Month', source: 'Zernio', active: true, status: null,
    followers: point.followers, reach: null, engagement: null, posts: null, extras: {},
    note: '', hook: '', caption: '', outcome: '', amount: null, currency: null, recordedAt,
  };
}

function dayRow(account, point, recordedAt) {
  return {
    kind: 'Snapshot', platform: account.platform, account: account.key,
    when: point.date, grain: 'Day', source: 'Zernio', active: true, status: null,
    followers: null, reach: point.reach, engagement: point.engagement, posts: point.posts,
    extras: point.extras || {},
    note: '', hook: '', caption: '', outcome: '', amount: null, currency: null, recordedAt,
  };
}

// Pulls numbers for the configured personal ids only. Returns snapshots.
// It does not write them. Callers that save must skip a slot that already exists.
export async function pullZernio({ env = process.env, fetchImpl = fetch, now = new Date(), today } = {}) {
  const map = readAccountMap(env);
  if (map.error) return { ok: false, skipped: true, reason: map.error, snapshots: [], errors: [] };
  const pairs = Object.entries(map.ids);
  if (!pairs.length) {
    return { ok: true, skipped: true, reason: 'no personal account id configured', snapshots: [], errors: [] };
  }
  const apiKey = env && env.ZERNIO_API_KEY;
  if (!apiKey) {
    return { ok: false, skipped: true, reason: 'Zernio key is not set on the server', snapshots: [], errors: [] };
  }
  const day = today || witaDate(now);
  const span = windowOf(day);
  const base = baseUrl(env);
  const recordedAt = now.toISOString();
  const snapshots = [];
  const errors = [];
  for (const [key, id] of pairs) {
    const account = accountByKey(key);
    const fUrl = base + '/accounts/follower-stats?accountIds=' + encodeURIComponent(id)
      + '&granularity=monthly&fromDate=' + span.from + '&toDate=' + span.to;
    const dUrl = base + '/analytics/daily-metrics?accountId=' + encodeURIComponent(id)
      + '&fromDate=' + span.from + '&toDate=' + span.to + '&attribution=received';
    try {
      const followers = await getJson(fetchImpl, fUrl, apiKey);
      const daily = await getJson(fetchImpl, dUrl, apiKey);
      const series = extractFollowerPoints(followers, id);
      for (const point of latestPerMonth(series.points)) {
        if (point.date > day) continue;
        snapshots.push(monthRow(account, point, recordedAt));
      }
      for (const point of extractDailyPoints(daily, id, account.platform)) {
        if (point.date > day) continue;
        snapshots.push(dayRow(account, point, recordedAt));
      }
    } catch (e) {
      errors.push({ account: key, error: String((e && e.message) || e) });
    }
  }
  return {
    ok: errors.length === 0,
    skipped: false,
    reason: errors.length ? 'Zernio did not answer for every account' : '',
    snapshots,
    errors,
  };
}
