/* packing-panel.js — the day-before packing list (12 Oct 2026).
   ---------------------------------------------------------------------------
   One file, used unchanged by two apps:
     - Dia's dashboard on DiveArts OS (/dia), talking to /api/packing behind
       Cloudflare Access, so nobody pastes a token
     - Befalia OS (befalia-os-app), talking to its own /api/packing with the
       x-os-key header
   Both reach the same DAA Packing Apps Script, so a tick in one shows in the
   other on the next refresh (every 2 minutes, or tap Refresh).

   The host page sets window.PACKING_CONFIG before loading this file:
     { api: '/api/packing', headers: function(){ return {...} },
       slots: ['pack-slot'], theme: 'light' | 'dark' }
   and puts an empty element with one of those ids where the card should go.
   The slot may be re-rendered by the host; the panel re-attaches by itself.

   Nothing here is invented. If the list cannot be read the panel says so in
   red. If there is no class it says how many calendar events it checked, so
   "nothing tomorrow" can be told apart from "could not read". A session the
   brain cannot recognise is shown as UNKNOWN in red, and that card can never
   show as done. A tick only stays ticked on screen if the sheet saved it.

   The × on a card (13 Oct 2026) hides it for the person looking, either that
   one day or every class in that city. It is saved in the sheet, so it holds
   on every device for that person, and the line "Hidden for you" with Show
   brings it back. Hiding never changes what the other person sees.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';
  var CFG = window.PACKING_CONFIG || {};
  var API = CFG.api || '/api/packing';
  var SLOTS = CFG.slots || ['pack-slot'];
  var DARK = CFG.theme === 'dark';
  var REFRESH_MS = 120000;

  var DATA = null, ERR = '', LOADING = false, OPEN = {}, BUSY = {}, MSG = {}, timer = null, AGAIN = false;
  var ASK = {}, HIDEMSG = '';   // ASK[cardId] = the hide choices are open for that card

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nice(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); if (!m) return ymd || '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return DOW[d.getUTCDay()] + ' ' + (+m[3]) + ' ' + MON[+m[2] - 1];
  }
  function hhmm(iso) {
    if (!iso) return '';
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch (e) { return ''; }
  }
  function cardId(c) { return c.date + '|' + c.city; }

  function css() {
    if (document.getElementById('pk-css')) return;
    var P = DARK
      ? { bg: 'rgba(255,255,255,.04)', card: 'rgba(255,255,255,.06)', line: 'rgba(255,255,255,.14)', ink: '#E9F4F7', mute: '#9fb3bb', accent: '#2ee6ff', done: '#5fc27e', red: '#ff6b81', amber: '#ffd27f', row: 'rgba(255,255,255,.03)' }
      : { bg: '#fff', card: '#fff', line: '#DDD3C0', ink: '#2A2E37', mute: '#8d8677', accent: '#1B2A47', done: '#3E7D5A', red: '#B23A48', amber: '#9A6A15', row: '#F7F3EC' };
    var s = document.createElement('style');
    s.id = 'pk-css';
    s.textContent =
      '.pk{font-family:inherit;color:' + P.ink + ';margin-bottom:16px}' +
      '.pk-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 8px}' +
      '.pk-h b{font-size:15.5px}.pk-h button{background:none;border:0;color:' + P.mute + ';font:700 12px inherit;cursor:pointer;padding:4px 0}' +
      '.pk-card{position:relative;background:' + P.card + ';border:1px solid ' + P.line + ';border-radius:14px;margin-bottom:10px;overflow:hidden}' +
      '.pk-x{position:absolute;top:6px;right:6px;width:36px;height:36px;border:0;background:none;color:' + P.mute + ';font-family:inherit;font-size:26px;line-height:1;cursor:pointer;border-radius:50%;z-index:2}' +
      '.pk-x:hover{background:' + P.row + ';color:' + P.ink + '}' +
      '.pk-ask{border-top:1px solid ' + P.line + ';padding:11px 15px 13px;font-size:13px}' +
      '.pk-ask .q{color:' + P.mute + ';margin-bottom:8px}' +
      '.pk-ask button{border:1px solid ' + P.line + ';background:' + P.row + ';color:' + P.ink + ';border-radius:999px;padding:8px 13px;font:700 12.5px inherit;cursor:pointer;margin:0 6px 6px 0;min-height:36px}' +
      '.pk-ask button.go{background:' + P.accent + ';border-color:' + P.accent + ';color:' + (DARK ? '#06202b' : '#fff') + '}' +
      '.pk-hid{font-size:12.5px;color:' + P.mute + ';padding:8px 2px;line-height:1.7}' +
      '.pk-hid button{background:none;border:0;color:' + P.accent + ';font:700 12.5px inherit;cursor:pointer;padding:0 2px;text-decoration:underline}' +
      '.pk-card.late{border-color:' + P.red + ';box-shadow:inset 4px 0 0 ' + P.red + '}' +
      '.pk-card.ok{border-color:' + P.done + ';box-shadow:inset 4px 0 0 ' + P.done + '}' +
      '.pk-top{display:block;width:100%;text-align:left;background:none;border:0;color:inherit;font:inherit;padding:13px 46px 13px 15px;cursor:pointer}' +
      '.pk-when{font-size:11px;letter-spacing:.07em;text-transform:uppercase;font-weight:800;color:' + P.mute + '}' +
      '.pk-card.late .pk-when{color:' + P.red + '}.pk-card.ok .pk-when{color:' + P.done + '}' +
      '.pk-ttl{font-size:15px;font-weight:800;margin-top:3px;display:flex;gap:10px;align-items:baseline}' +
      '.pk-ttl .n{margin-left:auto;font-size:13px;color:' + P.mute + ';white-space:nowrap}' +
      '.pk-bar{height:6px;border-radius:4px;background:' + P.line + ';margin-top:9px;overflow:hidden}' +
      '.pk-bar i{display:block;height:100%;background:' + P.done + '}' +
      '.pk-ses{font-size:12px;color:' + P.mute + ';margin-top:8px;line-height:1.55}' +
      '.pk-ses .u{color:' + P.red + ';font-weight:700}' +
      '.pk-body{border-top:1px solid ' + P.line + ';padding:4px 15px 12px}' +
      '.pk-sec{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:800;color:' + P.mute + ';margin:12px 0 4px}' +
      '.pk-row{display:flex;gap:11px;align-items:center;width:100%;text-align:left;background:none;border:0;border-top:1px solid ' + P.line + ';color:inherit;font:inherit;font-size:14px;padding:10px 2px;cursor:pointer;min-height:44px}' +
      '.pk-row:first-of-type{border-top:0}' +
      '.pk-row .bx{flex:none;width:22px;height:22px;border-radius:6px;border:2px solid ' + P.line + ';display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#fff}' +
      '.pk-row.on .bx{background:' + P.done + ';border-color:' + P.done + '}' +
      '.pk-row.on .t{text-decoration:line-through;color:' + P.mute + '}' +
      '.pk-row .nt{font-size:11.5px;color:' + P.mute + '}' +
      '.pk-row .by{margin-left:auto;font-size:11px;color:' + P.mute + ';white-space:nowrap}' +
      '.pk-row.busy{opacity:.55}' +
      '.pk-msg{font-size:12.5px;line-height:1.5;padding:10px 12px;border-radius:10px;margin:8px 0;border:1px solid}' +
      '.pk-msg.red{color:' + P.red + ';border-color:' + P.red + '}.pk-msg.amber{color:' + P.amber + ';border-color:' + P.amber + '}' +
      '.pk-quiet{font-size:12.5px;color:' + P.mute + ';padding:10px 2px}' +
      '.pk-unk{font-size:12.5px;color:' + P.red + ';border:1px solid ' + P.red + ';border-radius:10px;padding:9px 11px;margin:10px 0 4px;line-height:1.5}';
    document.head.appendChild(s);
  }

  /* ---------------------------------------------------------------- data */
  function headers(extra) {
    var h = {};
    try { h = (typeof CFG.headers === 'function' ? CFG.headers() : CFG.headers) || {}; } catch (e) { h = {}; }
    return Object.assign({}, h, extra || {});
  }

  /* Never reload while a tick is saving: the reload could read the sheet just
     before the tick lands and put the item back as unticked on screen. The
     reload runs as soon as the last tick has answered. */
  function load() {
    if (Object.keys(BUSY).length) { AGAIN = true; return; }
    if (LOADING) return;
    LOADING = true; render();
    fetch(API, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: headers() })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The packing list answered with HTTP ' + r.status + '.' }; }); })
      .then(function (j) {
        if (j && j.ok) { DATA = j; ERR = ''; }
        else { ERR = (j && j.error) || 'The packing list could not be read.'; if (j && j.notConnected) ERR = 'NC:' + ERR; }
      })
      .catch(function () { ERR = 'The packing list could not be reached. Check the connection and tap Refresh.'; })
      .then(function () { LOADING = false; render(); });
  }

  function tick(card, item) {
    var cid = cardId(card), key = item.key;
    var id = cid + '|' + key;
    if (BUSY[id]) return;
    var want = !item.ticked;
    BUSY[id] = true; item.ticked = want; MSG[cardId(card)] = '';
    recount(card); render();
    fetch(API, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: headers({ 'Content-Type': 'application/json' }),
                 body: JSON.stringify({ date: card.date, city: card.city, itemKey: item.key, ticked: want }) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }); })
      .then(function (j) {
        var c = findCard(cid) || card, it = c.items.filter(function (x) { return x.key === key; })[0] || item;
        if (j && j.ok) { it.ticked = j.ticked; it.by = j.ticked ? j.by : ''; it.at = j.ticked ? j.at : ''; }
        else { it.ticked = !want; MSG[cid] = 'Not saved: ' + ((j && j.error) || 'the sheet did not answer') + '. "' + it.item + '" is back as it was.'; }
      }, function () {
        var c = findCard(cid) || card, it = c.items.filter(function (x) { return x.key === key; })[0] || item;
        it.ticked = !want; MSG[cid] = 'Not saved, no connection. "' + it.item + '" is back as it was.';
      })
      .then(function () {
        delete BUSY[id];
        var c = findCard(cid); if (c) recount(c);
        render();
        if (AGAIN && !Object.keys(BUSY).length) { AGAIN = false; load(); }
      });
  }

  /* ---------------------------------------------------------------- hiding
     Per person: what Befa hides, Dia still sees. A hidden card never vanishes
     without a trace: the panel always says how many are hidden, with Show. */
  function hides() { return (DATA && DATA.hides) || { cities: [], cards: [] }; }
  function isHidden(c) {
    var h = hides();
    return h.cities.indexOf(c.city) !== -1 || h.cards.indexOf(cardId(c)) !== -1;
  }
  function hide(scope, city, date, hidden) {
    if (!DATA) return;
    var before = JSON.parse(JSON.stringify(hides()));
    var h = DATA.hides = DATA.hides || { cities: [], cards: [] };
    var key = date + '|' + city;
    if (scope === 'city') h.cities = hidden ? h.cities.concat([city]).filter(function (v, i, a) { return a.indexOf(v) === i; }) : h.cities.filter(function (v) { return v !== city; });
    else h.cards = hidden ? h.cards.concat([key]).filter(function (v, i, a) { return a.indexOf(v) === i; }) : h.cards.filter(function (v) { return v !== key; });
    ASK = {}; HIDEMSG = ''; render();
    fetch(API, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: headers({ 'Content-Type': 'application/json' }),
                 body: JSON.stringify({ action: 'hide', scope: scope, city: city, date: scope === 'card' ? date : '', hidden: hidden }) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }); })
      .then(function (j) {
        if (j && j.ok && j.hides) DATA.hides = j.hides;
        else { DATA.hides = before; HIDEMSG = 'Not saved: ' + ((j && j.error) || 'the sheet did not answer') + '. Nothing was hidden.'; }
      }, function () { DATA.hides = before; HIDEMSG = 'Not saved, no connection. Nothing was hidden.'; })
      .then(render);
  }

  function recount(card) {
    card.ticked = card.items.filter(function (x) { return x.ticked; }).length;
    card.done = card.items.length > 0 && card.ticked === card.items.length && !(card.unknown || []).length;
  }

  /* ---------------------------------------------------------------- view */
  function sessionLine(s) {
    var t = s.time || hhmm(s.start);
    if (s.unknown) return '<div class="u">' + esc(t) + ' ' + esc(s.title) + ' · UNKNOWN, no list made: ' + esc(s.unknown) + '</div>';
    var bits = [esc(t), '<b>' + esc(s.student) + '</b>', esc(s.label)];
    if (s.online) bits.push('online, nothing to pack');
    else if (s.location) bits.push(esc(s.location));
    if (s.last) bits.push('last session, graduation items added');
    if (s.lastUnknown) bits.push('<span class="u">could not confirm if this is the last session, so graduation items are NOT added</span>');
    return '<div>' + bits.join(' · ') + '</div>';
  }

  function cardHtml(c) {
    var id = cardId(c);
    var isToday = DATA && c.date === DATA.today;
    var when = isToday ? 'Today' : (DATA && c.date === DATA.tomorrow ? 'Tomorrow' : 'Packing');
    var late = isToday && !c.done;
    var cls = 'pk-card' + (c.done ? ' ok' : (late ? ' late' : ''));
    var kinds = [];
    c.sessions.forEach(function (s) { if (!s.unknown && !s.online) { var k = (s.kits || []).join(' + ').replace('MERMAID', 'Mermaid').replace('UWD', 'UW Dance').replace('UW_MODEL', 'UW Modeling').replace('PADI_MI', 'PADI MI'); if (s.kids) k += ' Kids'; k += ' (' + s.stageLabel + ')'; if (kinds.indexOf(k) === -1) kinds.push(k); } });
    var pct = c.total ? Math.round(c.ticked / c.total * 100) : 0;
    var status = c.done ? 'Packed' : (late ? 'Class is today, not packed yet' : 'Pack the day before');
    var h = '<div class="' + cls + '"><button class="pk-x" data-pk-x="' + esc(id) + '" aria-label="Hide this card" title="Hide this card">×</button>' +
      '<button class="pk-top" data-pk-open="' + esc(id) + '">' +
      '<div class="pk-when">' + when + ' · ' + esc(nice(c.date)) + ' · ' + esc(c.city) + ' · ' + status + '</div>' +
      '<div class="pk-ttl"><span>' + (kinds.length ? esc(kinds.join(', ')) : 'Check these sessions') + '</span><span class="n">' + c.ticked + ' of ' + c.total + '</span></div>' +
      '<div class="pk-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="pk-ses">' + c.sessions.map(sessionLine).join('') + '</div></button>';
    if (ASK[id]) {
      h += '<div class="pk-ask"><div class="q">Hide this from your list? Only you stop seeing it. You can show it again below.</div>' +
        '<button class="go" data-pk-hide="card" data-pk-city="' + esc(c.city) + '" data-pk-date="' + esc(c.date) + '">Hide just ' + esc(nice(c.date)) + '</button>' +
        '<button class="go" data-pk-hide="city" data-pk-city="' + esc(c.city) + '">Hide all ' + esc(c.city) + ' classes</button>' +
        '<button data-pk-cancel="' + esc(id) + '">Cancel</button></div>';
    }
    if (OPEN[id]) {
      h += '<div class="pk-body">';
      if (MSG[id]) h += '<div class="pk-msg red">' + esc(MSG[id]) + '</div>';
      if ((c.unknown || []).length) h += '<div class="pk-unk">' + c.unknown.length + ' session' + (c.unknown.length > 1 ? 's' : '') + ' could not be read, so ' + (c.unknown.length > 1 ? 'their' : 'its') + ' gear is NOT on this list. Pack ' + (c.unknown.length > 1 ? 'them' : 'it') + ' by hand and tell Claude which kit ' + (c.unknown.length > 1 ? 'they need' : 'it needs') + '.</div>';
      var sec = '';
      c.items.forEach(function (it) {
        if (it.section !== sec) { sec = it.section; h += '<div class="pk-sec">' + esc(sec) + '</div>'; }
        var busy = BUSY[id + '|' + it.key];
        var by = it.ticked && it.by ? (esc(it.by) + (it.at ? ' ' + esc(hhmm(it.at)) : '')) : '';
        h += '<button class="pk-row' + (it.ticked ? ' on' : '') + (busy ? ' busy' : '') + '" data-pk-tick="' + esc(id) + '" data-pk-key="' + esc(it.key) + '">' +
          '<span class="bx">' + (it.ticked ? '✓' : '') + '</span><span><span class="t">' + esc(it.item) + '</span>' +
          (it.note ? ' <span class="nt">' + esc(it.note) + '</span>' : '') + '</span>' + (by ? '<span class="by">' + by + '</span>' : '') + '</button>';
      });
      if (!c.items.length && !(c.unknown || []).length) h += '<div class="pk-quiet">Nothing to pack for these sessions.</div>';
      h += '</div>';
    }
    return h + '</div>';
  }

  function html() {
    var h = '<div class="pk"><div class="pk-h"><b>🎒 Packing for class</b><button data-pk-refresh>' + (LOADING ? 'Loading…' : '↻ Refresh') + '</button></div>';
    if (ERR) {
      var nc = ERR.indexOf('NC:') === 0;
      h += '<div class="pk-msg ' + (nc ? 'amber' : 'red') + '">' + esc(nc ? ERR.slice(3) : ERR) + (nc ? '' : ' The list is NOT showing, which does not mean there is no class. Check the calendar.') + '</div>';
      if (!DATA) return h + '</div>';
    }
    if (!DATA) return h + '<div class="pk-quiet">Reading tomorrow\'s classes…</div></div>';
    if ((DATA.kitProblems || []).length) h += '<div class="pk-msg amber">Some rows in the KITS sheet were skipped: ' + esc(DATA.kitProblems.join('; ')) + '</div>';
    var all = (DATA.cards || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.city < b.city ? -1 : 1); });
    var cards = all.filter(function (c) { return !isHidden(c); });
    var hiddenNow = all.length - cards.length;
    if (HIDEMSG) h += '<div class="pk-msg red">' + esc(HIDEMSG) + '</div>';
    if (!all.length) {
      var n = 0; Object.keys(DATA.scanned || {}).forEach(function (d) { Object.keys(DATA.scanned[d]).forEach(function (c) { n += DATA.scanned[d][c]; }); });
      h += '<div class="pk-quiet">No class to pack for today or tomorrow in Bali or Jakarta. Checked both calendars (' + n + ' event' + (n === 1 ? '' : 's') + ').</div>';
    } else {
      cards.forEach(function (c) { h += cardHtml(c); });
    }
    var hs = hides(), parts = [];
    hs.cities.slice().sort().forEach(function (city) {
      parts.push('all ' + esc(city) + ' classes <button data-pk-show="city" data-pk-city="' + esc(city) + '">Show</button>');
    });
    hs.cards.slice().sort().forEach(function (k) {
      var d = k.split('|')[0], city = k.split('|')[1];
      if (hs.cities.indexOf(city) !== -1) return;
      if (!all.some(function (c) { return cardId(c) === k; })) return;   // an old day, nothing to show
      parts.push(esc(nice(d)) + ' ' + esc(city) + ' <button data-pk-show="card" data-pk-city="' + esc(city) + '" data-pk-date="' + esc(d) + '">Show</button>');
    });
    if (parts.length) h += '<div class="pk-hid">Hidden for you' + (hiddenNow ? ' (' + hiddenNow + ' card' + (hiddenNow > 1 ? 's' : '') + ' now)' : '') + ': ' + parts.join(' · ') + '</div>';
    (DATA.quiet || []).forEach(function (x) {
      h += '<div class="pk-quiet">' + esc(nice(x.date)) + ' · ' + esc(x.city) + ' · ' + esc(x.time) + ' ' + esc(x.title) + ': ' + (x.online ? 'online, nothing to pack.' : 'nothing to pack.') + '</div>';
    });
    return h + '</div>';
  }

  function slots() {
    var out = [];
    SLOTS.forEach(function (id) { var el = document.getElementById(id); if (el) out.push(el); });
    return out;
  }

  function render() {
    css();
    var markup = html();
    slots().forEach(function (el) { if (el.__pk !== markup) { el.innerHTML = markup; el.__pk = markup; } });
  }

  function findCard(id) { return ((DATA && DATA.cards) || []).filter(function (c) { return cardId(c) === id; })[0]; }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-pk-open],[data-pk-tick],[data-pk-refresh],[data-pk-x],[data-pk-hide],[data-pk-show],[data-pk-cancel]');
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute('data-pk-refresh')) { load(); return; }
    if (t.hasAttribute('data-pk-x')) { var xid = t.getAttribute('data-pk-x'); ASK[xid] = !ASK[xid]; render(); return; }
    if (t.hasAttribute('data-pk-cancel')) { delete ASK[t.getAttribute('data-pk-cancel')]; render(); return; }
    if (t.hasAttribute('data-pk-hide')) { hide(t.getAttribute('data-pk-hide'), t.getAttribute('data-pk-city'), t.getAttribute('data-pk-date') || '', true); return; }
    if (t.hasAttribute('data-pk-show')) { hide(t.getAttribute('data-pk-show'), t.getAttribute('data-pk-city'), t.getAttribute('data-pk-date') || '', false); return; }
    if (t.hasAttribute('data-pk-open')) { var id = t.getAttribute('data-pk-open'); OPEN[id] = !OPEN[id]; render(); return; }
    var c = findCard(t.getAttribute('data-pk-tick'));
    var it = c && c.items.filter(function (x) { return x.key === t.getAttribute('data-pk-key'); })[0];
    if (c && it) tick(c, it);
  });

  /* The host may redraw the area that holds the slot (Dia's screen is a
     template). When a fresh empty slot appears, fill it again from memory. */
  var mo = new MutationObserver(function () {
    slots().forEach(function (el) { if (!el.firstChild) { el.__pk = ''; } });
    if (slots().some(function (el) { return !el.__pk; })) render();
  });

  function start() {
    mo.observe(document.body, { childList: true, subtree: true });
    load();
    timer = setInterval(function () { if (!document.hidden) load(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  }
  window.PackingPanel = { reload: load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
