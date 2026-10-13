/* Copied unchanged from divearts-os/sd-overview.js on 13 Oct 2026 (commit 7159bfe), so the
   Business tab and the Sea Diva Overview read the sheet by the same rules. If one
   changes, copy it again. */
/* sd-overview.js  (2 Oct 2026)
   ---------------------------------------------------------------------------
   The rules behind the Sea Diva Overview. Pure functions, no network and no
   page, so the same code runs in the browser and under node --test.

   What Befa asked for, in her words, and how each is decided here:

   "all orders that are not done yet ... they pay, but the production is not
   finished yet"
     An order counts when money has come in and at least one product line is
     not DONE. Money in means: MANUAL column "Production Payment Status" says
     PAID, Deposit, Installment Plan or Production Paid; every Shopee and
     Tokopedia/TikTok order (the platform holds the money); Shopify orders whose
     Financial Status is paid or partially_paid and that are not cancelled.
     WAITING FOR PAYMENT orders are not production work. They are listed under
     money instead, with any work already started named, so nothing hides.

   "which ones need the designer to create a design"
     Status Produksi = Design Needs to Be Made, or Design in Progress.

   "which ones need to be ordered from a third party ... send me the link"
     Order from 3rd Party = still to buy. Ordered = bought, waiting to arrive.
     When it arrives the sheet moves it to Ready to be shipped, so it shows up
     under shipping. The buy link comes from PRODUCT LIST SDT, SOURCE LINK 1
     and 2, through seadiva.v_product_source_links.

   "what needs to be shipped ... already stocked and we can just ship it"
     Rule B2 (3 Sep 2026): shipping is an order level fact. An order is ready
     to ship when every product on it that is not DONE reads Ready Stock, Ready
     to be shipped, Ready to Send or Shipping Process. An order where some
     items are ready and others are not is listed as partly ready, with what
     it is waiting for.

   "What's on Shopify as well that's unfulfilled"
     SHOPIFY-OL rows with Fulfillment Status unfulfilled or partial, paid, not
     cancelled.

   Every column is found by its header text at run time. A tab whose headers
   cannot be found is refused by name, and the rest of the page still works.
   Nothing here guesses a column letter.
--------------------------------------------------------------------------- */
(function (root) {
  'use strict';

  var TABS = [
    { src: 'MANUAL (IG & WA) - OL',     channel: 'manual',  label: 'Manual (IG & WA)' },
    { src: 'SHOPEE - OL',               channel: 'shopee',  label: 'Shopee' },
    { src: 'TOKOPEDIA/TIKTOK shop -OL', channel: 'toko',    label: 'Tokopedia / TikTok' },
    { src: 'SHOPIFY-OL',                channel: 'shopify', label: 'Shopify' }
  ];

  /* Status Produksi words, grouped. Lower case, spaces collapsed. Anything
     not listed lands in "other" and is shown as typed, never dropped. */
  var STATUS = {
    'done': 'done',
    'excluded shipping fee': 'ignore',
    'ready stock': 'ready',
    'ready to be shipped': 'ready',
    'ready to send': 'ready',
    'shipping process': 'shipping',
    'design needs to be made': 'design_todo',
    'design making': 'design_todo',
    'design in progress': 'design_wip',
    'order from 3rd party': 'third_todo',
    'ordering from 3rdparty': 'third_todo',
    'ordered': 'third_ordered',
    'printing': 'making',
    'sewing / building': 'making',
    'fluke filler making': 'making',
    'need to create': 'making',
    'in the making': 'making',
    '': 'blank'
  };

  var DAY = 86400000;

  function txt(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function low(v) { return txt(v).toLowerCase(); }

  function colNum(c) { var n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64); return n; }

  function cell(cells, col) {
    if (!col || !cells) return '';
    var x = cells[col];
    if (!x) return '';
    var d = x.d;
    if (d !== undefined && d !== null && txt(d) !== '') return txt(d);
    return x.v === undefined || x.v === null ? '' : txt(x.v);
  }
  function raw(cells, col) {
    if (!col || !cells || !cells[col]) return null;
    return cells[col].v === undefined ? null : cells[col].v;
  }

  /* A number out of a money cell. #VALUE! and friends return null, never 0,
     so a broken formula is reported rather than read as paid. */
  function money(cells, col) {
    var v = raw(cells, col);
    if (v === null || v === '') return null;
    if (typeof v === 'number') return v;
    var s = String(v);
    if (/^#/.test(s.trim())) return NaN;
    var n = Number(s.replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : null;
  }

  var MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, mei:4, jun:5, jul:6, aug:7, agu:7, agt:7, agustus:7,
                 sep:8, okt:9, oct:9, nov:10, dec:11, des:11, desember:11, april:3, maret:2, juni:5, juli:6 };

  /* The sheet writes dates four ways. Returns a Date at local midnight, or null. */
  function parseDate(v, shown) {
    var s = txt(v);
    var m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s))) {
      /* Sheets midnight in WITA/WIB arrives as the previous day 16:00 or 17:00
         UTC. Adding 8 hours puts it back on the right calendar day. */
      var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + 8 * 3600000;
      var d0 = new Date(t);
      return new Date(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
    }
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3]);
    var t2 = txt(shown || s);
    if ((m = /^(\d{1,2})[\s\-\/]([A-Za-z]+)[\s\-\/,]+(\d{2,4})/.exec(t2))) {
      var mo = MONTHS[m[2].toLowerCase()] !== undefined ? MONTHS[m[2].toLowerCase()] : MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (mo !== undefined) {
        var y = +m[3]; if (y < 100) y += 2000;
        return new Date(y, mo, +m[1]);
      }
    }
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t2))) return new Date(+m[3], +m[1] - 1, +m[2]);
    return null;
  }

  function daysSince(d, now) {
    if (!d) return null;
    var a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((a - d) / DAY);
  }

  /* ---------------------------------------------------------------------
     Headers. Every text in the first six rows, keyed by its lower case,
     space collapsed form, with the columns it sits in, left to right.
  --------------------------------------------------------------------- */
  function headerMap(rows) {
    var map = {}, last = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.row_no > 6) continue;
      var cells = r.cells || {};
      for (var col in cells) {
        var t = low(cells[col] && (cells[col].d !== undefined && cells[col].d !== null && txt(cells[col].d) !== '' ? cells[col].d : cells[col].v));
        if (!t) continue;
        (map[t] = map[t] || []).push({ col: col, n: colNum(col), row: r.row_no });
      }
    }
    for (var k in map) map[k].sort(function (a, b) { return a.n - b.n; });
    return map;
  }

  function findOne(map, names) {
    for (var i = 0; i < names.length; i++) {
      var hit = map[names[i]];
      if (hit && hit.length) return hit[0];
    }
    return null;
  }
  function findRe(map, re) {
    var out = [];
    for (var k in map) if (re.test(k)) out = out.concat(map[k]);
    return out.sort(function (a, b) { return a.n - b.n; });
  }

  /* Resolve one order tab. Returns { ok, error, cols, headerRow }. */
  function resolveTab(src, rows) {
    var map = headerMap(rows);
    var need = [];
    var status = (map['status produksi'] || []).slice();
    var items = findRe(map, /^\d+\. item \/ description$/);
    var inv = findOne(map, ['invoice no', 'no pesanan', 'invoice month no']);
    var name = findOne(map, ['name', 'customer name']);
    var pay = findOne(map, ['production payment status', 'status payment', 'financial status']);
    var date = findOne(map, ['invoice date', 'created at']);
    if (!status.length) need.push('Status Produksi');
    if (!items.length) need.push('Item / Description');
    if (!inv) need.push('Invoice No');
    if (!name) need.push('Name');
    if (!pay) need.push('Payment Status');
    if (!date) need.push('Invoice Date');
    if (need.length) return { ok: false, error: src + ' has no header for ' + need.join(', ') + ', so it was not read.' };
    if (status.length !== items.length) {
      return { ok: false, error: src + ' has ' + status.length + ' Status Produksi columns but ' + items.length +
        ' Item / Description columns, so the products cannot be paired safely. Not read.' };
    }
    /* Each item column must sit after its own status column and before the
       next one. Otherwise the pairing is wrong and the tab is refused. */
    for (var i = 0; i < status.length; i++) {
      var nextStatus = i + 1 < status.length ? status[i + 1].n : Infinity;
      if (!(items[i].n > status[i].n && items[i].n < nextStatus)) {
        return { ok: false, error: src + ': product ' + (i + 1) + ' item column ' + items[i].col +
          ' does not sit after its Status Produksi column ' + status[i].col + '. Not read.' };
      }
    }
    var headerRow = 0;
    [inv, name, pay].forEach(function (h) { if (h.row > headerRow) headerRow = h.row; });
    status.forEach(function (h) { if (h.row > headerRow) headerRow = h.row; });

    var cols = {
      slots: status.map(function (s, i) { return { status: s.col, item: items[i].col }; }),
      inv: inv.col, name: name.col, pay: pay.col, date: date.col,
      phone: (findOne(map, ['phone number', 'billing phone', 'shipping phone']) || {}).col,
      shipBy: (findOne(map, ['batas pengiriman']) || {}).col,
      fulfil: (findOne(map, ['fulfillment status']) || {}).col,
      cancelled: (findOne(map, ['cancelled at']) || {}).col,
      totalIdr: (findOne(map, ['total (idr)']) || {}).col,
      totalUsd: (findOne(map, ['total (usd)']) || {}).col,
      owedIdr: (findRe(map, /^outstanding payment.*idr/)[0] || {}).col,
      owedUsd: (findRe(map, /^outstanding payment.*usd/)[0] || {}).col,
      instal: instalmentBlocks(map)
    };
    if (src === 'SHOPIFY-OL' && !cols.fulfil) {
      return { ok: false, error: 'SHOPIFY-OL has no Fulfillment Status header, so unfulfilled orders cannot be told apart. Not read.' };
    }
    return { ok: true, cols: cols, headerRow: headerRow };
  }

  /* MANUAL carries up to eight instalment blocks, each starting at a Tanggal
     header. Each block's columns are found inside its own span. */
  function instalmentBlocks(map) {
    var starts = (map['tanggal'] || []).map(function (h) { return h.n; });
    if (!starts.length) return [];
    var want = {
      planIdr: /^jumlah cicilan rencana \(idr\)$/,
      planUsd: /^jumlah cicilan rencana \(usd\)$/,
      paidIdr: /^jumlah cicilan transfered \(idr\)$/,
      paidUsd: /^jumlah cicilan transfered \(usd\)$/,
      paidFlag: /^payment status paid\/not$/
    };
    var all = [];
    for (var k in map) map[k].forEach(function (h) { all.push({ t: k, col: h.col, n: h.n }); });
    var tcols = (map['tanggal'] || []);
    return tcols.map(function (t, i) {
      var end = i + 1 < tcols.length ? tcols[i + 1].n : t.n + 12;
      var b = { date: t.col };
      all.forEach(function (h) {
        if (h.n <= t.n || h.n >= end) return;
        for (var key in want) if (!b[key] && want[key].test(h.t)) b[key] = h.col;
      });
      return b;
    });
  }

  function payKind(channel, payText, cells, cols) {
    var p = low(payText);
    if (channel === 'shopee' || channel === 'toko') return 'paid';
    if (channel === 'shopify') {
      if (cols.cancelled && cell(cells, cols.cancelled)) return 'cancelled';
      if (p === 'paid' || p === 'partially_paid' || p === 'partially paid') return 'paid';
      if (p === 'refunded' || p === 'voided' || p === 'partially_refunded') return 'cancelled';
      return 'unpaid';
    }
    if (p === 'paid') return 'paid';
    if (/waiting for payment/.test(p)) return 'unpaid';
    if (/deposit|installment|instalment|cicilan|production paid/.test(p)) return 'part';
    if (/cancel/.test(p)) return 'cancelled';
    return p ? 'other' : 'blank';
  }

  /* One tab into orders, each with its lines. Banner rows (a year or a month
     with no invoice) and QA test rows are skipped. */
  function readTab(tab, rows, now) {
    var res = resolveTab(tab.src, rows);
    if (!res.ok) return { ok: false, error: res.error, orders: [] };
    var c = res.cols, orders = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.row_no <= res.headerRow) continue;
      var cells = r.cells || {};
      var invoice = cell(cells, c.inv);
      if (!invoice || /^qa[-_ ]/i.test(invoice)) continue;
      var dateRaw = raw(cells, c.date), dateShown = cell(cells, c.date);
      var date = parseDate(dateRaw, dateShown);
      var payText = cell(cells, c.pay);
      var o = {
        src: tab.src, channel: tab.channel, channelLabel: tab.label, row: r.row_no,
        invoice: invoice, customer: cell(cells, c.name).split(/\n| Mail:/)[0].trim(),
        date: date, dateText: dateShown, days: daysSince(date, now),
        payText: payText, pay: payKind(tab.channel, payText, cells, c),
        phone: cell(cells, c.phone), shipBy: cell(cells, c.shipBy),
        fulfil: c.fulfil ? low(cell(cells, c.fulfil)) : '',
        totalIdr: money(cells, c.totalIdr), totalUsd: money(cells, c.totalUsd),
        owedIdr: money(cells, c.owedIdr), owedUsd: money(cells, c.owedUsd),
        instalments: [], lines: []
      };
      c.instal.forEach(function (b, bi) {
        var when = cell(cells, b.date);
        var plan = money(cells, b.planIdr), planUsd = money(cells, b.planUsd);
        var got = money(cells, b.paidIdr), gotUsd = money(cells, b.paidUsd);
        if (!when && plan == null && planUsd == null && got == null && gotUsd == null) return;
        o.instalments.push({
          n: bi + 1, dateText: when, date: parseDate(raw(cells, b.date), when),
          planIdr: plan, planUsd: planUsd, paidIdr: got, paidUsd: gotUsd,
          paidFlag: /true|paid/i.test(cell(cells, b.paidFlag))
        });
      });
      c.slots.forEach(function (s, si) {
        var item = cell(cells, s.item);
        if (!item) return;
        var st = cell(cells, s.status);
        var group = STATUS.hasOwnProperty(low(st)) ? STATUS[low(st)] : 'other';
        o.lines.push({ slot: si + 1, item: item, status: st, group: group });
      });
      if (o.lines.length || o.pay !== 'paid') orders.push(o);
    }
    return { ok: true, orders: orders, headerRow: res.headerRow };
  }

  /* ---------------------------------------------------------------------
     Buy links. A product name match against PRODUCT LIST SDT. Exact first,
     then the longest product name contained in the order text, then the
     closest by shared words, which is labelled so a person checks it.
  --------------------------------------------------------------------- */
  var STOP = { variasi: 1, variant: 1, size: 1, color: 1, colour: 1, design: 1, the: 1, and: 1, with: 1, 'for': 1, of: 1, a: 1 };
  function words(s) {
    return low(s).replace(/0,5/g, '0.5').replace(/[^a-z0-9.]+/g, ' ').replace(/\.(?!\d)/g, ' ')
      .split(' ').filter(function (w) { return w && !STOP[w]; });
  }
  function key(s) { return words(s).join(' '); }

  function linkIndex(links) {
    var list = [];
    (links || []).forEach(function (l) {
      if (!l || !l.product) return;
      var url = /^https?:\/\//i.test(l.link_1 || '') ? l.link_1 : (/^https?:\/\//i.test(l.link_2 || '') ? l.link_2 : '');
      if (!url) return;
      var w = words(l.product);
      list.push({ product: txt(l.product), store: txt(l.store_1 || l.store_2 || ''), url: url,
                  url2: (url === l.link_1 && /^https?:\/\//i.test(l.link_2 || '')) ? l.link_2 : '',
                  key: w.join(' '), set: w });
    });
    return list;
  }

  function findLink(idx, item) {
    if (!idx || !idx.length) return null;
    var k = key(item), ws = words(item), wset = {};
    ws.forEach(function (w) { wset[w] = 1; });
    var i, best = null;
    for (i = 0; i < idx.length; i++) if (idx[i].key === k) return mk(idx[i], 'exact');
    for (i = 0; i < idx.length; i++) {
      var p = idx[i];
      if (p.key.length >= 8 && (' ' + k + ' ').indexOf(' ' + p.key + ' ') >= 0) {
        if (!best || p.key.length > best.key.length) best = p;
      }
    }
    if (best) return mk(best, 'contained');
    var top = null, second = 0;
    for (i = 0; i < idx.length; i++) {
      var q = idx[i], hit = 0;
      q.set.forEach(function (w) { if (wset[w]) hit++; });
      var score = q.set.length ? hit / q.set.length : 0;
      if (!top || score > top.score) { if (top) second = Math.max(second, top.score); top = { p: q, score: score }; }
      else if (score > second) second = score;
    }
    if (top && top.score >= 0.7 && top.score - second >= 0.1) return mk(top.p, 'close');
    return null;
    function mk(p, how) { return { product: p.product, store: p.store, url: p.url, url2: p.url2, how: how }; }
  }

  /* ---------------------------------------------------------------------
     The whole picture.
  --------------------------------------------------------------------- */
  function build(input) {
    var now = input.now || new Date();
    var sources = {}, all = [];
    TABS.forEach(function (tab) {
      var rows = (input.tabs && input.tabs[tab.src]) || null;
      if (!rows) { sources[tab.src] = { ok: false, error: tab.src + ' was not found in the copy of the sheet.', label: tab.label }; return; }
      var t = readTab(tab, rows, now);
      sources[tab.src] = { ok: t.ok, error: t.error || '', label: tab.label, orders: t.orders.length,
                           loadedAt: (input.loaded && input.loaded[tab.src]) || null };
      all = all.concat(t.orders);
    });

    /* Shopee keeps a second copy of some orders lower down with no status.
       A blank line on an invoice that also appears with real statuses is the
       copy, not a new order. */
    var withStatus = {};
    all.forEach(function (o) {
      if (o.lines.some(function (l) { return l.group !== 'blank'; })) withStatus[o.channel + '|' + o.invoice] = 1;
    });

    var idx = linkIndex(input.links);
    var out = {
      sources: sources,
      design: { todo: [], wip: [] },
      third: { todo: [], ordered: [] },
      making: [],
      ship: { ready: [], partly: [] },
      shopify: [],
      notSet: [], notSetOlder: 0,
      other: [],
      unpaid: [], instalments: [], paidButOwing: [],
      openOrders: 0, openLines: 0
    };
    var NOTSET_DAYS = 45;

    all.forEach(function (o) {
      var moneyIn = o.pay === 'paid' || o.pay === 'part';
      var open = o.lines.filter(function (l) { return l.group !== 'done' && l.group !== 'ignore'; });

      /* Money first. It does not depend on production. */
      if (o.channel === 'manual' && o.pay === 'unpaid') {
        out.unpaid.push(withMoney(o, open));
      } else if (o.channel === 'manual' && o.pay === 'part') {
        out.instalments.push(withMoney(o, open));
      } else if (o.channel === 'manual' && o.pay === 'paid' && (o.owedIdr > 0 || o.owedUsd > 0) &&
                 o.days !== null && o.days <= 365) {
        /* Marked PAID, yet the sheet's own OUTSTANDING formula still shows
           money owed. Either a transfer was never written into the cicilan
           columns, or money really is missing. A person has to look, so it
           is listed as a check, not as a debt. */
        out.paidButOwing.push(withMoney(o, open));
      }

      if (o.channel === 'shopify' && o.pay === 'paid' && /unfulfilled|partial/.test(o.fulfil)) {
        var sv = orderView(o, open);
        var notReady = open.filter(function (l) { return l.group !== 'ready' && l.group !== 'shipping'; });
        sv.state = !o.lines.length ? 'no_items' : (notReady.length ? 'waiting' : 'ready');
        sv.waitingOn = notReady.map(function (l) { return { item: l.item, status: l.status || 'no status' }; });
        out.shopify.push(sv);
      }

      if (!moneyIn || !open.length) return;

      var real = open.filter(function (l) { return l.group !== 'blank'; });
      if (!real.length) {
        /* Every open line is blank. Recent ones are asked about, old ones are
           only counted, because months old marketplace rows with no status
           are almost always long delivered. */
        if (withStatus[o.channel + '|' + o.invoice]) return;
        if (o.days !== null && o.days <= NOTSET_DAYS) {
          open.forEach(function (l) { out.notSet.push(lineView(o, l)); });
        } else {
          out.notSetOlder += open.length;
        }
        return;
      }

      out.openOrders++;
      out.openLines += open.length;
      open.forEach(function (l) {
        var v = lineView(o, l);
        if (l.group === 'design_todo' || l.group === 'design_wip') {
          var maybe = findLink(idx, l.item);
          if (maybe && maybe.how !== 'close') v.looksBought = maybe;
          out.design[l.group === 'design_todo' ? 'todo' : 'wip'].push(v);
        } else if (l.group === 'third_todo') {
          v.buy = findLink(idx, l.item);
          out.third.todo.push(v);
        } else if (l.group === 'third_ordered') {
          v.buy = findLink(idx, l.item);
          out.third.ordered.push(v);
        } else if (l.group === 'making') {
          out.making.push(v);
        } else if (l.group === 'blank') {
          out.notSet.push(v);
        } else if (l.group === 'other') {
          out.other.push(v);
        }
      });

      var shipish = function (l) { return l.group === 'ready' || l.group === 'shipping'; };
      var ready = open.filter(shipish);
      if (ready.length === open.length) out.ship.ready.push(orderView(o, open));
      else if (ready.length) {
        var ov = orderView(o, open);
        ov.waitingOn = open.filter(function (l) { return !shipish(l); })
          .map(function (l) { return { item: l.item, status: l.status || 'no status' }; });
        out.ship.partly.push(ov);
      }
    });

    var byAge = function (a, b) { return (b.days == null ? -1 : b.days) - (a.days == null ? -1 : a.days); };
    [out.design.todo, out.design.wip, out.third.todo, out.third.ordered, out.making, out.notSet, out.other,
     out.ship.ready, out.ship.partly, out.shopify, out.unpaid, out.instalments, out.paidButOwing].forEach(function (a) { a.sort(byAge); });
    return out;

    function lineView(o, l) {
      return { channel: o.channel, channelLabel: o.channelLabel, src: o.src, row: o.row, invoice: o.invoice,
               customer: o.customer, dateText: o.dateText, days: o.days, shipBy: o.shipBy,
               payText: o.payText, pay: o.pay, slot: l.slot, item: l.item, status: l.status, group: l.group };
    }
    function orderView(o, open) {
      return { channel: o.channel, channelLabel: o.channelLabel, src: o.src, row: o.row, invoice: o.invoice,
               customer: o.customer, dateText: o.dateText, days: o.days, shipBy: o.shipBy, payText: o.payText,
               fulfil: o.fulfil, phone: o.phone,
               lines: open.map(function (l) { return { item: l.item, status: l.status, group: l.group }; }) };
    }
    function withMoney(o, open) {
      var paidIdr = 0, paidUsd = 0, next = null;
      o.instalments.forEach(function (b) {
        if (b.paidIdr > 0) paidIdr += b.paidIdr;
        if (b.paidUsd > 0) paidUsd += b.paidUsd;
        var nothingIn = !(b.paidIdr > 0) && !(b.paidUsd > 0) && !b.paidFlag;
        if (!next && nothingIn && (b.planIdr > 0 || b.planUsd > 0)) next = b;
      });
      var lastPaid = null;
      o.instalments.forEach(function (b) { if ((b.paidIdr > 0 || b.paidUsd > 0) && b.date) lastPaid = b; });
      return {
        channel: o.channel, src: o.src, row: o.row, invoice: o.invoice, customer: o.customer, phone: o.phone,
        dateText: o.dateText, days: o.days, payText: o.payText, pay: o.pay,
        totalIdr: o.totalIdr, totalUsd: o.totalUsd, owedIdr: o.owedIdr, owedUsd: o.owedUsd,
        paidIdr: paidIdr, paidUsd: paidUsd,
        next: next ? { n: next.n, dateText: next.dateText, idr: next.planIdr, usd: next.planUsd,
                       overdue: !!(next.date && next.date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) } : null,
        lastPaid: lastPaid ? { n: lastPaid.n, dateText: lastPaid.dateText } : null,
        broken: [o.totalIdr, o.owedIdr, o.owedUsd, o.totalUsd].some(function (x) { return typeof x === 'number' && isNaN(x); }),
        workStarted: open.filter(function (l) { return l.group !== 'blank'; })
          .map(function (l) { return { item: l.item, status: l.status }; })
      };
    }
  }

  /* Follow ups from the DIA bridge (action=followups). Leads for Sea Diva and
     TailCraft, and the follow up notes Dia keeps against unpaid invoices. */
  function followups(reply, brands) {
    brands = brands || ['Sea Diva', 'TailCraft'];
    var rows = (reply && reply.rows) || [];
    var keep = function (r) { return brands.indexOf(r.brand) >= 0; };
    var leads = rows.filter(function (r) { return r.kind === 'lead' && keep(r); });
    leads.sort(function (a, b) {
      var rank = function (r) { return r.due ? 0 : (r.never ? 1 : (r.snoozed ? 3 : 2)); };
      return rank(a) - rank(b) || (Number(b.days) || 0) - (Number(a.days) || 0);
    });
    var inv = {};
    rows.filter(function (r) { return r.kind === 'invoice' && keep(r); })
      .forEach(function (r) { inv[r.brand + '|' + low(r.invoice)] = r; });
    return { leads: leads, invoices: inv, warnings: (reply && reply.warnings) || [] };
  }

  var API = { build: build, followups: followups, resolveTab: resolveTab, parseDate: parseDate,
              findLink: findLink, linkIndex: linkIndex, TABS: TABS, STATUS: STATUS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.SDOverview = API;
})(typeof window !== 'undefined' ? window : globalThis);
