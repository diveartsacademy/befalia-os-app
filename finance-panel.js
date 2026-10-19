/* finance-panel.js — the Finance tab (19 Oct 2026).
   ---------------------------------------------------------------------------
   Befa: "I don't like the finance tab looking just like notes. I want it to
   look like Apple, with images and elements, like an interactive artifact."
   And: the Google Sheet is the master ("I usually just take in the Google
   Sheet"), so this page reads her sheet FINANCIAL REPORT BEFALIA, tab HUTANG
   BEFA, through GET /api/finance, and a tick here ticks column A there.

   What it shows, top to bottom:
     - the hero: roughly how much debt is left, split into instalments with a
       schedule and debts without one, and the day the instalments end
     - a banner when ticks are waiting for Google (Drive storage full)
     - the next payments as passes, each with a round tick button
     - this month (a ring) and the months ahead (bars)
     - one card per lender
     - debts without a date or long past their date, urgent first
     - recent rows that are past their date but not ticked ("sudah bayar?")
     - the loose notes above the title row, never counted
   Every tick has Undo for 6 seconds before it is sent. Nothing here sends a
   message to anyone. Private mode blurs the amounts like the other cards.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';
  var ROOT = 'fin-root';
  var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1iVAYkNJJLYTeuL-xluOW_-HO3nTKBnRFmi8GvMnwhho/edit';
  var IMG = { hero: '/img/finance/hero.jpg', pass: '/img/finance/pass.jpg', lunas: '/img/finance/lunas.jpg' };
  var S = { data: null, err: '', loading: false, at: null, pending: {}, undo: null, notice: null, showNotes: false, showCheck: false, syncing: false };
  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  function headers() { return (typeof osHeaders === 'function') ? osHeaders() : {}; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rp(n) { return 'Rp' + Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function jt(n) {
    n = n || 0;
    if (n >= 1e9) return 'Rp' + (n / 1e9).toFixed(1).replace('.', ',') + ' M';
    if (n >= 1e6) return 'Rp' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace('.', ',').replace(/,0$/, '') + ' jt';
    if (n >= 1e3) return 'Rp' + Math.round(n / 1e3) + ' rb';
    return rp(n);
  }
  function parts(iso) { var p = String(iso || '').split('-').map(Number); return { y: p[0], m: p[1], d: p[2] }; }
  function dayName(iso) { var p = parts(iso); return HARI[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]; }
  function shortDate(iso) { if (!iso) return ''; var p = parts(iso); return p.d + ' ' + BULAN[p.m - 1] + (S.data && p.y !== parts(S.data.today).y ? ' ' + p.y : ''); }
  function longDate(iso) { var p = parts(iso); return p.d + ' ' + BULAN[p.m - 1] + ' ' + p.y; }
  function monthLong(ym) { var p = String(ym).split('-').map(Number); return BULAN_PANJANG[p[1] - 1] + (S.data && p[0] !== parts(S.data.today).y ? ' ' + p[0] : ''); }
  function daysUntil(iso) {
    var a = parts(S.data.today), b = parts(iso);
    return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
  }
  function when(iso) {
    var n = daysUntil(iso);
    if (n === 0) return 'Hari ini';
    if (n === 1) return 'Besok';
    if (n > 1 && n < 7) return n + ' hari lagi';
    if (n < 0) return (-n) + ' hari lalu';
    return dayName(iso) + ', ' + shortDate(iso);
  }
  function isPaid(it) { return S.pending[it.row] != null ? S.pending[it.row] : it.paid; }

  /* ---------- styles ---------- */
  function css() {
    if (document.getElementById('fin-css')) return;
    var s = document.createElement('style');
    s.id = 'fin-css';
    s.textContent = [
      '#fin-root{--fin-gold:#f2c97d;--fin-coral:#ff8fa3;--fin-sea:#7fe3c6;--fin-deep:#04121d;margin-top:14px;}',
      '#fin-root .fin-card{position:relative;border-radius:26px;background:linear-gradient(165deg,rgba(13,46,68,.62),rgba(4,18,29,.78));border:1px solid rgba(46,230,255,.13);box-shadow:var(--shadow);padding:20px 20px 18px;margin:0 0 16px;overflow:hidden;}',
      '#fin-root h3{font-family:var(--sans);font-size:15px;font-weight:650;letter-spacing:.1px;color:var(--ink);margin:0 0 4px;}',
      '#fin-root .fin-sub{font-size:13px;color:var(--muted);line-height:1.45;margin:0;}',
      '#fin-root .fin-row2{display:grid;grid-template-columns:1fr 1.4fr;gap:16px;}',
      '@media(max-width:820px){#fin-root .fin-row2{grid-template-columns:1fr;}}',
      /* hero */
      '#fin-root .fin-hero{min-height:250px;padding:26px 24px 22px;display:flex;flex-direction:column;justify-content:flex-end;background:#06192a;}',
      '#fin-root .fin-hero .art{position:absolute;inset:0;background-size:cover;background-position:center right;opacity:.92;}',
      '#fin-root .fin-hero .art.fallback{background:radial-gradient(120% 90% at 85% 10%,rgba(242,201,125,.30),transparent 55%),radial-gradient(90% 80% at 10% 100%,rgba(46,230,255,.22),transparent 60%),linear-gradient(170deg,#0b3550,#04121d 70%);}',
      '#fin-root .fin-hero .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(3,12,20,.92) 0%,rgba(3,12,20,.70) 46%,rgba(3,12,20,.10) 100%),linear-gradient(0deg,rgba(3,12,20,.75),transparent 60%);}',
      '#fin-root .fin-hero .in{position:relative;max-width:520px;}',
      '#fin-root .fin-hero .lbl{font-size:14px;color:var(--aquasoft);margin:0 0 2px;}',
      '#fin-root .fin-big{font-family:var(--serif);font-size:clamp(46px,9vw,74px);line-height:1;font-weight:600;color:#fff;letter-spacing:-.5px;margin:2px 0 10px;font-variant-numeric:lining-nums;}',
      '#fin-root .fin-split{display:flex;height:9px;border-radius:9px;overflow:hidden;background:rgba(255,255,255,.08);margin:6px 0 12px;max-width:440px;}',
      '#fin-root .fin-split i{display:block;height:100%;}',
      '#fin-root .fin-legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--ink);}',
      '#fin-root .fin-legend span{display:inline-flex;align-items:center;gap:7px;}',
      '#fin-root .fin-legend b{font-weight:650;}',
      '#fin-root .dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:none;}',
      '#fin-root .fin-end{margin-top:12px;font-size:13px;color:var(--muted);}',
      '#fin-root .fin-end b{color:var(--fin-gold);font-weight:650;}',
      /* banner */
      '#fin-root .fin-banner{display:flex;gap:12px;align-items:flex-start;border-radius:18px;padding:14px 16px;margin:0 0 16px;background:rgba(242,201,125,.09);border:1px solid rgba(242,201,125,.35);color:var(--ink);font-size:13.5px;line-height:1.45;}',
      '#fin-root .fin-banner.err{background:rgba(255,143,163,.08);border-color:rgba(255,143,163,.4);}',
      '#fin-root .fin-banner .ic{font-size:20px;line-height:1;}',
      '#fin-root .fin-btn{border:1px solid var(--aqualine);background:rgba(46,230,255,.08);color:var(--aquasoft);border-radius:999px;padding:7px 14px;font:600 13px var(--sans);cursor:pointer;white-space:nowrap;}',
      '#fin-root .fin-btn:hover{background:rgba(46,230,255,.16);}',
      '#fin-root .fin-btn:disabled{opacity:.5;cursor:default;}',
      '#fin-root .fin-btn:focus-visible,#fin-root .tick:focus-visible{outline:2px solid var(--aqua);outline-offset:2px;}',
      /* passes */
      '#fin-root .fin-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:4px 4px 10px;}',
      '#fin-root .fin-head h3{font-size:19px;font-family:var(--serif);font-weight:600;color:var(--aquasoft);}',
      '#fin-root .fin-head .fin-sub{font-size:12.5px;}',
      '#fin-root .passes{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 2px 14px;margin:0 -2px 6px;-webkit-overflow-scrolling:touch;}',
      '#fin-root .pass{scroll-snap-align:start;flex:0 0 228px;border-radius:22px;position:relative;overflow:hidden;padding:16px 16px 14px;min-height:178px;display:flex;flex-direction:column;background:linear-gradient(160deg,#0f3b57,#071c2c);border:1px solid rgba(46,230,255,.18);box-shadow:0 14px 30px rgba(0,8,18,.55);transition:opacity .25s,transform .25s;}',
      '#fin-root .pass.bill{background:linear-gradient(160deg,#0f4446,#062022);border-color:rgba(127,227,198,.24);}',
      '#fin-root .pass.soon{border-color:rgba(242,201,125,.55);}',
      '#fin-root .pass.done{opacity:.48;}',
      '#fin-root .pass .bg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.20;}',
      '#fin-root .pass .top{position:relative;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;}',
      '#fin-root .pass .when{font-size:12.5px;color:var(--aquasoft);font-weight:600;}',
      '#fin-root .pass.soon .when{color:var(--fin-gold);}',
      '#fin-root .pass .day{font-family:var(--serif);font-size:40px;line-height:1;color:#fff;font-weight:600;margin-top:4px;}',
      '#fin-root .pass .mon{font-size:13px;color:var(--muted);}',
      '#fin-root .pass .who{position:relative;margin-top:auto;font-size:14.5px;font-weight:650;color:var(--ink);line-height:1.25;}',
      '#fin-root .pass .amt{position:relative;font-family:var(--serif);font-size:21px;color:#fff;margin-top:2px;font-variant-numeric:lining-nums;}',
      '#fin-root .pass .kind{position:relative;font-size:11.5px;color:var(--muted);margin-top:2px;}',
      '#fin-root .tick{flex:none;width:38px;height:38px;border-radius:50%;border:2px solid rgba(234,249,255,.55);background:rgba(3,12,20,.35);color:transparent;font-size:18px;font-weight:800;cursor:pointer;display:grid;place-items:center;transition:background .2s,border-color .2s,color .2s;}',
      '#fin-root .tick.on{background:var(--fin-gold);border-color:var(--fin-gold);color:#2a1d05;}',
      '#fin-root .tick.sm{width:30px;height:30px;font-size:15px;}',
      /* ring + bars */
      '#fin-root .ringwrap{display:flex;align-items:center;gap:18px;margin-top:10px;}',
      '#fin-root .ring{flex:none;}',
      '#fin-root .ringtxt .n{font-family:var(--serif);font-size:26px;color:#fff;line-height:1.1;}',
      '#fin-root .ringtxt .s{font-size:13px;color:var(--muted);line-height:1.5;}',
      '#fin-root .ringtxt .s b{color:var(--ink);font-weight:600;}',
      '#fin-root .bars{display:flex;align-items:flex-end;gap:8px;height:150px;margin-top:14px;}',
      '#fin-root .bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0;}',
      '#fin-root .bar .v{font-size:11px;color:var(--ink);margin-bottom:4px;white-space:nowrap;}',
      '#fin-root .bar .col{width:100%;max-width:38px;display:flex;flex-direction:column-reverse;border-radius:9px 9px 4px 4px;overflow:hidden;}',
      '#fin-root .bar .col i{display:block;width:100%;}',
      '#fin-root .bar .m{font-size:11.5px;color:var(--muted);margin-top:6px;}',
      '#fin-root .bar.now .m{color:var(--aquasoft);font-weight:650;}',
      /* lenders */
      '#fin-root .lenders{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;}',
      '@media(max-width:520px){#fin-root .lenders{grid-template-columns:1fr 1fr;gap:10px;}#fin-root .lender{padding:13px 13px;}#fin-root .lender .rem{font-size:20px;}#fin-root .lender .nm{font-size:13.5px;gap:8px;}#fin-root .lender .lbadge{width:28px;height:28px;font-size:12px;border-radius:9px;}}',
      '#fin-root .lender{border-radius:20px;padding:15px 16px;background:rgba(4,18,29,.55);border:1px solid rgba(46,230,255,.12);}',
      '#fin-root .lender .nm{display:flex;align-items:center;gap:10px;font-weight:650;font-size:14.5px;color:var(--ink);}',
      '#fin-root .lender .lbadge{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;font:700 14px var(--serif);color:#03121d;flex:none;}',
      '#fin-root .lender .rem{font-family:var(--serif);font-size:24px;color:#fff;margin:10px 0 2px;}',
      '#fin-root .prog{height:6px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden;margin:8px 0 6px;}',
      '#fin-root .prog i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,var(--fin-gold),#ffe2a8);}',
      /* lists */
      '#fin-root .list{list-style:none;margin:10px 0 0;padding:0;}',
      '#fin-root .list li{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid rgba(46,230,255,.09);}',
      '#fin-root .list li:first-child{border-top:none;}',
      '#fin-root .list .t{flex:1;min-width:0;}',
      '#fin-root .list .t .a{font-weight:650;color:var(--ink);font-size:14.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '#fin-root .list .t .b{font-size:12.5px;color:var(--muted);margin-top:2px;}',
      '#fin-root .list .amt{font-family:var(--serif);font-size:18px;color:#fff;white-space:nowrap;}',
      '#fin-root .list li.done .t,#fin-root .list li.done .amt{opacity:.45;text-decoration:line-through;}',
      '#fin-root .pill{font:700 10.5px var(--sans);letter-spacing:.3px;padding:3px 8px;border-radius:999px;background:rgba(255,143,163,.16);color:var(--fin-coral);}',
      '#fin-root .pill.gold{background:rgba(242,201,125,.15);color:var(--fin-gold);}',
      '#fin-root .pill.sea{background:rgba(127,227,198,.14);color:var(--fin-sea);}',
      '#fin-root .fold{background:none;border:none;color:var(--aquasoft);font:600 13px var(--sans);cursor:pointer;padding:6px 0 0;}',
      '#fin-root .foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;font-size:12.5px;color:var(--dim);margin:4px 4px 24px;}',
      '#fin-root .foot a{color:var(--aquasoft);}',
      '#fin-root .skel{height:250px;border-radius:26px;background:linear-gradient(100deg,rgba(13,46,68,.4) 30%,rgba(46,230,255,.08) 50%,rgba(13,46,68,.4) 70%);background-size:300% 100%;animation:finsk 1.6s infinite;}',
      '@keyframes finsk{0%{background-position:100% 0}100%{background-position:0 0}}',
      '#fin-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:80;background:#0c2a3d;border:1px solid var(--aqualine);color:var(--ink);border-radius:16px;padding:11px 12px 11px 16px;display:flex;gap:14px;align-items:center;box-shadow:var(--shadow);font:14px var(--sans);max-width:calc(100vw - 32px);}',
      '#fin-toast button{background:none;border:none;color:var(--fin-gold,#f2c97d);font:700 14px var(--sans);cursor:pointer;padding:4px 6px;}',
      '@media (prefers-reduced-motion:reduce){#fin-root .skel{animation:none}#fin-root .pass{transition:none}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------- drawing ---------- */
  var LENDER_COLORS = ['#2ee6ff', '#7fe3c6', '#f2c97d', '#ff8fa3', '#9fb7ff', '#c7a6ff', '#8df3ff', '#ffd1a1'];
  function lenderColor(name) {
    var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return LENDER_COLORS[h % LENDER_COLORS.length];
  }
  function initials(name) { return String(name).replace(/[^A-Za-z0-9+ ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '?'; }

  function heroHTML(d) {
    var t = d.totals, tot = t.debt || 1;
    var seg = function (v, c) { return v > 0 ? '<i style="width:' + (v / tot * 100).toFixed(2) + '%;background:' + c + '"></i>' : ''; };
    var undated = t.undated + t.overdue;
    return '<section class="fin-card fin-hero sensitive" aria-label="Sisa hutang">'
      + '<div class="art fallback" data-art="hero"></div><div class="shade"></div>'
      + '<div class="in"><p class="lbl">Sisa hutang, kira-kira</p>'
      + '<div class="fin-big">' + esc(jt(t.debt)) + '</div>'
      + '<div class="fin-split" role="img" aria-label="Cicilan terjadwal ' + esc(jt(t.scheduled)) + ', tanpa jadwal ' + esc(jt(undated)) + '">' + seg(t.scheduled, 'var(--aqua)') + seg(undated, 'var(--fin-coral)') + '</div>'
      + '<div class="fin-legend"><span><i class="dot" style="background:var(--aqua)"></i>Cicilan terjadwal <b>' + esc(jt(t.scheduled)) + '</b></span>'
      + '<span><i class="dot" style="background:var(--fin-coral)"></i>Tanpa jadwal <b>' + esc(jt(undated)) + '</b></span></div>'
      + (t.scheduledEnds ? '<p class="fin-end">Kalau dibayar sesuai jadwal, cicilan terakhir <b>' + esc(longDate(t.scheduledEnds)) + '</b>.</p>' : '')
      + '</div></section>';
  }

  function bannerHTML(d) {
    var out = '';
    var waiting = (d.waiting || []).filter(function (r) { return S.pending[r] !== false; });
    if (waiting.length) {
      out += '<div class="fin-banner" role="status"><span class="ic">⏳</span><div style="flex:1">'
        + '<b>' + waiting.length + ' pembayaran menunggu Google.</b> Sudah dicatat sebagai selesai di To-Do. Sheet belum bisa disimpan karena storage Google penuh, jadi centangnya akan masuk sendiri begitu storage lega lagi.'
        + '</div><button class="fin-btn" data-fin="sync"' + (S.syncing ? ' disabled' : '') + '>' + (S.syncing ? 'Mencoba…' : 'Coba kirim') + '</button></div>';
    }
    if (S.notice) out += '<div class="fin-banner' + (S.notice.err ? ' err' : '') + '" role="status"><span class="ic">' + (S.notice.err ? '⚠️' : '✓') + '</span><div style="flex:1">' + esc(S.notice.text) + '</div></div>';
    return out;
  }

  function passHTML(it) {
    var paid = isPaid(it), n = daysUntil(it.due), p = parts(it.due);
    var cls = 'pass' + (it.kind === 'regular' ? ' bill' : '') + (n <= 3 && !paid ? ' soon' : '') + (paid ? ' done' : '');
    return '<article class="' + cls + '">'
      + '<div class="bg" data-art="pass"></div>'
      + '<div class="top"><div><div class="when">' + esc(when(it.due)) + '</div><div class="day">' + p.d + '</div><div class="mon">' + esc(BULAN_PANJANG[p.m - 1]) + '</div></div>'
      + tickHTML(it, paid, '') + '</div>'
      + '<div class="who">' + esc(it.lender) + '</div>'
      + '<div class="amt">' + esc(rp(it.amount)) + '</div>'
      + '<div class="kind">' + (it.kind === 'regular' ? 'Tagihan rutin' : 'Cicilan') + '</div>'
      + '</article>';
  }
  function tickHTML(it, paid, extra) {
    return '<button class="tick' + (paid ? ' on' : '') + (extra ? ' ' + extra : '') + '" data-fin="tick" data-row="' + it.row + '" aria-pressed="' + (paid ? 'true' : 'false') + '" aria-label="' + esc((paid ? 'Batalkan lunas: ' : 'Tandai lunas: ') + it.lender + ' ' + rp(it.amount)) + '">✓</button>';
  }

  function nextHTML(d) {
    var list = d.next || [];
    if (!list.length) return '';
    var sum14 = 0, today = d.today;
    list.forEach(function (x) { if (daysUntil(x.due) <= 14 && !isPaid(x)) sum14 += x.amount || 0; });
    return '<div class="fin-head"><h3>Yang harus dibayar</h3><p class="fin-sub">' + (sum14 ? esc(jt(sum14)) + ' dalam 2 minggu' : 'Tidak ada dalam 2 minggu') + '</p></div>'
      + '<div class="passes sensitive" role="list">' + list.map(passHTML).join('') + '</div>';
  }

  function ringSVG(frac) {
    var r = 38, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
    return '<svg class="ring" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="' + Math.round(f * 100) + ' persen sudah dicentang">'
      + '<circle cx="48" cy="48" r="' + r + '" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="11"/>'
      + '<circle cx="48" cy="48" r="' + r + '" fill="none" stroke="#f2c97d" stroke-width="11" stroke-linecap="round" stroke-dasharray="' + (c * f).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 48 48)"/>'
      + '<text x="48" y="54" text-anchor="middle" fill="#fff" font-family="Iowan Old Style,Palatino,Georgia,serif" font-size="20">' + Math.round(f * 100) + '%</text></svg>';
  }

  function monthHTML(d) {
    var m = d.thisMonth;
    var frac = m.total ? m.paid / m.total : 0;
    return '<section class="fin-card sensitive"><h3>' + esc(monthLong(m.month)) + '</h3><p class="fin-sub">Semua yang jatuh tempo bulan ini, termasuk tagihan rutin.</p>'
      + '<div class="ringwrap">' + ringSVG(frac) + '<div class="ringtxt"><div class="n">' + esc(jt(m.total)) + '</div>'
      + '<div class="s">Sudah dicentang <b>' + esc(jt(m.paid)) + '</b><br>Masih akan datang <b>' + esc(jt(m.left)) + '</b>'
      + (m.unticked ? '<br>Lewat tanggal, belum dicentang <b>' + esc(jt(m.unticked)) + '</b>' : '') + '</div></div></div></section>';
  }

  function barsHTML(d) {
    var ms = (d.months || []).slice(0, 8);
    if (!ms.length) return '';
    var max = Math.max.apply(null, ms.map(function (x) { return x.debt + x.bills; })) || 1;
    var nowYm = d.today.slice(0, 7);
    return '<section class="fin-card sensitive"><h3>Bulan ke bulan</h3><p class="fin-sub"><i class="dot" style="background:var(--aqua)"></i> cicilan &nbsp; <i class="dot" style="background:var(--fin-sea)"></i> tagihan rutin. Yang belum dibayar saja.</p>'
      + '<div class="bars" role="img" aria-label="Cicilan per bulan">' + ms.map(function (x) {
        var h1 = x.debt / max * 112, h2 = x.bills / max * 112, p = x.month.split('-').map(Number);
        return '<div class="bar' + (x.month === nowYm ? ' now' : '') + '"><div class="v">' + esc(jt(x.debt + x.bills).replace('Rp', '')) + '</div>'
          + '<div class="col" style="height:' + Math.max(3, h1 + h2).toFixed(0) + 'px"><i style="height:' + h1.toFixed(1) + 'px;background:var(--aqua)"></i><i style="height:' + h2.toFixed(1) + 'px;background:var(--fin-sea)"></i></div>'
          + '<div class="m">' + BULAN[p[1] - 1] + '</div></div>';
      }).join('') + '</div></section>';
  }

  function lendersHTML(d) {
    var ls = d.lenders || [];
    if (!ls.length) return '';
    return '<div class="fin-head"><h3>Per pemberi pinjaman</h3><p class="fin-sub">' + ls.length + ' cicilan berjalan</p></div>'
      + '<div class="lenders sensitive">' + ls.map(function (l) {
        var total = l.paid + l.left, frac = total ? l.paid / total : 0, col = lenderColor(l.lender);
        return '<div class="lender"><div class="nm"><span class="lbadge" style="background:' + col + '">' + esc(initials(l.lender)) + '</span>' + esc(l.lender) + '</div>'
          + '<div class="rem">' + esc(jt(l.remaining)) + '</div>'
          + '<div class="prog" aria-label="' + l.paid + ' dari ' + total + ' sudah dicentang"><i style="width:' + (frac * 100).toFixed(1) + '%"></i></div>'
          + '<p class="fin-sub">Sisa ' + l.left + 'x, berikutnya ' + esc(shortDate(l.next)) + '. Selesai ' + esc(longDate(l.last)) + '.</p></div>';
      }).join('') + '</div><div style="height:16px"></div>';
  }

  function rowLI(it, sub) {
    var paid = isPaid(it);
    return '<li class="' + (paid ? 'done' : '') + '">' + (it.amount != null ? tickHTML(it, paid, 'sm') : '<span style="width:30px"></span>')
      + '<div class="t"><div class="a">' + esc(it.lender) + (it.urgent ? ' <span class="pill">Segera</span>' : '') + (it.kind === 'overdue' ? ' <span class="pill gold">Lewat ' + esc(shortDate(it.due)) + '</span>' : '') + '</div>'
      + '<div class="b">' + esc(sub) + '</div></div>'
      + '<div class="amt">' + (it.amount != null ? esc(jt(it.amount)) : esc(it.amountText || 'Jumlah belum jelas')) + '</div></li>';
  }

  function undatedHTML(d) {
    var list = d.undated || [];
    if (!list.length) return '';
    return '<section class="fin-card sensitive"><h3>Tanpa jadwal</h3><p class="fin-sub">Hutang tanpa tanggal bayar, atau yang tanggalnya sudah lama lewat. Belum ada pengingatnya karena belum ada tanggal.</p>'
      + '<ul class="list">' + list.map(function (it) {
        var sub = it.note && it.note.toUpperCase() !== it.lender.toUpperCase() ? it.note : ((it.urgent ? '' : it.dueText) || (it.due ? 'Jatuh tempo ' + longDate(it.due) : 'Belum ada tanggal'));
        return rowLI(it, sub);
      }).join('') + '</ul></section>';
  }

  function checkHTML(d) {
    var list = d.check || [];
    if (!list.length) return '';
    var open = list.filter(function (x) { return !isPaid(x); });
    var sum = open.reduce(function (a, x) { return a + (x.amount || 0); }, 0);
    return '<section class="fin-card sensitive"><h3>Sudah bayar? ' + open.length + ' belum dicentang</h3>'
      + '<p class="fin-sub">Tanggalnya sudah lewat dalam 45 hari terakhir, tapi di sheet belum dicentang (' + esc(jt(sum)) + '). Biasanya sudah dibayar. Tidak dihitung sebagai hutang.</p>'
      + (S.showCheck ? '<ul class="list">' + list.map(function (it) { return rowLI(it, 'Jatuh tempo ' + shortDate(it.due)); }).join('') + '</ul>'
        + (open.length > 1 ? '<div style="margin-top:12px"><button class="fin-btn" data-fin="tickall">Centang semua ' + open.length + '</button></div>' : '')
        : '<button class="fold" data-fin="showcheck">Lihat daftarnya</button>')
      + '</section>';
  }

  function notesHTML(d) {
    var ns = (d.notes || []).filter(function (n) { return n.text || n.amount; });
    var dups = d.dups || [];
    if (!ns.length && !dups.length) return '';
    var h = '<section class="fin-card sensitive"><h3>Catatan di atas sheet</h3><p class="fin-sub">Tidak dihitung, karena belum jelas masih berlaku atau tidak.' + (d.totals.noteTotal ? ' Yang ada angkanya: ' + esc(jt(d.totals.noteTotal)) + '.' : '') + '</p>';
    if (S.showNotes) {
      h += '<ul class="list">' + ns.map(function (n) {
        return '<li><span style="width:30px;text-align:center;color:var(--dim)">' + n.row + '</span><div class="t"><div class="a">' + esc(n.text || 'Tanpa keterangan') + '</div></div><div class="amt">' + (n.amount ? esc(jt(n.amount)) : '') + '</div></li>';
      }).join('') + dups.map(function (x) {
        return '<li><span style="width:30px;text-align:center;color:var(--dim)">' + x.row + '</span><div class="t"><div class="a">' + esc(x.lender) + ' <span class="pill sea">Dobel</span></div><div class="b">Sama persis dengan baris ' + x.dup + ' (' + esc(shortDate(x.due)) + '). Dihitung sekali. Hapus salah satu di sheet.</div></div><div class="amt">' + esc(jt(x.amount)) + '</div></li>';
      }).join('') + '</ul>';
    } else h += '<button class="fold" data-fin="shownotes">Lihat ' + (ns.length + dups.length) + ' catatan</button>';
    return h + '</section>';
  }

  function footHTML() {
    var at = S.at ? S.at.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    return '<div class="foot"><span>Dari sheet HUTANG BEFA' + (at ? ', dibaca ' + esc(at) : '') + '. Kamu tetap bisa edit langsung di sheet.</span>'
      + '<span><button class="fin-btn" data-fin="reload">Muat ulang</button> &nbsp;<a href="' + SHEET_URL + '" target="_blank" rel="noopener">Buka sheet</a></span></div>';
  }

  function render() {
    var root = document.getElementById(ROOT);
    if (!root) return;
    css();
    if (S.err && !S.data) {
      root.innerHTML = '<div class="fin-banner err" role="alert"><span class="ic">⚠️</span><div style="flex:1"><b>Sheet hutang belum bisa dibaca.</b> ' + esc(S.err) + '</div><button class="fin-btn" data-fin="reload">Coba lagi</button></div>';
      return;
    }
    if (!S.data) { root.innerHTML = '<div class="skel" aria-label="Memuat"></div>'; return; }
    var d = S.data;
    root.innerHTML = heroHTML(d) + bannerHTML(d) + nextHTML(d)
      + '<div class="fin-row2">' + monthHTML(d) + barsHTML(d) + '</div>'
      + lendersHTML(d) + undatedHTML(d) + checkHTML(d) + notesHTML(d) + footHTML();
    art(root);
  }

  /* Canva art: shown when the file exists, the gradient stays when it does not. */
  var ART_OK = {};
  function art(root) {
    Object.keys(IMG).forEach(function (k) {
      var els = root.querySelectorAll('[data-art="' + k + '"]');
      if (!els.length) return;
      var apply = function () { els.forEach(function (el) { el.style.backgroundImage = 'url(' + IMG[k] + ')'; el.classList.remove('fallback'); }); };
      if (ART_OK[k] === true) return apply();
      if (ART_OK[k] === false) return;
      var im = new Image();
      im.onload = function () { ART_OK[k] = true; apply(); };
      im.onerror = function () { ART_OK[k] = false; };
      im.src = IMG[k];
    });
  }

  /* ---------- data ---------- */
  function load() {
    S.loading = true; S.err = '';
    render();
    return fetch('/api/finance', { headers: headers(), cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }).then(function (j) {
        if (r.status === 401) throw new Error('Kunci OS belum dimasukkan di perangkat ini.');
        if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    }).then(function (j) {
      S.data = j; S.at = new Date(); S.loading = false; S.pending = {};
      render();
      if ((j.waiting && j.waiting.length) || j.closable) sync(true);
    }).catch(function (e) { S.loading = false; S.err = e.message || String(e); render(); });
  }
  function post(body) {
    return fetch('/api/finance', { method: 'POST', headers: headers(), body: JSON.stringify(body), cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }).then(function (j) { if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
    });
  }
  function sync(quiet) {
    if (S.syncing) return;
    S.syncing = true; render();
    post({ action: 'sync' }).then(function (j) {
      S.syncing = false;
      if (j.pushed && j.pushed.length) { S.notice = { text: j.pushed.length + ' centang sudah masuk ke sheet.' }; return load(); }
      if (j.closed) return load();
      if (!quiet && j.waiting && j.waiting.length) S.notice = { err: true, text: 'Google masih belum bisa menyimpan' + (j.storage ? ' (storage penuh)' : '') + '. Centangnya tetap aman di To-Do.' };
      render();
    }).catch(function (e) { S.syncing = false; if (!quiet) S.notice = { err: true, text: e.message }; render(); });
  }

  function findItem(row) {
    var all = (S.data && S.data.items) || [];
    for (var i = 0; i < all.length; i++) if (all[i].row === row) return all[i];
    return null;
  }

  // A tick shows at once, waits 6 seconds for Undo, then goes to the server.
  function tick(rows, paid) {
    if (S.undo) { clearTimeout(S.undo.timer); send(S.undo.rows, S.undo.paid); }
    rows.forEach(function (r) { S.pending[r] = paid; });
    S.notice = null;
    render();
    var label = rows.length === 1 ? ((findItem(rows[0]) || {}).lender || 'Pembayaran') + (paid ? ' ditandai lunas' : ' dibatalkan') : rows.length + ' pembayaran ditandai lunas';
    showToast(label, function () {
      if (!S.undo) return;
      clearTimeout(S.undo.timer);
      S.undo.rows.forEach(function (r) { delete S.pending[r]; });
      S.undo = null; hideToast(); render();
    });
    S.undo = { rows: rows, paid: paid, timer: setTimeout(function () { var u = S.undo; S.undo = null; hideToast(); if (u) send(u.rows, u.paid); }, 6000) };
  }
  function send(rows, paid) {
    post({ action: 'tick', ticks: rows.map(function (r) { return { row: r, paid: paid }; }) }).then(function (j) {
      rows.forEach(function (r) { var it = findItem(r); if (it) it.paid = paid; delete S.pending[r]; });
      if (!j.saved && paid) {
        S.data.waiting = Array.from(new Set((S.data.waiting || []).concat(rows)));
        S.notice = null;
      } else if (!j.saved && !paid) {
        S.notice = { err: true, text: 'Di To-Do sudah dibatalkan, tapi sheet belum bisa disimpan' + (j.storage ? ' (storage penuh)' : '') + '. Hapus centangnya di sheet nanti kalau perlu.' };
      } else {
        S.data.waiting = (S.data.waiting || []).filter(function (r) { return rows.indexOf(r) < 0; });
      }
      if (j.saved) return load();
      render();
    }).catch(function (e) {
      rows.forEach(function (r) { delete S.pending[r]; });
      S.notice = { err: true, text: 'Tidak tersimpan: ' + e.message };
      render();
    });
  }

  function showToast(text, onUndo) {
    var t = document.getElementById('fin-toast');
    if (!t) { t = document.createElement('div'); t.id = 'fin-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = '<span>' + esc(text) + '</span><button type="button">Undo</button>';
    t.querySelector('button').onclick = onUndo;
    t.style.display = 'flex';
  }
  function hideToast() { var t = document.getElementById('fin-toast'); if (t) t.style.display = 'none'; }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#fin-root [data-fin]');
    if (!b) return;
    var a = b.getAttribute('data-fin');
    if (document.body.classList.contains('private')) { var card = b.closest('.sensitive'); if (card && !card.classList.contains('revealed')) return; }
    if (a === 'tick') { var row = +b.getAttribute('data-row'), it = findItem(row); if (it) tick([row], !isPaid(it)); }
    else if (a === 'tickall') { var rows = (S.data.check || []).filter(function (x) { return !isPaid(x) && x.amount != null; }).map(function (x) { return x.row; }); if (rows.length) tick(rows, true); }
    else if (a === 'sync') sync(false);
    else if (a === 'reload') load();
    else if (a === 'showcheck') { S.showCheck = true; render(); }
    else if (a === 'shownotes') { S.showNotes = true; render(); }
  });

  window.finOpen = function () {
    render();
    if (!S.loading && (!S.data || !S.at || Date.now() - S.at.getTime() > 60000)) load();
  };
  // A tick on a payment reminder in To-Do has to reach the sheet: done sends
  // every waiting row; undone unticks the reminder's rows in the sheet.
  window.finAfterTodoTick = function (notes, done) {
    var m = /baris\s+([\d\s,dan&]+)/i.exec(String(notes || ''));
    var rows = m ? (m[1].match(/\d+/g) || []).map(Number) : [];
    var call = done ? post({ action: 'sync' }) : (rows.length ? post({ action: 'tick', ticks: rows.map(function (r) { return { row: r, paid: false }; }) }) : null);
    if (call) call.then(function () { if (S.data) load(); }).catch(function () {});
  };
})();
