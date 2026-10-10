/* Wardrobe: Home, My Closet, item detail, the clothing scanner and batch add,
   bulk edit, and the style profile. */
'use strict';

/* ---------------- Home ---------------- */
RENDER.home = function (el) {
  const t = W.today;
  const planned = W.log.filter((l) => l.kind === 'Planned' && l.date && l.date.start === t);
  const wornToday = W.log.filter((l) => l.kind === 'Worn' && l.date && l.date.start === t);
  const upcoming = W.log.filter((l) => l.kind === 'Planned' && l.date && l.date.start > t && l.date.start <= addDays(t, 14)).sort((a, b) => (a.date.start < b.date.start ? -1 : 1));
  const warn = W.log.filter((l) => l.kind === 'Planned' && l.date && l.date.start >= t && l.date.start <= addDays(t, 7)).map((l) => ({ l, issues: lookIssues(l.items || []) })).filter((x) => x.issues.length);
  const act = activeItems();
  const val = valueByCurrency(act);
  const never = act.filter((i) => !wears(i.id)).length;
  const inLaundry = W.items.filter((i) => LAUNDRY_OUT.includes(i.laundry)).length;
  const today = planned[0] || wornToday[0];
  let h = '';
  if (warn.length) h += warn.map((x) => '<div class="banner warn">⚠︎ <div><b>' + esc(relDay(x.l.date.start)) + '</b>: your planned look includes ' + esc(x.issues.join(', ')) + '. <button class="link" data-plan="' + x.l.date.start + '">Change it</button></div></div>').join('');
  h += '<div class="homegrid"><div class="card lux"><div class="kick">Today’s outfit · ' + esc(prettyDay(t)) + '</div>';
  if (today) {
    const o = today.outfit && W.byId[today.outfit];
    h += '<h3 style="margin-top:6px;font-family:var(--display);font-size:24px">' + esc((o && o.name) || today.name.split(' · ')[2] || 'Your look') + '</h3>'
      + (today.event ? '<div class="small muted">For ' + esc(today.event) + '</div>' : '')
      + '<div class="board" style="box-shadow:none;border:0;padding:0;background:none">' + boardHTML(today.items || []) + '</div>'
      + '<div class="row">' + (today.kind === 'Planned' ? '<button class="btn gold sm" data-wear="' + today.id + '">Mark as worn</button>' : '<span class="tag ok">Worn today</span>') + '<button class="btn ghost sm" data-go="planner">Planner</button></div>';
  } else {
    h += '<div class="empty" style="padding:18px 6px"><span class="g">◇</span>Nothing planned for today.</div><div class="row" style="justify-content:center"><button class="btn sm" data-go="stylist">Ask the stylist</button><button class="btn ghost sm" data-plan="' + t + '">Plan a saved look</button></div>';
  }
  h += '</div><div class="card"><div class="kick">Ask my AI stylist</div><p class="small muted" style="margin:6px 0 0">Looks built only from pieces you own' + (W.server.ai ? '.' : '. AI is off because ANTHROPIC_API_KEY is not set in Vercel.') + '</p>'
    + '<div class="askbar"><input class="fld" id="home-ask" placeholder="What should I wear tomorrow for a business meeting?"' + (W.server.ai ? '' : ' disabled') + '><button class="btn" id="home-ask-go"' + (W.server.ai ? '' : ' disabled') + '>Ask</button></div>'
    + '<div class="chips" style="margin-top:10px">' + ['Classy dinner in Bali', 'Feminine, elegant, luxury', 'Ocean themed event', 'Business meeting tomorrow'].map((s) => '<button class="chip" data-askq="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div></div></div>';
  h += '<h2 class="sec">Quick actions</h2><div class="qa">'
    + '<button data-act="add"><span class="g">+</span><b>Quick add</b><span>Photograph a piece</span></button>'
    + '<button data-go="closet"><span class="g">▤</span><b>My closet</b><span>' + act.length + ' pieces</span></button>'
    + '<button data-go="room"><span class="g">◫</span><b>Saved looks</b><span>' + W.outfits.length + ' looks</span></button>'
    + '<button data-go="insights"><span class="g">◔</span><b>Insights</b><span>Wear and value</span></button></div>';
  h += '<h2 class="sec">Upcoming outfits<button class="act" data-go="planner">Planner →</button></h2>';
  h += upcoming.length ? '<div class="hs">' + upcoming.slice(0, 8).map((l) => '<button class="card" style="width:220px;text-align:left" data-plan="' + l.date.start + '"><div class="kick">' + esc(relDay(l.date.start)) + '</div><div style="font-family:var(--serif);font-size:16px;margin:4px 0 8px">' + esc(((l.outfit && W.byId[l.outfit]) || {}).name || l.name.split(' · ')[2] || 'Look') + '</div>' + miniHTML(l.items || [], 4) + (l.event ? '<div class="tiny muted" style="margin-top:6px">' + esc(l.event) + '</div>' : '') + '</button>').join('') + '</div>'
    : '<div class="card"><div class="muted small">No looks planned for the next two weeks.</div></div>';
  h += '<h2 class="sec">Saved looks<button class="act" data-go="room">All looks →</button></h2>';
  const looks = W.outfits.slice().sort((a, b) => (a.edited < b.edited ? 1 : -1)).slice(0, 10);
  h += looks.length ? '<div class="hs">' + looks.map((o) => '<button class="card" style="width:200px;text-align:left" data-look="' + o.id + '"><div style="font-family:var(--serif);font-size:16px;margin-bottom:8px">' + esc(o.name) + '</div>' + miniHTML(o.items, 4) + '</button>').join('') + '</div>'
    : '<div class="card"><div class="muted small">Saved looks from the stylist or the dressing room will show here.</div></div>';
  h += '<h2 class="sec">Wardrobe insights</h2><div class="tiles">'
    + tile(act.length, 'Pieces') + tile(val.length ? val.map((v) => money(v.sum, v.cur)).join(' + ') : '—', 'Recorded value', val.length > 1 ? 'small' : '')
    + tile(never, 'Never worn') + tile(inLaundry, 'In laundry or repair') + '</div>';
  if (!W.items.length) h = '<div class="card lux" style="text-align:center;padding:30px 18px"><div style="font-family:var(--display);font-size:26px">Your closet is empty</div><p class="muted" style="font-family:var(--serif);font-size:16px;line-height:1.5">Photograph a piece and the scanner fills in the details for you to check. Start with the ten pieces you wear most.</p><button class="btn gold" data-act="add">Add your first piece</button></div>' + h;
  el.innerHTML = h;
  const go2 = () => { const v = ($('#home-ask', el).value || '').trim(); if (!v) return; STY.prefill = v; go('stylist'); setTimeout(() => runStylist(), 30); };
  $('#home-ask-go', el) && ($('#home-ask-go', el).onclick = go2);
  $('#home-ask', el) && $('#home-ask', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') go2(); });
  el.onclick = (e) => {
    const q = e.target.closest('[data-askq]'); if (q) { STY.prefill = q.getAttribute('data-askq'); go('stylist'); return; }
    const a = e.target.closest('[data-act="add"]'); if (a) { openAdd(); return; }
    const p = e.target.closest('[data-plan]'); if (p) { go('planner', ['day', p.getAttribute('data-plan')]); return; }
    const w = e.target.closest('[data-wear]'); if (w) { markLogWorn(w.getAttribute('data-wear'), w); return; }
    const lk = e.target.closest('[data-look]'); if (lk) { openLook(lk.getAttribute('data-look')); }
  };
};
function tile(n, l, cls) { return '<div class="tile"><div class="n ' + (cls || '') + '"' + (cls ? ' style="font-size:17px"' : '') + '>' + esc(String(n)) + '</div><div class="l">' + esc(l) + '</div></div>'; }
function valueByCurrency(items) {
  const m = {};
  for (const i of items) if (i.price != null) { const c = i.currency || 'IDR'; m[c] = (m[c] || 0) + i.price; }
  return Object.keys(m).map((c) => ({ cur: c, sum: m[c] })).sort((a, b) => (a.cur === 'IDR' ? -1 : b.cur === 'IDR' ? 1 : 0));
}

/* ---------------- My Closet ---------------- */
const CL = { q: '', cat: '', f: {}, select: false, picked: new Set() };
RENDER.closet = function (el) {
  const p = prefs();
  const all = W.items.filter((i) => CL.f.gone ? true : (!i.status || i.status === 'In closet' || i.status === 'Lent out'));
  const list = closetFilter(all);
  sortItems(list, p.sort);
  const cats = CATS.filter((c) => all.some((i) => i.category === c));
  const nf = Object.keys(CL.f).filter((k) => CL.f[k]).length;
  let h = '<div class="tools"><input class="fld grow" id="cl-q" placeholder="Search name, brand, colour, notes" value="' + esc(CL.q) + '" autocomplete="off">'
    + '<button class="iconbtn" id="cl-filter" aria-label="Filters">⚲' + (nf ? '<sup style="color:var(--gold)">' + nf + '</sup>' : '') + '</button></div>'
    + '<div class="chips"><button class="chip' + (!CL.cat ? ' on' : '') + '" data-cat="">All<i>' + all.length + '</i></button>' + cats.map((c) => '<button class="chip' + (CL.cat === c ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '<i>' + all.filter((i) => i.category === c).length + '</i></button>').join('') + '</div>'
    + '<div class="row" style="margin:6px 0 12px"><select class="fld" id="cl-sort" style="width:auto;padding:8px 10px;font-size:13px" aria-label="Sort">'
    + [['new', 'Recently added'], ['name', 'Name'], ['most', 'Most worn'], ['least', 'Least worn'], ['last', 'Last worn'], ['price', 'Price, high first'], ['cpw', 'Cost per wear, best first']].map((s) => '<option value="' + s[0] + '"' + (p.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>').join('')
    + '</select><div class="grow"></div><div class="seg"><button data-vw="grid" class="' + (p.view !== 'list' ? 'on' : '') + '" aria-label="Grid">▦</button><button data-vw="list" class="' + (p.view === 'list' ? 'on' : '') + '" aria-label="List">☰</button></div>'
    + '<button class="btn ghost sm" id="cl-sel">' + (CL.select ? 'Cancel' : 'Select') + '</button><button class="btn sm" data-act="add">+ Add</button></div>';
  if (!W.items.length) h += '<div class="empty"><span class="g">▤</span>No pieces yet.<br><button class="btn gold" data-act="add" style="margin-top:12px">Add pieces</button></div>';
  else if (!list.length) h += '<div class="empty">Nothing matches these filters. <button class="link" id="cl-clear">Clear filters</button></div>';
  else h += '<div class="' + (p.view === 'list' ? 'list' : 'grid') + '" id="cl-grid">' + list.map((i) => itemCard(i, { select: CL.select, picked: CL.picked.has(i.id) })).join('') + '</div>';
  el.innerHTML = h;
  window.__closetSelect = CL.select;
  renderBulkBar();
  const qi = $('#cl-q', el);
  qi.oninput = debounce(() => { CL.q = qi.value; const pos = qi.selectionStart; render(); const n = $('#cl-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } }, 220);
  $('#cl-sort', el).onchange = (e) => { setPref('sort', e.target.value); render(); };
  $('#cl-filter', el).onclick = openFilters;
  $('#cl-sel', el).onclick = () => { CL.select = !CL.select; CL.picked.clear(); render(); };
  const clr = $('#cl-clear', el); if (clr) clr.onclick = () => { CL.f = {}; CL.cat = ''; CL.q = ''; render(); };
  el.onclick = (e) => {
    const c = e.target.closest('[data-cat]'); if (c) { CL.cat = c.getAttribute('data-cat'); render(); return; }
    const v = e.target.closest('[data-vw]'); if (v) { setPref('view', v.getAttribute('data-vw')); render(); return; }
    const a = e.target.closest('[data-act="add"]'); if (a) { openAdd(); return; }
    const it = e.target.closest('[data-item]');
    if (it && CL.select) { const id = it.getAttribute('data-item'); if (CL.picked.has(id)) CL.picked.delete(id); else CL.picked.add(id); render(); }
  };
};
function closetFilter(all) {
  const q = CL.q.toLowerCase().trim();
  const f = CL.f;
  return all.filter((i) => {
    if (CL.cat && i.category !== CL.cat) return false;
    if (q && [i.name, i.brand, i.color, i.subcategory, i.notes, (i.styleTags || []).join(' '), (i.material || []).join(' '), i.storage].join(' ').toLowerCase().indexOf(q) === -1) return false;
    if (f.color && String(i.color || '').toLowerCase() !== f.color.toLowerCase()) return false;
    if (f.season && !(i.season || []).includes(f.season)) return false;
    if (f.occasion && !(i.occasion || []).includes(f.occasion)) return false;
    if (f.laundry && i.laundry !== f.laundry) return false;
    if (f.status && i.status !== f.status) return false;
    if (f.storage && String(i.storage || '').toLowerCase() !== f.storage.toLowerCase()) return false;
    if (f.fav && !i.favorite) return false;
    if (f.never && wears(i.id)) return false;
    if (f.nocut && i.cutout && i.cutout.length) return false;
    return true;
  });
}
function sortItems(list, s) {
  const st = (i) => W.stats[i.id] || {};
  const by = {
    new: (a, b) => (a.created < b.created ? 1 : -1),
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
    most: (a, b) => (st(b).wears || 0) - (st(a).wears || 0),
    least: (a, b) => (st(a).wears || 0) - (st(b).wears || 0),
    last: (a, b) => String(st(b).last || '').localeCompare(String(st(a).last || '')),
    price: (a, b) => (b.price || 0) - (a.price || 0),
    cpw: (a, b) => { const x = cpw(a), y = cpw(b); if (x == null) return 1; if (y == null) return -1; return x - y; },
  };
  list.sort(by[s] || by.new);
}
function openFilters() {
  const uniq = (fn) => [...new Set(W.items.map(fn).filter(Boolean))].sort();
  const f = CL.f;
  sheet('Filter your closet', '<div class="form">'
    + '<label class="f">Colour<select class="fld" id="ff-color">' + opt(uniq((i) => i.color), f.color, 'Any') + '</select></label>'
    + '<label class="f">Season<select class="fld" id="ff-season">' + opt(SEASONS, f.season, 'Any') + '</select></label>'
    + '<label class="f">Occasion<select class="fld" id="ff-occ">' + opt(uniq((i) => null).concat([...new Set(W.items.flatMap((i) => i.occasion || []))].sort()), f.occasion, 'Any') + '</select></label>'
    + '<label class="f">Laundry<select class="fld" id="ff-laundry">' + opt(LAUNDRY, f.laundry, 'Any') + '</select></label>'
    + '<label class="f">Status<select class="fld" id="ff-status">' + opt(STATUSES, f.status, 'Any') + '</select></label>'
    + '<label class="f">Stored in<select class="fld" id="ff-storage">' + opt(uniq((i) => i.storage), f.storage, 'Anywhere') + '</select></label></div>'
    + '<div class="row" style="margin-top:12px"><label class="tog"><input type="checkbox" id="ff-fav"' + (f.fav ? ' checked' : '') + '> Favourites</label><label class="tog"><input type="checkbox" id="ff-never"' + (f.never ? ' checked' : '') + '> Never worn</label><label class="tog"><input type="checkbox" id="ff-nocut"' + (f.nocut ? ' checked' : '') + '> No cut-out yet</label><label class="tog"><input type="checkbox" id="ff-gone"' + (f.gone ? ' checked' : '') + '> Include donated and sold</label></div>'
    + '<div class="row" style="margin-top:16px"><button class="btn ghost" id="ff-reset">Reset</button><div class="grow"></div><button class="btn" id="ff-ok">Show pieces</button></div>', (el, close) => {
    $('#ff-reset', el).onclick = () => { CL.f = {}; close(); render(); };
    $('#ff-ok', el).onclick = () => {
      CL.f = { color: $('#ff-color', el).value, season: $('#ff-season', el).value, occasion: $('#ff-occ', el).value, laundry: $('#ff-laundry', el).value, status: $('#ff-status', el).value, storage: $('#ff-storage', el).value, fav: $('#ff-fav', el).checked, never: $('#ff-never', el).checked, nocut: $('#ff-nocut', el).checked, gone: $('#ff-gone', el).checked };
      close(); render();
    };
  });
}
function renderBulkBar() {
  let b = $('#bulkbar');
  if (!(W.view === 'closet' && CL.select)) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'bulkbar'; b.className = 'bulkbar'; document.body.appendChild(b); }
  const n = CL.picked.size;
  b.innerHTML = '<b style="font-weight:500">' + n + ' selected</b><div class="grow"></div>'
    + '<select id="bk-laundry" aria-label="Set laundry"><option value="">Laundry…</option>' + LAUNDRY.map((x) => '<option>' + esc(x) + '</option>').join('') + '</select>'
    + '<select id="bk-status" aria-label="Set status"><option value="">Status…</option>' + STATUSES.map((x) => '<option>' + esc(x) + '</option>').join('') + '</select>'
    + '<select id="bk-cat" aria-label="Set category"><option value="">Category…</option>' + CATS.map((x) => '<option>' + esc(x) + '</option>').join('') + '</select>'
    + '<button id="bk-more">More…</button><button id="bk-col">+ Collection</button><button id="bk-del" style="border-color:#e7a7a1;color:#ffd9d5">Delete</button>';
  const run = async (patch, archive) => {
    if (!n) { toast('Select pieces first'); return; }
    toast('Updating ' + n + ' pieces…');
    try {
      const j = await api('bulk', { kind: 'items', ids: Array.from(CL.picked), patch, archive });
      (j.rows || []).forEach((r) => (r.archived ? drop('items', r.id) : upsert('items', r)));
      toast((j.rows || []).length + ' updated' + ((j.failed || []).length ? ', ' + j.failed.length + ' failed' : ''), !!(j.failed || []).length);
      CL.picked.clear(); if (archive) CL.select = false; render();
    } catch (e) { toast(e.message, true); }
  };
  $('#bk-laundry', b).onchange = (e) => e.target.value && run({ laundry: e.target.value });
  $('#bk-status', b).onchange = (e) => e.target.value && run({ status: e.target.value });
  $('#bk-cat', b).onchange = (e) => e.target.value && run({ category: e.target.value });
  $('#bk-more', b).onclick = () => {
    if (!n) { toast('Select pieces first'); return; }
    sheet('Edit ' + n + ' pieces', '<p class="small muted">Only the fields you fill are changed. Season and occasion replace what the pieces had.</p><div class="form">'
      + '<label class="f">Stored in<input class="fld" id="bm-st" list="dl-storage" placeholder="e.g. Bali closet"></label>'
      + '<label class="f">Condition<select class="fld" id="bm-cond">' + opt(CONDITIONS, '', 'Leave as is') + '</select></label>'
      + '<label class="f full">Season<div class="chips" id="bm-sea">' + SEASONS.map((s) => '<button class="chip" data-v="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div></label>'
      + '<label class="f full">Occasion<div class="chips" id="bm-occ">' + OCCASIONS.map((s) => '<button class="chip" data-v="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div></label>'
      + '<label class="f">Favourite<select class="fld" id="bm-fav"><option value="">Leave as is</option><option value="1">Favourite</option><option value="0">Not favourite</option></select></label></div>'
      + storageList() + '<div class="row" style="margin-top:16px"><div class="grow"></div><button class="btn" id="bm-ok">Apply</button></div>', (el, close) => {
      ['#bm-sea', '#bm-occ'].forEach((s) => { $(s, el).onclick = (e) => { const c = e.target.closest('.chip'); if (c) { e.preventDefault(); c.classList.toggle('on'); } }; });
      $('#bm-ok', el).onclick = () => {
        const patch = {};
        const st = $('#bm-st', el).value.trim(); if (st) patch.storage = st;
        const co = $('#bm-cond', el).value; if (co) patch.condition = co;
        const se = $$('#bm-sea .chip.on', el).map((c) => c.getAttribute('data-v')); if (se.length) patch.season = se;
        const oc = $$('#bm-occ .chip.on', el).map((c) => c.getAttribute('data-v')); if (oc.length) patch.occasion = oc;
        const fv = $('#bm-fav', el).value; if (fv) patch.favorite = fv === '1';
        if (!Object.keys(patch).length) { toast('Nothing to change'); return; }
        close(); run(patch);
      };
    });
  };
  $('#bk-col', b).onclick = () => { if (!n) { toast('Select pieces first'); return; } pickCollection((cid) => addToCollection(cid, { items: Array.from(CL.picked) })); };
  $('#bk-del', b).onclick = (e) => { if (!n) { toast('Select pieces first'); return; } armDelete(e.target, () => run({}, true)); };
}
function storageList() { return '<datalist id="dl-storage">' + [...new Set(['Bali closet', 'Jakarta closet', 'Tabanan studio'].concat(W.items.map((i) => i.storage).filter(Boolean)))].map((s) => '<option value="' + esc(s) + '">').join('') + '</datalist>'; }

/* ---------------- item detail and editor ---------------- */
function itemForm(it, ask) {
  it = it || {};
  ask = ask || {};
  const sug = (k, val, label) => ask[k] && val != null && String(val) !== '' && !(Array.isArray(val) && !val.length)
    ? '<span class="ask" data-ask="' + k + '">AI suggests: <b>' + esc(Array.isArray(val) ? val.join(', ') : val) + '</b> (not sure) <button type="button" data-use="' + k + '">Use it</button></span>' : '';
  const multi = (k, list, cur) => '<div class="chips" data-multi="' + k + '">' + [...new Set(list.concat(cur || []))].map((s) => '<button type="button" class="chip' + ((cur || []).includes(s) ? ' on' : '') + '" data-v="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div>';
  return '<div class="form" data-form>'
    + '<label class="f full">Name<input class="fld" name="name" value="' + esc(it.name || '') + '" placeholder="e.g. Ivory silk wrap blouse" required></label>'
    + '<label class="f">Category<select class="fld" name="category">' + opt(CATS, it.category, 'Choose') + '</select>' + sug('category', ask.category && ask.category.v) + '</label>'
    + '<label class="f">Subcategory<input class="fld" name="subcategory" value="' + esc(it.subcategory || '') + '"></label>'
    + '<label class="f">Main colour<input class="fld" name="color" list="dl-colors" value="' + esc(it.color || '') + '">' + sug('color', ask.color && ask.color.v) + '</label>'
    + '<label class="f">Other colours<input class="fld" name="secondary" value="' + esc((it.secondary || []).join(', ')) + '" placeholder="comma separated"></label>'
    + '<label class="f">Pattern<input class="fld" name="pattern" list="dl-pattern" value="' + esc(it.pattern || '') + '">' + sug('pattern', ask.pattern && ask.pattern.v) + '</label>'
    + '<label class="f">Material<input class="fld" name="material" value="' + esc((it.material || []).join(', ')) + '" placeholder="comma separated">' + sug('material', ask.material && ask.material.v) + '</label>'
    + '<label class="f">Brand<input class="fld" name="brand" value="' + esc(it.brand || '') + '"></label>'
    + '<label class="f">Size<input class="fld" name="size" value="' + esc(it.size || '') + '"></label>'
    + '<label class="f">Fit<select class="fld" name="fit">' + opt(['Fitted', 'Regular', 'Relaxed', 'Oversized'].concat(it.fit && !['Fitted', 'Regular', 'Relaxed', 'Oversized'].includes(it.fit) ? [it.fit] : []), it.fit, '—') + '</select></label>'
    + '<label class="f">Condition<select class="fld" name="condition">' + opt(CONDITIONS, it.condition, '—') + '</select></label>'
    + '<label class="f full">Season' + multi('season', SEASONS, it.season) + '</label>'
    + '<label class="f full">Occasion' + multi('occasion', OCCASIONS, it.occasion) + '</label>'
    + '<label class="f full">Style tags<input class="fld" name="styleTags" value="' + esc((it.styleTags || []).join(', ')) + '" placeholder="e.g. Elegant, Minimal"></label>'
    + '<label class="f">Price<input class="fld" name="price" inputmode="decimal" value="' + esc(it.price == null ? '' : it.price) + '"></label>'
    + '<label class="f">Currency<select class="fld" name="currency">' + opt(CURRENCIES, it.currency || 'IDR') + '</select></label>'
    + '<label class="f">Bought on<input class="fld" type="date" name="purchaseDate" max="' + esc(W.today) + '" value="' + esc((it.purchaseDate && it.purchaseDate.start) || '') + '"></label>'
    + '<label class="f">Bought at<input class="fld" name="purchaseLocation" value="' + esc(it.purchaseLocation || '') + '"></label>'
    + '<label class="f">Stored in<input class="fld" name="storage" list="dl-storage" value="' + esc(it.storage || '') + '"></label>'
    + '<label class="f">Laundry<select class="fld" name="laundry">' + opt(LAUNDRY, it.laundry || 'Clean') + '</select></label>'
    + '<label class="f">Status<select class="fld" name="status">' + opt(STATUSES, it.status || 'In closet') + '</select></label>'
    + '<label class="f" style="justify-content:flex-end"><span class="tog" style="text-transform:none;letter-spacing:0"><input type="checkbox" name="favorite"' + (it.favorite ? ' checked' : '') + '> Favourite</span></label>'
    + '<label class="f full">Notes<textarea class="fld" name="notes" rows="2">' + esc(it.notes || '') + '</textarea></label></div>'
    + storageList() + '<datalist id="dl-colors">' + Object.keys(COLOR_HEX).map((c) => '<option value="' + esc(c.charAt(0).toUpperCase() + c.slice(1)) + '">').join('') + '</datalist>'
    + '<datalist id="dl-pattern">' + ['Solid', 'Floral', 'Stripes', 'Print', 'Checks', 'Polka dot', 'Animal', 'Lace', 'Embellished'].map((c) => '<option value="' + c + '">').join('') + '</datalist>';
}
function bindForm(el, ask) {
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-multi] .chip'); if (c) { e.preventDefault(); c.classList.toggle('on'); return; }
    const u = e.target.closest('[data-use]'); if (u) {
      e.preventDefault();
      const k = u.getAttribute('data-use'); const v = ask[k].v;
      const f = $('[name="' + k + '"]', el); if (f) f.value = Array.isArray(v) ? v.join(', ') : v;
      ask[k].ok = true; u.closest('.ask').remove();
    }
  });
}
const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
function readForm(el) {
  const g = (n) => { const f = $('[name="' + n + '"]', el); return f ? (f.type === 'checkbox' ? f.checked : f.value.trim()) : undefined; };
  const multi = (k) => $$('[data-multi="' + k + '"] .chip.on', el).map((c) => c.getAttribute('data-v'));
  const price = g('price');
  const d = {
    name: g('name'), category: g('category') || null, subcategory: g('subcategory'), color: g('color') || null,
    secondary: splitList(g('secondary')), pattern: g('pattern') || null, material: splitList(g('material')), brand: g('brand'),
    size: g('size'), fit: g('fit') || null, condition: g('condition') || null, season: multi('season'), occasion: multi('occasion'),
    styleTags: splitList(g('styleTags')), price: price === '' ? null : Number(String(price).replace(/[^0-9.]/g, '')),
    currency: g('currency'), purchaseDate: g('purchaseDate') ? { start: g('purchaseDate') } : null, purchaseLocation: g('purchaseLocation'),
    storage: g('storage'), laundry: g('laundry'), status: g('status'), favorite: g('favorite'), notes: g('notes'),
  };
  if (!d.name) throw new Error('Give the piece a name');
  if (d.price != null && !isFinite(d.price)) throw new Error('The price is not a number');
  return d;
}

function openItem(id) {
  const it = W.byId[id]; if (!it || it._k !== 'items') return;
  const st = W.stats[id] || { wears: 0, logs: [] };
  const c = cpw(it);
  const inCols = W.collections.filter((x) => (x.items || []).includes(id));
  const looks = W.outfits.filter((o) => (o.items || []).includes(id));
  const imgs = [].concat(it.cutout && it.cutout[0] ? [{ url: it.cutout[0].url, t: 'Cut-out' }] : [], it.photo && it.photo[0] ? [{ url: it.photo[0].url, t: 'Original' }] : []);
  const html = '<div class="two"><div><div class="hero-img" id="id-hero">' + (imgs[0] ? '<img src="' + esc(imgs[0].url) + '" alt="' + esc(it.name) + '">' : '<span class="ph0" style="font-family:var(--display);font-size:60px;color:var(--sand)">' + esc((it.name || '?').charAt(0)) + '</span>') + '</div>'
    + '<div class="thumbs" id="id-th">' + imgs.map((m, i) => '<button class="' + (i ? '' : 'on') + '" data-src="' + esc(m.url) + '" title="' + m.t + '"><img src="' + esc(m.url) + '" alt="' + m.t + '"></button>').join('') + '<span class="tiny muted" id="id-more" style="align-self:center">Loading photos…</span></div>'
    + '<div class="row" style="margin-top:10px"><button class="btn ghost sm" id="id-addph">+ Photo</button><button class="btn ghost sm" id="id-bg"' + (it.photo && it.photo[0] ? '' : ' disabled') + '>' + (it.cutout && it.cutout[0] ? 'Redo cut-out' : 'Remove background') + '</button></div>'
    + '<div class="stat3"><div><b>' + st.wears + '</b><span>Wears</span></div><div><b>' + (st.last ? esc(prettyDay(st.last, { weekday: undefined })) : '—') + '</b><span>Last worn</span></div><div><b style="font-size:15px">' + (c == null ? '—' : esc(money(c, it.currency))) + '</b><span>Cost per wear</span></div></div>'
    + '<div class="row"><button class="btn gold sm" id="id-wear">Worn today</button><button class="btn sm" id="id-style"' + (W.server.ai ? '' : ' disabled') + '>Style this piece</button><button class="btn ghost sm" id="id-col">+ Collection</button></div>'
    + (inCols.length ? '<div class="small muted" style="margin-top:10px">In ' + inCols.map((x) => esc(x.name)).join(', ') + '</div>' : '')
    + (looks.length ? '<div class="small muted" style="margin-top:6px">In ' + looks.length + ' saved look' + (looks.length > 1 ? 's' : '') + '</div>' : '')
    + (st.logs && st.logs.length ? '<h2 class="sec">Wear history</h2>' + st.logs.slice().sort((a, b) => (a.date.start < b.date.start ? 1 : -1)).slice(0, 12).map((l) => '<div class="ev">' + esc(prettyDay(l.date.start, { year: 'numeric' })) + (l.event ? ' · ' + esc(l.event) : '') + '</div>').join('') : '')
    + (it.ai && it.ai.scan ? '<p class="tiny muted" style="margin-top:12px">Details were suggested by the scanner on ' + esc(String(it.ai.at || '').slice(0, 10)) + ' and checked by you.</p>' : '')
    + '</div><div>' + itemForm(it) + '<div class="row" style="margin-top:16px"><button class="btn danger sm" id="id-del">Delete</button><a class="btn ghost sm" href="' + safeUrl(it.url) + '" target="_blank" rel="noopener">Notion ↗</a><div class="grow"></div><button class="btn" id="id-save">Save</button></div></div></div>';
  sheet(it.name || 'Piece', html, (el, close) => {
    bindForm(el, {});
    api('photos', { kind: 'items', id }).then((j) => {
      const box = $('#id-th', el); if (!box) return;
      $('#id-more', el) && $('#id-more', el).remove();
      box.insertAdjacentHTML('beforeend', (j.images || []).map((m) => '<button data-src="' + esc(m.url) + '" title="' + esc(m.caption) + '"><img src="' + esc(m.url) + '" alt="' + esc(m.caption || 'photo') + '"></button>').join(''));
    }).catch(() => { const m = $('#id-more', el); if (m) m.textContent = ''; });
    $('#id-th', el).onclick = (e) => { const b = e.target.closest('[data-src]'); if (!b) return; $$('#id-th button', el).forEach((x) => x.classList.remove('on')); b.classList.add('on'); $('#id-hero', el).innerHTML = '<img src="' + b.getAttribute('data-src') + '" alt="">'; };
    $('#id-save', el).onclick = async (e) => {
      let d; try { d = readForm(el); } catch (x) { toast(x.message, true); return; }
      busy(e.target, true);
      try { await save('items', id, d); toast('Saved'); close(); render(); } catch (x) { busy(e.target, false); toast(x.message, true); }
    };
    $('#id-del', el).onclick = (e) => armDelete(e.target, async () => { try { await remove('items', id); toast('Deleted. It can be restored from Notion trash.'); close(); render(); } catch (x) { toast(x.message, true); } });
    $('#id-wear', el).onclick = async (e) => { busy(e.target, true, 'Logging…'); try { await logWear({ items: [id] }); toast('Logged as worn today'); close(); render(); } catch (x) { busy(e.target, false); toast(x.message, true); } };
    $('#id-style', el).onclick = () => { close(); STY.focus = id; STY.prefill = 'Style my ' + (it.name || 'piece') + ' in three different ways'; go('stylist'); };
    $('#id-col', el).onclick = () => pickCollection((cid) => addToCollection(cid, { items: [id] }));
    $('#id-addph', el).onclick = () => pickFile($('#f-one'), async (files) => {
      const f = files[0]; if (!f) return;
      toast('Adding photo…');
      try { const c2 = await compress(f, 2000, 'image/jpeg', 0.86); const up = await uploadBlob(c2.blob, (it.name || 'photo') + '-extra'); const j = await api('update', { kind: 'items', id, patch: {}, uploads: { photo: up } }); upsert('items', j.row); toast('Photo added'); close(); openItem(id); } catch (x) { toast(x.message, true); }
    });
    $('#id-bg', el).onclick = async (e) => {
      const b = e.target; busy(b, true, 'Working…');
      try {
        const src = await api('image', { url: it.photo[0].url });
        const bin = atob(src.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const cut = await removeBackground(new Blob([u8], { type: src.mime }), (s) => { b.innerHTML = '<span class="spin"></span> ' + esc(s); });
        const up = await uploadBlob(cut.blob, (it.name || 'piece') + '-cutout');
        const j = await api('update', { kind: 'items', id, patch: {}, uploads: { cutout: up } });
        upsert('items', j.row); toast('Background removed. The original photo is kept.'); close(); openItem(id); render();
      } catch (x) { busy(b, false); toast('Background removal failed: ' + x.message, true); }
    };
  });
}
async function logWear(d) {
  const day = d.date || W.today;
  const label = d.label || (d.outfit && W.byId[d.outfit] && W.byId[d.outfit].name) || (d.items && d.items.length === 1 && W.byId[d.items[0]] ? W.byId[d.items[0]].name : 'Pieces');
  const j = await api('create', { kind: 'log', data: { kind: 'Worn', date: day, outfit: d.outfit || null, items: d.items || [], event: d.event || '', taskId: d.taskId || '', label }, markLaundry: prefs().markLaundry });
  upsert('log', j.row); (j.laundry || []).forEach((r) => upsert('items', r));
  return j.row;
}
async function markLogWorn(logId, btn) {
  const l = W.byId[logId]; if (!l) return;
  if (l.date.start > W.today) { toast('That day has not happened yet'); return; }
  busy(btn, true, 'Logging…');
  try {
    const j = await api('update', { kind: 'log', id: logId, patch: { kind: 'Worn' }, markLaundry: prefs().markLaundry });
    upsert('log', j.row); (j.laundry || []).forEach((r) => upsert('items', r));
    toast('Marked as worn'); render();
  } catch (e) { busy(btn, false); toast(e.message, true); }
}
function pickFile(input, fn) {
  input.value = '';
  input.onchange = () => { const files = Array.from(input.files || []); input.value = ''; fn(files); };
  input.click();
}

/* ---------------- add pieces: scanner and batch ---------------- */
const ADD = { queue: [], el: null, running: false };
function openAdd() {
  const p = prefs();
  sheet('Add pieces', '<div class="qa" style="grid-template-columns:repeat(3,1fr)">'
    + '<button id="ad-cam"><span class="g">◉</span><b>Take photo</b><span>Use the camera</span></button>'
    + '<button id="ad-lib"><span class="g">▦</span><b>Choose photos</b><span>One or many</span></button>'
    + '<button id="ad-none"><span class="g">✎</span><b>No photo</b><span>Type it in</span></button></div>'
    + '<div class="row" style="margin-top:12px"><label class="tog"><input type="checkbox" id="ad-scan"' + (p.scan && W.server.ai ? ' checked' : '') + (W.server.ai ? '' : ' disabled') + '> AI fills in details</label>'
    + '<label class="tog"><input type="checkbox" id="ad-bg"' + (p.bg ? ' checked' : '') + '> Remove background</label></div>'
    + '<p class="tiny muted">Tip: lay the piece flat or hang it against a plain wall in daylight. Originals are always kept. ' + (W.server.bgServer ? 'Backgrounds are removed on the server.' : 'Backgrounds are removed on this phone; the first time downloads a 40 MB model.') + '</p>'
    + '<div id="ad-q" style="margin-top:12px"></div><div class="row" id="ad-foot" style="margin-top:6px;display:none"><span class="muted small grow" id="ad-n"></span><button class="btn" id="ad-all">Save all ready</button></div>', (el) => {
    ADD.el = el; ADD.queue = [];
    $('#ad-scan', el).onchange = (e) => setPref('scan', e.target.checked);
    $('#ad-bg', el).onchange = (e) => setPref('bg', e.target.checked);
    $('#ad-cam', el).onclick = () => pickFile($('#f-camera'), addFiles);
    $('#ad-lib', el).onclick = () => pickFile($('#f-library'), addFiles);
    $('#ad-none', el).onclick = () => { ADD.queue.push({ key: 'q' + Date.now(), file: null, state: 'ready', steps: [], records: [{ data: {}, ask: {} }] }); drawQueue(); };
    $('#ad-all', el).onclick = saveAllQueue;
  }, { onClose: () => { ADD.el = null; } });
}
async function addFiles(files) {
  if (!files.length) return;
  if (files.length > 30) { toast('Up to 30 photos at a time'); files = files.slice(0, 30); }
  for (const f of files) ADD.queue.push({ key: 'q' + Math.random().toString(36).slice(2), file: f, state: 'wait', steps: [], records: [] });
  drawQueue();
  if (!ADD.running) runQueue();
}
async function runQueue() {
  ADD.running = true;
  for (const q of ADD.queue) { if (q.state === 'wait') { await processEntry(q); drawQueue(); } }
  ADD.running = false;
  if (ADD.queue.some((q) => q.state === 'wait')) runQueue();
}
function step(q, text, cls) { q.steps.push({ text, cls: cls || '' }); drawQueue(); }
async function processEntry(q) {
  q.state = 'work';
  const p = prefs();
  try {
    step(q, 'Preparing photo…');
    q.orig = await compress(q.file, 2000, 'image/jpeg', 0.86);
    q.thumb = URL.createObjectURL(q.orig.blob);
    q.hash = await sha256(q.file);
    q.steps.pop(); step(q, 'Photo ready (' + Math.round(q.orig.blob.size / 1024) + ' KB)', 'ok');
  } catch (e) { q.state = 'error'; step(q, e.message, 'bad'); return; }
  let scan = null;
  const scanOn = W.server.ai && $('#ad-scan', ADD.el || document) ? $('#ad-scan', ADD.el || document).checked : (W.server.ai && p.scan);
  if (scanOn) {
    try {
      step(q, 'Reading the piece…');
      const small = await compress(q.orig.blob, 1024, 'image/jpeg', 0.82);
      const j = await api('ai.scan', { data: await blobB64(small.blob), hash: q.hash });
      q.steps.pop();
      if (j.cached && j.duplicate) { q.duplicate = j.duplicate; step(q, 'This exact photo is already in your closet as "' + j.duplicate.name + '"', 'bad'); }
      scan = j.scan;
      if (scan && scan.isClothing) step(q, 'Found ' + scan.items.length + ' piece' + (scan.items.length > 1 ? 's' : '') + (scan.note ? '. ' + scan.note : ''), 'ok');
      else if (scan) step(q, 'No clothing recognised' + (scan.note ? ': ' + scan.note : '') + '. Fill it in by hand.', 'bad');
      q.model = j.model;
    } catch (e) { q.steps.pop(); step(q, 'Scanner unavailable: ' + e.message + '. Fill it in by hand.', 'bad'); }
  }
  const found = scan && scan.isClothing ? scan.items : [{ suggestion: {}, ask: [], confidence: {}, box: null }];
  q.records = found.map((s) => {
    const sg = s.suggestion || {};
    const ask = {};
    // Confident fields are prefilled; unsure ones wait for a tap on "Use it".
    const data = { name: sg.name || '', subcategory: sg.subcategory || '', secondary: sg.secondary || [], fit: sg.fit || null, season: sg.season || [], occasion: sg.occasion || [], styleTags: sg.styleTags || [], brand: sg.brand || '' };
    for (const k of ['category', 'color', 'pattern', 'material']) {
      if ((s.ask || []).includes(k)) ask[k] = { v: sg[k], ok: false };
      else data[k] = sg[k];
    }
    return { data, ask, box: found.length > 1 ? s.box : null, conf: s.confidence, scan: s };
  });
  if (q.records.length > 1) step(q, 'Each piece gets its own record. Crops follow the scanner’s outline; check them.', '');
  const bgOn = $('#ad-bg', ADD.el || document) ? $('#ad-bg', ADD.el || document).checked : p.bg;
  for (const r of q.records) {
    if (r.box) { try { r.crop = await compress(q.orig.blob, 1600, 'image/jpeg', 0.88, padBox(r.box, 0.04)); r.cropUrl = URL.createObjectURL(r.crop.blob); } catch (e) { r.crop = null; } }
    if (bgOn) {
      try {
        step(q, 'Removing background…');
        const cut = await removeBackground((r.crop || q.orig).blob, (s) => { q.steps[q.steps.length - 1].text = s; drawQueue(); });
        q.steps.pop();
        if (cut.keep < 0.04) step(q, 'The cut-out looked empty, so the photo is kept as is.', 'bad');
        else { r.cutout = cut; r.cutUrl = URL.createObjectURL(cut.blob); step(q, 'Background removed', 'ok'); }
      } catch (e) { q.steps.pop(); step(q, 'Background not removed: ' + e.message, 'bad'); }
    }
  }
  q.state = 'ready';
}
function drawQueue() {
  const box = ADD.el && $('#ad-q', ADD.el); if (!box) return;
  // Keep what was typed before redrawing.
  $$('[data-rec]', box).forEach((f) => { const [k, i] = f.getAttribute('data-rec').split(':'); const q = ADD.queue.find((x) => x.key === k); if (q && q.records[i]) { try { q.records[i].data = Object.assign(q.records[i].data, readForm(f)); } catch (e) { /* name may be empty */ } } });
  box.innerHTML = ADD.queue.map((q) => {
    if (q.state === 'saved') return '<div class="q"><div class="row"><span class="tag ok">Saved</span><span class="small">' + esc(q.savedNames.join(', ')) + '</span></div></div>';
    const head = '<div class="qh"><div class="qimg">' + (q.thumb ? '<img src="' + q.thumb + '" alt="">' : '<span class="muted">No photo</span>') + '</div><div class="steps grow">' + (q.state === 'wait' ? '<span>Waiting…</span>' : '') + q.steps.map((s) => '<span class="' + s.cls + '">' + (s.cls === 'ok' ? '✓ ' : s.cls === 'bad' ? '! ' : '<span class="spin"></span> ') + esc(s.text) + '</span>').join('') + '</div><button class="iconbtn" data-qdel="' + q.key + '" aria-label="Remove">×</button></div>';
    if (q.state !== 'ready') return '<div class="q">' + head + '</div>';
    return '<div class="q">' + head + q.records.map((r, i) => '<div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">'
      + (q.records.length > 1 || r.cutUrl ? '<div class="row" style="margin-bottom:10px">' + (r.cropUrl ? '<div class="qimg" style="width:72px;height:90px"><img src="' + r.cropUrl + '" alt=""><span class="t">crop</span></div>' : '') + (r.cutUrl ? '<div class="qimg" style="width:72px;height:90px"><img src="' + r.cutUrl + '" alt=""><span class="t">cut-out</span></div>' : '') + (q.records.length > 1 ? '<label class="tog"><input type="checkbox" data-skip="' + q.key + ':' + i + '"' + (r.skip ? ' checked' : '') + '> Skip this one</label>' : '') + '</div>' : '')
      + '<div data-rec="' + q.key + ':' + i + '">' + itemForm(r.data, r.ask) + '</div></div>').join('')
      + '<div class="row" style="margin-top:12px"><div class="grow"></div><button class="btn sm" data-qsave="' + q.key + '">Save ' + (q.records.length > 1 ? q.records.length + ' pieces' : 'piece') + '</button></div></div>';
  }).join('');
  $$('[data-rec]', box).forEach((f) => { const [k, i] = f.getAttribute('data-rec').split(':'); const q = ADD.queue.find((x) => x.key === k); bindForm(f, q.records[i].ask); });
  box.onclick = (e) => {
    const d = e.target.closest('[data-qdel]'); if (d) { ADD.queue = ADD.queue.filter((q) => q.key !== d.getAttribute('data-qdel') || q.state === 'work'); drawQueue(); return; }
    const s = e.target.closest('[data-qsave]'); if (s) { saveEntry(ADD.queue.find((q) => q.key === s.getAttribute('data-qsave')), s); return; }
    const k = e.target.closest('[data-skip]'); if (k) { const [qk, i] = k.getAttribute('data-skip').split(':'); ADD.queue.find((q) => q.key === qk).records[i].skip = k.checked; }
  };
  const ready = ADD.queue.filter((q) => q.state === 'ready').length;
  $('#ad-foot', ADD.el).style.display = ready > 1 ? '' : 'none';
  $('#ad-n', ADD.el).textContent = ready + ' ready to save';
}
async function saveEntry(q, btn) {
  if (!q || q.state !== 'ready') return;
  const forms = $$('[data-rec^="' + q.key + ':"]', ADD.el);
  const datas = [];
  try { forms.forEach((f) => { const i = +f.getAttribute('data-rec').split(':')[1]; if (!q.records[i].skip) datas.push({ i, d: readForm(f) }); }); } catch (e) { toast(e.message, true); return; }
  busy(btn, true);
  const names = [];
  try {
    for (const x of datas) {
      const r = q.records[x.i];
      const uploads = {};
      // Photo is always the full original. The display copy is the cut-out,
      // or the crop when one photo held several pieces.
      if (q.orig) uploads.photo = await uploadBlob(q.orig.blob, x.d.name);
      const disp = r.cutout || r.crop;
      if (disp) uploads.cutout = await uploadBlob(disp.blob, x.d.name + (r.cutout ? '-cutout' : '-crop'));
      const data = Object.assign({}, x.d, { imageHash: q.hash || '', ai: r.scan && q.model ? { scan: { isClothing: true, items: [r.scan] }, model: q.model, at: new Date().toISOString(), confirmed: Object.keys(r.ask).filter((k) => r.ask[k].ok) } : null });
      const j = await api('create', { kind: 'items', data, uploads });
      upsert('items', j.row); names.push(j.row.name);
    }
    q.state = 'saved'; q.savedNames = names; drawQueue(); render();
    toast(names.length + ' piece' + (names.length > 1 ? 's' : '') + ' saved');
  } catch (e) { busy(btn, false); toast(e.message + (names.length ? ' (' + names.length + ' saved before this)' : ''), true); if (names.length) { q.records = q.records.filter((r, i) => !datas.slice(0, names.length).some((d) => d.i === i)); drawQueue(); } }
}
async function saveAllQueue(e) {
  const b = e.target; busy(b, true);
  for (const q of ADD.queue.filter((x) => x.state === 'ready')) { const sb = $('[data-qsave="' + q.key + '"]', ADD.el); await saveEntry(q, sb); }
  busy(b, false);
}

/* ---------------- collections helpers used across views ---------------- */
function pickCollection(fn) {
  sheet('Add to collection', '<div class="list" id="pc-l">' + W.collections.map((c) => '<button class="it" data-c="' + c.id + '"><div class="meta"><div class="nm">' + esc(c.name) + '</div><div class="ct">' + (c.items || []).length + ' pieces · ' + (c.outfits || []).length + ' looks</div></div></button>').join('') + '</div><div class="row" style="margin-top:12px"><input class="fld grow" id="pc-new" placeholder="New collection name"><button class="btn sm" id="pc-add">Create</button></div>', (el, close) => {
    $('#pc-l', el).onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; close(); fn(b.getAttribute('data-c')); };
    $('#pc-add', el).onclick = async (e) => {
      const n = $('#pc-new', el).value.trim(); if (!n) return; busy(e.target, true);
      try { const r = await save('collections', null, { name: n, order: (W.collections.length + 1) * 10 }); close(); fn(r.id); } catch (x) { busy(e.target, false); toast(x.message, true); }
    };
  });
}
async function addToCollection(cid, add) {
  try {
    const j = await api('collect', { id: cid, items: add.items ? { add: add.items } : undefined, outfits: add.outfits ? { add: add.outfits } : undefined });
    upsert('collections', j.row); toast('Added to ' + j.row.name); render();
  } catch (e) { toast(e.message, true); }
}

/* ---------------- style profile and settings ---------------- */
function openProfile() {
  const p = W.profile || {}; const pr = prefs();
  sheet('Style profile', '<p class="small muted">The stylist reads this before every suggestion. Write it in your own words.</p><div class="form">'
    + '<label class="f full">About me<textarea class="fld" id="pf-about" rows="2" placeholder="e.g. what you do, where you spend your days, what your week usually holds">' + esc(p.about || '') + '</textarea></label>'
    + '<label class="f full">Style I love<textarea class="fld" id="pf-style" rows="2" placeholder="e.g. feminine, elegant, quiet luxury, flowing fabrics">' + esc(p.style || '') + '</textarea></label>'
    + '<label class="f full">Colours I love<input class="fld" id="pf-colors" value="' + esc(p.colors || '') + '" placeholder="e.g. ivory, champagne, ocean blues"></label>'
    + '<label class="f full">Avoid<input class="fld" id="pf-avoid" value="' + esc(p.avoid || '') + '" placeholder="e.g. heavy logos, very high heels at the pool"></label>'
    + '<label class="f">Usual sizes<input class="fld" id="pf-sizes" value="' + esc(p.sizes || '') + '"></label>'
    + '<label class="f">Home base<input class="fld" id="pf-home" value="' + esc(p.home || '') + '" placeholder="Bali" list="dl-place"></label>'
    + '<label class="f full">Other notes<textarea class="fld" id="pf-notes" rows="2">' + esc(p.notes || '') + '</textarea></label></div>'
    + '<datalist id="dl-place"><option value="Bali"><option value="Jakarta"><option value="Sanur, Bali"><option value="Tabanan, Bali"></datalist>'
    + '<div class="row" style="margin-top:12px"><div class="grow"></div><button class="btn" id="pf-save">Save profile</button></div>'
    + '<h2 class="sec">On this device</h2><div class="row"><label class="tog"><input type="checkbox" id="pf-ml"' + (pr.markLaundry ? ' checked' : '') + '> Mark clothes "Worn once" when I log a look</label>'
    + '<label class="tog">Warn about repeats within <input type="number" id="pf-rd" min="0" max="90" value="' + esc(pr.repeatDays) + '" style="width:52px" class="fld"> days</label></div>'
    + '<h2 class="sec">Services</h2><div class="small" style="line-height:1.7">'
    + 'AI scanner and stylist: <b>' + (W.server.ai ? 'on' : 'off, add ANTHROPIC_API_KEY in Vercel') + '</b>' + (W.server.ai ? ' · ' + (W.meter.used == null ? '?' : W.meter.used) + ' of ' + W.meter.cap + ' uses today' : '') + '<br>'
    + 'Background removal: <b>' + (W.server.bgServer ? 'remove.bg on the server' : 'on this device (open source model)') + '</b><br>'
    + 'Weather: <b>' + (W.server.weather ? 'Open-Meteo forecast, up to 16 days ahead' : 'off') + '</b><br>'
    + 'Virtual try-on: <b>not set up</b>. It needs a try-on provider and key; nothing is simulated until then.</div>', (el, close) => {
    $('#pf-save', el).onclick = async (e) => {
      busy(e.target, true);
      try { const j = await api('settings', { key: 'profile', value: { about: $('#pf-about', el).value, style: $('#pf-style', el).value, colors: $('#pf-colors', el).value, avoid: $('#pf-avoid', el).value, sizes: $('#pf-sizes', el).value, home: $('#pf-home', el).value, notes: $('#pf-notes', el).value } }); W.profile = j.profile; toast('Profile saved'); close(); } catch (x) { busy(e.target, false); toast(x.message, true); }
    };
    $('#pf-ml', el).onchange = (e) => setPref('markLaundry', e.target.checked);
    $('#pf-rd', el).onchange = (e) => setPref('repeatDays', Math.max(0, Math.min(90, parseInt(e.target.value, 10) || 0)));
  });
}
