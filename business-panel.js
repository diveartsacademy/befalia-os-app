/* business-panel.js — the Business tab (13 Oct 2026).
   ---------------------------------------------------------------------------
   Progress across Befa's businesses. Sea Diva is the first section: every paid
   order that is not finished yet, from Shopify and from Manual (IG & WA), one
   card per invoice, each product with its photo, so she can help pack and ship.

   Reads GET /api/business with the OS key. The rules are in api/_sd-business.js.
   The page only draws what the server sends. If it cannot read, it says so in
   red. A photo that does not load says so instead of leaving a blank square.
   Nothing here writes anywhere.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';
  var ROOT = 'biz-root';
  var S = { biz: 'seadiva', stage: 'all', ch: 'all', data: null, err: '', loading: false, at: null };

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
    ['close_in_shopify', 'Close in Shopify']
  ];
  var STAGE_NOTE = {
    ready: 'Every product left on this invoice is ready. Pack it.',
    partly: 'Some products are ready, the rest are still being made or bought.',
    production: 'Still being designed, made or bought.',
    not_set: 'Paid, but no production status is written in the sheet yet.',
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
      '.biz-pnote{font:11px var(--sans);color:var(--dim)}' +
      '.biz-foot{font:12px var(--sans);color:var(--dim);margin-top:6px}' +
      '.biz-empty{font:13.5px/1.5 var(--sans);color:var(--muted);padding:18px;border:1px dashed var(--line);border-radius:14px;margin-top:12px}' +
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

  function lineHtml(l) {
    var p = l.photo, ph;
    if (p && p.url) {
      ph = '<a class="biz-ph" href="' + esc(p.url) + '" target="_blank" rel="noopener" title="Open the full photo">' +
        '<img loading="lazy" referrerpolicy="no-referrer" alt="' + esc(l.title) + '" src="' + esc(p.url) + '" ' +
        'onerror="this.parentNode.outerHTML=\'<div class=&quot;biz-ph&quot;>photo did not load</div>\'"></a>';
    } else {
      ph = '<div class="biz-ph">no photo on file</div>';
    }
    var pnote = '';
    if (p) {
      pnote = '<span class="biz-pnote">' + esc(p.from) + (p.how === 'product' ? ', product photo, check colour and size' : '') + '</span>';
    }
    var detail = (l.detail || []).map(function (d) { return '<div class="d">' + esc(d) + '</div>'; }).join('');
    return '<div class="biz-line">' + ph + '<div class="biz-it"><div class="t">' + esc(l.title) + '</div>' + detail +
      '<div class="row">' + (l.qty ? '<span class="biz-q">× ' + esc(l.qty) + '</span>' : '<span class="biz-q">qty not written</span>') +
      '<span class="biz-s ' + esc(l.group) + '">' + esc(l.status || 'no status') + '</span>' + pnote + '</div></div></div>';
  }

  function cardHtml(o) {
    var when = o.date ? day(o.date) + (o.days != null ? ' · ' + o.days + ' days ago' : '') : (o.dateText || 'no date');
    var stageLabel = (STAGES.filter(function (s) { return s[0] === o.stage; })[0] || [0, 'No products'])[1];
    var pay = o.channel === 'manual' && o.pay === 'part' ? ' · ' + esc(o.payText) : '';
    return '<div class="biz-card sensitive st-' + esc(o.stage) + '">' +
      '<div class="biz-top"><span class="biz-inv">' + esc(o.invoice) + '</span>' +
      '<span class="biz-badge ' + esc(o.channel) + '">' + (o.channel === 'shopify' ? 'Shopify' : 'Manual') + '</span>' +
      '<span class="biz-stage ' + esc(o.stage) + '">' + esc(stageLabel) + '</span></div>' +
      '<div class="biz-who">' + esc(o.customer || 'no name') + '</div>' +
      '<div class="biz-meta">' + esc(when) + (o.country ? ' · ships to ' + esc(o.country) : '') + pay + '</div>' +
      (STAGE_NOTE[o.stage] && o.stage !== 'production' ? '<div class="biz-note">' + esc(STAGE_NOTE[o.stage]) + '</div>' : '') +
      o.lines.map(lineHtml).join('') +
      (o.doneCount ? '<div class="biz-foot">' + o.doneCount + ' of ' + o.lineCount + ' products on this invoice are already DONE and hidden.</div>' : '') +
      '</div>';
  }

  function seadiva() {
    var h = '<div class="biz-head"><h3>Sea Diva · orders to finish</h3><button data-act="refresh">' + (S.loading ? 'Loading…' : 'Refresh') + '</button></div>';
    if (S.err) return h + '<div class="biz-err">' + esc(S.err) + '</div>';
    var d = S.data;
    if (!d) return h + '<div class="biz-fresh">Loading the order list…</div>';

    var src = d.sources || {}, warn = '';
    var fresh = 'Manual orders: sheet copy ' + ago(src.manual && src.manual.loadedAt) + '. Shopify: sheet copy ' + ago(src.shopify && src.shopify.loadedAt) + '.';
    if (S.at) fresh += ' Page read at ' + hhmm(S.at) + ' WITA.';
    ['shopify', 'manual'].forEach(function (k) {
      if (src[k] && !src[k].ok) warn += '<div class="biz-err">' + esc((k === 'shopify' ? 'Shopify' : 'Manual') + ' could not be read: ' + src[k].error) + '</div>';
    });
    var nw = src.shopify && src.shopify.newest;
    if (nw && nw.date) {
      var age = Math.round((Date.now() - new Date(nw.date + 'T00:00:00+08:00').getTime()) / 86400000);
      if (age > 7) {
        warn += '<div class="biz-warn">The newest Shopify order in the sheet is ' + esc(nw.invoice) + ' from ' + esc(day(nw.date)) + ', ' + age +
          ' days ago. If anyone has ordered on seadivatails.com since then, that order is not on this list until the Shopify to sheet sync catches up. Check Shopify itself before you assume nothing is waiting.</div>';
      }
    }
    if (d.photosNote) warn += '<div class="biz-warn">' + esc(d.photosNote) + ' Orders are complete, only some photos are missing.</div>';

    var c = d.counts || {};
    var tiles = '<div class="biz-tiles">' + STAGES.map(function (s) {
      var n = s[0] === 'all' ? c.all : c[s[0]];
      if (s[0] !== 'all' && !n) return '';
      return '<button class="biz-tile' + (S.stage === s[0] ? ' on' : '') + '" data-stage="' + s[0] + '"><b>' + (n || 0) + '</b><span>' + esc(s[1]) + '</span></button>';
    }).join('') + '</div>';
    var chans = '<div class="biz-sub">' + [['all', 'Shopify and Manual'], ['shopify', 'Shopify'], ['manual', 'Manual']].map(function (x) {
      var n = x[0] === 'all' ? c.all : c[x[0]];
      return '<button class="biz-chip' + (S.ch === x[0] ? ' on' : '') + '" data-ch="' + x[0] + '">' + esc(x[1]) + '<i>' + (n || 0) + '</i></button>';
    }).join('') + '</div>';

    var list = (d.orders || []).filter(function (o) {
      return (S.stage === 'all' || o.stage === S.stage) && (S.ch === 'all' || o.channel === S.ch);
    });
    var body = list.length ? '<div class="biz-list">' + list.map(cardHtml).join('') + '</div>'
      : '<div class="biz-empty">' + (c.all ? 'Nothing in this filter.' : 'No paid order is waiting. Every paid Shopify and Manual order in the sheet is done or shipped.') + '</div>';
    var photoLine = c.lines ? '<div class="biz-fresh">' + c.photos + ' of ' + c.lines + ' products have a photo. ' +
      'A photo marked "product photo" shows the right product, but the colour or size may differ, so check the line text.</div>' : '';
    return h + '<div class="biz-fresh">' + esc(fresh) + '</div>' + warn + tiles + chans + photoLine + body;
  }

  function render() {
    var root = document.getElementById(ROOT);
    if (!root) return;
    css();
    var name = (BUSINESSES.filter(function (b) { return b[0] === S.biz; })[0] || [0, ''])[1];
    root.innerHTML = nav() + (S.biz === 'seadiva' ? seadiva() : notYet(name));
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

  document.addEventListener('click', function (e) {
    var root = document.getElementById(ROOT);
    if (!root || !root.contains(e.target)) return;
    var b = e.target.closest('[data-biz],[data-stage],[data-ch],[data-act]');
    if (!b) return;
    if (b.dataset.biz) { S.biz = b.dataset.biz; render(); if (S.biz === 'seadiva' && !S.data && !S.loading) load(); return; }
    if (b.dataset.stage) { S.stage = S.stage === b.dataset.stage ? 'all' : b.dataset.stage; render(); return; }
    if (b.dataset.ch) { S.ch = b.dataset.ch; render(); return; }
    if (b.dataset.act === 'refresh') load();
  });

  /* The host page calls this when the Business tab opens. Loads once, then
     only on Refresh, so switching tabs does not hammer the database. */
  window.bizOpen = function () { render(); if (!S.data && !S.loading && !S.err) load(); };
  window.bizReload = load;
  render();
})();
