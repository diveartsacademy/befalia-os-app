/* Wardrobe: AI Stylist, saved looks, Dressing Room, Outfit Planner. */
'use strict';

/* ---------------- AI Stylist ---------------- */
const STY = { thread: [], prefill: '', focus: null, busy: false, ctx: null };
function styCtx() {
  if (!STY.ctx) STY.ctx = { date: W.today, time: '', place: (W.profile && W.profile.home) || 'Bali', occasion: '', dress: '', avoid: true, laundry: false, count: 3 };
  return STY.ctx;
}
RENDER.stylist = function (el) {
  const c = styCtx();
  const focus = STY.focus && W.byId[STY.focus];
  let h = '<h2 class="sec" style="margin-top:8px">AI stylist</h2>';
  if (!W.server.ai) h += '<div class="banner warn">The stylist needs ANTHROPIC_API_KEY in Vercel. Everything else in the wardrobe works without it.</div>';
  if (!activeItems().length) h += '<div class="banner info">Add some pieces first. The stylist only uses what is in your closet.</div>';
  h += '<div class="thread" id="sty-thread">';
  if (!STY.thread.length) h += '<div class="card" style="text-align:center"><div style="font-family:var(--display);font-size:22px">What are we dressing for?</div><p class="muted small" style="margin:6px 0 0;line-height:1.5">Every look is built from pieces you own. Ideas for pieces you do not own are listed separately and clearly marked.</p></div>';
  STY.thread.forEach((t, ti) => {
    h += '<div class="msg me">' + esc(t.request) + '</div>';
    if (t.loading) { h += '<div class="loading"><span class="spin"></span> Styling from ' + activeItems().length + ' pieces…</div>'; return; }
    if (t.error) { h += '<div class="banner bad">' + esc(t.error) + '</div>'; return; }
    const r = t.result;
    h += '<div class="small muted">Considered ' + r.considered + ' available pieces' + (r.weather ? ' · ' + esc(weatherShort(r.weather)) : ' · no forecast used') + '</div>';
    if (r.dropped) h += '<div class="banner info">The stylist named ' + r.dropped + ' thing' + (r.dropped > 1 ? 's' : '') + ' that ' + (r.dropped > 1 ? 'are' : 'is') + ' not in your closet. ' + (r.dropped > 1 ? 'They were' : 'It was') + ' removed from the looks.</div>';
    if (r.note) h += '<div class="banner info">' + esc(r.note) + '</div>';
    if (!r.looks.length) h += '<div class="empty">No complete look could be built from your closet for this. Try loosening the request or allowing laundry items.</div>';
    r.looks.forEach((lk, li) => { h += lookBoard(lk, 'sty:' + ti + ':' + li); });
  });
  h += '</div>';
  h += '<div class="card lux" style="margin-top:16px"><textarea class="fld" id="sty-q" rows="2" placeholder="e.g. Create a classy outfit for a dinner in Bali">' + esc(STY.prefill || '') + '</textarea>'
    + (focus ? '<div class="row" style="margin-top:8px"><span class="tag own">Must include: ' + esc(focus.name) + '</span><button class="link" id="sty-unfocus">remove</button></div>' : '')
    + '<div class="chips" style="margin-top:8px">' + ['What should I wear for a business meeting tomorrow?', 'Create a classy outfit for a dinner in Bali', 'I want a feminine, elegant, luxury look', 'Create an outfit for an ocean themed event', 'Something cool for a hot day of meetings in Jakarta'].map((s) => '<button class="chip" data-q="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div>'
    + '<div class="ctx"><label class="f">Date<input class="fld" type="date" id="sty-date" value="' + esc(c.date) + '"></label>'
    + '<label class="f">Time<select class="fld" id="sty-time">' + opt(['Morning', 'Daytime', 'Evening', 'Night'], c.time, 'Any') + '</select></label>'
    + '<label class="f">Place<input class="fld" id="sty-place" list="dl-place2" value="' + esc(c.place) + '"></label>'
    + '<label class="f">Looks<select class="fld" id="sty-n">' + [1, 2, 3, 4, 5].map((n) => '<option' + (c.count === n ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>'
    + '<label class="f">Occasion<input class="fld" id="sty-occ" value="' + esc(c.occasion) + '" placeholder="optional"></label>'
    + '<label class="f">Dress code<input class="fld" id="sty-dress" value="' + esc(c.dress) + '" placeholder="optional"></label></div>'
    + '<datalist id="dl-place2"><option value="Bali"><option value="Jakarta"><option value="Sanur, Bali"><option value="Ubud, Bali"><option value="Bogor"></datalist>'
    + '<div class="row" style="margin-top:10px"><label class="tog"><input type="checkbox" id="sty-avoid"' + (c.avoid ? ' checked' : '') + '> Avoid recent repeats</label><label class="tog"><input type="checkbox" id="sty-laundry"' + (c.laundry ? ' checked' : '') + '> Include laundry pieces</label>'
    + '<div class="grow"></div>' + (STY.thread.length ? '<button class="btn ghost sm" id="sty-clear">New chat</button>' : '') + '<button class="btn gold" id="sty-go"' + (W.server.ai && activeItems().length ? '' : ' disabled') + '>Style me</button></div></div>';
  el.innerHTML = h;
  const sync = () => { c.date = $('#sty-date', el).value || W.today; c.time = $('#sty-time', el).value; c.place = $('#sty-place', el).value.trim(); c.count = +$('#sty-n', el).value; c.occasion = $('#sty-occ', el).value.trim(); c.dress = $('#sty-dress', el).value.trim(); c.avoid = $('#sty-avoid', el).checked; c.laundry = $('#sty-laundry', el).checked; STY.prefill = $('#sty-q', el).value; };
  $$('input,select,textarea', el).forEach((x) => x.addEventListener('change', sync));
  $('#sty-q', el).addEventListener('input', sync);
  $('#sty-go', el).onclick = () => { sync(); runStylist(); };
  $('#sty-q', el).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sync(); runStylist(); } });
  const uf = $('#sty-unfocus', el); if (uf) uf.onclick = () => { STY.focus = null; render(); };
  const cl = $('#sty-clear', el); if (cl) cl.onclick = () => { STY.thread = []; STY.focus = null; render(); };
  el.onclick = (e) => {
    const q = e.target.closest('[data-q]'); if (q) { $('#sty-q', el).value = q.getAttribute('data-q'); sync(); return; }
    lookAction(e);
  };
  if (STY.thread.length && STY.thread[STY.thread.length - 1].loading) setTimeout(() => { const t = $('#sty-thread'); if (t && t.lastElementChild) t.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
};
function weatherShort(w) { const d = w.days && w.days[0]; return d ? w.place + ': ' + d.sky + ', ' + d.min + ' to ' + d.max + '°C' + (d.rain != null ? ', ' + d.rain + '% rain' : '') + ' (forecast)' : ''; }
async function runStylist() {
  const c = styCtx();
  const req = String(STY.prefill || '').trim();
  if (!req || STY.busy) return;
  const turn = { request: req, loading: true };
  STY.thread.push(turn); STY.busy = true; STY.prefill = ''; render();
  const history = STY.thread.slice(0, -1).slice(-3).flatMap((t) => [{ role: 'me', text: t.request }].concat(t.result && t.result.looks.length ? [{ role: 'you', text: t.result.looks.map((l) => l.name + ': ' + l.pieces.map((p) => (W.byId[p.id] || {}).name).join(', ')).join(' / ') }] : []));
  try {
    turn.result = await api('ai.style', { request: req, date: c.date, timeOfDay: c.time, place: c.place, occasion: c.occasion, dressCode: c.dress, avoidRepeatDays: c.avoid ? (prefs().repeatDays || 14) : 0, allowLaundry: c.laundry, count: c.count, focusId: STY.focus || undefined, history });
    turn.result.looks.forEach((l) => { l.date = c.date; });
  } catch (e) { turn.error = e.capped ? e.message : 'The stylist could not answer: ' + e.message; }
  turn.loading = false; STY.busy = false; render();
}
function lookRef(key) {
  const p = key.split(':');
  if (p[0] === 'sty') return STY.thread[+p[1]].result.looks[+p[2]];
  return null;
}
function lookBoard(lk, key) {
  const ids = lk.pieces.map((p) => p.id);
  const issues = lookIssues(ids);
  return '<div class="board" data-look-key="' + key + '"><div class="row"><div class="ttl grow">' + esc(lk.name) + '</div>' + (lk.savedId ? '<span class="tag ok">Saved</span>' : '') + '</div>'
    + boardHTML(ids)
    + (lk.repeat ? '<div class="banner warn">You wore this exact combination recently.</div>' : '')
    + (lk.missingFocus ? '<div class="banner warn">This look does not include the piece you asked for.</div>' : '')
    + (issues.length ? '<div class="banner warn">Not available right now: ' + esc(issues.join(', ')) + '</div>' : '')
    + (lk.explanation ? '<div class="why">' + esc(lk.explanation) + '</div>' : '')
    + (lk.alternatives && lk.alternatives.length ? '<div class="kick" style="margin:6px 0">Swaps from your closet</div>' + lk.alternatives.map((a, i) => { const f = W.byId[a.replace], t = W.byId[a.with]; if (!f || !t) return ''; return '<div class="row small" style="margin-bottom:6px"><span class="mini"><span class="pc">' + itemImgTag(f) + '</span></span>→<span class="mini"><span class="pc">' + itemImgTag(t) + '</span></span><span class="grow">' + esc(t.name) + (a.why ? ' <span class="muted">· ' + esc(a.why) + '</span>' : '') + '</span><button class="btn ghost sm" data-swap="' + i + '">Swap</button></div>'; }).join('') : '')
    + (lk.suggestedPurchases && lk.suggestedPurchases.length ? '<div class="kick" style="margin:10px 0 6px">Not in your closet · ideas only</div>' + lk.suggestedPurchases.map((b, i) => '<div class="row small" style="margin-bottom:6px"><span class="tag buy">idea</span><span class="grow">' + esc(b.description) + (b.why ? ' <span class="muted">· ' + esc(b.why) + '</span>' : '') + '</span><button class="btn ghost sm" data-wishadd="' + i + '">+ Wishlist</button></div>').join('') : '')
    + '<div class="acts" style="margin-top:10px"><button class="btn sm" data-lk="save"' + (lk.savedId ? ' disabled' : '') + '>Save look</button><button class="btn ghost sm" data-lk="plan">Add to calendar</button><button class="btn ghost sm" data-lk="wear">Mark as worn</button><button class="btn ghost sm" data-lk="room">Dressing room</button></div></div>';
}
async function saveLook(lk) {
  if (lk.savedId && W.byId[lk.savedId]) return lk.savedId;
  const r = await save('outfits', null, { name: lk.name, items: lk.pieces.map((p) => p.id), explanation: lk.explanation || '', alternatives: (lk.alternatives || []).length ? lk.alternatives : null, source: lk.source || 'AI stylist' });
  lk.savedId = r.id; return r.id;
}
async function lookAction(e) {
  const box = e.target.closest('[data-look-key]'); if (!box) return;
  const lk = lookRef(box.getAttribute('data-look-key')); if (!lk) return;
  const sw = e.target.closest('[data-swap]');
  if (sw) { const a = lk.alternatives[+sw.getAttribute('data-swap')]; const p = lk.pieces.find((x) => x.id === a.replace); if (p) { p.id = a.with; lk.alternatives.splice(+sw.getAttribute('data-swap'), 1); lk.savedId = null; render(); } return; }
  const wa = e.target.closest('[data-wishadd]');
  if (wa) { const b = lk.suggestedPurchases[+wa.getAttribute('data-wishadd')]; busy(wa, true, 'Adding…'); try { await save('wish', null, { name: b.description.slice(0, 120), notes: 'Idea from the stylist for "' + lk.name + '". ' + (b.why || ''), priority: 'Medium' }); wa.textContent = 'Added'; } catch (x) { busy(wa, false); toast(x.message, true); } return; }
  const b = e.target.closest('[data-lk]'); if (!b) return;
  const a = b.getAttribute('data-lk');
  try {
    if (a === 'save') { busy(b, true); await saveLook(lk); toast('Look saved'); render(); }
    if (a === 'plan') { planDialog({ items: lk.pieces.map((p) => p.id), label: lk.name, date: lk.date || W.today, saveFirst: () => saveLook(lk) }); }
    if (a === 'wear') { busy(b, true, 'Logging…'); const id = await saveLook(lk); await logWear({ outfit: id }); toast('Saved and logged as worn today'); render(); }
    if (a === 'room') { ROOM.load({ items: lk.pieces.map((p) => p.id), name: lk.name, outfitId: lk.savedId || null }); go('room'); }
  } catch (x) { busy(b, false); toast(x.message, true); }
}

/* ---------------- saved look detail ---------------- */
function openLook(id) {
  const o = W.byId[id]; if (!o) return;
  const used = W.log.filter((l) => l.outfit === id && l.kind === 'Worn').length;
  sheet(o.name, '<div class="board">' + boardHTML(o.items) + (o.explanation ? '<div class="why">' + esc(o.explanation) + '</div>' : '') + '</div>'
    + '<div class="small muted" style="margin:8px 0">' + (o.source ? esc(o.source) + ' · ' : '') + 'worn ' + used + '×</div>'
    + '<div class="form"><label class="f full">Name<input class="fld" id="ol-name" value="' + esc(o.name) + '"></label>'
    + '<label class="f full">Occasion<div class="chips" data-multi="occ">' + [...new Set(OCCASIONS.concat(o.occasion || []))].map((s) => '<button type="button" class="chip' + ((o.occasion || []).includes(s) ? ' on' : '') + '" data-v="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div></label>'
    + '<label class="f full">Notes<textarea class="fld" id="ol-notes" rows="2">' + esc(o.notes || '') + '</textarea></label>'
    + '<label class="f"><span class="tog" style="text-transform:none;letter-spacing:0"><input type="checkbox" id="ol-fav"' + (o.favorite ? ' checked' : '') + '> Favourite</span></label></div>'
    + '<div class="row" style="margin-top:12px"><button class="btn ghost sm" id="ol-pieces">Change pieces</button><button class="btn ghost sm" id="ol-room">Dressing room</button><button class="btn ghost sm" id="ol-col">+ Collection</button><button class="btn ghost sm" id="ol-plan">Add to calendar</button><button class="btn gold sm" id="ol-wear">Worn today</button></div>'
    + '<div class="row" style="margin-top:16px"><button class="btn danger sm" id="ol-del">Delete</button><div class="grow"></div><button class="btn" id="ol-save">Save</button></div>', (el, close) => {
    let items = o.items.slice();
    $('[data-multi="occ"]', el).onclick = (e) => { const c = e.target.closest('.chip'); if (c) c.classList.toggle('on'); };
    $('#ol-pieces', el).onclick = () => pickItems('Pieces in this look', items, (ids) => { items = ids; $('.bgrid', el).outerHTML = boardHTML(items); });
    $('#ol-save', el).onclick = async (e) => {
      busy(e.target, true);
      try { await save('outfits', id, { name: $('#ol-name', el).value, notes: $('#ol-notes', el).value, favorite: $('#ol-fav', el).checked, occasion: $$('[data-multi="occ"] .chip.on', el).map((c) => c.getAttribute('data-v')), items }); toast('Saved'); close(); render(); } catch (x) { busy(e.target, false); toast(x.message, true); }
    };
    $('#ol-del', el).onclick = (e) => armDelete(e.target, async () => { try { await remove('outfits', id); toast('Look deleted. Wear history keeps its pieces.'); close(); render(); } catch (x) { toast(x.message, true); } });
    $('#ol-room', el).onclick = () => { close(); ROOM.load({ items: o.items, name: o.name, outfitId: id, layout: o.layout }); go('room'); };
    $('#ol-col', el).onclick = () => pickCollection((cid) => addToCollection(cid, { outfits: [id] }));
    $('#ol-plan', el).onclick = () => planDialog({ outfit: id, date: W.today });
    $('#ol-wear', el).onclick = async (e) => { busy(e.target, true, 'Logging…'); try { await logWear({ outfit: id }); toast('Logged as worn today'); close(); render(); } catch (x) { busy(e.target, false); toast(x.message, true); } };
  });
}

/* ---------------- planning a look on a day ---------------- */
function repeatHit(ids, outfitId, day) {
  const n = prefs().repeatDays || 0; if (!n) return null;
  const from = addDays(day, -n), to = addDays(day, n);
  const same = (l) => (outfitId && l.outfit === outfitId) || (l.items && l.items.length === ids.length && ids.every((x) => l.items.includes(x)));
  return W.log.filter((l) => l.kind === 'Worn' && l.date && l.date.start >= from && l.date.start <= to && same(l)).sort((a, b) => (a.date.start < b.date.start ? 1 : -1))[0] || null;
}
function planDialog(o) {
  const evs = W.tasks ? eventsOn(o.date) : [];
  sheet('Add to calendar', '<div class="form"><label class="f">Date<input class="fld" type="date" id="pd-date" value="' + esc(o.date || W.today) + '"></label>'
    + '<label class="f">For an event<select class="fld" id="pd-ev"><option value="">No event</option>' + evs.map((t) => '<option value="' + t.id + '"' + (o.taskId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select></label>'
    + '<label class="f full">Note<input class="fld" id="pd-note" placeholder="optional"></label></div><div id="pd-warn"></div>'
    + '<div class="row" style="margin-top:14px"><div class="grow"></div><button class="btn" id="pd-ok">Plan it</button></div>', (el, close) => {
    const refreshEv = () => {
      const d = $('#pd-date', el).value; const list = W.tasks ? eventsOn(d) : [];
      $('#pd-ev', el).innerHTML = '<option value="">No event</option>' + list.map((t) => '<option value="' + t.id + '"' + (o.taskId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
      const ids = o.outfit ? ((W.byId[o.outfit] || {}).items || []) : (o.items || []);
      const rp = repeatHit(ids, o.outfit, d); const is = lookIssues(ids);
      $('#pd-warn', el).innerHTML = (rp ? '<div class="banner warn">You wore this on ' + esc(prettyDay(rp.date.start)) + '. Planning it again is fine; this is just a heads up.</div>' : '') + (is.length ? '<div class="banner warn">Not available right now: ' + esc(is.join(', ')) + '</div>' : '');
    };
    if (!W.tasks) loadTasks().then(refreshEv);
    $('#pd-date', el).onchange = refreshEv; refreshEv();
    $('#pd-ok', el).onclick = async (e) => {
      busy(e.target, true);
      try {
        const outfit = o.outfit || (o.saveFirst ? await o.saveFirst() : null);
        const tid = $('#pd-ev', el).value; const ev = tid && W.tasks ? (W.tasks.find((t) => t.id === tid) || {}).name : '';
        const j = await api('create', { kind: 'log', data: { kind: 'Planned', date: $('#pd-date', el).value, outfit: outfit || null, items: outfit ? undefined : o.items, event: ev || '', taskId: tid || '', notes: $('#pd-note', el).value, label: o.label } });
        upsert('log', j.row); toast('Planned for ' + relDay(j.row.date.start)); close(); render();
      } catch (x) { busy(e.target, false); toast(x.message, true); }
    };
  });
}

/* ---------------- Dressing room ---------------- */
const ROOM = {
  pieces: [], sel: null, outfitId: null, name: '', q: '', cat: '',
  load(o) {
    this.outfitId = o.outfitId || null; this.name = o.name || ''; this.sel = null;
    const lay = Array.isArray(o.layout) ? o.layout : null;
    this.pieces = [];
    (o.items || []).filter((id) => W.byId[id]).forEach((id, i) => {
      const l = lay && lay.find((x) => x.id === id);
      this.pieces.push(l ? { id, x: l.x, y: l.y, w: l.w, z: l.z || i } : autoPlace(id, i, o.items.length));
    });
  },
};
function autoPlace(id, i, n) {
  const it = W.byId[id]; const r = roleOf(it); const c = it && it.category;
  const slots = { main: [0.28, 0.08, 0.44], Shoes: [0.36, 0.72, 0.22], Bags: [0.68, 0.48, 0.24], Jewelry: [0.08, 0.1, 0.16], Accessories: [0.72, 0.08, 0.18] };
  const top = ['Tops', 'Shirts and blouses', 'Outerwear', 'Activewear'].includes(c), bot = ['Pants', 'Jeans', 'Skirts', 'Shorts'].includes(c);
  const s = slots[c] || (r === 'main' ? slots.main : top ? [0.3, 0.06, 0.4] : bot ? [0.32, 0.4, 0.36] : [0.06 + (i % 3) * 0.3, 0.6, 0.2]);
  // Pieces that share a slot fan out instead of stacking exactly on top of each other.
  const twins = ROOM.pieces.filter((p) => p.id !== id && W.byId[p.id] && slotKey(W.byId[p.id]) === slotKey(it)).length;
  return { id, x: Math.min(0.85, s[0] + twins * 0.12), y: Math.min(0.85, s[1] + twins * 0.06), w: s[2], z: i };
}
function slotKey(it) {
  const c = it && it.category;
  if (['Shoes', 'Bags', 'Jewelry', 'Accessories'].includes(c)) return c;
  if (['Tops', 'Shirts and blouses', 'Outerwear', 'Activewear'].includes(c)) return 'top';
  if (['Pants', 'Jeans', 'Skirts', 'Shorts'].includes(c)) return 'bottom';
  return roleOf(it);
}
RENDER.room = function (el) {
  const R = ROOM;
  const cats = CATS.filter((c) => activeItems().some((i) => i.category === c));
  const tray = activeItems().filter((i) => (!R.cat || i.category === R.cat) && (!R.q || (i.name + ' ' + (i.color || '')).toLowerCase().indexOf(R.q) !== -1));
  let h = '<h2 class="sec" style="margin-top:8px">Dressing room</h2><div class="room"><div>'
    + '<div class="canvas" id="rm-c" aria-label="Styling canvas">' + (R.pieces.length ? '' : '<div class="hint">Tap pieces on the right to place them here. Drag to move, use the gold dot to resize.</div>')
    + R.pieces.slice().sort((a, b) => a.z - b.z).map((p) => { const it = W.byId[p.id]; return it ? '<div class="piece' + (R.sel === p.id ? ' on' : '') + '" data-p="' + p.id + '" style="left:' + (p.x * 100) + '%;top:' + (p.y * 100) + '%;width:' + (p.w * 100) + '%;z-index:' + (p.z + 1) + '">' + (itemImg(it) ? '<img src="' + esc(itemImg(it)) + '" alt="' + esc(it.name) + '">' : '<div class="tag">' + esc(it.name) + '</div>') + '<span class="rs" data-rs="' + p.id + '"></span></div>' : ''; }).join('') + '</div>'
    + '<div class="row" style="margin-top:10px">' + (R.sel ? '<button class="btn ghost sm" data-rm="up">Bring forward</button><button class="btn ghost sm" data-rm="down">Send back</button><button class="btn ghost sm" data-rm="big">Bigger</button><button class="btn ghost sm" data-rm="small">Smaller</button><button class="btn danger sm" data-rm="del">Remove</button>' : '<span class="small muted">Tap a piece on the canvas to adjust it.</span>') + '</div>'
    + '<div class="row" style="margin-top:12px"><input class="fld grow" id="rm-name" placeholder="Name this look" value="' + esc(R.name) + '"><button class="btn" id="rm-save"' + (R.pieces.length ? '' : ' disabled') + '>' + (R.outfitId ? 'Save changes' : 'Save look') + '</button>' + (R.outfitId ? '<button class="btn ghost" id="rm-copy">Save as new</button>' : '') + '<button class="btn ghost" id="rm-clear">Clear</button></div>'
    + (R.outfitId ? '<p class="tiny muted">Editing the saved look "' + esc((W.byId[R.outfitId] || {}).name || '') + '".</p>' : '')
    + '</div><div class="card tray"><input class="fld" id="rm-q" placeholder="Search pieces" value="' + esc(R.q) + '" autocomplete="off"><div class="chips" style="margin-top:8px"><button class="chip' + (!R.cat ? ' on' : '') + '" data-rc="">All</button>' + cats.map((c) => '<button class="chip' + (R.cat === c ? ' on' : '') + '" data-rc="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>'
    + '<div class="grid" style="margin-top:8px">' + tray.map((i) => itemCard(i, { select: true, picked: R.pieces.some((p) => p.id === i.id), wears: false })).join('') + '</div>' + (tray.length ? '' : '<div class="empty">No pieces to show.</div>') + '</div></div>';
  h += '<div class="card" style="margin-top:16px"><div class="kick">Virtual try-on</div><p class="small muted" style="margin:6px 0 0;line-height:1.5">Not set up. Seeing clothes on your own photo needs a try-on provider and its key in Vercel. When one is added, previews will be labelled as simulations, since no tool can show true fit or fabric.</p></div>';
  h += '<h2 class="sec">All saved looks</h2>' + (W.outfits.length ? '<div class="grid">' + W.outfits.slice().sort((a, b) => (a.edited < b.edited ? 1 : -1)).map((o) => '<button class="it" data-look="' + o.id + '" data-noitem><div class="ph" style="aspect-ratio:1;padding:10px">' + miniHTML(o.items, 4) + '</div><div class="meta"><div class="nm">' + esc(o.name) + (o.favorite ? ' ♥' : '') + '</div><div class="ct">' + esc(o.source || '') + ' · ' + o.items.length + ' pieces</div></div></button>').join('') + '</div>' : '<div class="card muted small">No saved looks yet.</div>');
  el.innerHTML = h;
  const cv = $('#rm-c', el);
  bindCanvas(cv);
  $('#rm-q', el).oninput = debounce((e) => { R.q = $('#rm-q').value.toLowerCase().trim(); render(); const n = $('#rm-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250);
  $('#rm-name', el).oninput = (e) => { R.name = e.target.value; };
  $('#rm-clear', el).onclick = () => { R.pieces = []; R.sel = null; R.outfitId = null; R.name = ''; render(); };
  const doSave = async (asNew, btn) => {
    const name = (R.name || '').trim() || 'Dressing room look';
    const layout = R.pieces.map((p) => ({ id: p.id, x: +p.x.toFixed(4), y: +p.y.toFixed(4), w: +p.w.toFixed(4), z: p.z }));
    busy(btn, true);
    try {
      const row = await save('outfits', asNew ? null : R.outfitId, Object.assign({ name, items: R.pieces.map((p) => p.id), layout }, R.outfitId && !asNew ? {} : { source: 'Dressing room' }));
      R.outfitId = row.id; R.name = row.name; toast('Look saved'); render();
    } catch (x) { busy(btn, false); toast(x.message, true); }
  };
  $('#rm-save', el).onclick = (e) => doSave(false, e.target);
  const cp = $('#rm-copy', el); if (cp) cp.onclick = (e) => doSave(true, e.target);
  el.onclick = (e) => {
    const rc = e.target.closest('[data-rc]'); if (rc) { R.cat = rc.getAttribute('data-rc'); render(); return; }
    const lk = e.target.closest('[data-look]'); if (lk) { openLook(lk.getAttribute('data-look')); return; }
    const ti = e.target.closest('.tray [data-item]');
    if (ti) {
      const id = ti.getAttribute('data-item');
      const ex = R.pieces.findIndex((p) => p.id === id);
      if (ex !== -1) { R.pieces.splice(ex, 1); if (R.sel === id) R.sel = null; }
      else { const p = autoPlace(id, R.pieces.length, R.pieces.length + 1); p.z = R.pieces.reduce((m, x) => Math.max(m, x.z), 0) + 1; R.pieces.push(p); R.sel = id; }
      render(); return;
    }
    const b = e.target.closest('[data-rm]'); if (!b || !R.sel) return;
    const p = R.pieces.find((x) => x.id === R.sel); if (!p) return;
    const a = b.getAttribute('data-rm');
    if (a === 'up') p.z = R.pieces.reduce((m, x) => Math.max(m, x.z), 0) + 1;
    if (a === 'down') { const mn = R.pieces.reduce((m, x) => Math.min(m, x.z), 0); p.z = mn - 1; }
    if (a === 'big') p.w = Math.min(0.95, p.w * 1.15);
    if (a === 'small') p.w = Math.max(0.08, p.w / 1.15);
    if (a === 'del') { R.pieces = R.pieces.filter((x) => x.id !== R.sel); R.sel = null; }
    render();
  };
}
function bindCanvas(cv) {
  if (!cv) return;
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    const rs = e.target.closest('[data-rs]'); const pc = e.target.closest('[data-p]');
    if (!pc) { if (ROOM.sel) { ROOM.sel = null; render(); } return; }
    const id = pc.getAttribute('data-p'); const p = ROOM.pieces.find((x) => x.id === id); if (!p) return;
    e.preventDefault();
    const box = cv.getBoundingClientRect();
    drag = { p, el: pc, mode: rs ? 'size' : 'move', sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, ow: p.w, bw: box.width, bh: box.height, moved: false };
    try { pc.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    if (ROOM.sel !== id) { ROOM.sel = id; $$('.piece', cv).forEach((x) => x.classList.toggle('on', x === pc)); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.bw, dy = (e.clientY - drag.sy) / drag.bh;
    if (Math.abs(dx) + Math.abs(dy) > 0.004) drag.moved = true;
    if (drag.mode === 'move') { drag.p.x = Math.max(-0.2, Math.min(0.95, drag.ox + dx)); drag.p.y = Math.max(-0.2, Math.min(0.95, drag.oy + dy)); drag.el.style.left = (drag.p.x * 100) + '%'; drag.el.style.top = (drag.p.y * 100) + '%'; }
    else { drag.p.w = Math.max(0.08, Math.min(0.95, drag.ow + dx)); drag.el.style.width = (drag.p.w * 100) + '%'; }
  });
  const end = () => { if (drag) { const d = drag; drag = null; render(); return d; } return null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}

/* ---------------- Outfit planner ---------------- */
const PL = { mode: 'month', day: '', place: '', weather: {}, autoPicked: {} };
RENDER.planner = function (el) {
  if (!W.tasks) loadTasks();
  const args = W.route || [];
  if (args[0] && ['month', 'week', 'day'].includes(args[0])) PL.mode = args[0];
  if (args[1] && /^\d{4}-\d{2}-\d{2}$/.test(args[1])) PL.day = args[1];
  if (!PL.day) PL.day = W.today;
  const taskId = args[2] || '';
  let h = '<h2 class="sec" style="margin-top:8px">Outfit planner</h2><div class="row" style="margin-bottom:12px"><div class="seg">' + ['day', 'week', 'month'].map((m) => '<button data-mode="' + m + '" class="' + (PL.mode === m ? 'on' : '') + '">' + m.charAt(0).toUpperCase() + m.slice(1) + '</button>').join('') + '</div><div class="grow"></div><button class="iconbtn" data-nav="-1" aria-label="Previous">‹</button><button class="btn ghost sm" data-nav="0">Today</button><button class="iconbtn" data-nav="1" aria-label="Next">›</button></div>';
  if (W.tasksErr) h += '<div class="banner info">Your Personal OS calendar could not be read here (' + esc(W.tasksErr) + '). Looks still plan normally.</div>';
  const soon = W.log.filter((l) => l.kind === 'Planned' && l.date && l.date.start >= W.today && l.date.start <= addDays(W.today, 7)).map((l) => ({ l, is: lookIssues(l.items || []) })).filter((x) => x.is.length);
  if (soon.length && PL.mode !== 'day') h += soon.map((x) => '<div class="banner warn">⚠︎ ' + esc(relDay(x.l.date.start)) + ': ' + esc(x.is.join(', ')) + '</div>').join('');
  if (PL.mode === 'month') h += monthHTML(PL.day);
  if (PL.mode === 'week') h += weekHTML(PL.day);
  if (PL.mode === 'day') h += dayHTML(PL.day, taskId);
  el.innerHTML = h;
  el.onclick = async (e) => {
    const m = e.target.closest('[data-mode]'); if (m) { go('planner', [m.getAttribute('data-mode'), PL.day]); return; }
    const n = e.target.closest('[data-nav]'); if (n) { const k = +n.getAttribute('data-nav'); PL.day = !k ? W.today : PL.mode === 'month' ? shiftMonth(PL.day, k) : addDays(PL.day, PL.mode === 'week' ? 7 * k : k); go('planner', [PL.mode, PL.day]); return; }
    const d = e.target.closest('[data-day]'); if (d) { go('planner', ['day', d.getAttribute('data-day')]); return; }
    const a = e.target.closest('[data-pa]'); if (!a) return;
    const act = a.getAttribute('data-pa'), id = a.getAttribute('data-id');
    if (act === 'pick') { const tid = a.getAttribute('data-task') || ''; pickOutfit('Choose a look', (oid) => planDialog({ outfit: oid, date: PL.day, taskId: tid })); }
    if (act === 'pieces') pickItems('Choose pieces', [], (ids) => ids.length && planDialog({ items: ids, date: PL.day, label: 'Pieces' }));
    if (act === 'ask') { const t = a.getAttribute('data-title'); STY.ctx = Object.assign(styCtx(), { date: PL.day }); STY.prefill = t ? 'What should I wear for ' + t + '?' : 'Plan a look for ' + prettyDay(PL.day); go('stylist'); }
    if (act === 'wear') markLogWorn(id, a);
    if (act === 'del') armDelete(a, async () => { try { await remove('log', id); toast('Removed from the calendar'); render(); } catch (x) { toast(x.message, true); } });
    if (act === 'look') { const l = W.byId[id]; if (l && l.outfit && W.byId[l.outfit]) openLook(l.outfit); }
    if (act === 'swap') { const l = W.byId[id]; pickOutfit('Change to', async (oid) => { try { await save('log', id, { outfit: oid, items: (W.byId[oid] || {}).items || [] }); toast('Changed'); render(); } catch (x) { toast(x.message, true); } }); }
  };
  if (PL.mode === 'day') {
    loadDayWeather(PL.day);
    // Opened from an event in the To-Do: offer the look picker right away, once.
    if (taskId && !PL.autoPicked[taskId] && !W.log.some((l) => l.taskId === taskId)) {
      PL.autoPicked[taskId] = true;
      const tryOpen = () => { const t = (W.tasks || []).find((x) => x.id === taskId); if (W.tasks) pickOutfit('Choose a look' + (t ? ' for ' + t.name : ''), (oid) => planDialog({ outfit: oid, date: PL.day, taskId })); else setTimeout(tryOpen, 300); };
      setTimeout(tryOpen, 200);
    }
  }
};
function shiftMonth(day, k) { const d = new Date(day.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 10); }
function looksOn(day) { return W.log.filter((l) => l.date && l.date.start === day); }
function monthHTML(day) {
  const first = day.slice(0, 7) + '-01';
  const dow = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const start = addDays(first, -dow);
  let h = '<div style="font-family:var(--display);font-size:24px;margin-bottom:10px">' + new Date(first + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + '</div><div class="cal">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => '<div class="dow">' + d + '</div>').join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i === 35 && d.slice(0, 7) !== day.slice(0, 7)) break;
    const ls = looksOn(d); const ev = W.tasks ? eventsOn(d) : [];
    const first2 = ls.slice(0, 2).map((l) => W.byId[(l.items || [])[0]]).filter(Boolean);
    const bad = ls.some((l) => l.kind === 'Planned' && d >= W.today && lookIssues(l.items || []).length);
    h += '<button class="d' + (d.slice(0, 7) !== day.slice(0, 7) ? ' out' : '') + (d === W.today ? ' today' : '') + '" data-day="' + d + '"><span class="n">' + (+d.slice(8)) + '</span><span class="th">' + first2.map((it) => itemImg(it) ? '<img src="' + esc(itemImg(it)) + '" alt="">' : '').join('') + '</span><span class="dots">' + ls.map((l) => '<span class="dot' + (l.kind === 'Worn' ? ' w' : '') + '"></span>').join('') + ev.slice(0, 3).map(() => '<span class="dot e"></span>').join('') + (bad ? '<span class="dot x"></span>' : '') + '</span></button>';
  }
  return h + '</div><div class="row tiny muted" style="margin-top:8px;gap:14px"><span><span class="dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--gold)"></span> planned</span><span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ok)"></span> worn</span><span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--sand)"></span> event</span><span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--bad)"></span> piece unavailable</span></div>';
}
function weekHTML(day) {
  const dow = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const start = addDays(day, -dow);
  let h = '<div class="wk card">';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i); const ls = looksOn(d); const ev = W.tasks ? eventsOn(d) : [];
    h += '<div class="day"><button class="link" data-day="' + d + '" style="font-family:var(--serif);font-size:16px;color:var(--ink)">' + esc(prettyDay(d)) + (d === W.today ? ' · today' : '') + '</button>'
      + ev.map((t) => '<div class="ev">' + esc(t.name) + '</div>').join('')
      + ls.map((l) => '<div class="row small" style="margin-top:6px">' + miniHTML(l.items || [], 5) + '<span class="tag ' + (l.kind === 'Worn' ? 'ok' : '') + '">' + l.kind + '</span>' + (lookIssues(l.items || []).length && l.kind === 'Planned' ? '<span class="tag warn">check pieces</span>' : '') + '</div>').join('')
      + (!ls.length && !ev.length ? '<div class="tiny muted">Nothing yet</div>' : '') + '</div>';
  }
  return h + '</div>';
}
function dayHTML(day, taskId) {
  const ls = looksOn(day); const ev = W.tasks ? eventsOn(day) : null;
  const w = PL.weather[day];
  let h = '<div style="font-family:var(--display);font-size:26px">' + esc(prettyDay(day, { weekday: 'long', year: 'numeric', month: 'long' })) + '</div>'
    + '<div class="small muted" id="pl-wx" style="margin:4px 0 12px">' + (w === undefined ? (dayDiff(W.today, day) <= 15 && dayDiff(W.today, day) >= 0 ? 'Checking the forecast…' : 'No forecast this far out') : w ? esc(weatherShort(w)) : 'No forecast available') + '</div>';
  h += '<h2 class="sec">Events</h2>';
  if (ev === null) h += '<div class="loading">Reading your calendar…</div>';
  else if (!ev.length) h += '<div class="small muted">No events in your Personal OS calendar this day.</div>';
  else h += ev.map((t) => { const att = ls.filter((l) => l.taskId === t.id); return '<div class="card" style="margin-bottom:10px' + (t.id === taskId ? ';border-color:var(--gold);box-shadow:0 0 0 3px var(--goldsoft)' : '') + '"><div class="row"><div class="grow"><div style="font-family:var(--serif);font-size:16px">' + esc(t.name) + '</div><div class="tiny muted">' + esc(/T(\d\d:\d\d)/.test(t.date.start) ? t.date.start.match(/T(\d\d:\d\d)/)[1] + ' WITA' : 'All day') + (t.area ? ' · ' + esc(t.area) : '') + '</div></div>' + (att.length ? '<span class="tag ok">Look chosen</span>' : '<button class="btn sm" data-pa="pick" data-task="' + t.id + '">Pick a look</button><button class="btn ghost sm" data-pa="ask" data-title="' + esc(t.name) + '"' + (W.server.ai ? '' : ' disabled') + '>Ask stylist</button>') + '</div></div>'; }).join('');
  h += '<h2 class="sec">Looks</h2>';
  if (!ls.length) h += '<div class="small muted" style="margin-bottom:10px">Nothing planned or worn this day.</div>';
  h += ls.map((l) => {
    const o = l.outfit && W.byId[l.outfit]; const is = l.kind === 'Planned' ? lookIssues(l.items || []) : [];
    return '<div class="board" style="margin-bottom:12px"><div class="row"><div class="ttl grow" style="font-size:19px">' + esc((o && o.name) || l.name.split(' · ')[2] || 'Look') + '</div><span class="tag ' + (l.kind === 'Worn' ? 'ok' : '') + '">' + l.kind + '</span></div>'
      + (l.event ? '<div class="small muted">For ' + esc(l.event) + '</div>' : '') + boardHTML(l.items || [])
      + (is.length ? '<div class="banner warn">Not available right now: ' + esc(is.join(', ')) + '. Wash it in time or change the look.</div>' : '')
      + (l.notes ? '<div class="small">' + esc(l.notes) + '</div>' : '')
      + '<div class="acts">' + (l.kind === 'Planned' ? '<button class="btn gold sm" data-pa="wear" data-id="' + l.id + '"' + (day > W.today ? ' disabled title="That day has not happened yet"' : '') + '>Mark as worn</button><button class="btn ghost sm" data-pa="swap" data-id="' + l.id + '">Change look</button>' : '') + (o ? '<button class="btn ghost sm" data-pa="look" data-id="' + l.id + '">Open look</button>' : '') + '<button class="btn danger sm" data-pa="del" data-id="' + l.id + '">Remove</button></div></div>';
  }).join('');
  h += '<div class="row"><button class="btn sm" data-pa="pick">Plan a saved look</button><button class="btn ghost sm" data-pa="pieces">Pick pieces</button><button class="btn ghost sm" data-pa="ask"' + (W.server.ai ? '' : ' disabled') + '>Ask the stylist</button></div>';
  return h;
}
async function loadDayWeather(day) {
  if (PL.weather[day] !== undefined) return;
  const n = dayDiff(W.today, day); if (n < 0 || n > 15) { PL.weather[day] = null; return; }
  const place = (W.profile && W.profile.home) || 'Bali';
  try { const j = await api('weather', { place, start: day }); PL.weather[day] = j.weather || null; } catch (e) { PL.weather[day] = null; }
  const el = $('#pl-wx'); if (el && W.view === 'planner') el.textContent = PL.weather[day] ? weatherShort(PL.weather[day]) : 'No forecast available';
}
