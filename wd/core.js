/* Wardrobe module, core. Shared state, the API client, the OS key lock,
   image handling (compression, hashing, background removal), navigation,
   sheets and toasts. The other wd/*.js files add the views. */
'use strict';

const W = {
  loaded: false, loading: false, err: '', today: '', lastLoad: 0,
  items: [], outfits: [], log: [], collections: [], trips: [], wish: [],
  profile: {}, meter: { used: null, cap: null }, server: { ai: false, bgServer: false, tryon: false, weather: true },
  byId: {}, stats: {}, tasks: null, tasksErr: '',
  view: 'home', route: [],
};
const CATS = ['Dresses', 'Tops', 'Shirts and blouses', 'Pants', 'Jeans', 'Skirts', 'Shorts', 'Outerwear', 'Activewear', 'Swimwear', 'Mermaid and underwater outfits', 'Performance costumes', 'Formalwear', 'Shoes', 'Bags', 'Jewelry', 'Accessories', 'Other'];
const SEASONS = ['All year', 'Tropical heat', 'Rainy season', 'Spring', 'Summer', 'Autumn', 'Winter'];
const OCCASIONS = ['Business', 'Casual', 'Evening', 'Event', 'Travel', 'Beach', 'Performance'];
const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'AUD', 'GBP'];
const CONDITIONS = ['New', 'Excellent', 'Good', 'Worn', 'Needs repair'];
const LAUNDRY = ['Clean', 'Worn once', 'In laundry', 'At dry cleaner', 'Needs repair'];
const LAUNDRY_OUT = ['In laundry', 'At dry cleaner', 'Needs repair'];
const STATUSES = ['In closet', 'Lent out', 'Donated', 'Sold'];
const SMALL_CATS = ['Shoes', 'Bags', 'Jewelry', 'Accessories'];
const COLOR_HEX = { black: '#222', white: '#fff', ivory: '#fffff0', cream: '#f4ead5', beige: '#e3d1b4', nude: '#e6c4a8', camel: '#c19a6b', brown: '#7b5236', tan: '#d2b48c', gold: '#c9a24a', silver: '#c0c0c0', grey: '#9a9a9a', gray: '#9a9a9a', navy: '#22305a', blue: '#3b6fb6', 'light blue': '#a8c8ea', teal: '#2a8c8c', turquoise: '#3fc6c0', aqua: '#5fe0e6', green: '#4f8a4f', olive: '#7a7a3a', sage: '#a7b59a', mint: '#bfe6cf', yellow: '#e8c547', mustard: '#c9a227', orange: '#e0813a', coral: '#f08a72', red: '#c0392b', burgundy: '#7a1f2b', wine: '#6d2132', pink: '#e8a3b9', blush: '#f2c9cf', fuchsia: '#c2337a', purple: '#7a4ea3', lilac: '#c8a8d8', lavender: '#c9bde6', multi: 'conic-gradient(#e8a3b9,#e8c547,#5fe0e6,#7a4ea3,#e8a3b9)' };
const WD_SETTINGS = 'wd_prefs';

/* ---------- small helpers ---------- */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function safeUrl(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? esc(u) : ''; }
function prefs() { try { return Object.assign({ scan: true, bg: true, markLaundry: false, repeatDays: 14, view: 'grid', sort: 'new' }, JSON.parse(localStorage.getItem(WD_SETTINGS) || '{}')); } catch (e) { return { scan: true, bg: true, markLaundry: false, repeatDays: 14, view: 'grid', sort: 'new' }; } }
function setPref(k, v) { const p = prefs(); p[k] = v; try { localStorage.setItem(WD_SETTINGS, JSON.stringify(p)); } catch (e) { /* private mode */ } }
function witaToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function addDays(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dayDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function prettyDay(day, opts) { if (!day) return ''; const d = new Date(day + 'T12:00:00Z'); return d.toLocaleDateString('en-GB', Object.assign({ weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }, opts || {})); }
function relDay(day) { const t = W.today || witaToday(); const n = dayDiff(t, day); if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday'; return prettyDay(day); }
function money(n, cur) {
  if (n == null || !isFinite(n)) return '—';
  cur = cur || 'IDR';
  if (cur === 'IDR') return 'Rp' + Math.round(n).toLocaleString('id-ID');
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n); } catch (e) { return cur + ' ' + n; }
}
function swatch(name) {
  const k = String(name || '').toLowerCase().trim();
  const v = COLOR_HEX[k] || Object.keys(COLOR_HEX).filter((c) => k.indexOf(c) !== -1).map((c) => COLOR_HEX[c])[0];
  return v || 'var(--sand)';
}
function debounce(fn, ms) { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; }

/* ---------- OS key (same key and storage slot as the main dashboard) ---------- */
function osKey() { try { return localStorage.getItem('os_key') || ''; } catch (e) { return ''; } }
function lockScreen(msg) {
  if ($('#wd-lock')) return;
  const w = document.createElement('div'); w.className = 'lock'; w.id = 'wd-lock';
  w.innerHTML = '<div style="max-width:340px;width:100%;text-align:center"><div style="font-family:var(--display);font-size:26px;letter-spacing:.3em;text-indent:.3em">WARDROBE</div>'
    + '<p class="muted small" style="margin:12px 0 16px;line-height:1.5">' + esc(msg || 'First time on this device. Paste your OS key from your password manager.') + '</p>'
    + '<input id="wd-lock-in" type="password" class="fld" autocomplete="off" aria-label="OS key">'
    + '<button class="btn" id="wd-lock-go" style="width:100%;margin-top:10px">Unlock</button>'
    + '<div id="wd-lock-st" class="small" style="color:var(--bad);margin-top:10px"></div>'
    + '<p class="tiny muted" style="margin-top:12px">Stored on this device only and sent only to your own OS.</p></div>';
  document.body.appendChild(w);
  const go = () => {
    const v = ($('#wd-lock-in').value || '').trim().replace(/^["']+|["']+$/g, '').trim(); if (!v) return;
    const b = $('#wd-lock-go'); b.disabled = true; b.textContent = 'Checking…';
    fetch('/api/wardrobe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-os-key': v }, body: JSON.stringify({ action: 'ping' }) }).then((r) => {
      if (r.status === 401) { b.disabled = false; b.textContent = 'Unlock'; $('#wd-lock-st').textContent = 'The server refused this key. It must match OS_KEY in Vercel exactly.'; return; }
      try { localStorage.setItem('os_key', v); } catch (e) { /* ignore */ }
      w.remove(); boot();
    }).catch(() => { b.disabled = false; b.textContent = 'Unlock'; $('#wd-lock-st').textContent = 'Could not reach your OS. Check the connection and try again.'; });
  };
  $('#wd-lock-go').onclick = go;
  $('#wd-lock-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  setTimeout(() => { try { $('#wd-lock-in').focus(); } catch (e) { /* ignore */ } }, 50);
}

async function api(action, payload, route) {
  const r = await fetch(route || '/api/wardrobe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-os-key': osKey() }, body: JSON.stringify(Object.assign({ action }, payload || {})) });
  if (r.status === 401) { try { localStorage.removeItem('os_key'); } catch (e) { /* ignore */ } lockScreen('That key was refused. It may have been rotated. Paste the current one.'); throw new Error('OS key refused'); }
  if (r.status === 404 && !route) throw new Error('The wardrobe service is not on this deployment yet');
  let j = {}; try { j = await r.json(); } catch (e) { j = {}; }
  if (!r.ok || j.error) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; e.capped = j.capped; throw e; }
  if (j.used != null && j.cap != null) { W.meter = { used: j.used, cap: j.cap }; renderMeter(); }
  return j;
}

/* ---------- data ---------- */
function indexAll() {
  W.byId = {};
  for (const k of ['items', 'outfits', 'log', 'collections', 'trips', 'wish']) for (const r of W[k]) W.byId[r.id] = Object.assign(r, { _k: k });
  computeStats();
}
function computeStats() {
  const st = {};
  for (const it of W.items) st[it.id] = { wears: 0, last: null, logs: [] };
  for (const l of W.log) {
    if (l.kind !== 'Worn' || !l.date) continue;
    for (const id of l.items || []) {
      const s = st[id]; if (!s) continue;
      s.wears++; s.logs.push(l);
      if (!s.last || l.date.start > s.last) s.last = l.date.start;
    }
  }
  W.stats = st;
}
function wears(id) { return (W.stats[id] && W.stats[id].wears) || 0; }
function cpw(it) { const n = wears(it.id); if (it.price == null || !n) return null; return it.price / n; }
function activeItems() { return W.items.filter((i) => !i.status || i.status === 'In closet' || i.status === 'Lent out'); }
function isAvailable(it) { return it && (!it.status || it.status === 'In closet') && !LAUNDRY_OUT.includes(it.laundry); }
function unavailableReason(it) {
  if (!it) return 'deleted';
  if (it.status && it.status !== 'In closet') return it.status.toLowerCase();
  if (LAUNDRY_OUT.includes(it.laundry)) return it.laundry.toLowerCase();
  return '';
}
function itemImg(it) {
  if (!it) return '';
  const c = it.cutout && it.cutout[0]; if (c) return c.url;
  const p = it.photo && it.photo[0]; return p ? p.url : '';
}
function itemImgTag(it, cls) {
  const u = itemImg(it);
  if (!u) return '<span class="ph0">' + esc(((it && it.name) || '?').trim().charAt(0).toUpperCase()) + '</span>';
  const full = !(it.cutout && it.cutout[0]);
  return '<img src="' + esc(u) + '" alt="' + esc(it.name || '') + '" loading="lazy" decoding="async"' + (full && cls ? ' class="' + cls + '"' : '') + ' onerror="imgExpired()">';
}
let __imgReload = 0;
// Notion photo links expire after about an hour. One quiet reload fixes them.
function imgExpired() { if (Date.now() - __imgReload < 60000 || Date.now() - W.lastLoad < 30000) return; __imgReload = Date.now(); load(true); }

async function load(silent) {
  if (W.loading) return;
  W.loading = true; if (!silent) { W.err = ''; render(); }
  try {
    const j = await api('list', {});
    W.today = j.today; W.profile = j.profile || {}; W.meter = j.meter || W.meter; W.server = j.server || W.server;
    for (const k of ['items', 'outfits', 'log', 'collections', 'trips', 'wish']) W[k] = j[k] || [];
    W.collections.sort((a, b) => (a.order == null ? 1e9 : a.order) - (b.order == null ? 1e9 : b.order));
    indexAll(); W.loaded = true; W.err = ''; W.lastLoad = Date.now();
  } catch (e) { W.err = e.message; }
  W.loading = false; renderMeter(); render();
}
function upsert(kind, row) {
  if (!row) return;
  const arr = W[kind]; const i = arr.findIndex((r) => r.id === row.id);
  if (i === -1) arr.push(row); else arr[i] = row;
  indexAll();
}
function drop(kind, id) { W[kind] = W[kind].filter((r) => r.id !== id); indexAll(); }
async function save(kind, id, patch, extra) {
  const j = await api(id ? 'update' : 'create', Object.assign(id ? { kind, id, patch } : { kind, data: patch }, extra || {}));
  upsert(kind, j.row);
  (j.laundry || []).forEach((r) => upsert('items', r));
  return j.row;
}
async function remove(kind, id) { await api('archive', { kind, id }); drop(kind, id); }

async function loadTasks() {
  if (W.tasks || W.tasksLoading) return;
  W.tasksLoading = true;
  try {
    const j = await api('list', {}, '/api/tasks');
    W.tasks = (j.tasks || []).filter((t) => t.date && t.date.start && t.status !== 'Parked' && t.area !== 'Focus');
  } catch (e) { W.tasksErr = e.message; W.tasks = []; }
  W.tasksLoading = false;
  if (W.view === 'planner' || W.view === 'home') render();
}
function eventsOn(day) {
  return (W.tasks || []).filter((t) => {
    const s = String(t.date.start).slice(0, 10); const e = t.date.end ? String(t.date.end).slice(0, 10) : s;
    return (t.type === 'Event' || /T\d/.test(t.date.start)) && day >= s && day <= e;
  });
}

/* ---------- images ---------- */
function loadImage(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('That image could not be opened')); im.src = src; }); }
async function decode(blob) {
  if (window.createImageBitmap) { try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ } }
  const u = URL.createObjectURL(blob);
  try { return await loadImage(u); } finally { setTimeout(() => URL.revokeObjectURL(u), 2000); }
}
function canvasBlob(cv, mime, q) { return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image'))), mime, q)); }
// Resize to fit maxDim and encode. JPEG for photos; PNG keeps transparency.
async function compress(src, maxDim, mime, quality, crop) {
  const im = src instanceof Blob ? await decode(src) : src;
  const sw = im.width, sh = im.height;
  let sx = 0, sy = 0, cw = sw, ch = sh;
  if (crop) { sx = Math.max(0, crop[0] * sw); sy = Math.max(0, crop[1] * sh); cw = Math.min(sw - sx, crop[2] * sw); ch = Math.min(sh - sy, crop[3] * sh); }
  const s = Math.min(1, maxDim / Math.max(cw, ch));
  const w = Math.max(1, Math.round(cw * s)), h = Math.max(1, Math.round(ch * s));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  if (mime === 'image/jpeg') { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); }
  cx.drawImage(im, sx, sy, cw, ch, 0, 0, w, h);
  let q = quality || 0.86;
  let blob = await canvasBlob(cv, mime, q);
  while (mime === 'image/jpeg' && blob.size > 2400000 && q > 0.5) { q -= 0.1; blob = await canvasBlob(cv, mime, q); }
  return { blob, w, h };
}
function blobB64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('Could not read the image')); r.readAsDataURL(blob); }); }
async function sha256(blob) {
  try { const b = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return ''; }
}
// Pad a crop box a little so a piece is not cut tight at its edges.
function padBox(b, p) { if (!b) return null; const x = Math.max(0, b[0] - p), y = Math.max(0, b[1] - p); return [x, y, Math.min(1 - x, b[2] + 2 * p), Math.min(1 - y, b[3] + 2 * p)]; }

async function uploadBlob(blob, name) {
  const j = await api('upload', { data: await blobB64(blob), filename: name || 'photo' });
  return j.upload;
}

// Trim the transparent border of a cut-out and cap its size.
async function trimPng(blob, maxDim) {
  const im = await decode(blob);
  const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
  const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, cv.width, cv.height).data;
  let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) {
    if (d[(y * cv.width + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error('The background remover found nothing to keep');
  const pad = Math.round(Math.max(cv.width, cv.height) * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(cv.width, x1 + pad); y1 = Math.min(cv.height, y1 + pad);
  const area = (x1 - x0) * (y1 - y0) / (cv.width * cv.height);
  const out = await compress(cv, maxDim || 900, 'image/png', 1, [x0 / cv.width, y0 / cv.height, (x1 - x0) / cv.width, (y1 - y0) / cv.height]);
  out.keep = area;
  return out;
}

// Background removal. Server (remove.bg) when a key is set in Vercel, else on
// this device with IMG.LY's open source model, which downloads once (about
// 40 MB) and is then cached by the browser. The original is never touched.
let __bgLib = null;
async function removeBackground(blob, onStep) {
  if (W.server.bgServer) {
    onStep && onStep('Removing background on the server…');
    const j = await api('bg', { data: await blobB64(blob) });
    const bin = atob(j.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return trimPng(new Blob([u8], { type: 'image/png' }));
  }
  onStep && onStep(__bgLib ? 'Removing background…' : 'Loading the background remover (first time only, about 40 MB)…');
  if (!__bgLib) {
    const m = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm');
    __bgLib = m.removeBackground || m.default;
    if (typeof __bgLib !== 'function') { __bgLib = null; throw new Error('The background remover did not load'); }
  }
  const out = await __bgLib(blob, {
    model: 'isnet_quint8', output: { format: 'image/png' },
    progress: (key, cur, total) => { if (onStep && total) onStep('Preparing background remover ' + Math.round(cur / total * 100) + '%'); },
  });
  onStep && onStep('Cleaning up the cut-out…');
  return trimPng(out);
}

/* ---------- navigation ---------- */
const VIEWS = [
  ['home', 'Home', '◇'], ['closet', 'Closet', '▤'], ['stylist', 'Stylist', '✧'], ['room', 'Dressing room', '◫'],
  ['planner', 'Planner', '▦'], ['collections', 'Collections', '❖'], ['packing', 'Packing', '✈︎'], ['insights', 'Insights', '◔'], ['wishlist', 'Wishlist', '♡'],
];
function buildNav() {
  $('#tabs').innerHTML = VIEWS.map((v) => '<button data-go="' + v[0] + '">' + esc(v[1]) + '</button>').join('');
  $('#bnav').innerHTML = [['home', 'Home', '◇'], ['closet', 'Closet', '▤'], ['add', 'Add', '+'], ['stylist', 'Stylist', '✧'], ['more', 'More', '⋯']]
    .map((v) => '<button data-go="' + v[0] + '" class="' + (v[0] === 'add' ? 'add' : '') + '" aria-label="' + v[1] + '"><span class="g">' + v[2] + '</span>' + (v[0] === 'add' ? '' : v[1]) + '</button>').join('');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    const v = b.getAttribute('data-go');
    if (v === 'add') { openAdd(); return; }
    if (v === 'more') { openMore(); return; }
    go(v);
  });
}
function openMore() {
  sheet('More', '<div class="qa">' + VIEWS.filter((v) => !['home', 'closet', 'stylist'].includes(v[0])).map((v) =>
    '<button data-go="' + v[0] + '" data-close><span class="g">' + v[2] + '</span><b>' + esc(v[1]) + '</b><span></span></button>').join('') +
    '<button id="more-prof" data-close><span class="g">⚙︎</span><b>Style profile</b><span>Preferences and settings</span></button></div>', (el) => {
    $('#more-prof', el).onclick = () => setTimeout(openProfile, 50);
  });
}
function go(view, args, noHash) {
  if (!VIEWS.find((v) => v[0] === view)) view = 'home';
  W.view = view; W.route = args || [];
  if (!noHash) { const h = '#' + [view].concat(W.route).map(encodeURIComponent).join('/'); if (location.hash !== h) history.replaceState(null, '', h); }
  $$('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + view));
  $$('#tabs button,#bnav button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-go') === view));
  $('#hero').style.display = view === 'home' ? '' : 'none';
  window.scrollTo({ top: 0 });
  render();
}
function readHash() {
  const parts = (location.hash || '').replace(/^#/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { view: parts[0] || 'home', args: parts.slice(1) };
}

/* ---------- sheets and toasts ---------- */
let __sheets = 0;
function sheet(title, html, onMount, opts) {
  const s = document.createElement('div'); s.className = 'scrim'; __sheets++;
  s.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="grab"></div><div class="hd"><h3>' + esc(title) + '</h3><button class="iconbtn" data-close aria-label="Close">×</button></div><div class="bd">' + html + '</div></div>';
  document.body.appendChild(s);
  document.body.style.overflow = 'hidden';
  const close = () => { if (!s.isConnected) return; s.remove(); __sheets--; if (!__sheets) document.body.style.overflow = ''; opts && opts.onClose && opts.onClose(); };
  s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-close]')) close(); });
  s.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  s._close = close;
  if (onMount) onMount($('.bd', s), close, s);
  return s;
}
function toast(msg, bad, action) {
  let t = $('#wd-toast'); if (t) t.remove();
  t = document.createElement('div'); t.id = 'wd-toast'; t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', 'status');
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button>' + esc(action.label) + '</button>' : '');
  document.body.appendChild(t);
  if (action) $('button', t).onclick = () => { t.remove(); action.fn(); };
  clearTimeout(window.__toastT); window.__toastT = setTimeout(() => t.remove(), bad ? 7000 : 4200);
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.l = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + esc(label || 'Saving…'); }
  else { btn.disabled = false; if (btn.dataset.l) btn.innerHTML = btn.dataset.l; }
}
function armDelete(btn, fn) {
  if (!btn.classList.contains('arm')) { btn.classList.add('arm'); const l = btn.textContent; btn.textContent = 'Tap again to delete'; setTimeout(() => { if (btn.isConnected) { btn.classList.remove('arm'); btn.textContent = l; } }, 4000); return; }
  fn();
}
function renderMeter() {
  const m = $('#meter'); if (!m) return;
  if (!W.server.ai) { m.textContent = 'AI off'; m.title = 'ANTHROPIC_API_KEY is not set'; return; }
  m.textContent = 'AI ' + (W.meter.used == null ? '—' : W.meter.used) + ' / ' + (W.meter.cap || '—');
  m.title = 'AI uses today (resets at midnight WITA)';
}

/* ---------- shared bits of markup ---------- */
function opt(list, cur, blank) { return (blank != null ? '<option value="">' + esc(blank) + '</option>' : '') + list.map((o) => '<option' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>').join(''); }
function itemCard(it, o) {
  o = o || {};
  const st = W.stats[it.id] || {};
  const why = unavailableReason(it);
  return '<button class="it' + (o.picked ? ' picked' : '') + '" data-item="' + it.id + '" aria-label="' + esc(it.name) + '">'
    + '<div class="ph">' + itemImgTag(it, 'full') + '</div>'
    + '<div class="badges">' + (it.favorite ? '<span class="fav">♥</span>' : '<span></span>') + (why && !o.select ? '<span class="tag warn">' + esc(why) + '</span>' : '') + '</div>'
    + (o.select ? '<span class="sel">' + (o.picked ? '✓' : '') + '</span>' : '')
    + '<div class="meta"><div class="nm">' + esc(it.name || 'Untitled') + '</div><div class="ct">' + esc([it.category, it.color].filter(Boolean).join(' · ')) + (o.wears !== false ? ' · ' + (st.wears || 0) + '×' : '') + '</div></div></button>';
}
function roleOf(it) {
  const c = it && it.category;
  if (['Dresses', 'Formalwear', 'Mermaid and underwater outfits', 'Performance costumes', 'Swimwear'].includes(c)) return 'main';
  if (['Tops', 'Shirts and blouses', 'Outerwear', 'Activewear'].includes(c)) return 'mid';
  if (['Pants', 'Jeans', 'Skirts', 'Shorts'].includes(c)) return 'mid';
  return 'sm';
}
// Visual outfit board from real closet photos. Pieces that no longer exist
// are shown as missing, never silently swapped.
function boardHTML(ids, o) {
  o = o || {};
  const its = ids.map((id) => W.byId[id]).filter(Boolean);
  const order = { main: 0, mid: 1, sm: 2 };
  its.sort((a, b) => order[roleOf(a)] - order[roleOf(b)]);
  let mains = 0;
  const cells = its.map((it) => {
    let r = roleOf(it);
    if (r === 'main') { mains++; if (mains > 1) r = 'mid'; }
    if (r === 'mid' && !its.some((x) => roleOf(x) === 'main') && its.filter((x) => roleOf(x) === 'mid').indexOf(it) === 0) r = 'main';
    const why = unavailableReason(it);
    return '<div class="pc ' + r + '" data-item="' + it.id + '" role="button" tabindex="0">' + itemImgTag(it) + '<span class="cap">' + (why ? '⚠︎ ' : '') + esc(it.name) + '</span></div>';
  }).join('');
  const missing = ids.length - its.length;
  return '<div class="bgrid">' + cells + '</div>' + (missing ? '<div class="tiny muted">' + missing + ' piece' + (missing > 1 ? 's were' : ' was') + ' deleted from your closet.</div>' : '');
}
function miniHTML(ids, n) {
  const its = ids.map((id) => W.byId[id]).filter(Boolean).slice(0, n || 5);
  return '<div class="mini">' + its.map((it) => '<span class="pc">' + itemImgTag(it) + '</span>').join('') + (ids.length > (n || 5) ? '<span class="pc tiny muted">+' + (ids.length - (n || 5)) + '</span>' : '') + '</div>';
}
function lookIssues(ids) {
  return ids.map((id) => ({ id, it: W.byId[id] })).filter((x) => !x.it || !isAvailable(x.it)).map((x) => (x.it ? x.it.name + ' (' + unavailableReason(x.it) + ')' : 'a deleted piece'));
}

/* ---------- item picker (used by outfits, collections, planner) ---------- */
function pickItems(title, preset, done) {
  const picked = new Set(preset || []);
  let q = '', cat = '';
  sheet(title, '<input class="fld" id="pk-q" placeholder="Search your closet" autocomplete="off"><div class="chips" id="pk-c" style="margin-top:8px"></div><div class="grid" id="pk-g" style="margin-top:8px"></div><div class="row" style="margin-top:14px;position:sticky;bottom:0;background:var(--ivory);padding:10px 0"><span class="muted small grow" id="pk-n"></span><button class="btn" id="pk-ok">Done</button></div>', (el, close) => {
    const draw = () => {
      const cats = CATS.filter((c) => W.items.some((i) => i.category === c));
      $('#pk-c', el).innerHTML = ['<button class="chip' + (!cat ? ' on' : '') + '" data-c="">All</button>'].concat(cats.map((c) => '<button class="chip' + (cat === c ? ' on' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>')).join('');
      const list = activeItems().filter((i) => (!cat || i.category === cat) && (!q || (i.name + ' ' + (i.brand || '') + ' ' + (i.color || '')).toLowerCase().indexOf(q) !== -1));
      $('#pk-g', el).innerHTML = list.map((i) => itemCard(i, { select: true, picked: picked.has(i.id), wears: false })).join('') || '<div class="empty">Nothing matches.</div>';
      $('#pk-n', el).textContent = picked.size + ' selected';
    };
    $('#pk-q', el).oninput = (e) => { q = e.target.value.toLowerCase().trim(); draw(); };
    $('#pk-c', el).onclick = (e) => { const c = e.target.closest('[data-c]'); if (!c) return; cat = c.getAttribute('data-c'); draw(); };
    $('#pk-g', el).onclick = (e) => { const c = e.target.closest('[data-item]'); if (!c) return; e.stopPropagation(); const id = c.getAttribute('data-item'); if (picked.has(id)) picked.delete(id); else picked.add(id); draw(); };
    $('#pk-ok', el).onclick = () => { close(); done(Array.from(picked)); };
    draw();
  });
}
function pickOutfit(title, done) {
  const list = W.outfits.slice().sort((a, b) => (a.favorite === b.favorite ? (a.edited < b.edited ? 1 : -1) : (a.favorite ? -1 : 1)));
  sheet(title, list.length ? '<div class="list" id="po">' + list.map((o) => '<button class="it" data-o="' + o.id + '"><div class="meta"><div class="nm">' + esc(o.name) + (o.favorite ? ' <span class="fav" style="color:var(--gold)">♥</span>' : '') + '</div><div style="margin-top:6px">' + miniHTML(o.items, 6) + '</div></div></button>').join('') + '</div>'
    : '<div class="empty"><span class="g">◇</span>No saved looks yet. Build one in the dressing room or ask the stylist.</div>', (el, close) => {
    const p = $('#po', el); if (p) p.onclick = (e) => { const b = e.target.closest('[data-o]'); if (!b) return; close(); done(b.getAttribute('data-o')); };
  });
}

/* ---------- render dispatch ---------- */
const RENDER = {};
function render() {
  const el = $('#v-' + W.view); if (!el) return;
  if (!W.loaded) {
    el.innerHTML = W.err ? '<div class="banner bad">' + esc(W.err) + ' <button class="link" onclick="load()">Try again</button></div>' : '<div class="loading"><span class="spin"></span> Opening your closet…</div>';
    return;
  }
  try { (RENDER[W.view] || RENDER.home)(el); } catch (e) { console.error(e); el.innerHTML = '<div class="banner bad">Something broke while drawing this page: ' + esc(e.message) + '</div>'; }
}

function boot() {
  if (!osKey()) { lockScreen(); return; }
  const h = readHash();
  go(h.view, h.args, true);
  load();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && W.loaded && Date.now() - W.lastLoad > 40 * 60 * 1000) load(true); });
window.addEventListener('hashchange', () => { const h = readHash(); if (h.view !== W.view || h.args.join('/') !== W.route.join('/')) go(h.view, h.args, true); });
document.addEventListener('DOMContentLoaded', () => {
  buildNav();
  $('#btn-profile').onclick = () => openProfile();
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-item]');
    // A view that re-rendered on this click has already handled it; its old
    // nodes are detached by now and must not also open the piece.
    if (!c || !c.isConnected || c.closest('#pk-g') || c.closest('.tray') || c.closest('[data-noitem]')) return;
    if (W.view === 'closet' && window.__closetSelect && c.closest('#v-closet')) return;
    openItem(c.getAttribute('data-item'));
  });
  if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* ignore */ } }
  boot();
});
