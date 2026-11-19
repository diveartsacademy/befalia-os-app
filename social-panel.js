/* social-panel.js — Personal social desk (19 Nov 2026).
   ---------------------------------------------------------------------------
   Befa's own accounts, confirmed by her:
     Instagram @befalia and @mermaidbefa (8 Nov 2026)
     TikTok @befalia and YouTube UCD8NyW-e1aadBdEulOxC3eA (19 Nov 2026)
   The desk is Scout (trends), Sonar (numbers, never invented) and Muse
   (the plan). Manual entry is the source. Connect with Zernio stays
   disabled until she asks, because each extra account adds a monthly cost.
   Nothing here calls Zernio, and no key is in this file.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';
  var ROOT = 'soc-root';
  var TZ = 'Asia/Makassar';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var CORE = [
    { key: 'followers', label: 'Followers' },
    { key: 'reach', label: 'Reach' },
    { key: 'engagement', label: 'Engagement' },
    { key: 'posts', label: 'Posts' }
  ];
  var STATUS = ['Idea', 'Drafting', 'Ready', 'Posted', 'Parked'];
  var S = { data: null, err: '', loading: false, msg: '', conflict: null, pending: null };

  function headers() { return (typeof osHeaders === 'function') ? osHeaders() : { 'Content-Type': 'application/json' }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function formatMetric(n, integer) {
    if (n == null || typeof n !== 'number' || !isFinite(n)) return '—';
    if (integer === false) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return Math.round(n).toLocaleString('en-US');
  }
  function formatMoney(amount, currency) {
    if (amount == null || typeof amount !== 'number') return '';
    if (currency === 'IDR') return 'Rp' + Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (currency === 'USD') return 'US$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return String(amount);
  }
  function formatDay(iso, grain) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
    var p = iso.split('-').map(Number);
    if (grain === 'Month') return MONTHS[p[1] - 1] + ' ' + p[0];
    return p[2] + ' ' + MONTHS[p[1] - 1].slice(0, 3) + ' ' + p[0];
  }
  function formatWita(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    var date = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    var time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    return date + ', ' + time + ' WITA';
  }
  function platformName(p) { return { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' }[p] || p || ''; }
  function accountLabel(a) {
    if (!a) return '';
    if (a.platform === 'youtube') return 'YouTube ' + a.handle;
    return platformName(a.platform) + ' ' + a.handle;
  }
  function byKey(key) {
    var list = (S.data && S.data.accounts) || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function toast(msg, ok) { try { if (typeof showToast === 'function') showToast(msg, ok); } catch (e) {} }
  function ask(text) { try { if (typeof window.sendPrompt === 'function') window.sendPrompt(text); } catch (e) {} }

  function css() {
    try {
      if (document.getElementById('soc-css')) return;
      var s = document.createElement('style');
      s.id = 'soc-css';
      s.textContent = [
        '#soc-root{margin-top:14px;}',
        '#soc-root .soc-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin:0 0 16px;}',
        '#soc-root .soc-metrics .card{margin:0;min-height:0;}',
        '#soc-root .card:hover{transform:none;}',
        '#soc-root .soc-form{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;}',
        '#soc-root .soc-form .wide{grid-column:1/-1;}',
        '#soc-root .soc-form label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--muted);}',
        '@media(max-width:640px){#soc-root .soc-form{grid-template-columns:1fr;} #soc-root .soc-form .wide{grid-column:auto;}}',
        '#soc-root .gold-btn:disabled,#soc-root .gold-btn[disabled]{opacity:.45;cursor:not-allowed;filter:none;transform:none;box-shadow:none;}',
        '#soc-root .soc-spark{display:block;margin-top:8px;}',
        '#soc-root textarea.fld{min-height:74px;resize:vertical;}',
        '#soc-root .soc-kept{color:var(--dim);}'
      ].join('\n');
      document.head.appendChild(s);
    } catch (e) {}
  }

  function spark(sp, label) {
    if (!sp || !sp.d) return '';
    return '<svg class="soc-spark" role="img" aria-label="' + esc(label) + '" viewBox="0 0 ' + sp.w + ' ' + sp.h + '" width="' + sp.w + '" height="' + sp.h + '"><path d="' + sp.d + '" fill="none" stroke="#2ee6ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function compareHtml(cmp) {
    if (!cmp) return '<div class="note-hint">Log one more month to see a comparison.</div>';
    if (!cmp.any) return '<div class="note-hint">The last two months do not share a number to compare.</div>';
    var bits = [];
    CORE.forEach(function (c) {
      var d = cmp.deltas[c.key];
      if (!d) return;
      var sign = d.delta > 0 ? '+' : '';
      bits.push(c.label + ' ' + formatMetric(d.from) + ' → ' + formatMetric(d.to) + ' (' + sign + formatMetric(d.delta) + ')');
    });
    return '<div class="note-hint">' + esc(formatDay(cmp.prev, 'Month')) + ' to ' + esc(formatDay(cmp.last, 'Month')) + '. ' + esc(bits.join(' · ')) + '</div>';
  }

  function tiles(row, platform) {
    var html = '<div class="stat-grid">';
    CORE.forEach(function (c) {
      var v = row ? row[c.key] : null;
      html += '<div class="stat-tile"><div class="stat-num">' + esc(formatMetric(v)) + '</div><div class="stat-lab">' + esc(c.label) + (v == null ? ' · not logged' : '') + '</div></div>';
    });
    var specs = (S.data.extras && S.data.extras[platform]) || [];
    specs.forEach(function (spec) {
      var v = row && row.extras ? row.extras[spec.key] : null;
      if (v == null) return;
      html += '<div class="stat-tile"><div class="stat-num">' + esc(formatMetric(v, spec.integer !== false)) + '</div><div class="stat-lab">' + esc(spec.label) + '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function sourceLine(row) {
    if (!row) return '<div class="note-hint">No numbers yet. Sonar leaves this empty until you log one.</div>';
    var src = row.source === 'Zernio' ? 'Zernio' : 'Manual';
    var saved = formatWita(row.recordedAt);
    return '<div class="note-hint">' + esc(src) + ' · as of ' + esc(formatDay(row.when, row.grain)) + (saved ? ' · saved ' + esc(saved) : '') + '</div>';
  }

  function historyHtml(items) {
    if (!items || !items.length) return '';
    var html = '<ul class="notes">';
    items.forEach(function (r) {
      var bits = [];
      CORE.forEach(function (c) { if (r[c.key] != null) bits.push(c.label + ' ' + formatMetric(r[c.key])); });
      html += '<li class="' + (r.active === false ? 'soc-kept' : '') + '"><span style="color:var(--aqua2)">' + esc(formatDay(r.when, r.grain)) + '</span> · ' + esc(r.source || 'Manual') + (r.active === false ? ' · kept' : '') + (bits.length ? ' · ' + esc(bits.join(', ')) : '') + '</li>';
    });
    return html + '</ul>';
  }

  function cardHtml(card) {
    var a = card.account;
    var row = card.headline;
    return '<div class="card" data-no-tools data-account="' + esc(a.key) + '">'
      + '<h2><span class="ic">' + (a.platform === 'youtube' ? '▶' : (a.platform === 'tiktok' ? '♪' : '◎')) + '</span>' + esc(accountLabel(a)) + '<span class="badge">Personal</span></h2>'
      + '<div class="blurb">Live account. Confirmed ' + esc(formatDay(a.confirmed)) + '.</div>'
      + sourceLine(row)
      + tiles(row, a.platform)
      + spark(card.spark, 'Followers by month for ' + accountLabel(a))
      + compareHtml(card.compare)
      + (card.days ? '<div class="note-hint">' + card.days + ' daily ' + (card.days === 1 ? 'entry' : 'entries') + ' logged.</div>' : '')
      + spark(card.dailySpark, 'Followers by day for ' + accountLabel(a))
      + historyHtml(card.history)
      + '<div class="foot"><a href="' + esc(a.url) + '" target="_blank" rel="noopener">Open ' + esc(a.handle) + ' →</a></div>'
      + '</div>';
  }

  function options(list, current) {
    return list.map(function (a) {
      var key = a.key || a;
      var label = a.key ? accountLabel(a) : platformName(a);
      return '<option value="' + esc(key) + '"' + (key === current ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function extrasFields(platform) {
    var specs = (S.data && S.data.extras && S.data.extras[platform]) || [];
    return specs.map(function (spec) {
      return '<label>' + esc(spec.label) + '<input class="fld" data-extra="' + esc(spec.key) + '" inputmode="decimal" placeholder="Blank if you do not have it"></label>';
    }).join('');
  }

  function msgHtml() {
    if (!S.msg && !S.conflict) return '';
    var html = '<div class="note-hint" id="soc-msg-text">' + esc(S.msg) + '</div>';
    if (S.conflict) html += '<button class="link-btn" type="button" data-act="correct">Save this one too, and keep the earlier snapshot</button>';
    return html;
  }

  function ideasHtml(list) {
    if (!list.length) return '<div class="note-hint">No ideas yet. A new one is saved here, newest first, and handed to Muse.</div>';
    var html = '<ul class="notes" style="max-height:420px">';
    list.forEach(function (r) {
      html += '<li><div class="lrn-head">' + esc(r.hook) + '</div>'
        + '<div class="iv-from">' + esc(platformName(r.platform)) + ' · ' + esc(r.status || 'Idea') + ' · ' + esc(formatDay(r.when)) + '</div>'
        + (r.caption ? '<div class="feed-p">' + esc(r.caption).replace(/\n/g, '<br>') + '</div>' : '')
        + '<label class="caption" style="display:block;margin-top:6px">Status<select class="fld" data-act="status" data-id="' + esc(r.id) + '">'
        + STATUS.map(function (st) { return '<option value="' + esc(st) + '"' + (st === r.status ? ' selected' : '') + '>' + esc(st) + '</option>'; }).join('')
        + '</select></label></li>';
    });
    return html + '</ul>';
  }

  function moneyHtml(list) {
    if (!list.length) return '<div class="note-hint">Nothing logged yet. Sonar will not guess income. Add a date, a platform, and an amount or an outcome.</div>';
    var html = '<ul class="notes" style="max-height:320px">';
    list.forEach(function (r) {
      var what = r.amount != null ? formatMoney(r.amount, r.currency) : (r.outcome || '');
      html += '<li><span style="color:var(--aqua2)">' + esc(formatDay(r.when)) + '</span> · ' + esc(platformName(r.platform)) + ' · ' + esc(what) + (r.note ? '<div class="feed-p">' + esc(r.note) + '</div>' : '') + '</li>';
    });
    return html + '</ul>';
  }

  function draw() {
    var root = document.getElementById(ROOT);
    if (!root) return;
    css();
    if (S.err && !S.data) {
      root.innerHTML = '<div class="card" data-no-tools><h2><span class="ic">📣</span>Personal accounts</h2><div class="err">' + esc(S.err) + '</div><button class="gold-btn" type="button" data-act="refresh" style="margin-top:8px">Refresh</button></div>';
      return;
    }
    var d = S.data;
    if (!d) {
      root.innerHTML = '<div class="card" data-no-tools><div class="loading">Loading your accounts…</div></div>';
      return;
    }
    var accounts = d.accounts || [];
    var first = accounts[0] ? accounts[0].key : '';
    var today = d.today || '';
    var z = d.zernio || {};
    var links = accounts.map(function (a) {
      return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(accountLabel(a)) + '</a>';
    }).join('');
    var reports = ((d.notion && d.notion.reports) || []).map(function (p) {
      return '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.label) + '</a>';
    }).join('');
    var html = '';
    html += '<div class="card feature" data-no-tools>'
      + '<h2><span class="ic">📣</span>Personal accounts<span class="badge">Personal</span></h2>'
      + '<div class="blurb">This desk is Scout, Sonar and Muse. Scout names a trend by its title and mood, and never downloads audio. Sonar reads only a number you log, and never fills a gap. Muse plans the hook, the script and the caption.</div>'
      + '<div class="sm-links">' + links + '</div>'
      + '<div class="foot"><button class="link-btn" type="button" data-act="refresh">Refresh</button>'
      + (d.notion && d.notion.ideas ? '<a href="' + esc(d.notion.ideas) + '" target="_blank" rel="noopener">Content ideas →</a>' : '')
      + (d.notion && d.notion.plan ? '<a href="' + esc(d.notion.plan) + '" target="_blank" rel="noopener">Monetization plan →</a>' : '')
      + '</div></div>';
    html += '<div class="soc-metrics">' + (d.cards || []).map(cardHtml).join('') + '</div>';
    html += '<div class="card" data-no-tools><h2><span class="ic">📊</span>Log a snapshot</h2>'
      + '<div class="blurb">Sonar keeps what you type. A blank stays blank. The same account and date is kept, not replaced.</div>'
      + '<div class="soc-form">'
      + '<label class="wide">Account<select class="fld" id="soc-account">' + options(accounts, first) + '</select></label>'
      + '<label>Grain<select class="fld" id="soc-grain"><option value="Month">Month</option><option value="Day">Day</option></select></label>'
      + '<label>Date<input class="fld" id="soc-date" type="date" max="' + esc(today) + '" value="' + esc(today) + '"></label>'
      + CORE.map(function (c) { return '<label>' + esc(c.label) + '<input class="fld" id="soc-' + c.key + '" inputmode="numeric" placeholder="Blank if you do not have it"></label>'; }).join('')
      + '<div class="wide" id="soc-extras">' + extrasFields(accounts[0] && accounts[0].platform) + '</div>'
      + '<label class="wide">Note, optional<textarea class="fld" id="soc-note" rows="2" maxlength="500" placeholder="Optional"></textarea></label>'
      + '</div><div id="soc-msg">' + msgHtml() + '</div>'
      + '<button class="gold-btn" type="button" data-act="save-snap" style="margin-top:8px">Save snapshot</button></div>';
    html += '<div class="card" data-no-tools><h2><span class="ic">🎬</span>Ideas</h2>'
      + '<div class="blurb">Newest first. Saving hands the idea to Muse. Trend research goes to Scout, by name and mood only.</div>'
      + '<div class="soc-form">'
      + '<label>Platform<select class="fld" id="soc-idea-platform">' + options(['instagram', 'tiktok', 'youtube'], 'instagram') + '</select></label>'
      + '<label>Status<select class="fld" id="soc-idea-status">' + STATUS.map(function (st) { return '<option value="' + st + '">' + st + '</option>'; }).join('') + '</select></label>'
      + '<label class="wide">Hook<input class="fld" id="soc-idea-hook" maxlength="300" placeholder="The first line"></label>'
      + '<label class="wide">Caption or script<textarea class="fld" id="soc-idea-caption" rows="3" maxlength="4000" placeholder="Optional"></textarea></label>'
      + '</div><div class="caption" id="soc-idea-hint"></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">'
      + '<button class="gold-btn" type="button" data-act="save-idea">Save for Muse</button>'
      + '<button class="gold-btn" type="button" data-act="scout" style="background:transparent;color:var(--aqua);border:1px solid var(--aqualine)">Ask Scout</button>'
      + '<button class="gold-btn" type="button" data-act="sonar" style="background:transparent;color:var(--aqua);border:1px solid var(--aqualine)">Ask Sonar</button>'
      + '</div>' + ideasHtml(d.ideas || []) + '</div>';
    html += '<div class="card sensitive" data-no-tools><h2><span class="ic">💵</span>Monetization</h2>'
      + '<div class="blurb">What actually came in, or what happened. An empty log stays empty.</div>'
      + '<div class="soc-form">'
      + '<label>Date<input class="fld" id="soc-earn-date" type="date" max="' + esc(today) + '" value="' + esc(today) + '"></label>'
      + '<label>Platform<select class="fld" id="soc-earn-platform">' + options(['instagram', 'tiktok', 'youtube'], 'instagram') + '</select></label>'
      + '<label>Amount<input class="fld" id="soc-earn-amount" inputmode="decimal" placeholder="Blank if you are logging an outcome"></label>'
      + '<label>Currency<select class="fld" id="soc-earn-currency"><option value="">No amount</option><option value="IDR">IDR</option><option value="USD">USD</option></select></label>'
      + '<label class="wide">Outcome<input class="fld" id="soc-earn-outcome" maxlength="300" placeholder="What happened, if there is no amount"></label>'
      + '<label class="wide">Note<textarea class="fld" id="soc-earn-note" rows="2" maxlength="500" placeholder="Optional"></textarea></label>'
      + '</div><div class="caption" id="soc-earn-hint"></div>'
      + '<button class="gold-btn" type="button" data-act="save-earn" style="margin:8px 0">Save entry</button>'
      + moneyHtml(d.earnings || []) + '</div>';
    html += '<div class="card" data-no-tools><h2><span class="ic">🔗</span>Zernio</h2>'
      + '<div class="blurb">Nothing is connected. Manual entry is the source. ' + esc(z.costNote || 'Each extra account adds a monthly cost.') + '</div>'
      + '<button class="gold-btn" type="button" id="soc-zernio" disabled aria-disabled="true">Connect with Zernio · ask Befa</button>'
      + (z.reason ? '<div class="note-hint">' + esc(z.reason) + '</div>' : '')
      + (reports ? '<div class="sm-links">' + reports + '</div>' : '')
      + '</div>';
    root.innerHTML = html;
  }

  function val(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    var v = String(el.value == null ? '' : el.value).trim();
    return v === '' ? null : v;
  }

  function snapshotBody(correct) {
    var account = byKey(val('soc-account'));
    var extras = {};
    var root = document.getElementById(ROOT);
    if (root) root.querySelectorAll('[data-extra]').forEach(function (el) {
      var v = String(el.value || '').trim();
      if (v !== '') extras[el.getAttribute('data-extra')] = v;
    });
    return {
      account: val('soc-account'),
      grain: val('soc-grain') || 'Month',
      date: val('soc-date'),
      followers: val('soc-followers'),
      reach: val('soc-reach'),
      engagement: val('soc-engagement'),
      posts: val('soc-posts'),
      extras: extras,
      note: val('soc-note') || '',
      correct: !!correct
    };
  }

  function post(action, payload) {
    return fetch('/api/notion?social=1', { method: 'POST', headers: headers(), body: JSON.stringify(Object.assign({ social: true, action: action }, payload || {})) })
      .then(function (r) {
        if (r.status === 401) { if (typeof osUnauthorised === 'function') osUnauthorised(); throw new Error('key'); }
        return r.json().then(function (j) { return { status: r.status, j: j || {} }; });
      });
  }

  function applyView(j) {
    if (j && j.view) S.data = j.view;
    S.conflict = null;
    S.pending = null;
    S.msg = '';
    draw();
  }

  function saveSnap(correct) {
    var body = correct && S.pending ? Object.assign({}, S.pending, { correct: true }) : snapshotBody(false);
    if (!body.date) { S.msg = 'Choose a date.'; S.conflict = null; draw(); return; }
    S.pending = body;
    post('snapshot', body).then(function (x) {
      if (x.status === 409 || (x.j && x.j.conflict)) {
        S.msg = (x.j && x.j.error) || 'That snapshot is already kept.';
        S.conflict = (x.j && x.j.existing) || { id: 'kept' };
        S.pending = body;
        draw();
        return;
      }
      if (!x.j.ok) { S.msg = x.j.error || 'Not saved.'; S.conflict = null; draw(); return; }
      toast('Snapshot saved', true);
      applyView(x.j);
    }).catch(function (e) { if (e && e.message === 'key') return; S.msg = 'Not saved. Try again.'; draw(); });
  }

  function saveIdea() {
    var payload = {
      platform: val('soc-idea-platform'),
      status: val('soc-idea-status') || 'Idea',
      hook: val('soc-idea-hook') || '',
      caption: val('soc-idea-caption') || '',
      date: (S.data && S.data.today) || null
    };
    post('idea', payload).then(function (x) {
      var hint = document.getElementById('soc-idea-hint');
      if (!x.j.ok) { if (hint) hint.textContent = x.j.error || 'Not saved.'; return; }
      var id = S.data && S.data.notion && S.data.notion.ideasId;
      ask('Act as Muse, my personal content planner. Personal accounts only: Instagram @befalia, Instagram @mermaidbefa, TikTok @befalia, YouTube channel UCD8NyW-e1aadBdEulOxC3eA. Platform: ' + platformName(payload.platform) + '. Hook: ' + payload.hook + '. Caption or script: ' + (payload.caption || '(none yet)') + '. Draft a tighter hook, a 20 to 30 second script, and a caption for that platform. Voice: warm and personal, Befa herself. Save the draft on my Notion Content Ideas page (id ' + (id || '') + ') as a dated entry. Never invent metrics or revenue.');
      toast('Idea saved', true);
      applyView(x.j);
      var again = document.getElementById('soc-idea-hint');
      if (again) again.textContent = (x.j.pageWarning ? x.j.pageWarning + ' ' : '') + 'Saved on the board for Muse.';
    }).catch(function (e) { if (!(e && e.message === 'key')) toast('Idea not saved', false); });
  }

  function saveEarn() {
    var payload = {
      date: val('soc-earn-date'),
      platform: val('soc-earn-platform'),
      amount: val('soc-earn-amount'),
      currency: val('soc-earn-currency') || '',
      outcome: val('soc-earn-outcome') || '',
      note: val('soc-earn-note') || ''
    };
    post('earning', payload).then(function (x) {
      var hint = document.getElementById('soc-earn-hint');
      if (!x.j.ok) { if (hint) hint.textContent = x.j.error || 'Not saved.'; return; }
      toast('Entry saved', true);
      applyView(x.j);
    }).catch(function (e) { if (!(e && e.message === 'key')) toast('Entry not saved', false); });
  }

  function onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.getAttribute('data-act') === 'status') return;
    var act = b.getAttribute('data-act');
    if (act === 'refresh') { load(); return; }
    if (act === 'save-snap') { saveSnap(false); return; }
    if (act === 'correct') { saveSnap(true); return; }
    if (act === 'save-idea') { saveIdea(); return; }
    if (act === 'save-earn') { saveEarn(); return; }
    if (act === 'scout') {
      var id = S.data && S.data.notion && S.data.notion.ideasId;
      ask('Act as Scout, my personal trend researcher. Look at what is working now for a mermaid, freediving and ocean creator. Name up to 5 sounds or formats by title and mood only. Do not download, rip or attach copyrighted audio. Give a one-line why each fits me. Never invent view counts, follower numbers or revenue. Save the names on my Notion Content Ideas page (id ' + (id || '') + ') as a dated note.');
      var hint = document.getElementById('soc-idea-hint');
      if (hint) hint.textContent = 'Asked Scout for names and moods. No audio is downloaded.';
      return;
    }
    if (act === 'sonar') {
      var any = (S.data && S.data.cards || []).some(function (c) { return c.headline; });
      var hint2 = document.getElementById('soc-idea-hint');
      if (!any) { if (hint2) hint2.textContent = 'Nothing is logged yet, so Sonar has nothing to read.'; return; }
      ask('Act as Sonar, my personal analytics reader. Read only the snapshots I have logged on the Personal Social Tracker for Instagram @befalia, Instagram @mermaidbefa, TikTok @befalia and YouTube channel UCD8NyW-e1aadBdEulOxC3eA. Say what changed. If a number is missing, say it is missing. Never invent a metric or any revenue.');
      if (hint2) hint2.textContent = 'Asked Sonar to read what is logged, and nothing else.';
    }
  }

  function onChange(e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'soc-account') {
      var box = document.getElementById('soc-extras');
      var account = byKey(t.value);
      if (box) box.innerHTML = extrasFields(account && account.platform);
      return;
    }
    if (t.getAttribute('data-act') === 'status') {
      post('status', { id: t.getAttribute('data-id'), status: t.value }).then(function (x) {
        if (!x.j.ok) { toast(x.j.error || 'Status not saved', false); return; }
        applyView(x.j);
        toast('Status saved', true);
      }).catch(function () { toast('Status not saved', false); });
    }
  }

  function bind(root) {
    if (!root || !root.addEventListener) return;
    if (root.dataset && root.dataset.socBound) return;
    if (root.dataset) root.dataset.socBound = '1';
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
  }

  function load() {
    var root = document.getElementById(ROOT);
    if (!root || S.loading) return;
    css();
    bind(root);
    S.loading = true;
    if (!S.data) root.innerHTML = '<div class="card" data-no-tools><div class="loading">Loading your accounts…</div></div>';
    fetch('/api/notion?social=1', { headers: headers() }).then(function (r) {
      if (r.status === 401) { if (typeof osUnauthorised === 'function') osUnauthorised(); throw new Error('key'); }
      return r.json().then(function (j) { return { ok: r.ok, j: j || {} }; });
    }).then(function (x) {
      S.loading = false;
      if (!x.ok || x.j.ok === false) { S.err = x.j.error || 'Could not load.'; if (!S.data) draw(); else toast(S.err, false); return; }
      S.data = x.j;
      S.err = '';
      draw();
    }).catch(function (e) {
      S.loading = false;
      if (e && e.message === 'key') return;
      S.err = 'Could not load. Try Refresh.';
      if (!S.data) draw();
    });
  }

  window.socOpen = function () {
    var root = document.getElementById(ROOT);
    if (!root) return;
    css();
    bind(root);
    if (!S.data && !S.loading) load();
  };

  // Used by tests to draw a known desk without the network.
  window.__socRender = function (data) {
    S.data = data;
    S.err = '';
    S.msg = '';
    S.conflict = null;
    css();
    var root = document.getElementById(ROOT);
    bind(root);
    draw();
    return root ? root.innerHTML : '';
  };
})();
