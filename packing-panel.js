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

   + Add (13 Oct 2026) puts a card on any day by hand:
     - Class gear: Mermaid, PADI Mermaid Instructor, UW Dance, UW Modeling, EFR
       or Scuba, at a stage (open water carries everything below it), in Bali
       or Jakarta, with kids or last-session items if ticked. Same lists as a
       real class.
     - My lists: your own lists (a trip, bringing Kai). Write the items once,
       one per line, then add the list to any day. Edit it any time.
   An added card shows for the person who added it, and for both when "also
   sees this" is ticked. Its × removes it. The brain refuses a card that would
   be empty, and a list that later goes missing makes the card red.
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
  var FORM = null;              // the + Add form while it is open (its values live here, not in the DOM)
  var RMMSG = {};               // a failed Remove, per card

  var GEAR = [
    { id: 'mermaid', label: 'Mermaid', kits: ['MERMAID'] },
    { id: 'padi_mi', label: 'PADI Mermaid Instructor', kits: ['MERMAID', 'PADI_MI'], padi: true },
    { id: 'uwd', label: 'Underwater dance', kits: ['UWD'] },
    { id: 'model', label: 'Underwater modeling', kits: ['UW_MODEL'] },
    { id: 'efr', label: 'EFR', kits: ['EFR'] },
    { id: 'scuba', label: 'Scuba', kits: ['SCUBA'] }
  ];
  var STAGES = [['theory', 'Theory'], ['studio', 'Studio'], ['pool', 'Pool'], ['ow_pool', 'Open water pool'], ['ow', 'Open water']];

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
  function cardId(c) { return c.date + '|' + (c.slot || c.city); }
  function other() { return DATA && DATA.who === 'Dia' ? 'Befa' : 'Dia'; }
  function gearOf(id) { return GEAR.filter(function (g) { return g.id === id; })[0] || GEAR[0]; }
  function stageLabel(id) { var x = STAGES.filter(function (s) { return s[0] === id; })[0]; return x ? x[1] : id; }

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
      '.pk-h b{font-size:15.5px}.pk-h button{background:none;border:0;color:' + P.mute + ';font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;padding:4px 0}' +
      '.pk-card{position:relative;background:' + P.card + ';border:1px solid ' + P.line + ';border-radius:14px;margin-bottom:10px;overflow:hidden}' +
      '.pk-x{position:absolute;top:6px;right:6px;width:36px;height:36px;border:0;background:none;color:' + P.mute + ';font-family:inherit;font-size:26px;line-height:1;cursor:pointer;border-radius:50%;z-index:2}' +
      '.pk-x:hover{background:' + P.row + ';color:' + P.ink + '}' +
      '.pk-ask{border-top:1px solid ' + P.line + ';padding:11px 15px 13px;font-size:13px}' +
      '.pk-ask .q{color:' + P.mute + ';margin-bottom:8px}' +
      '.pk-ask button{border:1px solid ' + P.line + ';background:' + P.row + ';color:' + P.ink + ';border-radius:999px;padding:8px 13px;font-family:inherit;font-weight:700;font-size:12.5px;cursor:pointer;margin:0 6px 6px 0;min-height:36px}' +
      '.pk-ask button.go{background:' + P.accent + ';border-color:' + P.accent + ';color:' + (DARK ? '#06202b' : '#fff') + '}' +
      '.pk-hid{font-size:12.5px;color:' + P.mute + ';padding:8px 2px;line-height:1.7}' +
      '.pk-hid button{background:none;border:0;color:' + P.accent + ';font-family:inherit;font-weight:700;font-size:12.5px;cursor:pointer;padding:0 2px;text-decoration:underline}' +
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
      '.pk-unk{font-size:12.5px;color:' + P.red + ';border:1px solid ' + P.red + ';border-radius:10px;padding:9px 11px;margin:10px 0 4px;line-height:1.5}' +
      '.pk-h .acts{display:flex;gap:16px;align-items:baseline}.pk-h button.add{color:' + P.accent + ';font-size:13px}' +
      '.pk-form{background:' + P.card + ';border:1px solid ' + P.accent + ';border-radius:14px;padding:12px 15px 14px;margin-bottom:10px;font-size:13.5px}' +
      '.pk-tabs{display:flex;gap:6px;margin-bottom:4px}' +
      '.pk-tabs button,.pk-btn{border:1px solid ' + P.line + ';background:' + P.row + ';color:' + P.ink + ';border-radius:999px;padding:8px 14px;font-family:inherit;font-weight:700;font-size:12.5px;cursor:pointer;min-height:36px;margin:0 6px 6px 0}' +
      '.pk-tabs button.on,.pk-btn.go{background:' + P.accent + ';border-color:' + P.accent + ';color:' + (DARK ? '#06202b' : '#fff') + '}' +
      '.pk-btn[disabled]{opacity:.5;cursor:default}' +
      '.pk-form label.f{display:block;font-size:11.5px;letter-spacing:.04em;font-weight:700;color:' + P.mute + ';margin:11px 0 0}' +
      '.pk-form input[type=text],.pk-form input[type=date],.pk-form select,.pk-form textarea{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:9px 10px;border:1px solid ' + P.line + ';border-radius:10px;background:' + P.row + ';color:' + P.ink + ';font-family:inherit;font-size:14px;min-height:42px}' +
      '.pk-form textarea{min-height:150px;line-height:1.5;resize:vertical}' +
      '.pk-form .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '.pk-form .ck{display:flex;gap:10px;align-items:center;margin-top:11px;cursor:pointer;line-height:1.35}' +
      '.pk-form .ck input{width:20px;height:20px;flex:none;margin:0;accent-color:' + P.accent + '}' +
      '.pk-form .hint{font-size:11.5px;color:' + P.mute + ';margin-top:5px;line-height:1.45}' +
      '.pk-form .btns{margin-top:13px}' +
      '.pk-prev{font-size:12.5px;color:' + P.mute + ';line-height:1.6;margin-top:8px;border-left:3px solid ' + P.line + ';padding-left:10px}' +
      '.pk-prev b{color:' + P.ink + '}' +
      '.pk-link{background:none;border:0;color:' + P.accent + ';font-family:inherit;font-weight:700;font-size:12.5px;cursor:pointer;padding:0;text-decoration:underline}' +
      '.pk-tag{font-size:11.5px;color:' + P.mute + ';margin-top:6px}';
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
                 body: JSON.stringify({ date: card.date, city: card.slot || card.city, itemKey: item.key, ticked: want }) })
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
    if (c.slot) return false;   // a card someone added on purpose is never hidden by a city
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

  /* ---------------------------------------------------------------- + Add */
  function why(j) { return String((j && j.error) || 'the sheet did not answer').replace(/[.\s]+$/, ''); }

  function send(body) {
    return fetch(API, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }); },
            function () { return { ok: false, error: 'no connection' }; });
  }

  function openForm() {
    var lists = (DATA && DATA.lists) || [];
    FORM = { tab: 'class', date: (DATA && (DATA.tomorrow || DATA.today)) || '', gear: 'mermaid', stage: 'pool', city: 'Bali',
             kids: false, grad: false, padi: false, title: '', cardShared: true, listSel: lists.length ? lists[0].name : '__new',
             newName: '', text: '', listShared: false, listCardShared: false, editing: false, busy: false, msg: '' };
  }

  function classTitle() {
    var g = gearOf(FORM.gear);
    return g.label + ' · ' + stageLabel(FORM.stage) + (FORM.kids ? ' · Kids' : '') + (FORM.grad ? ' · Last session' : '');
  }

  function addCard(body) {
    FORM.busy = true; FORM.msg = ''; render();
    return send(Object.assign({ action: 'add' }, body)).then(function (j) {
      if (!FORM) return j;
      FORM.busy = false;
      if (j && j.ok && j.card) {
        DATA.cards = (DATA.cards || []).concat([j.card]);
        OPEN[cardId(j.card)] = true;
        FORM = null;
      } else FORM.msg = 'Not added: ' + why(j) + '.';
      render();
      return j;
    });
  }

  function submitClass() {
    var g = gearOf(FORM.gear);
    addCard({ date: FORM.date, kind: 'class', kits: g.kits, stage: FORM.stage, city: FORM.city, kids: FORM.kids, grad: FORM.grad,
              padi: !!(g.padi || (FORM.grad && FORM.padi)), shared: FORM.cardShared, title: (FORM.title || '').trim() || classTitle() });
  }

  function submitList() {
    addCard({ date: FORM.date, kind: 'list', list: FORM.listSel, shared: FORM.listCardShared, title: FORM.listSel });
  }

  function saveList(andAdd) {
    var isNew = FORM.listSel === '__new';
    var name = isNew ? (FORM.newName || '').trim() : FORM.listSel;
    if (!name) { FORM.msg = 'Give the list a name first.'; render(); return; }
    if (!(FORM.text || '').trim()) { FORM.msg = 'Write at least one thing, one per line.'; render(); return; }
    FORM.busy = true; FORM.msg = ''; render();
    send({ action: 'list', mode: isNew ? 'new' : 'replace', name: name, text: FORM.text, shared: !!FORM.listShared }).then(function (j) {
      if (!FORM) return;
      FORM.busy = false;
      if (!(j && j.ok)) { FORM.msg = 'Not saved: ' + why(j) + '.'; render(); return; }
      DATA.lists = j.lists || DATA.lists;
      FORM.listSel = j.name; FORM.editing = false; FORM.text = ''; FORM.newName = '';
      if (andAdd) submitList(); else { FORM.msg = ''; render(); }
    });
  }

  function editText(L) {
    var out = [], sec = L.name;
    (L.items || []).forEach(function (x) {
      if (x.section !== sec) { sec = x.section; out.push(sec + ':'); }
      out.push(x.item);
    });
    return out.join('\n');
  }

  function removeCard(c) {
    var id = cardId(c), before = DATA.cards.slice();
    DATA.cards = DATA.cards.filter(function (x) { return x !== c; });
    delete ASK[id]; delete RMMSG[id]; render();
    send({ action: 'remove', id: c.added.id }).then(function (j) {
      if (j && j.ok) return;
      DATA.cards = before; RMMSG[id] = 'Not removed: ' + why(j) + '.';
      render();
    });
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
    var status = c.done ? 'Packed' : (late ? (c.added ? 'It is today, not packed yet' : 'Class is today, not packed yet') : 'Pack the day before');
    var A = c.added;
    var xLabel = A ? 'Remove this card' : 'Hide this card';
    var h = '<div class="' + cls + '"><button class="pk-x" data-pk-x="' + esc(id) + '" aria-label="' + xLabel + '" title="' + xLabel + '">×</button>' +
      '<button class="pk-top" data-pk-open="' + esc(id) + '">' +
      '<div class="pk-when">' + when + ' · ' + esc(nice(c.date)) + (c.city ? ' · ' + esc(c.city) : '') + ' · ' + status + '</div>' +
      '<div class="pk-ttl"><span>' + (A ? esc(A.title) : (kinds.length ? esc(kinds.join(', ')) : 'Check these sessions')) + '</span><span class="n">' + c.ticked + ' of ' + c.total + '</span></div>' +
      '<div class="pk-bar"><i style="width:' + pct + '%"></i></div>';
    if (A) {
      var you = DATA && A.by === DATA.who;
      h += '<div class="pk-ses">' + (A.kind === 'class' ? esc(kinds.join(', ')) + ' · ' : 'Your list "' + esc(A.list) + '" · ') +
        'added by ' + (you ? 'you' : esc(A.by)) + (A.shared ? ', ' + (you ? esc(other()) + ' sees it too' : 'shared with you') : ', only you see it') +
        (c.unknown || []).map(function (u) { return '<div class="u">Cannot fill this card: ' + esc(u.unknown) + '</div>'; }).join('') + '</div></button>';
    } else {
      h += '<div class="pk-ses">' + c.sessions.map(sessionLine).join('') + '</div></button>';
    }
    if (RMMSG[id]) h += '<div class="pk-ask"><div class="pk-msg red">' + esc(RMMSG[id]) + '</div></div>';
    if (ASK[id] && A) {
      h += '<div class="pk-ask"><div class="q">Remove "' + esc(A.title) + '" from ' + esc(nice(c.date)) + '?' + (A.shared ? ' It comes off for ' + esc(other()) + ' too.' : '') +
        (A.kind === 'list' ? ' Your list stays saved.' : '') + '</div>' +
        '<button class="go" data-pk-rm="' + esc(id) + '">Remove</button><button data-pk-cancel="' + esc(id) + '">Cancel</button></div>';
    } else if (ASK[id]) {
      h += '<div class="pk-ask"><div class="q">Hide this from your list? Only you stop seeing it. You can show it again below.</div>' +
        '<button class="go" data-pk-hide="card" data-pk-city="' + esc(c.city) + '" data-pk-date="' + esc(c.date) + '">Hide just ' + esc(nice(c.date)) + '</button>' +
        '<button class="go" data-pk-hide="city" data-pk-city="' + esc(c.city) + '">Hide all ' + esc(c.city) + ' classes</button>' +
        '<button data-pk-cancel="' + esc(id) + '">Cancel</button></div>';
    }
    if (OPEN[id]) {
      h += '<div class="pk-body">';
      if (MSG[id]) h += '<div class="pk-msg red">' + esc(MSG[id]) + '</div>';
      if ((c.unknown || []).length && A) h += '<div class="pk-unk">Nothing can be ticked here: ' + esc(c.unknown[0].unknown) + '. ' + (A.kind === 'list' ? 'Check the list in My lists (+ Add) or the MY LISTS tab, or remove this card.' : 'Check the KITS tab, or remove this card.') + '</div>';
      else if ((c.unknown || []).length) h += '<div class="pk-unk">' + c.unknown.length + ' session' + (c.unknown.length > 1 ? 's' : '') + ' could not be read, so ' + (c.unknown.length > 1 ? 'their' : 'its') + ' gear is NOT on this list. Pack ' + (c.unknown.length > 1 ? 'them' : 'it') + ' by hand and tell Claude which kit ' + (c.unknown.length > 1 ? 'they need' : 'it needs') + '.</div>';
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

  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function ck(field, on, label) { return '<label class="ck"><input type="checkbox" data-pk-f="' + field + '"' + (on ? ' checked' : '') + '><span>' + label + '</span></label>'; }

  function formHtml() {
    var F = FORM, busy = F.busy ? ' disabled' : '';
    var h = '<div class="pk-form"><div class="pk-tabs">' +
      '<button data-pk-ftab="class" class="' + (F.tab === 'class' ? 'on' : '') + '">Class gear</button>' +
      '<button data-pk-ftab="list" class="' + (F.tab === 'list' ? 'on' : '') + '">My lists</button></div>';
    h += '<label class="f">DAY<input type="date" data-pk-f="date" min="' + esc(DATA.today || '') + '" value="' + esc(F.date) + '"></label>';
    if (F.tab === 'class') {
      var g = gearOf(F.gear);
      h += '<label class="f">CLASS GEAR<select data-pk-f="gear">' + GEAR.map(function (x) { return opt(x.id, x.label, F.gear); }).join('') + '</select></label>' +
        '<div class="two"><label class="f">UP TO STAGE<select data-pk-f="stage">' + STAGES.map(function (x) { return opt(x[0], x[1], F.stage); }).join('') + '</select></label>' +
        '<label class="f">CITY<select data-pk-f="city">' + opt('Bali', 'Bali', F.city) + opt('Jakarta', 'Jakarta', F.city) + '</select></label></div>' +
        '<div class="hint">Open water carries everything for theory, studio and pool too, the same as a real class.</div>' +
        ck('kids', F.kids, 'Kids class (adds the kids items)') +
        ck('grad', F.grad, 'Last session of the course (adds the graduation items)');
      if (F.grad && !g.padi) h += ck('padi', F.padi, 'PADI course (adds the PADI graduation items)');
      h += '<label class="f">NAME ON THE CARD<input type="text" data-pk-f="title" maxlength="80" placeholder="' + esc(classTitle()) + '" value="' + esc(F.title) + '"></label>' +
        ck('cardShared', F.cardShared, esc(other()) + ' also sees this card') +
        '<div class="btns"><button class="pk-btn go" data-pk-do="class"' + busy + '>' + (F.busy ? 'Adding…' : 'Add to ' + esc(nice(F.date))) + '</button>' +
        '<button class="pk-btn" data-pk-add>Cancel</button></div>';
    } else {
      var lists = DATA.lists || [];
      var L = lists.filter(function (x) { return x.name === F.listSel; })[0];
      if (!L && F.listSel !== '__new') { F.listSel = '__new'; }
      h += '<label class="f">LIST<select data-pk-f="listSel">' +
        lists.map(function (x) { return opt(x.name, x.name + ' · ' + x.count + ' thing' + (x.count === 1 ? '' : 's') + (x.owner === 'Both' ? ' · shared' : ''), F.listSel); }).join('') +
        opt('__new', '+ New list', F.listSel) + '</select></label>';
      if (F.listSel === '__new' || F.editing) {
        if (F.listSel === '__new') h += '<label class="f">NAME<input type="text" data-pk-f="newName" maxlength="60" placeholder="For example: Trip to Jakarta" value="' + esc(F.newName) + '"></label>';
        h += '<label class="f">' + (F.editing ? 'EDIT THE THINGS ON "' + esc(L.name).toUpperCase() + '"' : 'WHAT TO BRING') +
          '<textarea data-pk-f="text" placeholder="One thing per line.&#10;End a line with : to start a section.">' + esc(F.text) + '</textarea></label>' +
          '<div class="hint">One thing per line. A line ending with : starts a section. You write this once and reuse it.</div>';
        if (F.listSel === '__new') {
          h += ck('listShared', F.listShared, esc(other()) + ' can use this list too') +
            ck('listCardShared', F.listCardShared, esc(other()) + ' also sees the card') +
            '<div class="btns"><button class="pk-btn go" data-pk-do="saveadd"' + busy + '>' + (F.busy ? 'Saving…' : 'Save and add to ' + esc(nice(F.date))) + '</button>' +
            '<button class="pk-btn" data-pk-do="save"' + busy + '>Save only</button><button class="pk-btn" data-pk-add>Cancel</button></div>';
        } else {
          h += '<div class="btns"><button class="pk-btn go" data-pk-do="save"' + busy + '>' + (F.busy ? 'Saving…' : 'Save changes') + '</button>' +
            '<button class="pk-btn" data-pk-do="noedit">Cancel edit</button></div>';
        }
      } else {
        var shown = L.items.slice(0, 12), sec = '', prev = '';
        shown.forEach(function (x) { if (x.section !== sec) { sec = x.section; prev += (prev ? '<br>' : '') + '<b>' + esc(sec) + ':</b> '; } else prev += ', '; prev += esc(x.item); });
        if (L.items.length > shown.length) prev += ' … and ' + (L.items.length - shown.length) + ' more';
        h += '<div class="pk-prev">' + prev + '</div><div class="pk-tag"><button class="pk-link" data-pk-do="edit">Edit this list</button></div>' +
          ck('listCardShared', F.listCardShared, esc(other()) + ' also sees the card') +
          '<div class="btns"><button class="pk-btn go" data-pk-do="list"' + busy + '>' + (F.busy ? 'Adding…' : 'Add to ' + esc(nice(F.date))) + '</button>' +
          '<button class="pk-btn" data-pk-add>Cancel</button></div>';
      }
    }
    if (F.msg) h += '<div class="pk-msg red">' + esc(F.msg) + '</div>';
    return h + '</div>';
  }

  function html() {
    var h = '<div class="pk"><div class="pk-h"><b>🎒 Packing for class</b><span class="acts">' +
      (DATA ? '<button class="add" data-pk-add>' + (FORM ? 'Close' : '+ Add') + '</button>' : '') +
      '<button data-pk-refresh>' + (LOADING ? 'Loading…' : '↻ Refresh') + '</button></span></div>';
    if (FORM && DATA) h += formHtml();
    if (ERR) {
      var nc = ERR.indexOf('NC:') === 0;
      h += '<div class="pk-msg ' + (nc ? 'amber' : 'red') + '">' + esc(nc ? ERR.slice(3) : ERR) + (nc ? '' : ' The list is NOT showing, which does not mean there is no class. Check the calendar.') + '</div>';
      if (!DATA) return h + '</div>';
    }
    if (!DATA) return h + '<div class="pk-quiet">Reading tomorrow\'s classes…</div></div>';
    if ((DATA.kitProblems || []).length) h += '<div class="pk-msg amber">Some rows in the KITS sheet were skipped: ' + esc(DATA.kitProblems.join('; ')) + '</div>';
    var all = (DATA.cards || []).slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (!!a.slot !== !!b.slot) return a.slot ? 1 : -1;      // the calendar's cards first, then the added ones
      return (a.city || '') < (b.city || '') ? -1 : 1;
    });
    var cards = all.filter(function (c) { return !isHidden(c); });
    var hiddenNow = all.length - cards.length;
    if (HIDEMSG) h += '<div class="pk-msg red">' + esc(HIDEMSG) + '</div>';
    if (!all.some(function (c) { return !c.slot; })) {
      var n = 0; Object.keys(DATA.scanned || {}).forEach(function (d) { Object.keys(DATA.scanned[d]).forEach(function (c) { n += DATA.scanned[d][c]; }); });
      h += '<div class="pk-quiet">No class to pack for today or tomorrow in Bali or Jakarta. Checked both calendars (' + n + ' event' + (n === 1 ? '' : 's') + ').</div>';
    }
    cards.forEach(function (c) { h += cardHtml(c); });
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

  /* Redrawing replaces the markup, so the field being typed in gets its focus
     and caret back afterwards (a background refresh must never eat typing). */
  function render() {
    css();
    var markup = html();
    var a = document.activeElement, f = a && a.getAttribute && a.getAttribute('data-pk-f'), host = null, ss = null, se = null;
    if (f) { slots().forEach(function (el) { if (el.contains(a)) host = el; }); try { ss = a.selectionStart; se = a.selectionEnd; } catch (e) {} }
    slots().forEach(function (el) { if (el.__pk !== markup) { el.innerHTML = markup; el.__pk = markup; } });
    if (host && !host.contains(a)) {
      var n = host.querySelector('[data-pk-f="' + f + '"]');
      if (n) { n.focus(); try { if (ss != null) n.setSelectionRange(ss, se); } catch (e) {} }
    }
  }

  function findCard(id) { return ((DATA && DATA.cards) || []).filter(function (c) { return cardId(c) === id; })[0]; }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-pk-open],[data-pk-tick],[data-pk-refresh],[data-pk-x],[data-pk-hide],[data-pk-show],[data-pk-cancel],[data-pk-add],[data-pk-ftab],[data-pk-do],[data-pk-rm]');
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute('data-pk-refresh')) { load(); return; }
    if (t.hasAttribute('data-pk-add')) { if (FORM) FORM = null; else openForm(); render(); return; }
    if (t.hasAttribute('data-pk-ftab')) { FORM.tab = t.getAttribute('data-pk-ftab'); FORM.msg = ''; render(); return; }
    if (t.hasAttribute('data-pk-rm')) { var rc = findCard(t.getAttribute('data-pk-rm')); if (rc && rc.added) removeCard(rc); return; }
    if (t.hasAttribute('data-pk-do')) {
      if (!FORM || FORM.busy) return;
      var act = t.getAttribute('data-pk-do');
      if (act === 'class') submitClass();
      else if (act === 'list') submitList();
      else if (act === 'save') saveList(false);
      else if (act === 'saveadd') saveList(true);
      else if (act === 'edit') { var L = (DATA.lists || []).filter(function (x) { return x.name === FORM.listSel; })[0]; if (L) { FORM.editing = true; FORM.text = editText(L); render(); } }
      else if (act === 'noedit') { FORM.editing = false; FORM.text = ''; FORM.msg = ''; render(); }
      return;
    }
    if (t.hasAttribute('data-pk-x')) { var xid = t.getAttribute('data-pk-x'); ASK[xid] = !ASK[xid]; render(); return; }
    if (t.hasAttribute('data-pk-cancel')) { delete ASK[t.getAttribute('data-pk-cancel')]; render(); return; }
    if (t.hasAttribute('data-pk-hide')) { hide(t.getAttribute('data-pk-hide'), t.getAttribute('data-pk-city'), t.getAttribute('data-pk-date') || '', true); return; }
    if (t.hasAttribute('data-pk-show')) { hide(t.getAttribute('data-pk-show'), t.getAttribute('data-pk-city'), t.getAttribute('data-pk-date') || '', false); return; }
    if (t.hasAttribute('data-pk-open')) { var id = t.getAttribute('data-pk-open'); OPEN[id] = !OPEN[id]; render(); return; }
    var c = findCard(t.getAttribute('data-pk-tick'));
    var it = c && c.items.filter(function (x) { return x.key === t.getAttribute('data-pk-key'); })[0];
    if (c && it) tick(c, it);
  });

  /* Form fields: the value is kept in FORM as it is typed, so a redraw never
     loses it. Dropdowns, ticks and the date change what the form shows, so
     they redraw it; typing in a text box does not. */
  function onField(e) {
    var el = e.target, f = el && el.getAttribute && el.getAttribute('data-pk-f');
    if (!f || !FORM) return;
    FORM[f] = el.type === 'checkbox' ? el.checked : el.value;
    if (f === 'listSel') { FORM.editing = false; FORM.text = ''; FORM.msg = ''; }
    if (e.type === 'change' && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date')) render();
  }
  document.addEventListener('input', onField);
  document.addEventListener('change', onField);

  /* The host may redraw the area that holds the slot (Dia's screen is a
     template). When a fresh empty slot appears, fill it again from memory. */
  var mo = new MutationObserver(function () {
    slots().forEach(function (el) { if (!el.firstChild) { el.__pk = ''; } });
    if (slots().some(function (el) { return !el.__pk; })) render();
  });

  function start() {
    mo.observe(document.body, { childList: true, subtree: true });
    load();
    timer = setInterval(function () { if (!document.hidden && !FORM) load(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !FORM) load(); });
  }
  window.PackingPanel = { reload: load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
