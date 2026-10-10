// AI pieces of the wardrobe: the clothing scanner, the stylist, the packing
// planner and the wishlist check. Plus the free weather lookup.
//
// The rule that matters most lives here: the model never decides what she
// owns. It is shown a catalog with short refs (i1, i2, ...) for the pieces she
// actually has and may wear, and every ref it answers with is checked against
// that catalog. Anything it invents is dropped and counted, never shown as
// hers. Ideas for things to buy come back in a separate list that the client
// labels "not in your closet".

import { CATEGORIES, SEASONS, OCCASIONS, LAUNDRY_OUT } from './_wardrobe-schema.js';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const HAIKU = 'claude-haiku-4-5-20251001';

export function scanModels() {
  return [process.env.WARDROBE_SCAN_MODEL, HAIKU].filter(Boolean);
}
export function stylistModels() {
  return [process.env.WARDROBE_STYLIST_MODEL, 'claude-sonnet-4-5', HAIKU].filter(Boolean);
}

// One Claude call. Tries each model in turn when the first is not available
// on the account, so a retired model name degrades instead of breaking.
export async function claude(models, system, content, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('ANTHROPIC_API_KEY is not set in Vercel, so AI features are off'); e.status = 500; throw e; }
  let last = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    let r, d;
    try {
      r = await fetch(ANTHROPIC, {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens || 1500, system, messages: [{ role: 'user', content }] }),
      });
      d = await r.json();
    } catch (e) { last = new Error('Could not reach Claude: ' + (e.message || e)); last.upstream = true; continue; }
    if (d && d.error) {
      const msg = String(d.error.message || '');
      const missing = d.error.type === 'not_found_error' || /model/i.test(msg) && /not|invalid|found/i.test(msg);
      last = new Error('Claude error: ' + (msg || d.error.type)); last.upstream = true;
      if (missing && i < models.length - 1) continue;
      throw last;
    }
    const text = ((d && d.content) || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    return { text, model };
  }
  throw last || new Error('No model answered');
}

export function parseJsonLoose(text) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

const clamp01 = (x) => { const n = Number(x); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };
const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 120);
const pickList = (arr, allowed, n) => {
  const out = [];
  for (const x of Array.isArray(arr) ? arr : []) {
    const hit = allowed ? allowed.find((a) => a.toLowerCase() === String(x).toLowerCase()) : clean(x, 40);
    if (hit && !out.includes(hit)) out.push(hit);
    if (out.length >= (n || 8)) break;
  }
  return out;
};

/* ---------------- scanner ---------------- */

export const SCAN_SYSTEM = [
  'You catalogue clothing for a private wardrobe app. You get ONE photo.',
  'Find each separate wearable piece in it (a garment, shoes, a bag, jewelry, an accessory, a swimsuit, a mermaid tail or underwater costume).',
  'Return ONLY a JSON object, no prose, no code fences, shaped exactly:',
  '{"is_clothing":true,"items":[{"name":"short descriptive name, e.g. Ivory silk wrap blouse",',
  '"category":"one of: ' + CATEGORIES.join(' | ') + '",',
  '"subcategory":"e.g. wrap blouse","color":"main colour as a plain word","secondary_colors":["..."],',
  '"pattern":"Solid | Floral | Stripes | Print | Checks | Polka dot | Animal | Lace | Embellished | Other",',
  '"material":["your best visual guess, e.g. Silk"],"fit":"Fitted | Regular | Relaxed | Oversized | null",',
  '"season":["any of: ' + SEASONS.join(' | ') + '"],"occasion":["any of: ' + OCCASIONS.join(' | ') + '"],',
  '"style_tags":["up to 4, e.g. Elegant, Minimal, Feminine"],',
  '"brand":"ONLY if a brand label or logo is clearly readable in the photo, else null",',
  '"box":[x,y,w,h] as fractions 0 to 1 of the image, the piece\'s bounding box,',
  '"confidence":{"category":0-1,"color":0-1,"material":0-1,"pattern":0-1,"brand":0-1}}],',
  '"note":"anything the owner should check, or empty"}',
  'Rules: material and brand are hard to see in a photo, so give honest low confidence when unsure. Never guess a brand from style.',
  'If the photo shows no clothing, return {"is_clothing":false,"items":[],"note":"what you see"}. Maximum 6 items.',
].join(' ');

// Turns whatever the model said into the only shape the client receives.
// Fields under the confidence floor are moved to "ask" so the form shows them
// as suggestions to confirm, not as filled-in facts.
export function normalizeScan(raw, floor = 0.6) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 6).map((it) => {
    const conf = it.confidence || {};
    const c = { category: clamp01(conf.category), color: clamp01(conf.color), material: clamp01(conf.material), pattern: clamp01(conf.pattern), brand: clamp01(conf.brand) };
    let category = CATEGORIES.find((x) => x.toLowerCase() === String(it.category || '').toLowerCase()) || null;
    if (!category) { category = 'Other'; c.category = Math.min(c.category, 0.3); }
    const box = Array.isArray(it.box) && it.box.length === 4 ? it.box.map(clamp01) : null;
    const fit = ['Fitted', 'Regular', 'Relaxed', 'Oversized'].find((x) => x.toLowerCase() === String(it.fit || '').toLowerCase()) || null;
    const suggestion = {
      name: clean(it.name, 120) || category,
      category,
      subcategory: clean(it.subcategory, 80),
      color: clean(it.color, 40),
      secondary: pickList(it.secondary_colors, null, 5),
      pattern: clean(it.pattern, 40),
      material: pickList(it.material, null, 4),
      fit,
      season: pickList(it.season, SEASONS, 7),
      occasion: pickList(it.occasion, OCCASIONS, 7),
      styleTags: pickList(it.style_tags, null, 4),
      brand: it.brand && c.brand >= 0.8 ? clean(it.brand, 60) : '',
    };
    // Which suggested fields the person must confirm before they count.
    const ask = [];
    if (c.category < floor) ask.push('category');
    if (c.color < floor) ask.push('color');
    if (c.material < floor && suggestion.material.length) ask.push('material');
    if (c.pattern < floor) ask.push('pattern');
    return { suggestion, confidence: c, ask, box: box && box[2] > 0.05 && box[3] > 0.05 ? box : null };
  });
  return { isClothing: r.is_clothing !== false && items.length > 0, items, note: clean(r.note, 300) };
}

/* ---------------- catalog + validation ---------------- */

// Which pieces the stylist may use. Gone pieces never appear; pieces in the
// wash or lent out appear only when the caller says so (packing for a trip
// next month can include something that is in the laundry today).
export function availableItems(items, opts = {}) {
  return items.filter((it) => {
    if (it.status && it.status !== 'In closet') return opts.includeLent && it.status === 'Lent out';
    if (!opts.includeLaundry && LAUNDRY_OUT.includes(it.laundry)) return false;
    return true;
  });
}

export function wearStats(items, logs) {
  const st = {};
  for (const it of items) st[it.id] = { wears: 0, last: null };
  for (const l of logs) {
    if (l.kind !== 'Worn' || !l.date) continue;
    for (const id of l.items || []) {
      if (!st[id]) continue;
      st[id].wears++;
      if (!st[id].last || l.date.start > st[id].last) st[id].last = l.date.start;
    }
  }
  return st;
}

export function buildCatalog(items, stats) {
  const refs = {}; const back = {};
  const lines = items.map((it, i) => {
    const ref = 'i' + (i + 1);
    refs[ref] = it.id; back[it.id] = ref;
    const s = stats[it.id] || {};
    const bits = [
      ref, it.name || '(unnamed)', [it.category, it.subcategory].filter(Boolean).join('/'),
      [it.color, ...(it.secondary || [])].filter(Boolean).join('+'),
      it.pattern, (it.material || []).join('+'), it.fit,
      'season:' + ((it.season || []).join('+') || '-'),
      'occasion:' + ((it.occasion || []).join('+') || '-'),
      'style:' + ((it.styleTags || []).join('+') || '-'),
      'worn:' + (s.wears || 0) + (s.last ? ' last ' + s.last : ''),
      it.favorite ? 'favourite' : '',
      it.laundry && it.laundry !== 'Clean' ? 'laundry:' + it.laundry : '',
      it.storage ? 'kept:' + it.storage : '',
    ].filter(Boolean);
    return bits.join(' | ');
  });
  return { text: lines.join('\n'), refs, back };
}

const ROLES = ['dress', 'top', 'bottom', 'outerwear', 'swim', 'costume', 'shoes', 'bag', 'jewelry', 'accessory', 'other'];

// Map model refs back to her item ids; drop and count anything that is not in
// the catalog. Returns null when nothing real is left.
export function validateLook(look, refs, counter) {
  if (!look || typeof look !== 'object') return null;
  const pieces = [];
  const seen = new Set();
  for (const p of Array.isArray(look.pieces) ? look.pieces : []) {
    const ref = String((p && p.ref) || '').trim().toLowerCase();
    const id = refs[ref];
    if (!id) { counter.dropped++; continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    const role = ROLES.includes(String(p.role || '').toLowerCase()) ? String(p.role).toLowerCase() : 'other';
    pieces.push({ id, role });
  }
  if (!pieces.length) return null;
  const alternatives = [];
  for (const a of Array.isArray(look.alternatives) ? look.alternatives : []) {
    const from = refs[String((a && a.replace) || '').trim().toLowerCase()];
    const to = refs[String((a && a.with) || '').trim().toLowerCase()];
    if (!from || !to || !seen.has(from) || from === to) { counter.dropped++; continue; }
    alternatives.push({ replace: from, with: to, why: clean(a.why, 200) });
    if (alternatives.length >= 3) break;
  }
  const buy = (Array.isArray(look.suggested_purchases) ? look.suggested_purchases : []).slice(0, 3)
    .map((b) => ({ description: clean(b && b.description, 140), why: clean(b && b.why, 200) }))
    .filter((b) => b.description);
  return {
    name: clean(look.name, 80) || 'Look',
    pieces,
    explanation: clean(look.explanation, 900),
    alternatives,
    suggestedPurchases: buy,
  };
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

export function flagLooks(looks, logs, opts) {
  const since = opts.avoidRepeatDays && opts.date ? addDays(opts.date, -opts.avoidRepeatDays) : null;
  const worn = logs.filter((l) => l.kind === 'Worn' && l.date && (!since || l.date.start >= since)).map((l) => l.items || []);
  for (const lk of looks) {
    const ids = lk.pieces.map((p) => p.id);
    lk.repeat = !!(since && worn.some((w) => w.length && sameSet(w, ids)));
    if (opts.focusId) lk.missingFocus = !ids.includes(opts.focusId);
  }
  return looks;
}

export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

function profileText(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const bits = [];
  if (p.about) bits.push('About her: ' + clean(p.about, 400));
  if (p.style) bits.push('Style she likes: ' + clean(p.style, 400));
  if (p.avoid) bits.push('Avoid: ' + clean(p.avoid, 300));
  if (p.colors) bits.push('Colours she loves: ' + clean(p.colors, 200));
  if (p.notes) bits.push('Other notes: ' + clean(p.notes, 400));
  return bits.join('\n');
}

export function stylistSystem(profile) {
  return [
    'You are the private personal stylist inside Befalia\'s wardrobe app.',
    'You style ONLY with pieces from the catalog you are given. Each catalog line starts with a ref like i12. Refer to pieces by ref only.',
    'Never mention, imply or invent a piece that is not in the catalog. If a look would need something she does not have, put it in suggested_purchases, never in pieces.',
    'Consider the occasion, dress code, place, time of day, weather if given, colour harmony, her preferences, wear counts (favour pieces she wears less when it suits), and what she wore recently.',
    'A complete look normally has a main garment (a dress, or a top plus a bottom), shoes, and where suitable a bag and one or two jewelry or accessory pieces. Use fewer only when the catalog lacks them, and say so in the explanation.',
    'Write explanations in warm, clear, expert English, 2 to 4 sentences, no clichés, no hype, no dashes as punctuation.',
    'Return ONLY JSON, no prose, no code fences:',
    '{"looks":[{"name":"evocative but plain look name","pieces":[{"ref":"i3","role":"dress|top|bottom|outerwear|swim|costume|shoes|bag|jewelry|accessory|other"}],',
    '"explanation":"why it works for this request","alternatives":[{"replace":"i3","with":"i9","why":"short"}],',
    '"suggested_purchases":[{"description":"a piece she does not own","why":"what it would add"}]}],',
    '"note":"one line if the closet cannot really answer the request, else empty"}',
    profileText(profile),
  ].filter(Boolean).join('\n');
}

export function packSystem(profile) {
  return [
    'You plan packing for Befalia\'s trips using ONLY pieces from the catalog you are given, referred to by ref (i1, i2 ...).',
    'Never invent owned pieces. Things she should buy or borrow go in "missing".',
    'Re-wear pieces across days where sensible to keep luggage light, matching the luggage preference. Respect the activities and dress codes.',
    'If no forecast is given, do not state temperatures; reason from the destination and season in general terms and say it is not a forecast.',
    'Return ONLY JSON:',
    '{"days":[{"date":"YYYY-MM-DD","plan":"what the day is","look":{"name":"...","pieces":[{"ref":"i3","role":"top"}],"explanation":"one sentence"}}],',
    '"toiletries":["generic personal items worth bringing for this trip"],"personal":["documents, chargers, activity gear"],',
    '"reusable":[{"name":"capsule idea","refs":["i3","i5"]}],"missing":[{"description":"...","why":"..."}],"note":"..."}',
    profileText(profile),
  ].filter(Boolean).join('\n');
}

export function wishSystem() {
  return [
    'You help Befalia decide whether a piece on her wishlist is worth buying, judged only against what she already owns (the catalog, refs i1, i2 ...).',
    'Never invent owned pieces, prices, stock or links.',
    'Return ONLY JSON: {"verdict":"fills a gap | nice to have | likely duplicate","reason":"2 sentences","pairs":[{"refs":["i2","i7"],"how":"one sentence"}],"similar":["i4"]}',
  ].join('\n');
}

/* ---------------- weather (Open-Meteo, free, no key) ---------------- */

const WMO = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'rain showers', 82: 'violent showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail' };

// Daily forecast for a place name. Returns null instead of throwing: weather
// is a nice-to-have and must never block a look.
export async function forecast(place, start, end, today) {
  if (process.env.WARDROBE_WEATHER === 'off') return null;
  const q = clean(place, 80);
  if (!q || !start) return null;
  const last = addDays(today, 15);
  if (start > last || (end || start) < today) return null;
  const from = start < today ? today : start;
  const to = (end && end < last ? end : (end ? last : from));
  try {
    const g = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(q));
    const gj = await g.json();
    const hit = gj && gj.results && gj.results[0];
    if (!hit) return null;
    const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + hit.latitude + '&longitude=' + hit.longitude +
      '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=' + from + '&end_date=' + to;
    const f = await fetch(u);
    const fj = await f.json();
    const d = fj && fj.daily;
    if (!d || !d.time) return null;
    return {
      place: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', '),
      source: 'Open-Meteo forecast',
      days: d.time.map((t, i) => ({
        date: t, sky: WMO[d.weathercode[i]] || 'mixed',
        max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]),
        rain: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
      })),
    };
  } catch (e) { return null; }
}

export function weatherLine(w) {
  if (!w || !w.days || !w.days.length) return '';
  return 'Forecast for ' + w.place + ' (' + w.source + ', may change): ' + w.days.map((d) =>
    d.date + ' ' + d.sky + ' ' + d.min + ' to ' + d.max + '°C' + (d.rain != null ? ', rain chance ' + d.rain + '%' : '')).join('; ');
}

export { LAUNDRY_OUT };
