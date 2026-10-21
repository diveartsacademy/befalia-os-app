/* subscriptions-panel.js — Langganan, the subscriptions card on the Finance tab (21 Oct 2026).
   ---------------------------------------------------------------------------
   Befa: "all the subscriptions that I do, the date that I need to repay, the
   other option that I can do, how much I spent on subscriptions, and if I
   have a free trial, notify me in that list."

   Reads GET /api/subscriptions (Notion database "Subscriptions" under
   Personal Life). Read only: edits happen in Notion or by the morning inbox
   check. Top to bottom:
     - what subscriptions cost a month, IDR and USD apart, with the doubtful
       rows and the trials shown beside it, never inside it
     - what needs action now (trial ending, payment failing, due, stale date)
     - the next 30 days of charges
     - every subscription, each with its other option and where it was seen
   Private mode blurs the card like the others.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';
  var ROOT = 'subs-root';
  var S = { data: null, err: '', loading: false, at: null, open: {}, showEnded: false };
  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var CYCLE = { 'Monthly': '/bln', 'Yearly': '/thn', 'Every 2 months': '/2 bln', 'Usage': ' pemakaian', 'One-off': ' sekali' };
  var ALERT = {
    trial_over: 'Trial sudah lewat, cek apakah sudah ditagih',
    trial_ending: 'Trial berakhir',
    failing: 'Pembayaran gagal',
    due: 'Harus diperpanjang',
    date_passed: 'Tanggal tagihan sudah lewat, cek statusnya'
  };
  var ORDER = ['Free trial', 'Payment failing', 'Due', 'Check', 'Active', 'Ended'];
  var LABEL = { 'Active': 'Aktif', 'Free trial': 'Trial gratis', 'Payment failing': 'Gagal bayar', 'Due': 'Jatuh tempo', 'Check': 'Perlu dicek', 'Ended': 'Sudah berhenti' };

  function headers() { return (typeof osHeaders === 'function') ? osHeaders() : {}; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n, cur) {
    if (n == null || !cur) return 'Jumlah belum diketahui';
    if (cur === 'USD') return 'US$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
    return 'Rp' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function date(iso) { if (!iso) return ''; var p = iso.split('-').map(Number); return p[2] + ' ' + BULAN[p[1] - 1] + ' ' + p[0]; }
  function inDays(n) { if (n == null) return ''; if (n === 0) return 'hari ini'; if (n === 1) return 'besok'; if (n < 0) return (-n) + ' hari lalu'; return n + ' hari lagi'; }
  function byId(id) { var a = (S.data && S.data.items) || []; for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }

  function css() {
    if (document.getElementById('subs-css')) return;
    var s = document.createElement('style');
    s.id = 'subs-css';
    s.textContent = [
      '#subs-root{--sb-gold:#f2c97d;--sb-coral:#ff8fa3;--sb-sea:#7fe3c6;margin-top:6px;}',
      '#subs-root .sb-card{border-radius:26px;background:linear-gradient(165deg,rgba(13,46,68,.62),rgba(4,18,29,.78));border:1px solid rgba(46,230,255,.13);box-shadow:var(--shadow);padding:20px;margin:0 0 16px;}',
      '#subs-root h3{font-family:var(--serif);font-size:19px;font-weight:600;color:var(--aquasoft);margin:0 0 4px;}',
      '#subs-root .sb-sub{font-size:13px;color:var(--muted);line-height:1.45;margin:0;}',
      '#subs-root .sb-hero{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px;}',
      '@media(max-width:620px){#subs-root .sb-hero{grid-template-columns:1fr;}}',
      '#subs-root .sb-big{font-family:var(--serif);font-size:clamp(34px,7vw,52px);line-height:1;color:#fff;font-weight:600;margin:4px 0 6px;font-variant-numeric:lining-nums;}',
      '#subs-root .sb-lbl{font-size:13px;color:var(--aquasoft);}',
      '#subs-root .sb-side{font-size:13px;color:var(--muted);line-height:1.6;}',
      '#subs-root .sb-side b{color:var(--ink);font-weight:600;}',
      '#subs-root .sb-list{list-style:none;margin:10px 0 0;padding:0;}',
      '#subs-root .sb-list li{padding:12px 0;border-top:1px solid rgba(46,230,255,.09);}',
      '#subs-root .sb-list li:first-child{border-top:none;}',
      '#subs-root .sb-row{display:flex;gap:12px;align-items:flex-start;}',
      '#subs-root .sb-row .t{flex:1;min-width:0;}',
      '#subs-root .sb-row .n{font-weight:650;font-size:14.5px;color:var(--ink);}',
      '#subs-root .sb-row .m{font-size:12.5px;color:var(--muted);margin-top:2px;}',
      '#subs-root .sb-row .a{font-family:var(--serif);font-size:17px;color:#fff;white-space:nowrap;text-align:right;}',
      '#subs-root .sb-row .a small{display:block;font-family:var(--sans);font-size:11.5px;color:var(--muted);}',
      '#subs-root .pill{display:inline-block;white-space:nowrap;font-size:11px;font-weight:650;border-radius:999px;padding:2px 8px;margin-left:6px;vertical-align:1px;}',
      '#subs-root .pill.trial{background:rgba(46,230,255,.14);color:var(--aquasoft);}',
      '#subs-root .pill.fail{background:rgba(255,143,163,.16);color:var(--sb-coral);}',
      '#subs-root .pill.due{background:rgba(242,201,125,.16);color:var(--sb-gold);}',
      '#subs-root .pill.check{background:rgba(242,201,125,.10);color:var(--sb-gold);}',
      '#subs-root .pill.ok{background:rgba(127,227,198,.12);color:var(--sb-sea);}',
      '#subs-root .pill.end{background:rgba(255,255,255,.07);color:var(--muted);}',
      '#subs-root .sb-alert{border-left:3px solid var(--sb-gold);padding-left:12px;}',
      '#subs-root .sb-alert.fail,#subs-root .sb-alert.trial_over{border-left-color:var(--sb-coral);}',
      '#subs-root .sb-opt{margin-top:8px;font-size:13px;line-height:1.5;color:var(--ink);background:rgba(4,18,29,.5);border:1px solid rgba(46,230,255,.10);border-radius:14px;padding:10px 12px;}',
      '#subs-root .sb-opt .ev{color:var(--muted);font-size:12px;margin-top:6px;}',
      '#subs-root .sb-more{background:none;border:none;color:var(--aquasoft);font:600 12.5px var(--sans);padding:6px 0 0;cursor:pointer;}',
      '#subs-root .sb-strip{display:flex;gap:10px;overflow-x:auto;padding:4px 2px 10px;-webkit-overflow-scrolling:touch;}',
      '#subs-root .sb-pass{flex:0 0 170px;border-radius:20px;padding:14px;background:linear-gradient(160deg,#0f3b57,#071c2c);border:1px solid rgba(46,230,255,.18);}',
      '#subs-root .sb-pass.soon{border-color:rgba(242,201,125,.55);}',
      '#subs-root .sb-pass .w{font-size:12px;color:var(--aquasoft);font-weight:600;}',
      '#subs-root .sb-pass.soon .w{color:var(--sb-gold);}',
      '#subs-root .sb-pass .d{font-family:var(--serif);font-size:30px;color:#fff;line-height:1.1;margin-top:2px;}',
      '#subs-root .sb-pass .nm{font-size:13.5px;font-weight:650;color:var(--ink);margin-top:8px;line-height:1.25;}',
      '#subs-root .sb-pass .am{font-size:13px;color:var(--muted);margin-top:2px;}',
      '#subs-root .sb-grp{font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:var(--dim, var(--muted));margin:16px 0 0;}',
      '#subs-root .sb-btn{border:1px solid var(--aqualine);background:rgba(46,230,255,.08);color:var(--aquasoft);border-radius:999px;padding:7px 14px;font:600 13px var(--sans);cursor:pointer;}',
      '#subs-root .sb-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;font-size:12.5px;color:var(--muted);margin:4px 4px 18px;}',
      '#subs-root .sb-foot a{color:var(--aquasoft);}',
      '#subs-root .sb-err{border-radius:18px;padding:14px 16px;background:rgba(255,143,163,.08);border:1px solid rgba(255,143,163,.4);font-size:13.5px;color:var(--ink);display:flex;gap:12px;align-items:center;justify-content:space-between;}',
      '#subs-root button:focus-visible{outline:2px solid var(--aqua);outline-offset:2px;}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function pill(st) {
    var c = { 'Active': 'ok', 'Free trial': 'trial', 'Payment failing': 'fail', 'Due': 'due', 'Check': 'check', 'Ended': 'end' }[st] || 'check';
    return '<span class="pill ' + c + '">' + esc(LABEL[st] || st) + '</span>';
  }

  function heroHTML(d) {
    var m = d.summary.month, y = d.summary.year;
    var extra = [];
    if (m.IDR.unconfirmed || m.USD.unconfirmed) extra.push('<b>+ ' + esc(money(m.IDR.unconfirmed, 'IDR')) + (m.USD.unconfirmed ? ' dan ' + esc(money(m.USD.unconfirmed, 'USD')) : '') + '</b> belum pasti (perlu dicek atau gagal bayar)');
    if (m.IDR.afterTrials || m.USD.afterTrials) extra.push('<b>+ ' + esc(money(m.IDR.afterTrials, 'IDR')) + (m.USD.afterTrials ? ' dan ' + esc(money(m.USD.afterTrials, 'USD')) : '') + '</b> kalau trial lanjut');
    if (d.summary.unknownAmount.length) extra.push('<b>' + d.summary.unknownAmount.length + '</b> langganan jumlahnya belum diketahui, tidak dihitung');
    return '<section class="sb-card sensitive"><h3>Langganan</h3>'
      + '<p class="sb-sub">Semua tagihan rutin dari inbox kamu. Rupiah dan dolar dihitung terpisah, tanpa kurs tebakan.</p>'
      + '<div class="sb-hero"><div><div class="sb-lbl">Pasti per bulan</div>'
      + '<div class="sb-big">' + esc(money(m.IDR.confirmed, 'IDR')) + '</div>'
      + '<div class="sb-big" style="font-size:clamp(24px,4.5vw,32px)">+ ' + esc(money(m.USD.confirmed, 'USD')) + '</div>'
      + '<div class="sb-side">Setahun kira kira ' + esc(money(y.IDR, 'IDR')) + ' + ' + esc(money(y.USD, 'USD')) + '</div></div>'
      + '<div class="sb-side">' + extra.join('<br>') + '</div></div></section>';
  }

  function alertsHTML(d) {
    var a = d.summary.alerts;
    if (!a.length) return '';
    return '<section class="sb-card sensitive"><h3>Perlu tindakan</h3><p class="sb-sub">Trial yang mau habis, pembayaran yang gagal, dan yang harus diperpanjang.</p><ul class="sb-list">'
      + a.map(function (x) {
        var s = byId(x.id); if (!s) return '';
        var when = x.kind === 'trial_ending' ? ' ' + inDays(x.days) + ' (' + date(s.trialEnds) + ')' : (x.days != null && (x.kind === 'due' || x.kind === 'date_passed') ? ', ' + inDays(x.days) : '');
        return '<li class="sb-alert ' + esc(x.kind === 'failing' ? 'fail' : x.kind) + '"><div class="sb-row"><div class="t"><div class="n">' + esc(s.name) + '</div>'
          + '<div class="m">' + esc(ALERT[x.kind] + when) + '</div></div><div class="a">' + esc(s.amount != null ? money(s.amount, s.currency) : '') + '</div></div>'
          + (s.option ? '<div class="sb-opt">' + esc(s.option) + '</div>' : '') + '</li>';
      }).join('') + '</ul></section>';
  }

  function nextHTML(d) {
    var u = d.summary.upcoming;
    if (!u.length) return '';
    return '<section class="sb-card sensitive"><h3>30 hari ke depan</h3><div class="sb-strip">' + u.map(function (x) {
      var s = byId(x.id); if (!s) return '';
      var p = x.date.split('-').map(Number);
      return '<div class="sb-pass' + (x.days <= 7 ? ' soon' : '') + '"><div class="w">' + esc(inDays(x.days)) + '</div><div class="d">' + p[2] + ' ' + BULAN[p[1] - 1] + '</div>'
        + '<div class="nm">' + esc(s.name) + '</div><div class="am">' + esc(s.amount != null ? money(s.amount, s.currency) : 'jumlah belum diketahui') + '</div></div>';
    }).join('') + '</div></section>';
  }

  function rowHTML(s) {
    var open = !!S.open[s.id];
    var meta = [];
    if (s.status === 'Free trial' && s.trialEnds) meta.push('Trial sampai ' + date(s.trialEnds));
    else if (s.next) meta.push('Tagihan berikut ' + date(s.next));
    if (s.via) meta.push(s.via);
    if (s.area) meta.push(s.area);
    return '<li><div class="sb-row"><div class="t"><div class="n">' + esc(s.name) + pill(s.status) + '</div><div class="m">' + esc(meta.join(' · ')) + '</div></div>'
      + '<div class="a">' + esc(s.amount != null ? money(s.amount, s.currency) : '?') + '<small>' + esc(s.amount != null ? (CYCLE[s.cycle] || '') : 'belum diketahui') + '</small></div></div>'
      + (open ? '<div class="sb-opt"><b>Pilihan lain:</b> ' + esc(s.option || 'Belum ada catatan.') + (s.evidence ? '<div class="ev">Dari: ' + esc(s.evidence) + (s.verified ? ' (dicek ' + esc(date(s.verified)) + ')' : '') + '</div>' : '') + '</div>' : '')
      + '<button class="sb-more" data-sb="toggle" data-id="' + esc(s.id) + '">' + (open ? 'Tutup' : 'Pilihan lain') + '</button></li>';
  }

  function allHTML(d) {
    var groups = {};
    d.items.forEach(function (s) { (groups[s.status] = groups[s.status] || []).push(s); });
    var h = '<section class="sb-card sensitive"><h3>Semua langganan</h3><p class="sb-sub">' + d.items.length + ' baris. Ketuk Pilihan lain untuk alternatif dan dari email mana datanya.</p>';
    ORDER.forEach(function (st) {
      var g = groups[st]; if (!g || !g.length) return;
      if (st === 'Ended' && !S.showEnded) { h += '<button class="sb-more" data-sb="ended">Lihat ' + g.length + ' yang sudah berhenti</button>'; return; }
      g.sort(function (a, b) { return String(a.next || '9999').localeCompare(String(b.next || '9999')); });
      h += '<div class="sb-grp">' + esc(LABEL[st] || st) + ' (' + g.length + ')</div><ul class="sb-list">' + g.map(rowHTML).join('') + '</ul>';
    });
    return h + '</section>';
  }

  function footHTML(d) {
    var at = S.at ? S.at.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    return '<div class="sb-foot"><span>Dari database Notion Subscriptions' + (at ? ', dibaca ' + esc(at) : '') + '. Diperbarui tiap pagi dari inbox.</span>'
      + '<span><button class="sb-btn" data-sb="reload">Muat ulang</button> &nbsp;<a href="' + esc(d.notion) + '" target="_blank" rel="noopener">Buka di Notion</a></span></div>';
  }

  function render() {
    var root = document.getElementById(ROOT);
    if (!root) return;
    css();
    if (S.err && !S.data) {
      root.innerHTML = '<div class="sb-err" role="alert"><span><b>Daftar langganan belum bisa dibaca.</b> ' + esc(S.err) + '</span><button class="sb-btn" data-sb="reload">Coba lagi</button></div>';
      return;
    }
    if (!S.data) { root.innerHTML = '<div class="skel" aria-label="Memuat"></div>'; return; }
    var d = S.data;
    root.innerHTML = heroHTML(d) + alertsHTML(d) + nextHTML(d) + allHTML(d) + footHTML(d);
  }

  function load() {
    S.loading = true; S.err = '';
    render();
    return fetch('/api/subscriptions', { headers: headers(), cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }).then(function (j) {
        if (r.status === 401) throw new Error('Kunci OS belum dimasukkan di perangkat ini.');
        if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    }).then(function (j) { S.data = j; S.at = new Date(); S.loading = false; render(); })
      .catch(function (e) { S.loading = false; S.err = e.message || String(e); render(); });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#subs-root [data-sb]');
    if (!b) return;
    var a = b.getAttribute('data-sb');
    if (document.body.classList.contains('private')) { var card = b.closest('.sensitive'); if (card && !card.classList.contains('revealed')) return; }
    if (a === 'toggle') { var id = b.getAttribute('data-id'); S.open[id] = !S.open[id]; render(); }
    else if (a === 'ended') { S.showEnded = true; render(); }
    else if (a === 'reload') load();
  });

  window.subsOpen = function () {
    render();
    if (!S.loading && (!S.data || !S.at || Date.now() - S.at.getTime() > 60000)) load();
  };
})();
