/* business-panel.js — the Business tab (13 Oct 2026).
   ---------------------------------------------------------------------------
   Progress across Befa's businesses. Sea Diva is the first section: every paid
   order that is not finished yet, from Shopify, Shopee, Tokopedia/TikTok and
   Manual (IG & WA), one card per invoice, each product with its photo, so she
   can pack and ship.

   Reads GET /api/business with the OS key. The rules are in api/_sd-business.js.
   The page only draws what the server sends. If it cannot read, it says so in
   red. A photo that does not load says so instead of leaving a blank square.

   "In the box" ticks and the box label (13 Oct 2026, 22:00): a tick per
   product, shared with the Sea Diva dashboard, and a button that fetches one
   order's name, phone and address for writing on the box.

   One thing writes (13 Oct 2026): "Packed, ready to ship". It needs two taps,
   POSTs to /api/business, and can be undone from the same card. The server
   moves the products to Ready to be shipped, moves the board job to Shipping
   and logs a done task on the To-Do.

   My work (14 Oct 2026): every product line that waits on Befa's own hands
   (Designer with TailCraft designs, ordering from third parties, fluke
   filler, crown, other things to make) and on the craftspeople (printing,
   sewing). Each line has Done buttons, two taps each, that move it along by
   her rulings; the server holds the list of allowed moves.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';
  var ROOT = 'biz-root';
  var S = { biz: 'seadiva', stage: 'all', ch: 'all', data: null, err: '', loading: false, at: null,
            arm: '', busy: '', flash: {}, addr: {}, noteEdit: '', noteDraft: {}, noteBusy: '', notice: null, visible: [], trackDraft: {},
            view: 'work', wtab: 'all', showLog: false };
  try { var v0 = localStorage.getItem('biz-view'); if (v0 === 'pack' || v0 === 'work') S.view = v0; } catch (e) { /* storage blocked */ }
  var CH = { shopify: 'Shopify', shopee: 'Shopee', toko: 'Tokopedia/TikTok', manual: 'Manual', tailcraft: 'TailCraft' };

  var BUSINESSES = [
    ['seadiva', 'Sea Diva'],
    ['academy', 'DiveArts Academy'],
    ['tailcraft', 'TailCraft'],
    ['productions', 'Productions']
  ];
  var STAGES = [
    ['all', 'All'],
    ['ready', 'Ready to pack'],
    ['partly', 'Partly ready'],
    ['production', 'In production'],
    ['not_set', 'No status yet'],
    ['packed', 'Packed, pickup or send?'],
    ['to_send', 'To send'],
    ['unpaid', 'Not paid yet'],
    ['old_no_status', 'Old, no status'],
    ['paperwork', 'Only paperwork left'],
    ['close_in_shopify', 'Close in Shopify']
  ];
  var STAGE_NOTE = {
    ready: 'Every product left on this invoice is ready. Pack it, then tap Packed, ready to ship.',
    packed: 'Packed. Does the customer pick it up, or do we send it?',
    to_send: 'Packed, going out by courier. Print or write the label below, then save the tracking code.',
    unpaid: 'Not paid yet, but production has started. Do not send before it is paid.',
    old_no_status: 'Older than 45 days with no production status. If it went out long ago, tap Already shipped. If not, set its status in the sheet.',
    partly: 'Some products are ready, the rest are still being made or bought.',
    production: 'Still being designed, made or bought.',
    not_set: 'Paid, but no production status is written in the sheet yet.',
    paperwork: 'Nothing physical is left, only lines like design fees or custom colour. Mark them DONE in the sheet.',
    close_in_shopify: 'Every product is DONE in the sheet, but Shopify still says unfulfilled. Mark it fulfilled in Shopify.',
    no_items: 'This Shopify order has no products in the sheet.'
  };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(ymd) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1] : ''; }
  function ago(iso) {
    if (!iso) return 'unknown';
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!isFinite(mins)) return 'unknown';
    if (mins < 2) return 'just now';
    if (mins < 90) return mins + ' min ago';
    var h = Math.round(mins / 60);
    return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
  }
  function hhmm(d) { try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit' }).format(d); } catch (e) { return ''; } }
  function headers() { return (typeof osHeaders === 'function') ? osHeaders() : {}; }

  function css() {
    if (document.getElementById('biz-css')) return;
    var s = document.createElement('style');
    s.id = 'biz-css';
    s.textContent =
      '.biz-nav{display:flex;gap:8px;flex-wrap:wrap;margin:18px 2px 6px}' +
      '.biz-chip{font:600 12.5px var(--sans);color:var(--muted);background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:999px;padding:7px 13px;cursor:pointer}' +
      '.biz-chip.on{color:#04121f;background:var(--aqua);border-color:var(--aqua)}' +
      '.biz-chip i{font-style:normal;opacity:.7;margin-left:4px}' +
      '.biz-sub{display:flex;gap:6px;flex-wrap:wrap;margin:8px 2px}' +
      '.biz-sub .biz-chip{padding:5px 11px;font-size:12px}' +
      '.biz-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:14px 4px 4px}' +
      '.biz-head h3{margin:0;font:600 19px var(--serif);color:var(--ink)}' +
      '.biz-head button{background:none;border:1px solid var(--line);border-radius:8px;color:var(--aqua);font:600 12px var(--sans);padding:6px 10px;cursor:pointer}' +
      '.biz-fresh{font:12.5px/1.5 var(--sans);color:var(--muted);margin:2px 4px 8px}' +
      '.biz-warn{font:13px/1.45 var(--sans);color:#ffd27f;border:1px solid rgba(255,210,127,.35);background:rgba(255,210,127,.06);border-radius:10px;padding:9px 12px;margin:6px 2px}' +
      '.biz-err{font:13px/1.45 var(--sans);color:#ff8fa3;border:1px solid rgba(255,107,129,.4);background:rgba(255,107,129,.06);border-radius:10px;padding:10px 12px;margin:10px 2px}' +
      '.biz-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin:8px 2px 4px}' +
      '.biz-tile{background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:12px;padding:10px 12px;cursor:pointer;text-align:left;color:var(--ink)}' +
      '.biz-tile b{display:block;font:600 24px var(--serif);color:var(--aqua)}' +
      '.biz-tile span{font:12px var(--sans);color:var(--muted)}' +
      '.biz-tile.on{border-color:var(--aqua);box-shadow:var(--glowsoft)}' +
      '.biz-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-top:12px}' +
      '.biz-card{background:linear-gradient(160deg,rgba(12,42,62,.44),rgba(5,20,32,.52));border:1px solid rgba(46,230,255,.16);border-radius:16px;padding:14px;color:var(--ink);min-width:0}' +
      '.biz-card.st-ready{border-color:rgba(95,194,126,.55);box-shadow:inset 4px 0 0 #5fc27e}' +
      '.biz-card.st-close_in_shopify{border-color:rgba(255,210,127,.45)}' +
      '.biz-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
      '.biz-inv{font:700 15px var(--sans);letter-spacing:.2px}' +
      '.biz-badge{font:700 10.5px var(--sans);letter-spacing:.6px;text-transform:uppercase;padding:3px 7px;border-radius:6px;background:rgba(46,230,255,.12);color:var(--aquasoft)}' +
      '.biz-badge.manual{background:rgba(190,150,255,.14);color:#d9c6ff}' +
      '.biz-stage{margin-left:auto;font:600 11px var(--sans);padding:3px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}' +
      '.biz-stage.ready{color:#7ee0a0;border-color:rgba(126,224,160,.5)}' +
      '.biz-stage.close_in_shopify{color:#ffd27f;border-color:rgba(255,210,127,.45)}' +
      '.biz-who{font:600 14px var(--sans);margin:6px 0 1px}' +
      '.biz-meta{font:12px var(--sans);color:var(--muted)}' +
      '.biz-note{font:12px/1.4 var(--sans);color:var(--muted);margin:6px 0 2px;font-style:italic}' +
      '.biz-line{display:flex;gap:11px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line)}' +
      '.biz-line:first-of-type{margin-top:8px}' +
      '.biz-ph{flex:0 0 76px;width:76px;height:76px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--line);overflow:hidden;display:flex;align-items:center;justify-content:center;text-align:center;font:10.5px/1.25 var(--sans);color:var(--dim);padding:0}' +
      '.biz-ph img{width:100%;height:100%;object-fit:cover;display:block}' +
      'a.biz-ph{cursor:zoom-in}' +
      '.biz-it{min-width:0;flex:1}' +
      '.biz-it .t{font:600 13.5px/1.35 var(--sans);word-wrap:break-word}' +
      '.biz-it .d{font:12px/1.35 var(--sans);color:var(--muted)}' +
      '.biz-it .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:5px}' +
      '.biz-q{font:700 12px var(--sans);color:var(--ink);background:rgba(255,255,255,.06);border-radius:6px;padding:2px 7px}' +
      '.biz-s{font:600 11px var(--sans);border-radius:6px;padding:2px 7px;background:rgba(255,255,255,.05);color:var(--muted)}' +
      '.biz-s.ready,.biz-s.shipping{background:rgba(95,194,126,.16);color:#9fe8b6}' +
      '.biz-s.design_todo,.biz-s.design_wip{background:rgba(255,160,200,.13);color:#ffc2da}' +
      '.biz-s.third_todo,.biz-s.third_ordered{background:rgba(255,210,127,.13);color:#ffd99a}' +
      '.biz-s.making{background:rgba(46,230,255,.12);color:var(--aquasoft)}' +
      '.biz-s.blank{background:rgba(255,107,129,.10);color:#ffa3b3}' +
      '.biz-s.mark{background:rgba(255,210,127,.16);color:#ffd99a;border:1px dashed rgba(255,210,127,.5)}' +
      '.biz-pnote{font:11px var(--sans);color:var(--dim)}' +
      '.biz-foot{font:12px var(--sans);color:var(--dim);margin-top:6px}' +
      '.biz-badge.shopee{background:rgba(255,120,60,.16);color:#ffb08a}' +
      '.biz-badge.toko{background:rgba(95,194,126,.16);color:#9fe8b6}' +
      '.biz-badge.tailcraft{background:rgba(206,160,255,.16);color:#dcc2ff}' +
      '.biz-card.st-packed{border-style:dashed}' +
      '.biz-stage.to_send{color:#8fd3ff;border-color:rgba(143,211,255,.5)}' +
      '.biz-hand{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}' +
      '.biz-go{flex-direction:column;align-items:stretch}.biz-golead{font:600 13px var(--sans);color:#9fe8b6}' +
      '.biz-pack.alt{background:#8fd3ff}.biz-pack.alt.arm{background:#ffd27f}' +
      '.biz-track{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}' +
      '.biz-track input{flex:1 1 180px;min-width:0;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--ink);font:14px var(--sans);padding:9px 11px}' +
      '.biz-hand button{font:700 13px var(--sans);border-radius:10px;padding:10px 14px;cursor:pointer;border:1px solid rgba(143,211,255,.55);background:rgba(143,211,255,.12);color:#cfeaff}' +
      '.biz-hand button.arm{background:#ffd27f;color:#04121f;border-color:#ffd27f}' +
      '.biz-hand .now{font:600 12px var(--sans);color:#8fd3ff;align-self:center}' +
      '.biz-hand .chg{font:600 11.5px var(--sans);padding:5px 9px;border-radius:7px;background:none;color:var(--aqua);border:1px solid var(--line)}' +
      '.biz-notice{font:13px/1.45 var(--sans);border-radius:10px;padding:9px 11px;margin:10px 2px;background:rgba(143,211,255,.1);border:1px solid rgba(143,211,255,.4);color:#cfeaff}' +
      '.biz-notice button{margin-left:8px}' +
      '.biz-stage.packed{color:#9fe8b6;border-color:rgba(126,224,160,.35)}' +
      '.biz-due{font:600 12px var(--sans);color:var(--muted)}' +
      '.biz-due.late{color:#ff8fa3}.biz-due.soon{color:#ffd27f}' +
      '.biz-act{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}' +
      '.biz-pack{font:700 13px var(--sans);color:#04121f;background:#7ee0a0;border:0;border-radius:10px;padding:10px 14px;cursor:pointer}' +
      '.biz-pack.arm{background:#ffd27f}' +
      '.biz-pack.small{font-size:11.5px;padding:5px 9px;border-radius:7px;background:rgba(126,224,160,.18);color:#9fe8b6;border:1px solid rgba(126,224,160,.45)}' +
      '.biz-pack.small.arm{background:#ffd27f;color:#04121f}' +
      '.biz-pack[disabled]{opacity:.55;cursor:wait}' +
      '.biz-undo{font:600 11.5px var(--sans);color:var(--aqua);background:none;border:1px solid var(--line);border-radius:7px;padding:4px 8px;cursor:pointer}' +
      '.biz-packed{font:600 11px var(--sans);border-radius:6px;padding:2px 7px;background:rgba(95,194,126,.22);color:#9fe8b6}' +
      '.biz-sheet{font:11px/1.35 var(--sans);color:var(--dim);flex-basis:100%}' +
      '.biz-sheet.todo{color:#ffd99a}' +
      '.biz-flash{font:12.5px/1.45 var(--sans);border-radius:10px;padding:8px 10px;margin-top:10px;background:rgba(95,194,126,.1);border:1px solid rgba(95,194,126,.35);color:#c9f3d6}' +
      '.biz-flash.bad{background:rgba(255,107,129,.08);border-color:rgba(255,107,129,.4);color:#ffb3c0}' +
      '.biz-box{flex:0 0 auto;width:30px;height:30px;margin-top:22px;border-radius:8px;border:2px solid rgba(126,224,160,.55);background:transparent;color:#04121f;font:900 17px/1 var(--sans);cursor:pointer;padding:0}' +
      '.biz-box.on{background:#7ee0a0;border-color:#7ee0a0}' +
      '.biz-line.inbox .biz-it .t{text-decoration:line-through;text-decoration-color:rgba(126,224,160,.7);opacity:.75}' +
      '.biz-boxcount{font:600 12px var(--sans);color:#9fe8b6;margin-top:8px}' +
      '.biz-addrbtn{font:600 12px var(--sans);color:var(--aqua);background:none;border:1px solid var(--line);border-radius:8px;padding:6px 10px;cursor:pointer;margin-top:8px}' +
      '.biz-label{margin-top:8px;padding:10px 12px;border-radius:10px;background:#f7f3ea;color:#16202a;font:15px/1.45 var(--sans)}' +
      '.biz-label b{font-size:17px}' +
      '.biz-label .ph{font:700 15px var(--sans);margin-top:2px}' +
      '.biz-label .miss{font:12.5px/1.4 var(--sans);color:#a3263a;margin-top:6px}' +
      '.biz-label .src{font:11px var(--sans);color:#6b6659;margin-top:6px}' +
      '.biz-label button{font:600 12px var(--sans);margin-top:8px;padding:5px 10px;border-radius:7px;border:1px solid #16202a;background:#fff;color:#16202a;cursor:pointer}' +
      '.biz-ship{font:600 12px var(--sans);color:var(--muted);background:none;border:1px solid var(--line);border-radius:8px;padding:6px 10px;cursor:pointer;margin:8px 0 0 8px}' +
      '.biz-ship.arm{color:#04121f;background:#ffd27f;border-color:#ffd27f}' +
      '.biz-shipped{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:10px 2px;font:13px/1.45 var(--sans)}' +
      '.biz-shipped h4{margin:0 0 6px;font:600 13px var(--sans);color:var(--ink)}' +
      '.biz-shipped .r{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:5px 0;border-top:1px solid var(--line)}' +
      '.biz-shipped .r:first-of-type{border-top:0}' +
      '.biz-shipped .h{font:12px var(--sans);color:#ffd99a;flex-basis:100%}' +
      '.biz-pnote2{margin-top:6px;padding:7px 9px;border-radius:8px;background:rgba(255,210,127,.12);border:1px solid rgba(255,210,127,.4);color:#ffe2a8;font:13px/1.4 var(--sans);white-space:pre-wrap;word-wrap:break-word}' +
      '.biz-pnote2 .w{display:block;font:11px var(--sans);color:var(--dim);margin-top:3px;white-space:normal}' +
      '.biz-notebtn{font:600 11.5px var(--sans);color:var(--aqua);background:none;border:0;padding:4px 0;cursor:pointer}' +
      '.biz-noteed{margin-top:6px}' +
      '.biz-noteed textarea{width:100%;box-sizing:border-box;min-height:64px;border-radius:8px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--ink);font:13px/1.4 var(--sans);padding:7px 9px}' +
      '.biz-noteed .b{display:flex;gap:8px;margin-top:6px}' +
      '.biz-noteed button{font:600 12px var(--sans);border-radius:7px;padding:5px 10px;cursor:pointer;border:1px solid var(--line);background:none;color:var(--ink)}' +
      '.biz-noteed button.save{background:#ffd27f;color:#04121f;border-color:#ffd27f}' +
      '.biz-empty{font:13.5px/1.5 var(--sans);color:var(--muted);padding:18px;border:1px dashed var(--line);border-radius:14px;margin-top:12px}' +
      '.biz-views{display:flex;gap:8px;margin:12px 2px 2px}' +
      '.biz-views button{flex:1;font:700 14px var(--sans);padding:11px 12px;border-radius:12px;cursor:pointer;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--muted);text-align:left}' +
      '.biz-views button b{display:block;font:600 22px var(--serif);color:var(--aqua)}' +
      '.biz-views button.on{border-color:var(--aqua);color:var(--ink);box-shadow:var(--glowsoft)}' +
      '.biz-wgroup{font:600 12px var(--sans);letter-spacing:.6px;text-transform:uppercase;color:var(--dim);margin:14px 4px 2px}' +
      '.biz-tile.wait b{color:#8fd3ff}' +
      '.biz-tile.zero{opacity:.55}' +
      '.biz-wsec{margin-top:14px}' +
      '.biz-wsec h4{margin:0 4px 2px;font:600 15px var(--serif);color:var(--ink)}' +
      '.biz-wsec .why{font:12px/1.45 var(--sans);color:var(--muted);margin:0 4px 6px}' +
      '.biz-witem{display:flex;gap:11px;align-items:flex-start;background:linear-gradient(160deg,rgba(12,42,62,.44),rgba(5,20,32,.52));border:1px solid rgba(46,230,255,.16);border-radius:14px;padding:11px;margin:8px 0;min-width:0}' +
      '.biz-witem.tc{border-color:rgba(206,160,255,.35)}' +
      '.biz-witem .m{font:12px/1.4 var(--sans);color:var(--muted);margin-top:3px}' +
      '.biz-witem .m b{color:var(--ink)}' +
      '.biz-wbtns{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}' +
      '.biz-wbtn{font:700 12.5px var(--sans);border-radius:10px;padding:9px 12px;cursor:pointer;border:1px solid rgba(126,224,160,.55);background:rgba(126,224,160,.14);color:#c9f3d6}' +
      '.biz-wbtn.alt{border-color:var(--line);background:none;color:var(--muted)}' +
      '.biz-wbtn.arm{background:#ffd27f;color:#04121f;border-color:#ffd27f}' +
      '.biz-wbtn[disabled]{opacity:.55;cursor:wait}' +
      '.biz-unpaid{font:700 10.5px var(--sans);letter-spacing:.4px;text-transform:uppercase;padding:2px 6px;border-radius:6px;background:rgba(255,107,129,.14);color:#ffa3b3}' +
      '.biz-stale{font:11.5px/1.4 var(--sans);color:#ffd99a;margin-top:3px}' +
      '@media (max-width:420px){.biz-list{grid-template-columns:1fr}.biz-ph{flex-basis:64px;width:64px;height:64px}}';
    document.head.appendChild(s);
  }

  function nav() {
    return '<div class="biz-nav">' + BUSINESSES.map(function (b) {
      return '<button class="biz-chip' + (S.biz === b[0] ? ' on' : '') + '" data-biz="' + b[0] + '">' + esc(b[1]) + '</button>';
    }).join('') + '</div>';
  }

  function notYet(name) {
    return '<div class="biz-empty"><b>' + esc(name) + '</b> is not connected to this tab yet. Sea Diva comes first. ' +
      'Tell Claude which numbers you want to see here and where they live, and it will be built the same way.</div>';
  }

  function when(iso) {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
    catch (e) { return ''; }
  }
  /* What the sheet says about a packed line, in plain words. */
  function sheetNote(o, l) {
    var k = l.packed;
    if (k.write === 'queued') {
      if (k.written) return ['', 'Sheet updated to Ready to be shipped.'];
      if (k.writeError) return ['todo', 'The sheet was not changed: ' + k.writeError + ' Change it by hand.'];
      return ['', 'The sheet changes to Ready to be shipped within the hour.'];
    }
    if (k.write === 'person_word') return ['todo', 'The sheet says "' + (l.status || 'something else') + '", a word the writer never overwrites. Change it to Ready to be shipped by hand.'];
    if (k.write === 'waiting_bridge') return ['todo', 'The ' + CH[o.channel] + ' tab cannot be written automatically yet. Set Ready to be shipped in the sheet by hand for now.'];
    return ['', ''];
  }

  function lineHtml(o, l, packable) {
    var p = l.photo, ph;
    if (p && p.url) {
      ph = '<a class="biz-ph" href="' + esc(p.url) + '" target="_blank" rel="noopener" title="Open the full photo">' +
        '<img loading="lazy" referrerpolicy="no-referrer" alt="' + esc(l.title) + '" src="' + esc(p.url) + '" ' +
        'onerror="this.parentNode.outerHTML=\'<div class=&quot;biz-ph&quot;>photo did not load</div>\'"></a>';
    } else {
      ph = '<div class="biz-ph">no shop photo</div>';
    }
    var pnote = '';
    if (p) {
      pnote = p.how === 'product' ? '<span class="biz-pnote">check colour and size</span>' : '';
    }
    var detail = (l.detail || []).map(function (d) { return '<div class="d">' + esc(d) + '</div>'; }).join('');
    /* A note on this product (e.g. size or colour changed after checkout). */
    var nid = o.src + '|' + o.invoice + '|' + l.slot, noteHtml = '';
    if (S.noteEdit === nid) {
      var draft = Object.prototype.hasOwnProperty.call(S.noteDraft, nid) ? S.noteDraft[nid] : (l.note ? l.note.text : '');
      noteHtml = '<div class="biz-noteed"><textarea data-note-input="' + esc(nid) + '" maxlength="1000" placeholder="e.g. Customer changed to size M after checkout">' + esc(draft) + '</textarea>' +
        '<div class="b"><button class="save" data-note-save="' + esc(nid) + '"' + (S.noteBusy ? ' disabled' : '') + '>' + (S.noteBusy === nid ? 'Saving…' : 'Save note') + '</button>' +
        '<button data-note-cancel="' + esc(nid) + '">Cancel</button></div></div>';
    } else if (l.note) {
      noteHtml = '<div class="biz-pnote2">' + esc(l.note.text) + '<span class="w">Note' + (l.note.by ? ' by ' + esc(l.note.by) : '') + (l.note.at ? ' · ' + esc(when(l.note.at)) : '') + '</span></div>' +
        '<button class="biz-notebtn" data-note-edit="' + esc(nid) + '">Edit note</button>';
    } else {
      noteHtml = '<button class="biz-notebtn" data-note-edit="' + esc(nid) + '">+ Add note</button>';
    }
    detail += noteHtml;
    var pack = '';
    if (l.packed) {
      var sn = sheetNote(o, l);
      pack = '<span class="biz-packed">Packed' + (l.packed.by ? ' by ' + esc(l.packed.by) : '') + ' · ' + esc(when(l.packed.at)) + '</span>' +
        '<button class="biz-undo" data-undo-mark="' + esc(l.packed.id) + '">Undo</button>' +
        (sn[1] ? '<span class="biz-sheet ' + sn[0] + '">' + esc(sn[1]) + '</span>' : '');
    } else if (l.canPack && packable > 1) {
      var id = o.src + '|' + o.invoice + '|' + l.slot;
      pack = '<button class="biz-pack small' + (S.arm === id ? ' arm' : '') + '" data-pack="' + esc(id) + '"' + (S.busy ? ' disabled' : '') + '>' +
        (S.arm === id ? 'Tap again to confirm' : 'Pack only this') + '</button>';
    }
    /* "In the box": tick each product as it goes into the box. Shared with
       the Sea Diva dashboard. Only physical products that are not done. */
    var box = '';
    if (l.physical && l.group !== 'done' && l.group !== 'ignore') {
      var tid = o.src + '|' + o.invoice + '|' + l.slot;
      box = '<button class="biz-box' + (l.inBox ? ' on' : '') + '" data-tick="' + esc(tid) + '" title="' +
        (l.inBox ? 'In the box' + (l.inBox.by ? ' (ticked by ' + esc(l.inBox.by) + ')' : '') + '. Tap to untick.' : 'Tap when this is in the box') +
        '" aria-pressed="' + (l.inBox ? 'true' : 'false') + '">' + (l.inBox ? '✓' : '') + '</button>';
    }
    return '<div class="biz-line' + (l.inBox ? ' inbox' : '') + '">' + box + ph + '<div class="biz-it"><div class="t">' + esc(l.title) + '</div>' + detail +
      '<div class="row">' + (l.qty ? '<span class="biz-q">× ' + esc(l.qty) + '</span>' : '<span class="biz-q">qty not written</span>') +
      (l.packed ? '' : '<span class="biz-s ' + esc(l.group) + '">' + esc(l.status || 'no status') + '</span>') +
      (l.markDone ? '<span class="biz-s mark">not a physical item, mark DONE</span>' : '') + pnote + pack + '</div></div></div>';
  }

  function labelText(d) {
    return [d.name || '', d.phone || ''].concat(d.lines || []).filter(Boolean).join('\n');
  }
  function labelHtml(d, key) {
    if (d.marketplace) return '<div class="biz-label">' + esc(d.note) + ' <button data-addr-hide="' + esc(key) + '">Hide</button></div>';
    var miss = (d.missing || []).map(function (m) {
      return m === 'address' ? 'The address is not in the sheet. Ask the customer before you seal the box, and write it in the sheet.'
                             : 'No phone number in the sheet or the contacts book.';
    });
    return '<div class="biz-label">' + (d.name ? '<b>' + esc(d.name) + '</b>' : '') +
      (d.phone ? '<div class="ph">' + esc(d.phone) + '</div>' : '') +
      (d.lines || []).map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') +
      miss.map(function (m) { return '<div class="miss">' + esc(m) + '</div>'; }).join('') +
      '<div class="src">From: ' + esc(d.from || 'sheet') + '</div>' +
      '<button data-addr-print="' + esc(key) + '">Print label</button> <button data-addr-copy="' + esc(key) + '">Copy</button> <button data-addr-hide="' + esc(key) + '">Hide</button></div>';
  }
  /* A printable shipping label: big name, phone and address, one page. */
  function printLabel(key) {
    var A = S.addr[key];
    if (!A || !A.data) return;
    var d = A.data, i = key.lastIndexOf('|'), inv = key.slice(i + 1);
    var w = window.open('', '_blank');
    if (!w) { S.flash[key] = { text: 'The browser blocked the print window. Allow pop-ups for this site, or use Copy.', bad: true }; render(); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Label ' + esc(inv) + '</title><style>' +
      'body{font:18px/1.45 Arial,sans-serif;margin:24px;color:#000}.box{border:2px solid #000;border-radius:8px;padding:18px 20px;max-width:420px}' +
      '.to{font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px}.n{font-size:24px;font-weight:700}.p{font-size:20px;font-weight:700;margin:2px 0 8px}' +
      '.inv{margin-top:12px;font-size:12px;color:#444}.from{margin-top:14px;font-size:13px;border-top:1px dashed #000;padding-top:8px}' +
      '@media print{body{margin:0}}</style></head><body><div class="box"><div class="to">Ship to</div>' +
      (d.name ? '<div class="n">' + esc(d.name) + '</div>' : '') + (d.phone ? '<div class="p">' + esc(d.phone) + '</div>' : '') +
      (d.lines || []).map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') +
      '<div class="inv">Order ' + esc(inv) + '</div><div class="from">From: Sea Diva Tails</div></div>' +
      '<script>window.onload=function(){window.print();}<\/script></body></html>');
    w.document.close();
  }

  function dueHtml(o) {
    if (o.shipByDays == null) return o.shipByText ? ' · ship by ' + esc(o.shipByText) : '';
    var n = o.shipByDays, cls = n < 0 ? 'late' : (n <= 1 ? 'soon' : '');
    var t = n < 0 ? (-n) + (n === -1 ? ' day' : ' days') + ' late' : (n === 0 ? 'today' : (n === 1 ? 'tomorrow' : 'in ' + n + ' days'));
    return ' · <span class="biz-due ' + cls + '">ship by ' + esc(day(o.shipBy)) + ', ' + t + '</span>';
  }

  /* Everything ticked in the box (Befa, 13 Oct 23:44): then the big button
     packs every product, whatever the sheet still says, so pickup or send
     follows straight away. Worked out on each draw, so a tick counts at once. */
  function boxAllIn(o) {
    var phys = o.lines.filter(function (l) { return l.physical && l.group !== 'done' && l.group !== 'ignore'; });
    return phys.length > 0 && phys.every(function (l) { return l.inBox || l.packed; });
  }
  function cardHtml(o) {
    var dated = o.date ? day(o.date) + (o.days != null ? ' · ' + o.days + ' days ago' : '') : (o.dateText || 'no date');
    var packable = o.lines.filter(function (l) { return l.canPack; });
    /* The big button packs only what the sheet says is ready. Anything else
       can still be packed one by one, on purpose. */
    var boxAll = boxAllIn(o);
    var ready = packable.filter(function (l) { return l.group === 'ready' || l.group === 'shipping' || boxAll; });
    var key = o.src + '|' + o.invoice;
    var act = '';
    if (boxAll && packable.length) {
      /* Everything is in the box (Befa, 14 Oct 00:21): one step, packed
         and sent or picked up. */
      var gs = 'go:' + key + '|send', gp = 'go:' + key + '|pickup';
      act = '<div class="biz-act biz-go"><div class="biz-golead">Everything is in the box. How does it leave?</div>' +
        '<button class="biz-pack' + (S.arm === gs ? ' arm' : '') + '" data-packgo="' + esc(key + '|send') + '"' + (S.busy ? ' disabled' : '') + '>' +
        (S.busy === key ? 'Saving…' : (S.arm === gs ? 'Tap again: packed, we send it' : 'We send it')) + '</button>' +
        '<button class="biz-pack alt' + (S.arm === gp ? ' arm' : '') + '" data-packgo="' + esc(key + '|pickup') + '"' + (S.busy ? ' disabled' : '') + '>' +
        (S.arm === gp ? 'Tap again: packed, customer picks it up' : 'Customer picks it up at the studio') + '</button></div>';
    } else if (ready.length) {
      var all = key + '|*';
      act = '<div class="biz-act"><button class="biz-pack' + (S.arm === all ? ' arm' : '') + '" data-pack="' + esc(all) + '"' + (S.busy ? ' disabled' : '') + '>' +
        (S.busy === key ? 'Saving…' : (S.arm === all ? 'Tap again to confirm' : 'Packed, ready to ship' +
          (ready.length < packable.length ? ' (the ' + ready.length + ' ready)' : (boxAll && ready.length > 1 ? ' (all ' + ready.length + ' in the box)' : (ready.length > 1 ? ' (' + ready.length + ' products)' : ''))))) +
        '</button></div>';
    }
    var f = S.flash[key];
    if (f) {
      act += '<div class="biz-flash' + (f.bad ? ' bad' : '') + '">' + esc(f.text) +
        (f.click ? ' <button class="biz-undo" data-undo-click="' + esc(f.click) + '">Undo</button>' : '') + '</div>';
    }
    /* In the box count, and the box label on request. */
    var boxable = o.lines.filter(function (l) { return l.physical && l.group !== 'done' && l.group !== 'ignore'; });
    var inBox = boxable.filter(function (l) { return l.inBox; }).length;
    var boxLine = boxable.length && inBox ? '<div class="biz-boxcount">' + inBox + ' of ' + boxable.length + ' in the box' +
      (inBox === boxable.length ? '. Everything is in.' : '') + '</div>' : '';
    var A = S.addr[key], label = '';
    if (!A) label = '<button class="biz-addrbtn" data-addr="' + esc(key) + '">Name, phone and address for the box</button>';
    else if (A.loading) label = '<div class="biz-label">Loading…</div>';
    else if (A.err) label = '<div class="biz-label"><div class="miss">' + esc(A.err) + '</div><button data-addr="' + esc(key) + '">Try again</button></div>';
    else label = labelHtml(A.data, key);
    /* Already shipped: for orders that are finished but the sheet still
       shows them. Two taps, undoable from the list at the top. */
    var sid = key;
    act = label + boxLine + act + '<button class="biz-ship' + (S.arm === 'ship:' + sid ? ' arm' : '') + '" data-ship="' + esc(sid) + '"' + (S.busy ? ' disabled' : '') + '>' +
      (S.arm === 'ship:' + sid ? 'Tap again: already shipped' : (o.stage === 'to_send' ? 'Courier has it, mark DONE' : 'Already shipped, mark DONE')) + '</button>';
    /* Pickup or send, once every product is packed (Befa, 13 Oct 22:27). */
    var hand = '';
    if (o.stage === 'packed') {
      var pk = 'hand:' + key + '|pickup';
      hand = '<div class="biz-hand"><button data-hand="' + esc(key + '|pickup') + '" class="' + (S.arm === pk ? 'arm' : '') + '"' + (S.busy ? ' disabled' : '') + '>' +
        (S.arm === pk ? 'Tap again: leaves this tab, goes to Sea Diva' : 'Customer picks it up') + '</button>' +
        '<button data-hand="' + esc(key + '|send') + '"' + (S.busy ? ' disabled' : '') + '>We send it</button></div>';
    } else if (o.stage === 'to_send') {
      var tv = Object.prototype.hasOwnProperty.call(S.trackDraft, key) ? S.trackDraft[key] : ((o.handoff && o.handoff.tracking) || '');
      var ta = 'track:' + key;
      hand = '<div class="biz-hand"><span class="now">Going by courier' + (o.handoff && o.handoff.by ? ', set by ' + esc(o.handoff.by) : '') + '.</span>' +
        '<button class="chg" data-hand="' + esc(key + '|none') + '"' + (S.busy ? ' disabled' : '') + '>Change</button></div>' +
        '<div class="biz-track"><input data-track-input="' + esc(key) + '" placeholder="Tracking code (resi)" value="' + esc(tv) + '" maxlength="120">' +
        '<button class="biz-pack' + (S.arm === ta ? ' arm' : '') + '" data-track-save="' + esc(key) + '"' + (S.busy ? ' disabled' : '') + '>' +
        (S.arm === ta ? 'Tap again: sent, mark DONE' : 'Save tracking, mark sent') + '</button></div>';
    }
    act = hand + act;
    var after = '';
    if ((o.stage === 'packed' || o.stage === 'to_send') && o.channel === 'tailcraft') {
      after = ' Once it is sent, tap Courier has it, mark DONE. That moves the TailCraft project to Shipped.';
    } else if (o.stage === 'packed' || o.stage === 'to_send') {
      after = o.channel === 'shopify' ? ' Once it is sent, mark it fulfilled in Shopify and DONE in the sheet.'
        : (o.channel === 'manual' ? ' Once it is sent, tick Shipped and set DONE in the sheet.' : ' Once the courier has it, set DONE in the sheet.');
    }
    var stageLabel = (STAGES.filter(function (s) { return s[0] === o.stage; })[0] || [0, 'No products'])[1];
    var pay = o.channel === 'manual' && o.pay === 'part' ? ' · ' + esc(o.payText) : '';
    return '<div class="biz-card sensitive st-' + esc(o.stage) + '" data-key="' + esc(key) + '">' +
      '<div class="biz-top"><span class="biz-inv">' + esc(o.invoice) + '</span>' +
      '<span class="biz-badge ' + esc(o.channel) + '">' + esc(CH[o.channel] || o.channel) + '</span>' +
      '<span class="biz-stage ' + esc(o.stage) + '">' + esc(stageLabel) + '</span></div>' +
      '<div class="biz-who">' + esc(o.customer || 'no name') + '</div>' +
      '<div class="biz-meta">' + esc(dated) + (o.country ? ' · ships to ' + esc(o.country) : '') + pay + dueHtml(o) + '</div>' +
      (STAGE_NOTE[o.stage] && o.stage !== 'production' ? '<div class="biz-note">' + esc(STAGE_NOTE[o.stage] + after) + '</div>' : '') +
      o.lines.map(function (l) { return lineHtml(o, l, ready.length === packable.length ? packable.length : 2); }).join('') + act +
      (o.doneCount ? '<div class="biz-foot">' + o.doneCount + ' of ' + o.lineCount + ' products on this invoice are already DONE and hidden.</div>' : '') +
      '</div>';
  }

  function seadiva() {
    var h = '<div class="biz-head"><h3>Sea Diva · orders to finish</h3><button data-act="refresh">' + (S.loading ? 'Loading…' : 'Refresh') + '</button></div>';
    if (S.err) return h + '<div class="biz-err">' + esc(S.err) + '</div>';
    var d = S.data;
    if (!d) return h + '<div class="biz-fresh">Loading the order list…</div>';

    var src = d.sources || {}, warn = '';
    var fresh = 'Sheet copies: Manual ' + ago(src.manual && src.manual.loadedAt) + ', Shopify ' + ago(src.shopify && src.shopify.loadedAt) +
      ', Shopee ' + ago(src.shopee && src.shopee.loadedAt) + ', Tokopedia/TikTok ' + ago(src.toko && src.toko.loadedAt) + '.';
    if (S.at) fresh += ' Page read at ' + hhmm(S.at) + ' WITA.';
    ['shopify', 'shopee', 'toko', 'manual'].forEach(function (k) {
      if (src[k] && !src[k].ok) warn += '<div class="biz-err">' + esc(CH[k] + ' could not be read: ' + src[k].error) + '</div>';
    });
    if (d.todo && d.todo.error) warn += '<div class="biz-warn">To-Do logging: ' + esc(d.todo.error) + '</div>';
    var nw = src.shopify && src.shopify.newest;
    if (nw && nw.date) {
      var age = Math.round((Date.now() - new Date(nw.date + 'T00:00:00+08:00').getTime()) / 86400000);
      if (age > 7) {
        warn += '<div class="biz-warn">The newest Shopify order in the sheet is ' + esc(nw.invoice) + ' from ' + esc(day(nw.date)) + ', ' + age +
          ' days ago. If anyone has ordered on seadivatails.com since then, that order is not on this list until the Shopify to sheet sync catches up. Check Shopify itself before you assume nothing is waiting.</div>';
      }
    }
    if (d.photosNote) warn += '<div class="biz-warn">' + esc(d.photosNote) + ' Orders are complete, only some photos are missing.</div>';

    var c = d.counts || {}, photoLine0 = '';
    if (S.stage !== 'all' && !c[S.stage]) S.stage = 'all';
    var tiles = '<div class="biz-tiles">' + STAGES.map(function (s) {
      var n = s[0] === 'all' ? c.all : c[s[0]];
      if (s[0] !== 'all' && !n) return '';
      return '<button class="biz-tile' + (S.stage === s[0] ? ' on' : '') + '" data-stage="' + s[0] + '"><b>' + (n || 0) + '</b><span>' + esc(s[1]) + '</span></button>';
    }).join('') + '</div>';
    var chans = '<div class="biz-sub">' + [['all', 'All shops'], ['shopify', 'Shopify'], ['shopee', 'Shopee'], ['toko', 'Tokopedia/TikTok'], ['manual', 'Manual'], ['tailcraft', 'TailCraft']].map(function (x) {
      var n = x[0] === 'all' ? c.all : c[x[0]];
      if (x[0] !== 'all' && !n) return '';
      return '<button class="biz-chip' + (S.ch === x[0] ? ' on' : '') + '" data-ch="' + x[0] + '">' + esc(x[1]) + '<i>' + (n || 0) + '</i></button>';
    }).join('') + '</div>';

    var list = (d.orders || []).filter(function (o) {
      return ((S.stage === 'all' && o.stage !== 'old_no_status') || o.stage === S.stage) && (S.ch === 'all' || o.channel === S.ch);
    });
    var shipBox = '';
    /* Finished orders leave the list. Only a one-line count stays, folded,
       so Undo is still possible for three days (Befa, 13 Oct 23:11). */
    if ((d.shipped || []).length && !S.showShipped) {
      shipBox = '<div class="biz-fresh">' + d.shipped.length + (d.shipped.length === 1 ? ' order' : ' orders') +
        ' marked shipped in the last 3 days, off the list. <button class="biz-undo" data-act="show-shipped">Show to undo</button></div>';
    } else if ((d.shipped || []).length) {
      shipBox = '<div class="biz-shipped"><h4>Marked already shipped, last 3 days <button class="biz-undo" data-act="hide-shipped">Hide</button></h4>' + d.shipped.map(function (k) {
        return '<div class="r"><b>' + esc(k.invoice) + '</b> <span>' + esc(CH[{ 'MANUAL (IG & WA) - OL': 'manual', 'SHOPIFY-OL': 'shopify', 'SHOPEE - OL': 'shopee', 'TOKOPEDIA/TIKTOK shop -OL': 'toko', 'TAILCRAFT': 'tailcraft' }[k.src]] || '') +
          (k.customer ? ' · ' + esc(k.customer) : '') + ' · ' + esc(when(k.at)) + (k.tracking ? ' · resi ' + esc(k.tracking) : '') + '</span>' +
          '<button class="biz-undo" data-unship="' + esc(k.id) + '">Undo</button>' +
          (k.byHand ? '<span class="h">Set DONE by hand in the sheet for ' + k.byHand + (k.byHand === 1 ? ' product' : ' products') +
            (k.src === 'MANUAL (IG & WA) - OL' ? ' (their status is a word the writer never overwrites).' : ' (this tab cannot be written automatically yet).') +
            (k.src === 'SHOPIFY-OL' ? ' Also mark it fulfilled in Shopify.' : '') + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    }
    var body = list.length ? '<div class="biz-list">' + list.map(cardHtml).join('') + '</div>'
      : '<div class="biz-empty">' + (c.all ? 'Nothing in this filter.' : 'No paid order is waiting. Every paid order in the sheet is done or shipped.') + '</div>';
    if (c.packedToday) photoLine0 = '<div class="biz-fresh">Packed today: ' + c.packedToday + (c.packedToday === 1 ? ' product.' : ' products.') + ' Each pack is a done task on your To-Do.</div>';
    var photoLine = c.lines ? '<div class="biz-fresh">' + c.photos + ' of ' + c.lines + ' products have a photo, all from seadivatails.com. ' +
      'A photo marked "check colour and size" shows the right product, but maybe not the colour ordered. Custom pieces and items not on the shop have no photo.</div>' : '';
    if (c.markDone) photoLine += '<div class="biz-warn">' + c.markDone + (c.markDone === 1 ? ' line is' : ' lines are') +
      ' not a physical item but still open on a paid order (design fee, custom colour and similar). Your rule: mark these DONE in the sheet once the invoice is paid. They no longer hold an order out of Ready to pack.</div>';
    S.visible = list.filter(function (o) { return o.stage === 'to_send'; }).map(function (o) { return o.src + '|' + o.invoice; });
    var notice = '';
    if (S.notice) notice = '<div class="biz-notice">' + esc(S.notice.text) +
      (S.notice.undo ? '<button class="biz-undo" data-hand="' + esc(S.notice.undo + '|none') + '">Undo</button>' : '') +
      (S.notice.unship ? '<button class="biz-undo" data-unship="' + esc(S.notice.unship) + '">Undo</button>' : '') +
      (S.notice.wundo ? '<button class="biz-undo" data-wundo="' + esc(S.notice.wundo) + '">Undo</button>' : '') + '</div>';
    if (c.pickupHidden) notice += '<div class="biz-fresh">' + c.pickupHidden + (c.pickupHidden === 1 ? ' packed order is' : ' packed orders are') +
      ' waiting for the customer to pick up. They are on the Sea Diva dashboard only, Pack and ship, Waiting for pickup.</div>';
    var W = d.work || null, wc = (W && W.counts) || {};
    var views = '<div class="biz-views">' +
      '<button data-view="work" class="' + (S.view === 'work' ? 'on' : '') + '"><b>' + (W ? wc.mine : '?') + '</b>My work' +
        (W && wc.waiting ? ' · ' + wc.waiting + ' waiting on others' : '') + '</button>' +
      '<button data-view="pack" class="' + (S.view === 'pack' ? 'on' : '') + '"><b>' + (c.ready || 0) + '</b>Pack &amp; ship · ready to pack</button></div>';
    if (S.view === 'work') return h + '<div class="biz-fresh">' + esc(fresh) + '</div>' + warn + notice + views + workHtml(d);
    return h + '<div class="biz-fresh">' + esc(fresh) + '</div>' + warn + notice + views + tiles + chans + photoLine0 + photoLine + shipBox + body;
  }

  /* ---------------------------------------------------------------------
     My work (14 Oct 2026)
  --------------------------------------------------------------------- */
  var WORK_TILES = [
    ['design', 'Designer', 'Sea Diva and TailCraft designs to make. Done sends a Sea Diva design to Printing; a TailCraft design to Design options sent.'],
    ['order', 'To order, 3rd party', 'Paid products bought from a supplier. Once you have ordered, tap Bought, now ordered.'],
    ['ordered', 'Ordered, arriving', 'Ordered from the supplier. When it arrives, tap Arrived and it moves to Pack and ship.'],
    ['fluke', 'Fluke filler', 'Fluke fillers to make. Done moves the product to Ready to be shipped.'],
    ['crown', 'Crown', 'Crowns to make. Done moves the product to Ready to be shipped.'],
    ['make', 'Other to make', 'Status Need to Create or In the Making. Done moves the product to Ready to be shipped.']
  ];
  var WAIT_TILES = [
    ['printing', 'Printing · Timur Jaya', 'At the printer. When the print is back, send it to sewing or straight to ready.'],
    ['sewing', 'Sewing · Pak Supri', 'With the tailor. When it is sewn, tap Sewn, ready to pack.']
  ];
  function tabName(src) {
    return { 'MANUAL (IG & WA) - OL': 'Manual', 'SHOPIFY-OL': 'Shopify', 'SHOPEE - OL': 'Shopee', 'TOKOPEDIA/TIKTOK shop -OL': 'Tokopedia/TikTok', 'TAILCRAFT': 'TailCraft' }[src] || src;
  }
  function workSheetNote(k) {
    if (!k) return '';
    if (k.write === 'queued') {
      if (k.written) return 'Sheet updated.';
      if (k.writeError) return 'The sheet was not changed: ' + k.writeError + ' Change it by hand.';
      return 'The sheet changes to ' + k.to + ' within the hour.';
    }
    if (k.write === 'by_hand') return 'The ' + tabName(k.src) + ' tab cannot be written automatically yet. Set ' + k.to + ' in the sheet by hand.';
    if (k.write === 'tailcraft') return 'TailCraft project updated.';
    return '';
  }
  function workItemHtml(x) {
    var ph = x.photo && x.photo.url
      ? '<a class="biz-ph" href="' + esc(x.photo.url) + '" target="_blank" rel="noopener"><img loading="lazy" referrerpolicy="no-referrer" alt="' + esc(x.title) + '" src="' + esc(x.photo.url) + '" onerror="this.parentNode.outerHTML=\'<div class=&quot;biz-ph&quot;>photo did not load</div>\'"></a>'
      : '<div class="biz-ph">' + (x.tc ? 'TailCraft custom' : 'no shop photo') + '</div>';
    var meta = '<span class="biz-badge ' + esc(x.channel) + '">' + esc(CH[x.channel] || x.channel) + '</span> <b>' + esc(x.invoice) + '</b>' +
      (x.customer ? ' · ' + esc(x.customer) : '') + (x.days != null ? ' · ' + (x.tc ? 'last change ' : '') + x.days + (x.days === 1 ? ' day ago' : ' days ago') : '') +
      (x.unpaid ? ' <span class="biz-unpaid">not paid yet</span>' : '');
    var detail = (x.detail || []).map(function (t) { return '<div class="d">' + esc(t) + '</div>'; }).join('');
    if (x.note) detail += '<div class="biz-pnote2">' + esc(x.note.text) + '<span class="w">Note' + (x.note.by ? ' by ' + esc(x.note.by) : '') + '</span></div>';
    var st = '<span class="biz-s ' + (x.tc ? 'design_todo' : '') + '">' + esc(x.status) + '</span>' +
      (x.qty ? ' <span class="biz-q">× ' + esc(x.qty) + '</span>' : '');
    if (x.sheetStatus && x.sheetStatus.toLowerCase() !== String(x.status).toLowerCase()) st += ' <span class="biz-pnote">sheet still says ' + esc(x.sheetStatus) + '</span>';
    var moved = '';
    if (x.work) {
      moved = '<div class="m">Moved here' + (x.work.by ? ' by ' + esc(x.work.by) : '') + (x.work.at ? ' · ' + esc(when(x.work.at)) : '') +
        ' <button class="biz-undo" data-wundo="' + esc(x.work.id) + '">Undo</button></div>' +
        (workSheetNote(Object.assign({ src: x.src }, x.work)) ? '<div class="biz-sheet' + (x.work.write === 'by_hand' || x.work.writeError ? ' todo' : '') + '">' + esc(workSheetNote(Object.assign({ src: x.src }, x.work))) + '</div>' : '');
    }
    if (x.tc && x.days != null && x.days > 30) moved += '<div class="biz-stale">No change on this project for ' + x.days + ' days. If the customer went quiet, tap Not going ahead.</div>';
    var live = S.data && S.data.work && S.data.work.live;
    var btns = !live ? '' : '<div class="biz-wbtns">' + (x.moves || []).map(function (m, i) {
      var id = x.key + '|' + i;
      return '<button class="biz-wbtn' + (i > 0 && m.to === 'lost' ? ' alt' : '') + (S.arm === 'w:' + id ? ' arm' : '') + '" data-work="' + esc(id) + '"' + (S.busy ? ' disabled' : '') + '>' +
        (S.arm === 'w:' + id ? 'Tap again: ' + esc(m.label) : esc(m.label)) + '</button>';
    }).join('') + '</div>';
    var fl = S.flash[x.key] ? '<div class="biz-flash' + (S.flash[x.key].bad ? ' bad' : '') + '">' + esc(S.flash[x.key].text) + '</div>' : '';
    return '<div class="biz-witem' + (x.tc ? ' tc' : '') + '">' + ph + '<div class="biz-it"><div class="t">' + esc(x.title) + '</div>' + detail +
      '<div class="row">' + st + '</div><div class="m">' + meta + '</div>' + moved + btns + fl + '</div></div>';
  }
  function workHtml(d) {
    var W = d.work;
    if (!W) return '<div class="biz-err">My work could not be worked out from this answer. Tap Refresh.</div>';
    var c = W.counts || {}, items = W.items || {};
    var warn = '';
    if (!W.live) warn += '<div class="biz-warn">The Done buttons are not switched on yet: the database part is waiting for approval. The lists below are already correct, read from the sheet.</div>';
    if (!(d.sources && d.sources.tcwork)) warn += '<div class="biz-warn">TailCraft designs could not be read, so the Designer list shows Sea Diva only.</div>';
    var tile = function (t, wait) {
      var n = c[t[0]] || 0;
      return '<button class="biz-tile' + (wait ? ' wait' : '') + (n ? '' : ' zero') + (S.wtab === t[0] ? ' on' : '') + '" data-wtab="' + t[0] + '"><b>' + n + '</b><span>' + esc(t[1]) + '</span></button>';
    };
    var tiles = '<div class="biz-wgroup">My hands</div><div class="biz-tiles">' + WORK_TILES.map(function (t) { return tile(t, false); }).join('') + '</div>' +
      '<div class="biz-wgroup">Waiting on someone</div><div class="biz-tiles">' + WAIT_TILES.map(function (t) { return tile(t, true); }).join('') + '</div>';
    var show = WORK_TILES.concat(WAIT_TILES).filter(function (t) { return (S.wtab === 'all' || S.wtab === t[0]) && (items[t[0]] || []).length; });
    var secs = show.map(function (t) {
      var list = items[t[0]] || [];
      var extra = '';
      if (t[0] === 'design' && c.tcDesign) extra = ' ' + c.tcDesign + ' of them TailCraft.';
      if (t[0] === 'order') extra = ' <button class="biz-undo" data-act="copy-order">Copy the list</button> <span id="biz-copied"></span>';
      return '<div class="biz-wsec"><h4>' + esc(t[1]) + ' (' + list.length + ')</h4><div class="why">' + esc(t[2]) + extra + '</div>' + list.map(workItemHtml).join('') + '</div>';
    }).join('');
    if (!secs) secs = '<div class="biz-empty">' + (S.wtab === 'all' ? 'Nothing is waiting on you or on the craftspeople. Every paid product is ready, packed or done.' : 'Nothing here right now.') + '</div>';
    var log = '';
    if ((W.log || []).length) {
      log = S.showLog
        ? '<div class="biz-shipped"><h4>Moved in the last 24 hours <button class="biz-undo" data-act="hide-wlog">Hide</button></h4>' + W.log.map(function (k) {
            return '<div class="r"><b>' + esc(k.invoice) + '</b> <span>' + esc(String(k.item || '').split('\n')[0]) + ': ' + esc(k.from) + ' → ' + esc(k.to) + ' · ' + esc(when(k.at)) + '</span>' +
              '<button class="biz-undo" data-wundo="' + esc(k.id) + '">Undo</button>' +
              (workSheetNote(k) ? '<span class="h">' + esc(workSheetNote(k)) + '</span>' : '') + '</div>';
          }).join('') + '</div>'
        : '<div class="biz-fresh">' + W.log.length + (W.log.length === 1 ? ' product' : ' products') + ' moved in the last 24 hours. <button class="biz-undo" data-act="show-wlog">Show to undo</button></div>';
    }
    return warn + tiles + log + secs;
  }
  function workItem(key) {
    var W = S.data && S.data.work, hit = null;
    if (!W) return null;
    Object.keys(W.items || {}).forEach(function (k) { (W.items[k] || []).forEach(function (x) { if (x.key === key) hit = x; }); });
    return hit;
  }
  function doWork(id) {
    var parts = id.split('|'), i = Number(parts.pop()), key = parts.join('|');
    var x = workItem(key), m = x && x.moves[i];
    if (!x || !m) return;
    var body = x.tc ? { action: 'tc_work', project: x.project, from: 'design_making', to: m.to }
      : { action: 'work', src: x.src, row: x.row, invoice: x.invoice, slot: x.slot, from: x.status, to: m.to };
    post(body, key).then(function (j) {
      var r = (j && j.result) || j || {};
      var t = String(x.title).split('\n')[0] + ' (' + x.invoice + '): ' + m.label + '.';
      if (r.write === 'by_hand') t += ' The ' + tabName(x.src) + ' tab cannot be written automatically yet, so set ' + m.to + ' in the sheet by hand.';
      else if (r.write === 'queued') t += ' The sheet changes within the hour.';
      if (r.job && /not moved/.test(r.job)) t += ' Board: ' + r.job + '.';
      S.notice = { text: t, wundo: r.id };
      delete S.flash[key];
      load();
    }).catch(function (e) { S.flash[key] = { text: 'Not saved: ' + (e.message || 'error'), bad: true }; render(); });
  }
  function doWorkUndo(id) {
    post({ action: 'work_undo', id: id }, 'wundo').then(function (j) {
      var r = (j && j.result) || j || {};
      S.notice = { text: 'Undone.' + (r.note ? ' ' + r.note.charAt(0).toUpperCase() + r.note.slice(1) + '.' : '') };
      load();
    }).catch(function (e) { S.notice = { text: 'Undo failed: ' + (e.message || 'error') }; render(); });
  }

  function render() {
    var root = document.getElementById(ROOT);
    if (!root) return;
    css();
    var name = (BUSINESSES.filter(function (b) { return b[0] === S.biz; })[0] || [0, ''])[1];
    root.innerHTML = nav() + (S.biz === 'seadiva' ? seadiva() : notYet(name));
    /* To send cards open their box label by themselves. */
    var need = S.biz === 'seadiva' ? S.visible.filter(function (k) { return !S.addr[k]; }) : [];
    if (need.length) setTimeout(function () { need.forEach(function (k) { if (!S.addr[k]) doAddr(k); }); }, 0);
  }

  function load() {
    if (S.loading) return;
    S.loading = true; S.err = ''; render();
    fetch('/api/business', { headers: headers(), cache: 'no-store' }).then(function (r) {
      if (r.status === 401) {
        if (typeof osUnauthorised === 'function') osUnauthorised();
        throw new Error('Your OS key was refused. Enter it again.');
      }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || ('The order list could not be read (HTTP ' + r.status + ').'));
        return j;
      });
    }).then(function (j) {
      S.data = j; S.at = new Date();
    }).catch(function (e) {
      S.err = (e && e.message) || 'The order list could not be read.';
    }).then(function () { S.loading = false; render(); });
  }

  function find(src, invoice) {
    return ((S.data && S.data.orders) || []).filter(function (o) { return o.src === src && o.invoice === invoice; })[0];
  }

  function post(body, key) {
    S.busy = key || 'x'; S.arm = ''; render();
    /* osHeaders() already sends Content-Type. Adding a second, lower-case one
       made the browser send "application/json, application/json", which the
       server could not read: every tick and pack failed (13 Oct 2026). */
    var h = headers(); if (!h['Content-Type'] && !h['content-type']) h['Content-Type'] = 'application/json';
    return fetch('/api/business', { method: 'POST', headers: h, body: JSON.stringify(body), cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { if (typeof osUnauthorised === 'function') osUnauthorised(); throw new Error('Your OS key was refused. Enter it again.'); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || ('Not saved (HTTP ' + r.status + ').'));
        return j;
      });
    }).then(function (j) { S.busy = ''; return j; }, function (e) { S.busy = ''; throw e; });
  }

  function doPack(id) {
    var parts = id.split('|'), src = parts[0], inv = parts[1], slot = parts[2];
    var o = find(src, inv);
    if (!o) return;
    var all = boxAllIn(o);
    var slots = slot === '*' ? o.lines.filter(function (l) { return l.canPack && (l.group === 'ready' || l.group === 'shipping' || all); }).map(function (l) { return l.slot; }) : [Number(slot)];
    var key = src + '|' + inv;
    post({ action: 'mark', src: src, row: o.row, invoice: inv, slots: slots }, key).then(function (j) {
      var r = j.result || {}, lines = r.lines || [], n = r.marked || 0;
      var odd = lines.filter(function (x) { return x.state === 'refused' || x.state === 'already'; });
      var t = n ? 'Packed ' + n + (n === 1 ? ' product' : ' products') + '.' : 'Nothing new was marked.';
      if (odd.length) t += ' ' + odd.map(function (x) { return (x.item ? String(x.item).split('\n')[0] + ': ' : '') + (x.state === 'already' ? 'already packed' : x.why); }).join('; ') + '.';
      var td = j.todo || {};
      if (n) t += td.logged ? ' Logged on your To-Do.' : (td.error ? ' Not logged on the To-Do: ' + td.error : '');
      S.flash[key] = { text: t, click: n ? r.click_id : '', bad: !n };
      load();
    }).catch(function (e) { S.flash[key] = { text: e.message || 'Not saved.', bad: true }; render(); });
  }

  function quiet(body) {
    /* osHeaders() already sends Content-Type. Adding a second, lower-case one
       made the browser send "application/json, application/json", which the
       server could not read: every tick and pack failed (13 Oct 2026). */
    var h = headers(); if (!h['Content-Type'] && !h['content-type']) h['Content-Type'] = 'application/json';
    return fetch('/api/business', { method: 'POST', headers: h, body: JSON.stringify(body), cache: 'no-store' }).then(function (r) {
      if (r.status === 401 && typeof osUnauthorised === 'function') osUnauthorised();
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || ('Not saved (HTTP ' + r.status + ').'));
        return j;
      });
    });
  }

  /* Tick at once on screen, then save. If saving fails, the tick goes back
     and the card says why. */
  function doTick(id) {
    var parts = id.split('|'), o = find(parts[0], parts[1]);
    if (!o) return;
    var l = o.lines.filter(function (x) { return String(x.slot) === parts[2]; })[0];
    if (!l) return;
    var was = l.inBox, on = !was;
    l.inBox = on ? { at: new Date().toISOString(), by: 'Befa' } : null;
    render();
    quiet({ action: 'tick', src: parts[0], invoice: parts[1], slot: Number(parts[2]), on: on }).catch(function (e) {
      l.inBox = was;
      S.flash[parts[0] + '|' + parts[1]] = { text: 'The tick was not saved: ' + (e.message || 'error'), bad: true };
      render();
    });
  }

  function doAddr(key) {
    var i = key.lastIndexOf('|'), o = find(key.slice(0, i), key.slice(i + 1));
    if (!o) return;
    S.addr[key] = { loading: true }; render();
    quiet({ action: 'contact', src: o.src, row: o.row, invoice: o.invoice })
      .then(function (j) { S.addr[key] = { data: j }; render(); })
      .catch(function (e) { S.addr[key] = { err: e.message || 'Could not read the address.' }; render(); });
  }

  function doNote(id) {
    if (S.noteBusy) return;
    var parts = id.split('|'), o = find(parts[0], parts[1]);
    if (!o) return;
    var l = o.lines.filter(function (x) { return String(x.slot) === parts[2]; })[0];
    var ta = document.querySelector('[data-note-input]');
    var text = (Object.prototype.hasOwnProperty.call(S.noteDraft, id) ? S.noteDraft[id] : (ta ? ta.value : '')).trim();
    S.noteBusy = id; render();
    quiet({ action: 'note', src: parts[0], invoice: parts[1], slot: Number(parts[2]), note: text }).then(function () {
      if (l) l.note = text ? { text: text, at: new Date().toISOString(), by: 'Befa' } : null;
      delete S.noteDraft[id]; S.noteEdit = ''; S.noteBusy = ''; render();
    }).catch(function (e) {
      S.noteBusy = ''; S.flash[parts[0] + '|' + parts[1]] = { text: 'The note was not saved: ' + (e.message || 'error'), bad: true }; render();
    });
  }

  /* Keep what is typed in a note while the list redraws around it. */
  document.addEventListener('input', function (e) {
    var ti = e.target && e.target.getAttribute && e.target.getAttribute('data-track-input');
    if (ti) { S.trackDraft[ti] = e.target.value; return; }
    var t = e.target;
    if (t && t.dataset && t.dataset.noteInput) S.noteDraft[t.dataset.noteInput] = t.value;
  });

  function doShip(key) {
    var i = key.lastIndexOf('|'), o = find(key.slice(0, i), key.slice(i + 1));
    if (!o) return;
    post({ action: 'ship', src: o.src, row: o.row, invoice: o.invoice }, key).then(function (j) {
      S.notice = { text: o.invoice + (o.customer ? ' (' + o.customer + ')' : '') + ' is marked shipped and DONE, and is off the list.', unship: j && j.id };
      load();
    })
      .catch(function (e) { S.flash[key] = { text: 'Not marked: ' + (e.message || 'error'), bad: true }; render(); });
  }
  /* Everything in the box: pack every product, then send or pickup. */
  function doPackGo(id) {
    var i = id.lastIndexOf('|'), method = id.slice(i + 1), key = id.slice(0, i);
    var j = key.lastIndexOf('|'), src = key.slice(0, j), inv = key.slice(j + 1);
    var o = find(src, inv);
    if (!o) return;
    var slots = o.lines.filter(function (l) { return l.canPack; }).map(function (l) { return l.slot; });
    post({ action: 'mark', src: src, row: o.row, invoice: inv, slots: slots }, key).then(function () {
      return post({ action: 'handoff', src: src, invoice: inv, method: method }, key);
    }).then(function () {
      var who = o.customer ? ' (' + o.customer + ')' : '';
      S.notice = method === 'pickup'
        ? { text: inv + who + ' is packed and waiting for pickup. It is now only on the Sea Diva dashboard, Pack and ship, Waiting for pickup.', undo: key }
        : { text: inv + who + ' is packed and under To send, with its label open.', undo: key };
      if (method === 'send') S.stage = 'to_send';
      load();
    }).catch(function (e) { S.flash[key] = { text: 'Not saved: ' + (e.message || 'error'), bad: true }; render(); });
  }
  /* Tracking code saved, then the order is marked sent and DONE. */
  function doTrack(key) {
    var j = key.lastIndexOf('|'), src = key.slice(0, j), inv = key.slice(j + 1);
    var o = find(src, inv);
    if (!o) return;
    var tr = String(S.trackDraft[key] != null ? S.trackDraft[key] : ((o.handoff && o.handoff.tracking) || '')).trim();
    if (!tr) { S.flash[key] = { text: 'Type the tracking code first.', bad: true }; render(); return; }
    post({ action: 'tracking', src: src, invoice: inv, tracking: tr }, key).then(function () {
      return post({ action: 'ship', src: src, row: o.row, invoice: inv }, key);
    }).then(function (j2) {
      delete S.trackDraft[key];
      S.notice = { text: inv + (o.customer ? ' (' + o.customer + ')' : '') + ' is sent with tracking ' + tr + ', marked DONE and off the list.', unship: j2 && j2.id };
      load();
    }).catch(function (e) { S.flash[key] = { text: 'Not saved: ' + (e.message || 'error'), bad: true }; render(); });
  }
  function doHand(id) {
    var i = id.lastIndexOf('|'), method = id.slice(i + 1), key = id.slice(0, i);
    var j = key.lastIndexOf('|'), src = key.slice(0, j), inv = key.slice(j + 1);
    var o = find(src, inv);
    post({ action: 'handoff', src: src, invoice: inv, method: method }, key).then(function () {
      var who = (o && o.customer) ? ' (' + o.customer + ')' : '';
      if (method === 'pickup') S.notice = { text: inv + who + ' is waiting for pickup. It is now only on the Sea Diva dashboard, Pack and ship, Waiting for pickup.', undo: key };
      else if (method === 'send') S.notice = { text: inv + who + ' moved to To send. Its box label is open on the card.', undo: key };
      else S.notice = null;
      load();
    }).catch(function (e) { S.flash[key] = { text: 'Not saved: ' + (e.message || 'error'), bad: true }; render(); });
  }
  function doUnship(id) {
    post({ action: 'unship', id: id }, 'unship').then(function () { S.notice = null; load(); })
      .catch(function (e) { S.err = 'Undo failed: ' + (e.message || 'error'); render(); });
  }

  function doUndo(body, key) {
    post(Object.assign({ action: 'undo' }, body), key).then(function (j) {
      var r = j.result || {}, td = j.todo || {};
      S.flash[key] = { text: 'Undone: ' + (r.undone || 0) + (r.undone === 1 ? ' product is' : ' products are') + ' back to how they were.' +
        (td.archived ? ' The To-Do task was removed.' : '') + (td.error ? ' To-Do: ' + td.error : '') };
      load();
    }).catch(function (e) { S.flash[key] = { text: e.message || 'Not undone.', bad: true }; render(); });
  }

  document.addEventListener('click', function (e) {
    var root = document.getElementById(ROOT);
    if (!root || !root.contains(e.target)) return;
    var b = e.target.closest('[data-biz],[data-stage],[data-ch],[data-act],[data-pack],[data-undo-mark],[data-undo-click],[data-tick],[data-addr],[data-addr-hide],[data-addr-copy],[data-ship],[data-unship],[data-note-edit],[data-note-save],[data-note-cancel],[data-hand],[data-packgo],[data-track-save],[data-addr-print],[data-view],[data-wtab],[data-work],[data-wundo]');
    if (!b) return;
    if (b.dataset.noteEdit) { S.noteEdit = b.dataset.noteEdit; render(); var ta = document.querySelector('[data-note-input]'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return; }
    if (b.dataset.noteCancel) { delete S.noteDraft[b.dataset.noteCancel]; S.noteEdit = ''; render(); return; }
    if (b.dataset.noteSave) { doNote(b.dataset.noteSave); return; }
    if (b.dataset.ship) {
      if (S.busy) return;
      var arm = 'ship:' + b.dataset.ship;
      if (S.arm !== arm) { S.arm = arm; render(); setTimeout(function () { if (S.arm === arm) { S.arm = ''; render(); } }, 5000); return; }
      doShip(b.dataset.ship); return;
    }
    if (b.dataset.addrPrint) { printLabel(b.dataset.addrPrint); return; }
    if (b.dataset.view) {
      S.view = b.dataset.view;
      try { localStorage.setItem('biz-view', S.view); } catch (e2) { /* storage blocked */ }
      render(); return;
    }
    if (b.dataset.wtab) { S.wtab = S.wtab === b.dataset.wtab ? 'all' : b.dataset.wtab; render(); return; }
    if (b.dataset.work) {
      if (S.busy) return;
      /* Two taps, so a stray tap while scrolling never moves anything. */
      var wa = 'w:' + b.dataset.work;
      if (S.arm !== wa) { S.arm = wa; render(); setTimeout(function () { if (S.arm === wa) { S.arm = ''; render(); } }, 5000); return; }
      S.arm = ''; doWork(b.dataset.work); return;
    }
    if (b.dataset.wundo) { if (!S.busy) doWorkUndo(Number(b.dataset.wundo)); return; }
    if (b.dataset.packgo || b.dataset.trackSave) {
      if (S.busy) return;
      var ga = b.dataset.packgo ? 'go:' + b.dataset.packgo : 'track:' + b.dataset.trackSave;
      if (S.arm !== ga) { S.arm = ga; render(); setTimeout(function () { if (S.arm === ga) { S.arm = ''; render(); } }, 5000); return; }
      S.arm = '';
      if (b.dataset.packgo) doPackGo(b.dataset.packgo); else doTrack(b.dataset.trackSave);
      return;
    }
    if (b.dataset.hand) {
      if (S.busy) return;
      /* Pickup takes the order off this tab, so it needs a second tap. */
      if (/\|pickup$/.test(b.dataset.hand) && S.arm !== 'hand:' + b.dataset.hand) {
        var ha = 'hand:' + b.dataset.hand; S.arm = ha; render();
        setTimeout(function () { if (S.arm === ha) { S.arm = ''; render(); } }, 5000); return;
      }
      doHand(b.dataset.hand); return;
    }
    if (b.dataset.unship) { if (!S.busy) doUnship(Number(b.dataset.unship)); return; }
    if (b.dataset.tick) { doTick(b.dataset.tick); return; }
    if (b.dataset.addr) { doAddr(b.dataset.addr); return; }
    if (b.dataset.addrHide) { delete S.addr[b.dataset.addrHide]; render(); return; }
    if (b.dataset.addrCopy) {
      var A = S.addr[b.dataset.addrCopy];
      if (A && A.data && navigator.clipboard) navigator.clipboard.writeText(labelText(A.data)).then(function () { b.textContent = 'Copied'; }, function () { b.textContent = 'Copy failed'; });
      return;
    }
    if (b.dataset.pack) {
      if (S.busy) return;
      /* Two taps, so a stray tap while scrolling never packs anything. */
      if (S.arm !== b.dataset.pack) {
        S.arm = b.dataset.pack; render();
        var armed = S.arm;
        setTimeout(function () { if (S.arm === armed) { S.arm = ''; render(); } }, 5000);
        return;
      }
      doPack(b.dataset.pack); return;
    }
    if (b.dataset.undoMark || b.dataset.undoClick) {
      if (S.busy) return;
      var card = b.closest('.biz-card');
      var key = (card && card.getAttribute('data-key')) || 'undo';
      doUndo(b.dataset.undoClick ? { click_id: b.dataset.undoClick } : { mark_id: Number(b.dataset.undoMark) }, key);
      return;
    }
    if (b.dataset.biz) { S.biz = b.dataset.biz; render(); if (S.biz === 'seadiva' && !S.data && !S.loading) load(); return; }
    if (b.dataset.stage) { S.stage = S.stage === b.dataset.stage ? 'all' : b.dataset.stage; render(); return; }
    if (b.dataset.ch) { S.ch = b.dataset.ch; render(); return; }
    if (b.dataset.act === 'show-shipped') { S.showShipped = true; render(); return; }
    if (b.dataset.act === 'show-wlog') { S.showLog = true; render(); return; }
    if (b.dataset.act === 'hide-wlog') { S.showLog = false; render(); return; }
    if (b.dataset.act === 'copy-order') {
      var ol = ((S.data && S.data.work && S.data.work.items.order) || []).map(function (x) {
        return String(x.title).split('\n')[0] + (x.qty ? ' × ' + x.qty : '') + '  (' + x.invoice + (x.customer ? ', ' + x.customer : '') + ')';
      }).join('\n');
      var cp = document.getElementById('biz-copied');
      if (navigator.clipboard) navigator.clipboard.writeText(ol).then(function () { if (cp) cp.textContent = 'Copied.'; }, function () { if (cp) cp.textContent = 'Copy was blocked.'; });
      return;
    }
    if (b.dataset.act === 'hide-shipped') { S.showShipped = false; render(); return; }
    if (b.dataset.act === 'refresh') { S.flash = {}; S.notice = null; load(); }
  });

  /* The host page calls this when the Business tab opens. Loads once, then
     only on Refresh, so switching tabs does not hammer the database. */
  window.bizOpen = function () { render(); if (!S.data && !S.loading && !S.err) load(); };
  window.bizReload = load;
  render();
})();
