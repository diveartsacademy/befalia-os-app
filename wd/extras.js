/* Wardrobe: Style Collections, Travel Packing, Wardrobe Insights, Wishlist. */
'use strict';

/* ---------------- Style collections ---------------- */
RENDER.collections = function (el) {
  const open = W.route[0] && W.byId[W.route[0]] && W.byId[W.route[0]]._k === 'collections' ? W.byId[W.route[0]] : null;
  if (open) { collectionDetail(el, open); return; }
  let h = '<h2 class="sec" style="margin-top:8px">Style collections<button class="act" id="co-new">+ New collection</button></h2><div class="grid">';
  h += W.collections.map((c) => {
    const ids = (c.items || []).concat(...(c.outfits || []).map((o) => (W.byId[o] || {}).items || []));
    const pics = [...new Set(ids)].map((id) => W.byId[id]).filter((it) => it && itemImg(it)).slice(0, 4);
    return '<button class="it" data-col="' + c.id + '" data-noitem><div class="ph" style="aspect-ratio:1;display:grid;grid-template-columns:1fr 1fr;gap:2px;padding:8px">' + (pics.length ? pics.map((it) => '<img src="' + esc(itemImg(it)) + '" alt="" style="width:100%;height:100%;object-fit:contain;padding:4px">').join('') : '<span class="ph0" style="grid-column:span 2">❖</span>') + '</div><div class="meta"><div class="nm">' + esc(c.name) + '</div><div class="ct">' + (c.items || []).length + ' pieces · ' + (c.outfits || []).length + ' looks</div></div></button>';
  }).join('') + '</div>';
  if (!W.collections.length) h += '<div class="empty">No collections yet.</div>';
  el.innerHTML = h;
  $('#co-new', el).onclick = () => sheet('New collection', '<input class="fld" id="cn" placeholder="e.g. Wedding season"><div class="row" style="margin-top:12px"><div class="grow"></div><button class="btn" id="cn-ok">Create</button></div>', (s, close) => {
    $('#cn-ok', s).onclick = async (e) => { const n = $('#cn', s).value.trim(); if (!n) return; busy(e.target, true); try { const r = await save('collections', null, { name: n, order: (W.collections.length + 1) * 10 }); close(); go('collections', [r.id]); } catch (x) { busy(e.target, false); toast(x.message, true); } };
  });
  el.onclick = (e) => { const b = e.target.closest('[data-col]'); if (b) go('collections', [b.getAttribute('data-col')]); };
};
function collectionDetail(el, c) {
  let h = '<div class="row" style="margin-top:8px"><button class="link" data-back>← All collections</button></div>'
    + '<div class="row"><h1 style="font-family:var(--display);font-weight:400;font-size:30px;margin:6px 0" class="grow">' + esc(c.name) + '</h1><button class="btn ghost sm" id="cd-ren">Rename</button></div>'
    + '<textarea class="fld" id="cd-notes" rows="2" placeholder="Notes for this collection: mood, rules, references">' + esc(c.notes || '') + '</textarea>'
    + '<div class="row" style="margin-top:8px"><button class="btn sm" id="cd-items">+ Pieces</button><button class="btn sm" id="cd-looks">+ Looks</button><button class="btn ghost sm" id="cd-insp">+ Inspiration photo</button><div class="grow"></div><button class="btn danger sm" id="cd-del">Delete collection</button></div>';
  h += '<h2 class="sec">Looks</h2>' + ((c.outfits || []).length ? '<div class="grid">' + c.outfits.map((id) => W.byId[id]).filter(Boolean).map((o) => '<div class="board" style="padding:10px"><button class="link" data-look="' + o.id + '" style="font-family:var(--serif);font-size:16px;color:var(--ink)">' + esc(o.name) + '</button>' + miniHTML(o.items, 4) + '<button class="link tiny" data-rmo="' + o.id + '">Remove from collection</button></div>').join('') + '</div>' : '<div class="small muted">No looks here yet.</div>');
  h += '<h2 class="sec">Pieces</h2>' + ((c.items || []).length ? '<div class="grid">' + c.items.map((id) => W.byId[id]).filter(Boolean).map((it) => '<div>' + itemCard(it) + '<button class="link tiny" data-rmi="' + it.id + '">Remove</button></div>').join('') + '</div>' : '<div class="small muted">No pieces here yet.</div>');
  h += '<h2 class="sec">Inspiration</h2><div class="grid" id="cd-ins"><div class="loading"><span class="spin"></span> Loading…</div></div>';
  el.innerHTML = h;
  api('photos', { kind: 'collections', id: c.id }).then((j) => {
    const g = $('#cd-ins'); if (!g) return;
    g.innerHTML = (j.images || []).length ? j.images.map((m) => '<div class="it"><div class="ph"><img class="full" src="' + esc(m.url) + '" alt="' + esc(m.caption || 'inspiration') + '"></div>' + (m.caption && m.caption !== 'inspiration' ? '<div class="meta"><div class="ct">' + esc(m.caption) + '</div></div>' : '') + '</div>').join('') : '<div class="small muted">Add photos that capture the mood. They are kept as inspiration, not as pieces you own.</div>';
  }).catch((e) => { const g = $('#cd-ins'); if (g) g.innerHTML = '<div class="small muted">' + esc(e.message) + '</div>'; });
  const saveNotes = debounce(async (v) => { try { await save('collections', c.id, { notes: v }); toast('Notes saved'); } catch (x) { toast(x.message, true); } }, 900);
  $('#cd-notes', el).oninput = (e) => saveNotes(e.target.value);
  $('#cd-ren', el).onclick = () => sheet('Rename', '<input class="fld" id="rn" value="' + esc(c.name) + '"><div class="row" style="margin-top:12px"><div class="grow"></div><button class="btn" id="rn-ok">Save</button></div>', (s, close) => { $('#rn-ok', s).onclick = async () => { try { await save('collections', c.id, { name: $('#rn', s).value }); close(); render(); } catch (x) { toast(x.message, true); } }; });
  $('#cd-items', el).onclick = () => pickItems('Pieces in ' + c.name, c.items, async (ids) => { try { const add = ids.filter((x) => !c.items.includes(x)); const rem = c.items.filter((x) => !ids.includes(x)); const j = await api('collect', { id: c.id, items: { add, remove: rem } }); upsert('collections', j.row); render(); } catch (x) { toast(x.message, true); } });
  $('#cd-looks', el).onclick = () => pickOutfit('Add a look to ' + c.name, (oid) => addToCollection(c.id, { outfits: [oid] }));
  $('#cd-insp', el).onclick = () => pickFile($('#f-one'), async (files) => {
    if (!files[0]) return; toast('Adding inspiration…');
    try { const img = await compress(files[0], 1800, 'image/jpeg', 0.85); const up = await uploadBlob(img.blob, c.name + '-inspiration'); await api('addPhoto', { kind: 'collections', id: c.id, upload: up, caption: 'inspiration' }); toast('Added'); render(); } catch (x) { toast(x.message, true); }
  });
  $('#cd-del', el).onclick = (e) => armDelete(e.target, async () => { try { await remove('collections', c.id); toast('Collection deleted. Pieces and looks are untouched.'); go('collections'); } catch (x) { toast(x.message, true); } });
  el.onclick = async (e) => {
    if (e.target.closest('[data-back]')) { go('collections'); return; }
    const lk = e.target.closest('[data-look]'); if (lk) { openLook(lk.getAttribute('data-look')); return; }
    const ri = e.target.closest('[data-rmi]'), ro = e.target.closest('[data-rmo]');
    if (ri || ro) { try { const j = await api('collect', { id: c.id, items: ri ? { remove: [ri.getAttribute('data-rmi')] } : undefined, outfits: ro ? { remove: [ro.getAttribute('data-rmo')] } : undefined }); upsert('collections', j.row); render(); } catch (x) { toast(x.message, true); } }
  };
}

/* ---------------- Travel packing ---------------- */
RENDER.packing = function (el) {
  const open = W.route[0] && W.byId[W.route[0]] && W.byId[W.route[0]]._k === 'trips' ? W.byId[W.route[0]] : null;
  if (open) { tripDetail(el, open); return; }
  const trips = W.trips.filter((t) => !t.template).sort((a, b) => String((b.dates || {}).start || '').localeCompare(String((a.dates || {}).start || '')));
  const temps = W.trips.filter((t) => t.template);
  let h = '<h2 class="sec" style="margin-top:8px">Travel packing<button class="act" id="pk-new">+ New trip</button></h2>';
  h += trips.length ? '<div class="list">' + trips.map((t) => tripRow(t)).join('') + '</div>' : '<div class="empty"><span class="g">✈︎</span>No trips yet. Plan one and the assistant packs from your own closet first.</div>';
  if (temps.length) h += '<h2 class="sec">Packing templates</h2><div class="list">' + temps.map((t) => tripRow(t)).join('') + '</div>';
  el.innerHTML = h;
  $('#pk-new', el).onclick = () => newTrip();
  el.onclick = (e) => { const b = e.target.closest('[data-trip]'); if (b) go('packing', [b.getAttribute('data-trip')]); };
};
function tripRow(t) {
  const p = t.plan || {}; const all = packList(p); const done = all.filter((x) => x.packed).length;
  return '<button class="it" data-trip="' + t.id + '" data-noitem><div class="meta"><div class="nm">' + esc(t.name) + '</div><div class="ct">' + esc([t.destination, t.dates ? prettyDay(t.dates.start) + (t.dates.end ? ' to ' + prettyDay(t.dates.end) : '') : '', t.template ? 'template' : ''].filter(Boolean).join(' · ')) + '</div>' + (all.length ? '<div class="prog"><i style="width:' + Math.round(done / all.length * 100) + '%"></i></div><div class="tiny muted">' + done + ' of ' + all.length + ' packed</div>' : '') + '</div></button>';
}
function packList(p) { return [].concat(p.pieces || [], p.toiletries || [], p.personal || [], p.custom || []); }
function newTrip(from) {
  sheet(from ? 'New trip from template' : 'New trip', '<div class="form">'
    + '<label class="f full">Trip name<input class="fld" id="nt-name" placeholder="e.g. Singapore show weekend" value="' + esc(from ? from.name.replace(/ template$/i, '') : '') + '"></label>'
    + '<label class="f full">Destination<input class="fld" id="nt-dest" value="' + esc(from ? from.destination || '' : '') + '"></label>'
    + '<label class="f">From<input class="fld" type="date" id="nt-s" value="' + esc(W.today) + '"></label><label class="f">To<input class="fld" type="date" id="nt-e" value="' + esc(addDays(W.today, 3)) + '"></label>'
    + '<label class="f full">Planned activities<textarea class="fld" id="nt-act" rows="2" placeholder="e.g. two pool performances, client dinner, beach day">' + esc(from ? from.activities || '' : '') + '</textarea></label>'
    + '<label class="f full">Dress codes<input class="fld" id="nt-dc" value="' + esc(from ? from.dressCodes || '' : '') + '" placeholder="e.g. smart casual dinner, black tie gala"></label>'
    + '<label class="f">Luggage<select class="fld" id="nt-lug">' + opt(['Carry-on only', 'One checked bag', 'Multiple bags'], from ? from.luggage : 'One checked bag') + '</select></label>'
    + '<label class="f">Notes<input class="fld" id="nt-notes" value="' + esc(from ? from.notes || '' : '') + '"></label></div>'
    + '<div class="row" style="margin-top:14px"><button class="btn ghost" id="nt-empty">' + (from ? 'Copy checklist' : 'Start an empty list') + '</button><div class="grow"></div><button class="btn gold" id="nt-ai"' + (W.server.ai && activeItems().length ? '' : ' disabled') + '>Plan with AI</button></div>'
    + (W.server.ai ? '' : '<p class="tiny muted">AI planning needs ANTHROPIC_API_KEY. You can still build the list yourself.</p>'), (el, close) => {
    const read = () => ({ name: $('#nt-name', el).value.trim() || 'Trip', destination: $('#nt-dest', el).value.trim(), dates: { start: $('#nt-s', el).value, end: $('#nt-e', el).value || null }, activities: $('#nt-act', el).value, dressCodes: $('#nt-dc', el).value, luggage: $('#nt-lug', el).value, notes: $('#nt-notes', el).value });
    $('#nt-empty', el).onclick = async (e) => {
      const d = read(); if (d.dates.end && d.dates.end < d.dates.start) { toast('The trip ends before it starts', true); return; }
      busy(e.target, true);
      const base = from && from.plan ? resetPlan(from.plan) : { v: 1, days: [], pieces: [], toiletries: [], personal: [], custom: [], missing: [], reusable: [] };
      try { const r = await save('trips', null, Object.assign(d, { plan: base })); close(); go('packing', [r.id]); } catch (x) { busy(e.target, false); toast(x.message, true); }
    };
    $('#nt-ai', el).onclick = async (e) => {
      const d = read(); busy(e.target, true, 'Packing from your closet…');
      try {
        const j = await api('ai.pack', { destination: d.destination, start: d.dates.start, end: d.dates.end || d.dates.start, activities: d.activities, dressCodes: d.dressCodes, luggage: d.luggage, notes: d.notes });
        const r = await save('trips', null, Object.assign(d, { plan: Object.assign(j.plan, { custom: [] }) }));
        close(); go('packing', [r.id]);
        if (j.plan.dropped) toast(j.plan.dropped > 1 ? j.plan.dropped + ' suggested pieces were not in your closet, so they were left out' : '1 suggested piece was not in your closet, so it was left out');
      } catch (x) { busy(e.target, false); toast(x.message, true); }
    };
  });
}
function resetPlan(p) {
  const c = JSON.parse(JSON.stringify(p));
  for (const k of ['pieces', 'toiletries', 'personal', 'custom', 'missing']) (c[k] || []).forEach((x) => { x.packed = false; });
  c.days = []; c.weather = null; c.generated = null;
  return c;
}
function tripDetail(el, t) {
  const p = t.plan || { days: [], pieces: [] };
  const all = packList(p); const done = all.filter((x) => x.packed).length;
  const pieces = (p.pieces || []).map((x, idx) => Object.assign({}, x, { it: W.byId[x.id], idx }));
  const grp = (g) => pieces.filter((x) => x.group === g);
  const chk = (list, key) => list.map((x, i0) => { const i = x.idx != null ? x.idx : i0; return '<label class="check' + (x.packed ? ' done' : '') + '"><input type="checkbox" data-ck="' + key + ':' + i + '"' + (x.packed ? ' checked' : '') + '>' + (x.it ? '<span class="mini"><span class="pc">' + itemImgTag(x.it) + '</span></span>' : '') + '<span class="lbl grow">' + esc(x.it ? x.it.name : x.label || x.description || 'Deleted piece') + (x.it && LAUNDRY_OUT.includes(x.it.laundry) ? ' <span class="tag warn">' + esc(x.it.laundry) + '</span>' : '') + (x.why ? ' <span class="tiny muted">· ' + esc(x.why) + '</span>' : '') + '</span>' + (key === 'custom' || key === 'pieces' ? '<button class="link tiny" data-rmck="' + key + ':' + i + '" aria-label="Remove">×</button>' : '') + '</label>'; }).join('');
  let h = '<div class="row" style="margin-top:8px"><button class="link" data-back>← All trips</button></div>'
    + '<div style="font-family:var(--display);font-size:28px;margin-top:4px">' + esc(t.name) + '</div>'
    + '<div class="small muted">' + esc([t.destination, t.dates ? prettyDay(t.dates.start) + (t.dates.end ? ' to ' + prettyDay(t.dates.end) : '') : '', t.luggage].filter(Boolean).join(' · ')) + '</div>'
    + (all.length ? '<div class="prog"><i style="width:' + Math.round(done / all.length * 100) + '%"></i></div><div class="tiny muted">' + done + ' of ' + all.length + ' packed</div>' : '')
    + (p.weather ? '<div class="banner info">' + esc(p.weather.place) + ' forecast when planned: ' + esc(p.weather.days.map((d) => prettyDay(d.date) + ' ' + d.min + ' to ' + d.max + '°C ' + d.sky).join('; ')) + '. Check again closer to the day.</div>' : (p.generated ? '<div class="banner info">No forecast was available for these dates, so nothing was assumed about the weather.</div>' : ''))
    + (p.note ? '<div class="banner info">' + esc(p.note) + '</div>' : '');
  if ((p.days || []).length) h += '<h2 class="sec">Outfits per day</h2><div class="hs">' + p.days.map((d) => '<div class="board" style="width:270px"><div class="kick">' + esc(prettyDay(d.date)) + '</div><div style="font-family:var(--serif);font-size:16px;margin:4px 0">' + esc(d.look ? d.look.name : 'No look') + '</div>' + (d.plan ? '<div class="tiny muted">' + esc(d.plan) + '</div>' : '') + (d.look ? boardHTML(d.look.pieces.map((x) => x.id)) + '<button class="btn ghost sm" data-planday="' + d.date + '">Add to calendar</button>' : '') + '</div>').join('') + '</div>';
  if ((p.reusable || []).length) h += '<h2 class="sec">Re-wearable combinations</h2>' + p.reusable.map((r) => '<div class="row small" style="margin-bottom:8px"><b class="grow" style="font-weight:500">' + esc(r.name) + '</b>' + miniHTML(r.ids, 5) + '</div>').join('');
  h += '<h2 class="sec">Clothing<button class="act" data-addpc>+ From closet</button></h2>' + (grp('clothing').length ? chk(grp('clothing'), 'pieces') : '<div class="small muted">No clothing on the list yet.</div>');
  h += '<h2 class="sec">Shoes and accessories</h2>' + (grp('shoes').length ? chk(grp('shoes'), 'pieces') : '<div class="small muted">None yet.</div>');
  h += '<h2 class="sec">Toiletries</h2>' + chk(p.toiletries || [], 'toiletries');
  h += '<h2 class="sec">Personal and activity items</h2>' + chk(p.personal || [], 'personal');
  h += '<h2 class="sec">Your own additions</h2>' + chk(p.custom || [], 'custom') + '<div class="row" style="margin-top:8px"><input class="fld grow" id="tp-add" placeholder="Add anything, then Enter"><button class="btn sm" id="tp-addb">Add</button></div>';
  if ((p.missing || []).length) h += '<h2 class="sec">Missing essentials · not in your closet</h2>' + chk(p.missing, 'missing');
  h += '<div class="row" style="margin-top:20px"><label class="tog"><input type="checkbox" id="tp-tpl"' + (t.template ? ' checked' : '') + '> Keep as a reusable template</label><button class="btn ghost sm" id="tp-copy">New trip from this</button><div class="grow"></div><button class="btn danger sm" id="tp-del">Delete</button></div>';
  el.innerHTML = h;
  const persist = debounce(async () => { try { const r = await save('trips', t.id, { plan: p }); W.byId[t.id] = r; } catch (x) { toast('Not saved: ' + x.message, true); } }, 700);
  el.onchange = (e) => {
    const c = e.target.closest('[data-ck]'); if (!c) return;
    const [k, iv] = c.getAttribute('data-ck').split(':'); const i = +iv;
    const lbl = c.closest('.check');
    const list = p[k]; if (!list || !list[i]) return;
    list[i].packed = c.checked; lbl && lbl.classList.toggle('done', c.checked); persist();
    const all2 = packList(p); const d2 = all2.filter((x) => x.packed).length; const bar = $('.prog i', el); if (bar) bar.style.width = Math.round(d2 / all2.length * 100) + '%';
  };
  el.onclick = (e) => {
    if (e.target.closest('[data-back]')) { go('packing'); return; }
    const rm = e.target.closest('[data-rmck]');
    if (rm) { e.preventDefault(); const [k, iv] = rm.getAttribute('data-rmck').split(':'); p[k].splice(+iv, 1); persist(); render(); return; }
    const pd = e.target.closest('[data-planday]'); if (pd) { const d = p.days.find((x) => x.date === pd.getAttribute('data-planday')); if (d && d.look) planDialog({ items: d.look.pieces.map((x) => x.id), label: d.look.name, date: d.date }); return; }
    if (e.target.closest('[data-addpc]')) {
      pickItems('Add pieces to pack', (p.pieces || []).map((x) => x.id), (ids) => {
        p.pieces = (p.pieces || []).filter((x) => ids.includes(x.id));
        for (const id of ids) if (!p.pieces.some((x) => x.id === id)) p.pieces.push({ id, packed: false, group: SMALL_CATS.includes((W.byId[id] || {}).category) ? 'shoes' : 'clothing' });
        persist(); render();
      });
    }
  };
  const addC = () => { const v = $('#tp-add', el).value.trim(); if (!v) return; p.custom = p.custom || []; p.custom.push({ label: v.slice(0, 80), packed: false }); persist(); render(); setTimeout(() => { const n = $('#tp-add'); if (n) n.focus(); }, 30); };
  $('#tp-addb', el).onclick = addC; $('#tp-add', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') addC(); });
  $('#tp-tpl', el).onchange = async (e) => { try { await save('trips', t.id, { template: e.target.checked }); toast(e.target.checked ? 'Kept as a template' : 'No longer a template'); } catch (x) { toast(x.message, true); } };
  $('#tp-copy', el).onclick = () => newTrip(t);
  $('#tp-del', el).onclick = (e) => armDelete(e.target, async () => { try { await remove('trips', t.id); toast('Trip deleted'); go('packing'); } catch (x) { toast(x.message, true); } });
}

/* ---------------- Wardrobe insights ---------------- */
RENDER.insights = function (el) {
  const act = activeItems();
  if (!act.length) { el.innerHTML = '<h2 class="sec" style="margin-top:8px">Wardrobe insights</h2><div class="empty"><span class="g">◔</span>Insights appear once your closet has pieces and you start logging what you wear.</div>'; return; }
  const val = valueByCurrency(act);
  const worn = act.filter((i) => wears(i.id) > 0).sort((a, b) => wears(b.id) - wears(a.id));
  const never = act.filter((i) => !wears(i.id));
  const priced = act.filter((i) => i.price != null);
  const cp = act.map((i) => ({ i, c: cpw(i) })).filter((x) => x.c != null).sort((a, b) => a.c - b.c);
  const logs = W.log.filter((l) => l.kind === 'Worn' && l.date).sort((a, b) => (a.date.start < b.date.start ? 1 : -1));
  const count = (fn) => { const m = {}; for (const i of act) for (const k of [].concat(fn(i) || [])) if (k) m[k] = (m[k] || 0) + 1; return Object.keys(m).map((k) => ({ k, n: m[k] })).sort((a, b) => b.n - a.n); };
  const bars = (rows, sw) => { const mx = Math.max(1, ...rows.map((r) => r.n)); return '<div class="bars">' + rows.slice(0, 12).map((r) => '<div class="bar"><span>' + (sw ? '<span class="sw" style="background:' + swatch(r.k) + '"></span>' : '') + esc(r.k) + '</span><span class="tr"><i style="width:' + Math.round(r.n / mx * 100) + '%"></i></span><span class="muted">' + r.n + '</span></div>').join('') + '</div>'; };
  const rank = (rows, fn) => '<div class="rank">' + rows.map((x) => { const it = x.i || x; return '<button class="r link" data-item="' + it.id + '" style="color:var(--ink);text-align:left"><span class="pc">' + itemImgTag(it) + '</span><span class="grow"><span style="font-family:var(--serif);font-size:15px">' + esc(it.name) + '</span><br><span class="tiny muted">' + esc(fn(x)) + '</span></span></button>'; }).join('') + '</div>';
  const laundry = LAUNDRY.map((s) => ({ k: s, n: act.filter((i) => (i.laundry || 'Clean') === s).length })).filter((r) => r.n);
  const repair = act.filter((i) => i.condition === 'Needs repair' || i.laundry === 'Needs repair');
  let h = '<h2 class="sec" style="margin-top:8px">Wardrobe insights</h2><div class="tiles">'
    + tile(act.length, 'Pieces in closet') + tile(val.length ? val.map((v) => money(v.sum, v.cur)).join(' + ') : '—', 'Recorded value' + (priced.length < act.length ? ' (' + priced.length + ' priced)' : ''), val.length > 1 || (val[0] && val[0].sum > 1e8) ? 'small' : '')
    + tile(logs.length, 'Wears logged') + tile(never.length, 'Never worn') + '</div>';
  if (val.length > 1) h += '<p class="tiny muted">Values in different currencies are shown side by side. They are not converted, because no exchange rate is assumed.</p>';
  h += '<div class="two" style="margin-top:14px"><div class="card"><div class="kick">Most worn</div>' + (worn.length ? rank(worn.slice(0, 5), (i) => wears(i.id) + ' wears · last ' + prettyDay(W.stats[i.id].last)) : '<p class="small muted">Log a few looks as worn and your favourites will show here.</p>') + '</div>'
    + '<div class="card"><div class="kick">Least worn (worn at least once)</div>' + (worn.length > 5 ? rank(worn.slice(5).slice(-5).reverse(), (i) => wears(i.id) + ' wear' + (wears(i.id) > 1 ? 's' : '') + ' · last ' + prettyDay(W.stats[i.id].last)) : '<p class="small muted">Shows once more than five pieces have been worn, so it never repeats the most worn list.</p>') + '</div>'
    + '<div class="card"><div class="kick">Best cost per wear</div>' + (cp.length ? rank(cp.slice(0, 5), (x) => money(x.c, x.i.currency) + ' per wear · ' + wears(x.i.id) + ' wears of ' + money(x.i.price, x.i.currency)) : '<p class="small muted">Needs a purchase price and at least one logged wear. Cost per wear is the price divided by recorded wears.</p>') + '</div>'
    + '<div class="card"><div class="kick">Never worn · ' + never.length + '</div>' + (never.length ? rank(never.slice(0, 8), (i) => [i.category, i.price != null ? money(i.price, i.currency) : ''].filter(Boolean).join(' · ')) + (never.length > 8 ? '<button class="link" data-go="closet" id="in-never">See all ' + never.length + '</button>' : '') : '<p class="small muted">Everything has been worn at least once.</p>') + '</div>'
    + '<div class="card"><div class="kick">Colours</div>' + bars(count((i) => i.color), true) + '</div>'
    + '<div class="card"><div class="kick">Categories</div>' + bars(count((i) => i.category)) + '</div>'
    + '<div class="card"><div class="kick">Favourite brands</div>' + (count((i) => i.brand).length ? bars(count((i) => i.brand)) : '<p class="small muted">No brands recorded yet.</p>') + '</div>'
    + '<div class="card"><div class="kick">Laundry and care</div>' + bars(laundry) + (repair.length ? '<div class="banner warn" style="margin-top:10px">Needs repair: ' + esc(repair.map((i) => i.name).join(', ')) + '</div>' : '') + '</div></div>';
  h += '<h2 class="sec">Outfit history</h2>' + (logs.length ? '<div class="card">' + logs.slice(0, 20).map((l) => '<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)"><span class="small" style="width:110px">' + esc(prettyDay(l.date.start)) + '</span>' + miniHTML(l.items || [], 5) + '<span class="small muted grow">' + esc(((l.outfit && W.byId[l.outfit]) || {}).name || l.event || '') + '</span></div>').join('') + '</div>' : '<div class="card small muted">Nothing logged yet. Tap "Mark as worn" on a look, or "Worn today" on a piece.</div>');
  el.innerHTML = h;
  const nv = $('#in-never', el); if (nv) nv.onclick = () => { CL.f = { never: true }; };
};

/* ---------------- Wishlist ---------------- */
RENDER.wishlist = function (el) {
  const wish = W.wish.slice();
  const owned = activeItems();
  const pri = { High: 0, Medium: 1, Low: 2 };
  const info = (w) => {
    const dup = owned.filter((i) => w.category && i.category === w.category && w.color && i.color && (String(i.color).toLowerCase().indexOf(String(w.color).toLowerCase()) !== -1 || String(w.color).toLowerCase().indexOf(String(i.color).toLowerCase()) !== -1));
    const inCat = w.category ? owned.filter((i) => i.category === w.category).length : null;
    return { dup, inCat, gap: inCat === 0 };
  };
  wish.sort((a, b) => { const sa = a.status === 'Wanted' ? 0 : 1, sb = b.status === 'Wanted' ? 0 : 1; if (sa !== sb) return sa - sb; const ga = info(a).gap ? 0 : 1, gb = info(b).gap ? 0 : 1; return (pri[a.priority] ?? 1) - (pri[b.priority] ?? 1) || ga - gb; });
  let h = '<h2 class="sec" style="margin-top:8px">Shopping wishlist<button class="act" id="ws-new">+ Add</button></h2><p class="small muted" style="margin-top:-4px">Prices and links are what you typed. Nothing here is checked against live shops.</p>';
  h += wish.length ? '<div class="list">' + wish.map((w) => {
    const x = info(w); const ai = w.aiNotes;
    return '<div class="card" style="display:flex;gap:12px' + (w.status !== 'Wanted' ? ';opacity:.6' : '') + '"><div class="qimg" style="width:84px;height:104px;border-radius:12px;background:var(--pearl2);overflow:hidden;flex:none;display:flex;align-items:center;justify-content:center">' + (w.image && w.image[0] ? '<img src="' + esc(w.image[0].url) + '" alt="" style="width:100%;height:100%;object-fit:cover">' : '<span style="font-family:var(--display);font-size:28px;color:var(--sand)">♡</span>') + '</div>'
      + '<div class="grow"><div class="row"><b style="font-family:var(--serif);font-weight:400;font-size:17px" class="grow">' + esc(w.name) + '</b>' + (w.priority ? '<span class="tag' + (w.priority === 'High' ? ' warn' : '') + '">' + esc(w.priority) + '</span>' : '') + '<span class="tag">' + esc(w.status || 'Wanted') + '</span></div>'
      + '<div class="small muted">' + esc([w.category, w.brand, w.color, w.size, w.price != null ? money(w.price, w.currency) + ' (your note)' : ''].filter(Boolean).join(' · ')) + '</div>'
      + (x.gap ? '<div class="tag ok" style="margin-top:6px">Fills a gap: no ' + esc(w.category) + ' in your closet</div>' : '') + (x.dup.length ? '<div class="small" style="margin-top:6px">Similar pieces you own: ' + x.dup.slice(0, 3).map((i) => '<button class="link" data-item="' + i.id + '">' + esc(i.name) + '</button>').join(', ') + '</div>' : '')
      + (ai ? '<div class="banner info" style="margin-top:8px"><div><b>' + esc(ai.verdict) + '.</b> ' + esc(ai.reason) + (ai.pairs && ai.pairs.length ? '<div class="tiny muted" style="margin-top:6px">Wear it with:</div>' + ai.pairs.map((p) => '<div class="row" style="margin-top:4px">' + miniHTML(p.ids, 4) + '<span class="tiny">' + esc(p.how) + '</span></div>').join('') : '') + '</div></div>' : '')
      + '<div class="row" style="margin-top:8px">' + (safeUrl(w.link) ? '<a class="btn ghost sm" href="' + safeUrl(w.link) + '" target="_blank" rel="noopener noreferrer">Open link ↗</a>' : '') + '<button class="btn ghost sm" data-wai="' + w.id + '"' + (W.server.ai && owned.length ? '' : ' disabled') + '>' + (ai ? 'Check again' : 'Check against my closet') + '</button><button class="btn ghost sm" data-wedit="' + w.id + '">Edit</button>' + (w.status === 'Wanted' ? '<button class="btn sm" data-wbuy="' + w.id + '">Bought it</button>' : '') + '</div></div></div>';
  }).join('') + '</div>' : '<div class="empty"><span class="g">♡</span>Nothing on the wishlist yet.</div>';
  el.innerHTML = h;
  $('#ws-new', el).onclick = () => wishForm(null);
  el.onclick = async (e) => {
    const ed = e.target.closest('[data-wedit]'); if (ed) { wishForm(W.byId[ed.getAttribute('data-wedit')]); return; }
    const ai = e.target.closest('[data-wai]'); if (ai) { busy(ai, true, 'Checking…'); try { const j = await api('ai.wish', { id: ai.getAttribute('data-wai') }); upsert('wish', j.wish); render(); } catch (x) { busy(ai, false); toast(x.message, true); } return; }
    const bu = e.target.closest('[data-wbuy]'); if (bu) { const w = W.byId[bu.getAttribute('data-wbuy')]; try { await save('wish', w.id, { status: 'Bought' }); toast('Marked bought. Add it to your closet?', false, { label: 'Add', fn: () => { openAdd(); } }); render(); } catch (x) { toast(x.message, true); } }
  };
};
function wishForm(w) {
  w = w || {};
  sheet(w.id ? 'Edit wishlist piece' : 'Add to wishlist', '<div class="form">'
    + '<label class="f full">What is it<input class="fld" id="wf-name" value="' + esc(w.name || '') + '"></label>'
    + '<label class="f">Category<select class="fld" id="wf-cat">' + opt(CATS, w.category, '—') + '</select></label>'
    + '<label class="f">Brand<input class="fld" id="wf-brand" value="' + esc(w.brand || '') + '"></label>'
    + '<label class="f">Colour<input class="fld" id="wf-color" value="' + esc(w.color || '') + '"></label>'
    + '<label class="f">Size<input class="fld" id="wf-size" value="' + esc(w.size || '') + '"></label>'
    + '<label class="f">Price you saw<input class="fld" id="wf-price" inputmode="decimal" value="' + esc(w.price == null ? '' : w.price) + '"></label>'
    + '<label class="f">Currency<select class="fld" id="wf-cur">' + opt(CURRENCIES, w.currency || 'IDR') + '</select></label>'
    + '<label class="f full">Shop link<input class="fld" id="wf-link" type="url" value="' + esc(w.link || '') + '" placeholder="https://"></label>'
    + '<label class="f">Priority<select class="fld" id="wf-pri">' + opt(['High', 'Medium', 'Low'], w.priority || 'Medium') + '</select></label>'
    + '<label class="f">Status<select class="fld" id="wf-st">' + opt(['Wanted', 'Bought', 'Dropped'], w.status || 'Wanted') + '</select></label>'
    + '<label class="f full">Notes<textarea class="fld" id="wf-notes" rows="2">' + esc(w.notes || '') + '</textarea></label>'
    + '<label class="f full">Inspiration photo<button class="btn ghost sm" id="wf-img" type="button">' + (w.image && w.image[0] ? 'Replace photo' : 'Add photo') + '</button><span class="tiny muted" id="wf-imgn"></span></label></div>'
    + '<div class="row" style="margin-top:14px">' + (w.id ? '<button class="btn danger sm" id="wf-del">Delete</button>' : '') + '<div class="grow"></div><button class="btn" id="wf-ok">Save</button></div>', (el, close) => {
    let blob = null;
    $('#wf-img', el).onclick = () => pickFile($('#f-one'), async (files) => { if (!files[0]) return; try { blob = (await compress(files[0], 1400, 'image/jpeg', 0.85)).blob; $('#wf-imgn', el).textContent = 'Photo ready'; } catch (x) { toast(x.message, true); } });
    $('#wf-ok', el).onclick = async (e) => {
      const price = $('#wf-price', el).value.trim();
      const d = { name: $('#wf-name', el).value.trim(), category: $('#wf-cat', el).value || null, brand: $('#wf-brand', el).value, color: $('#wf-color', el).value, size: $('#wf-size', el).value, price: price ? Number(price.replace(/[^0-9.]/g, '')) : null, currency: $('#wf-cur', el).value, link: $('#wf-link', el).value.trim(), priority: $('#wf-pri', el).value, status: $('#wf-st', el).value, notes: $('#wf-notes', el).value };
      if (!d.name) { toast('Give it a name', true); return; }
      busy(e.target, true);
      try { const uploads = blob ? { image: await uploadBlob(blob, d.name) } : undefined; await save('wish', w.id || null, d, uploads ? { uploads } : undefined); toast('Saved'); close(); render(); } catch (x) { busy(e.target, false); toast(x.message, true); }
    };
    const del = $('#wf-del', el); if (del) del.onclick = (e) => armDelete(e.target, async () => { try { await remove('wish', w.id); close(); render(); } catch (x) { toast(x.message, true); } });
  });
}
