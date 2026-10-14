/* academy-panel.js — Befa's instructor desk, Business tab, DiveArts Academy
   (14 Oct 2026).
   ---------------------------------------------------------------------------
   What Befa asked for: her students who have not finished, her schedule, the
   courses finished but still needing a certificate, a button to make the DAA
   certificate and to process the PADI or MFI one, and each certificate showing
   in the student's portal.

   Reads GET /api/academy (her own rows of the instructor sheet, plus the
   portal). That read takes 30 to 45 seconds, so the last answer is kept in
   this browser and shown at once, marked with its time, while a fresh one
   loads.

   Writes, each on its own button and each saying what happened:
     Finished, waiting for certificate   her sheet, column A of that block (two taps)
     Submitted to PADI / MFI             the portal shows "submitted"
     Save as issued (number + date)      the portal shows ISSUED, badge awarded
     Make DAA certificate                her design, filled in here, downloaded
                                         and/or saved to the student's portal
     Mark done in my sheet               column A to "done (certificate issued-if required)" (two taps)

   business-panel.js draws <div id="acad-root"> when the Academy chip is on and
   calls window.acadMount(). Everything else lives here.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';
  var ROOT = 'acad-root';
  var LS_LAST = 'acad_last_v1', LS_PICK = 'acad_picks_v1';
  var A = { data: null, err: '', loading: false, busy: '', arm: '', flash: {}, gen: '', form: {}, picks: {}, search: {}, pending: false, notice: '' };
  var ORDER = ['In Progress', 'Not Started yet', 'Not Passed', 'Status not set'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: fine */ } }
  A.picks = lsGet(LS_PICK) || {};
  var last = lsGet(LS_LAST);
  if (last && last.ok) A.data = last;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function headers() { return (typeof osHeaders === 'function') ? osHeaders() : { 'Content-Type': 'application/json' }; }
  function witaToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function dmy(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? (+p[2]) + ' ' + MON[+p[1] - 1] + ' ' + p[0] : ''; }
  function dayHead(iso) { var d = new Date(iso + 'T12:00:00Z'); return DOW[d.getUTCDay()] + ' ' + dmy(iso); }
  function when(iso) { try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch (e) { return ''; } }

  /* ------------------------------------------------------------- styles */
  function css() {
    if (document.getElementById('acad-css')) return;
    var s = document.createElement('style');
    s.id = 'acad-css';
    s.textContent =
      '#acad-root{margin-top:12px}' +
      '.ac-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:4px 0 6px}' +
      '.ac-h h3{margin:0;font:600 17px var(--serif);color:var(--ink)}' +
      '.ac-fresh{font:12px var(--sans);color:var(--dim)}' +
      '.ac-btn{font:600 12.5px var(--sans);border-radius:8px;padding:6px 11px;cursor:pointer;border:1px solid var(--aqualine);background:rgba(46,230,255,.06);color:var(--aquasoft)}' +
      '.ac-btn:disabled{opacity:.5;cursor:default}' +
      '.ac-btn.go{background:linear-gradient(180deg,var(--aqua),var(--aqua2));color:#04121f;border-color:var(--aqua)}' +
      '.ac-btn.warm{background:#ffd27f;color:#04121f;border-color:#ffd27f}' +
      '.ac-btn.arm{background:#ffb37f;color:#04121f;border-color:#ffb37f}' +
      '.ac-btn.ghost{background:none;border-color:var(--line);color:var(--muted)}' +
      '.ac-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:10px 0 14px}' +
      '.ac-tile{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:rgba(255,255,255,.03)}' +
      '.ac-tile b{display:block;font:700 22px var(--serif);color:var(--aqua)}' +
      '.ac-tile span{font:12px var(--sans);color:var(--muted)}' +
      '.ac-sec{margin:18px 0 6px;font:600 12px var(--serif);letter-spacing:2px;text-transform:uppercase;color:var(--aqua2)}' +
      '.ac-note{font:12.5px/1.45 var(--sans);color:var(--muted);margin:2px 0 8px}' +
      '.ac-card{border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:8px 0;background:rgba(255,255,255,.03)}' +
      '.ac-card.cq{border-color:rgba(255,210,127,.45)}' +
      '.ac-t{font:600 15px var(--sans);color:var(--ink)}' +
      '.ac-m{font:12.5px/1.45 var(--sans);color:var(--muted);margin-top:2px}' +
      '.ac-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}' +
      '.ac-pill{font:600 11px var(--sans);border-radius:999px;padding:3px 8px;border:1px solid var(--line);color:var(--muted)}' +
      '.ac-pill.ok{border-color:rgba(120,230,160,.6);color:#9ff0bd}' +
      '.ac-pill.wait{border-color:rgba(255,210,127,.6);color:#ffe2a8}' +
      '.ac-cert{border-top:1px dashed var(--line);margin-top:9px;padding-top:9px}' +
      '.ac-cert .lbl{font:600 13px var(--sans);color:var(--ink);min-width:74px}' +
      '.ac-in{font:13px var(--sans);border-radius:8px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--ink);padding:6px 8px;min-width:0}' +
      '.ac-in.w{flex:1 1 160px}' +
      '.ac-flash{font:12.5px/1.4 var(--sans);margin-top:7px;color:#9ff0bd}' +
      '.ac-flash.bad{color:#ff9b9b}' +
      '.ac-err{font:13px/1.45 var(--sans);color:#ff9b9b;border:1px solid rgba(255,120,120,.4);border-radius:12px;padding:10px 12px;margin:8px 0}' +
      '.ac-gen{margin-top:10px;border:1px solid var(--aqualine);border-radius:12px;padding:10px}' +
      '.ac-gen canvas{width:100%;height:auto;border-radius:8px;display:block;margin-top:8px;background:#fff}' +
      '.ac-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
      '.ac-grid label{font:11.5px var(--sans);color:var(--dim);display:flex;flex-direction:column;gap:3px}' +
      '.ac-day{font:600 13px var(--sans);color:var(--aquasoft);margin:12px 0 4px}' +
      '.ac-cls{display:flex;gap:10px;font:13px/1.4 var(--sans);color:var(--ink);padding:6px 0;border-bottom:1px solid var(--line)}' +
      '.ac-cls .tm{color:var(--aqua);min-width:88px;font-variant-numeric:tabular-nums}' +
      '.ac-cls .sub{color:var(--muted);font-size:12px}' +
      '.ac-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:6px;max-width:220px}' +
      '.ac-bar i{display:block;height:100%;background:var(--aqua2)}' +
      '.ac-cand{font:12.5px var(--sans)}' +
      '@media (max-width:520px){.ac-grid{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------ helpers */
  function certsFor(inv) { return ((A.data && A.data.certs) || []).filter(function (c) { return c.invoice_no === inv; }); }
  function certOf(inv, ag) { return certsFor(inv).filter(function (c) { return c.agency === ag; })[0] || null; }
  function matchesFor(name) {
    var m = ((A.data && A.data.matches) || []).filter(function (x) { return x.q === name; })[0];
    return (m && m.candidates) || [];
  }
  /* The portal student for an enrolment: a certificate already made decides it,
     then Befa's own pick, then one exact name match. Never a guess. */
  function pickFor(e) {
    var made = certsFor(e.invoice_no)[0];
    if (made) return { profile_id: made.profile_id, name: made.name, locked: true };
    var p = A.picks[e.invoice_no];
    if (p) return p;
    var c = matchesFor(e.student), exact = c.filter(function (x) { return x.score >= 100; });
    if (exact.length === 1) return { profile_id: exact[0].profile_id, name: exact[0].name, auto: true };
    return null;
  }
  function certTitle(course) {
    var parts = String(course || '').split(' - ').map(function (x) { return x.trim(); }).filter(Boolean);
    var disc = (parts[0] || '').replace(/\s*Course$/i, '');
    var lastP = parts.length > 1 ? parts[parts.length - 1] : '';
    if (!lastP || /^(Adult|Kids)$/i.test(lastP)) return disc || String(course || '');
    if (disc && lastP.toLowerCase().indexOf(disc.toLowerCase()) < 0 && !/Mermaid|Dance/i.test(lastP)) {
      var m = lastP.match(/^(PADI|MFI|AIDA|EFR)\s+(.*)$/i);
      return m ? m[1] + ' ' + disc + ' ' + m[2] : disc + ' ' + lastP;
    }
    return lastP;
  }
  function daaNumber(inv) { return 'DAA-' + String(inv || '').replace(/^DAA[-\s]?/i, ''); }
  function allIssued(e) {
    var need = (e.agencies || []).concat(['DiveArts']);
    return need.every(function (ag) { var c = certOf(e.invoice_no, ag); return c && c.status === 'issued'; });
  }
  function fl(key) {
    var f = A.flash[key];
    return f ? '<div class="ac-flash' + (f.bad ? ' bad' : '') + '">' + esc(f.text) + '</div>' : '';
  }
  function armBtn(key, label, armedLabel, cls) {
    var on = A.arm === key;
    return '<button class="ac-btn ' + (on ? 'arm' : (cls || '')) + '" data-a="arm" data-k="' + esc(key) + '"' + (A.busy ? ' disabled' : '') + '>' +
      esc(on ? armedLabel : label) + '</button>';
  }

  /* ------------------------------------------------------------- render */
  function tiles(d) {
    var n = function (st) { return d.enrolments.filter(function (e) { return e.status === st; }).length; };
    var soon = d.upcoming.filter(function (u) { return u.date <= addDays(d.today, 14); }).length;
    var t = [[d.certQueue.length, 'Finished, certificate to do'], [n('In Progress'), 'In progress'], [n('Not Started yet'), 'Not started yet'],
             [n('Not Passed'), 'Not passed'], [soon, 'Classes in the next 14 days']];
    if (n('Status not set')) t.push([n('Status not set'), 'Status not set in the sheet']);
    return '<div class="ac-tiles">' + t.map(function (x) { return '<div class="ac-tile"><b>' + x[0] + '</b><span>' + esc(x[1]) + '</span></div>'; }).join('') + '</div>';
  }
  function addDays(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  function portalLine(e) {
    var p = pickFor(e), inv = e.invoice_no;
    if (p) {
      return '<div class="ac-row ac-cand"><span class="ac-pill ok">Portal: ' + esc(p.name) + '</span>' +
        (p.auto ? '<span class="ac-m">same name in the portal</span>' : '') +
        (p.locked ? '' : '<button class="ac-btn ghost" data-a="unpick" data-inv="' + esc(inv) + '">Change</button>') + '</div>';
    }
    var c = (A.search[inv] && A.search[inv].list) || matchesFor(e.student);
    var h = '<div class="ac-row ac-cand"><span class="ac-pill wait">Portal student?</span>';
    if (c.length) {
      h += c.map(function (x) {
        return '<button class="ac-btn" data-a="pick" data-inv="' + esc(inv) + '" data-pid="' + esc(x.profile_id) + '" data-name="' + esc(x.name) + '">' +
          esc(x.name) + (x.classes ? ' · ' + x.classes + ' classes' : '') + '</button>';
      }).join('');
    } else {
      h += '<span class="ac-m">No one by this name in the student portal. The DAA certificate can still be made and downloaded, but it can only show in a portal that has this student.</span>';
    }
    h += '</div><div class="ac-row"><input class="ac-in w" data-af="' + esc(inv) + '|q" placeholder="Search the portal by another name" value="' + esc((A.form[inv] || {}).q || '') + '">' +
      '<button class="ac-btn ghost" data-a="search" data-inv="' + esc(inv) + '"' + (A.busy ? ' disabled' : '') + '>Search</button></div>';
    return h;
  }

  function agencyLine(e, ag, p) {
    var inv = e.invoice_no, c = certOf(inv, ag), key = inv + '|' + ag, f = A.form[key] || {};
    var h = '<div class="ac-cert"><div class="ac-row"><span class="lbl">' + esc(ag) + '</span>';
    var dis = (A.busy || !p) ? ' disabled' : '';
    if (c && c.status === 'issued' && !f.edit) {
      h += '<span class="ac-pill ok">Issued · ' + esc(c.number) + ' · ' + esc(dmy(c.issued_on)) + '</span>' +
        '<button class="ac-btn ghost" data-a="edit" data-k="' + esc(key) + '">Correct</button></div>';
    } else if (c && (c.status === 'submitted_to_agency' || (c.status === 'issued' && f.edit))) {
      h += (c.status === 'issued' ? '<span class="ac-pill ok">Issued · ' + esc(c.number) + '</span>' : '<span class="ac-pill wait">Submitted ' + esc(dmy(c.submitted_on)) + '</span>') + '</div>' +
        '<div class="ac-row"><input class="ac-in w" data-af="' + esc(key) + '|number" placeholder="' + esc(ag) + ' certificate number" value="' + esc(f.number != null ? f.number : (c.number || '')) + '">' +
        '<input class="ac-in" type="date" data-af="' + esc(key) + '|date" max="' + esc(witaToday()) + '" value="' + esc(f.date || c.issued_on || witaToday()) + '">' +
        '<button class="ac-btn go" data-a="issue" data-inv="' + esc(inv) + '" data-ag="' + esc(ag) + '"' + dis + '>Save as issued</button>' +
        (c.status === 'submitted_to_agency' ? '<button class="ac-btn ghost" data-a="unsubmit" data-inv="' + esc(inv) + '" data-ag="' + esc(ag) + '"' + dis + '>Undo submitted</button>' : '') + '</div>' +
        '<div class="ac-m">Type the number exactly as ' + esc(ag) + ' sent it. The portal reads ISSUED only with a real number and date.</div>';
    } else {
      h += '<span class="ac-pill">Not submitted</span><button class="ac-btn warm" data-a="submit" data-inv="' + esc(inv) + '" data-ag="' + esc(ag) + '"' + dis + '>Submitted to ' + esc(ag) + '</button></div>';
    }
    return h + fl(key) + '</div>';
  }

  function daaLine(e, p) {
    var inv = e.invoice_no, c = certOf(inv, 'DiveArts'), key = inv + '|DiveArts';
    var h = '<div class="ac-cert"><div class="ac-row"><span class="lbl">DAA</span>';
    if (c && c.status === 'issued') {
      h += '<span class="ac-pill ok">Issued · ' + esc(c.number) + ' · ' + esc(dmy(c.issued_on)) + '</span>' +
        (c.file_url ? '<a class="ac-btn ghost" href="' + esc(c.file_url) + '" target="_blank" rel="noopener">View</a>' : '');
    } else {
      h += '<span class="ac-pill">Not made</span>';
    }
    h += '<button class="ac-btn ' + (c ? 'ghost' : 'go') + '" data-a="gen" data-inv="' + esc(inv) + '">' + (A.gen === inv ? 'Close' : (c ? 'Make again' : 'Make DAA certificate')) + '</button></div>';
    if (A.gen === inv) h += genPanel(e, p);
    return h + fl(key) + '</div>';
  }

  function genDefaults(e) {
    var f = A.form[e.invoice_no + '|gen'] || (A.form[e.invoice_no + '|gen'] = {});
    if (f.name == null) f.name = e.student;
    if (f.course == null) f.course = certTitle(e.course);
    if (f.date == null) f.date = witaToday();
    if (f.city == null) f.city = 'Bali, Indonesia';
    if (f.padi == null) f.padi = (e.agencies || []).indexOf('PADI') >= 0;
    if (f.number == null) f.number = daaNumber(e.invoice_no);
    return f;
  }
  function genPanel(e, p) {
    var inv = e.invoice_no, f = genDefaults(e), k = inv + '|gen';
    var inp = function (fld, label, type) {
      return '<label>' + esc(label) + '<input class="ac-in" ' + (type ? 'type="' + type + '" ' : '') + 'data-af="' + esc(k) + '|' + fld + '" value="' + esc(f[fld]) + '"' + (type === 'date' ? ' max="' + witaToday() + '"' : '') + '></label>';
    };
    return '<div class="ac-gen"><div class="ac-grid">' + inp('name', 'Name on the certificate') + inp('course', 'Course line') +
      inp('date', 'Date', 'date') + inp('city', 'Place') + inp('number', 'DAA certificate number') +
      '<label>PADI logo<span class="ac-row" style="margin:0"><input type="checkbox" data-af="' + esc(k) + '|padi"' + (f.padi ? ' checked' : '') + '> top right corner</span></label></div>' +
      '<canvas id="ac-canvas" width="1684" height="1191"></canvas>' +
      '<div class="ac-row"><button class="ac-btn" data-a="download" data-inv="' + esc(inv) + '"' + (A.busy ? ' disabled' : '') + '>Download</button>' +
      '<button class="ac-btn go" data-a="savedaa" data-inv="' + esc(inv) + '"' + ((A.busy || !p) ? ' disabled' : '') + '>Save to ' + esc(p ? p.name.split(' ')[0] : 'the') + '\'s portal</button></div>' +
      (p ? '' : '<div class="ac-m">Pick the portal student above to save it to the portal. Download works without.</div>') +
      '<div class="ac-m">Check the name spelling before saving. Saving marks the DAA certificate issued with this number and date.</div></div>';
  }

  function cqCard(e) {
    var p = pickFor(e), inv = e.invoice_no;
    var h = '<div class="ac-card cq"><div class="ac-t">' + esc(e.student) + '</div>' +
      '<div class="ac-m">' + esc(e.course) + ' · ' + esc(inv) + (e.plan ? ' · ' + e.done + ' of ' + e.plan + ' sessions' : '') + (e.last_seen ? ' · last class ' + esc(e.last_seen) : '') + '</div>' +
      portalLine(e);
    (e.agencies || []).forEach(function (ag) { h += agencyLine(e, ag, p); });
    h += daaLine(e, p);
    if (allIssued(e)) {
      h += '<div class="ac-row">' + armBtn('done|' + inv, 'Mark done in my sheet', 'Tap again: column A becomes done', 'go') + '</div>';
    }
    return h + fl(inv) + '</div>';
  }

  function openCard(e) {
    var pct = e.plan ? Math.min(100, Math.round(100 * e.done / e.plan)) : 0;
    return '<div class="ac-card"><div class="ac-t">' + esc(e.student) + '</div>' +
      '<div class="ac-m">' + esc(e.course) + ' · ' + esc(e.invoice_no) + ' · ' + (e.plan ? e.done + ' of ' + e.plan + ' sessions' : e.done + ' sessions taught') +
      (e.last_seen ? ' · last class ' + esc(e.last_seen) : ' · no class yet') + '</div>' +
      (e.plan ? '<div class="ac-bar"><i style="width:' + pct + '%"></i></div>' : '') +
      '<div class="ac-row">' + armBtn('wait|' + e.invoice_no, 'Course finished, waiting for certificate', 'Tap again to change the sheet', 'ghost') + '</div>' +
      fl(e.invoice_no) + '</div>';
  }

  function schedule(d) {
    if (!d.upcoming.length) return '<div class="ac-note">No classes from today on in the Schedule Manager.</div>';
    var h = '', day = '';
    d.upcoming.slice(0, 40).forEach(function (u) {
      if (u.date !== day) { day = u.date; h += '<div class="ac-day">' + esc(dayHead(day)) + (day === d.today ? ' · today' : '') + '</div>'; }
      h += '<div class="ac-cls"><span class="tm">' + esc(u.start + (u.end ? '–' + u.end : '')) + '</span><span>' + esc(u.student) +
        ' <span class="sub">· ' + esc(u.label || u.course) + (u.venue ? ' · ' + esc(u.venue) : '') + '</span></span></div>';
    });
    if (d.upcoming.length > 40) h += '<div class="ac-note">' + (d.upcoming.length - 40) + ' more later on.</div>';
    return h;
  }

  function render() {
    var root = document.getElementById(ROOT);
    if (!root) return;
    var ae = document.activeElement;
    if (ae && root.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== 'checkbox') { A.pending = true; return; }
    A.pending = false;
    css();
    var d = A.data;
    var h = '<div class="ac-h"><h3>My instructor desk</h3><span class="ac-fresh">' +
      (A.loading ? 'Reading your sheet, about 40 seconds…' : (d ? 'As of ' + esc(when(d.at)) : '')) + '</span>' +
      '<button class="ac-btn ghost" data-a="refresh"' + (A.loading ? ' disabled' : '') + '>Refresh</button></div>';
    if (A.err) h += '<div class="ac-err">' + esc(A.err) + (d ? ' Showing the last answer from ' + esc(when(d.at)) + '.' : '') + '</div>';
    if (A.notice) h += '<div class="ac-flash">' + esc(A.notice) + '</div>';
    if (!d) { root.innerHTML = h + (A.loading ? '' : '<div class="ac-note">Nothing loaded yet.</div>'); return; }
    if (d.portalError) h += '<div class="ac-err">The student portal did not answer: ' + esc(d.portalError) + ' Certificates cannot be saved until it does.</div>';
    h += tiles(d);

    h += '<div class="ac-sec">Finished, certificate to do</div>';
    if (d.certQueueKnown === false) h += '<div class="ac-note">The sheet service is an older version without this list.</div>';
    else if (!d.certQueue.length) h += '<div class="ac-note">None. When a course is finished, tap "Course finished, waiting for certificate" on it below, or set column A in your sheet.</div>';
    else h += d.certQueue.map(cqCard).join('');

    h += '<div class="ac-sec">Still in progress</div>';
    ORDER.forEach(function (st) {
      var list = d.enrolments.filter(function (e) { return e.status === st; });
      if (!list.length) return;
      h += '<div class="ac-note"><b>' + esc(st) + '</b> · ' + list.length + '</div>' + list.map(openCard).join('');
    });
    var other = d.enrolments.filter(function (e) { return ORDER.indexOf(e.status) < 0; });
    if (other.length) h += '<div class="ac-note"><b>Other status</b> · ' + other.length + '</div>' + other.map(openCard).join('');

    h += '<div class="ac-sec">Coming up</div>' + schedule(d);
    root.innerHTML = h;
    if (A.gen) draw();
  }

  /* --------------------------------------------------------- the loader */
  function load() {
    if (A.loading) return;
    A.loading = true; A.err = ''; render();
    fetch('/api/academy', { headers: headers(), cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { if (typeof osUnauthorised === 'function') osUnauthorised(); throw new Error('Your OS key was refused. Enter it again.'); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || ('Your sheet could not be read (HTTP ' + r.status + ').'));
        return j;
      });
    }).then(function (j) {
      A.data = j; A.loading = false; lsSet(LS_LAST, j); render();
    }).catch(function (e) {
      A.loading = false; A.err = e.message || 'Your sheet could not be read.'; render();
    });
  }

  function post(body) {
    return fetch('/api/academy', { method: 'POST', headers: headers(), body: JSON.stringify(body) }).then(function (r) {
      if (r.status === 401 && typeof osUnauthorised === 'function') osUnauthorised();
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function findE(inv) {
    var d = A.data || {};
    return (d.certQueue || []).concat(d.enrolments || []).filter(function (e) { return e.invoice_no === inv; })[0];
  }
  function putCert(c) {
    var list = A.data.certs || (A.data.certs = []);
    var i = list.findIndex(function (x) { return x.invoice_no === c.invoice_no && x.agency === c.agency; });
    if (i >= 0) list[i] = c; else list.push(c);
    lsSet(LS_LAST, A.data);
  }
  function busy(key) { A.busy = key; A.flash[key] = null; render(); }

  function doCert(inv, ag, step) {
    var e = findE(inv), p = e && pickFor(e), key = inv + '|' + ag, f = A.form[key] || {};
    if (!e || !p) return;
    var body = { action: 'cert', step: step, invoice_no: inv, agency: ag, profile_id: p.profile_id, course_name: e.course };
    if (step === 'issue') {
      body.number = String(f.number != null ? f.number : ((certOf(inv, ag) || {}).number || '')).trim();
      body.issued_on = f.date || witaToday();
      if (!body.number) { A.flash[key] = { text: 'Type the certificate number first.', bad: true }; render(); return; }
    }
    busy(key);
    post(body).then(function (j) {
      putCert(j.cert); A.busy = ''; delete A.form[key];
      A.flash[key] = { text: step === 'submit' ? 'Marked submitted. ' + p.name + '\'s portal shows it as waiting for ' + ag + '.'
        : step === 'unsubmit' ? 'Undone.' : 'Issued. It shows in ' + p.name + '\'s portal with number ' + j.cert.number + '.' };
      render();
    }).catch(function (err) { A.busy = ''; A.flash[key] = { text: 'Not saved: ' + err.message, bad: true }; render(); });
  }

  function doStatus(inv, to) {
    var e = findE(inv);
    if (!e) return;
    busy(inv);
    post({ action: 'status', sheet_row: e.sheet_row, student: e.student, invoice_no: inv, to: to }).then(function (j) {
      A.busy = ''; A.arm = '';
      if (to === 'wait') {
        A.data.enrolments = A.data.enrolments.filter(function (x) { return x !== e; });
        e.status = j.to || 'course done, waiting for certificate';
        A.data.certQueue.unshift(e);
        A.notice = e.student + ' moved to Finished, certificate to do. Your sheet now says "' + (j.to || '') + '".';
        lsSet(LS_LAST, A.data);
        render();
        post({ action: 'match', names: [e.student] }).then(function (m) {
          A.data.matches = (A.data.matches || []).filter(function (x) { return x.q !== e.student; }).concat(m.matches || []);
          lsSet(LS_LAST, A.data); render();
        }).catch(function () { /* the card offers search */ });
      } else {
        A.data.certQueue = A.data.certQueue.filter(function (x) { return x !== e; });
        A.notice = e.student + ', ' + inv + ' is done. Your sheet now says "' + (j.to || '') + '".';
        lsSet(LS_LAST, A.data); render();
      }
    }).catch(function (err) { A.busy = ''; A.arm = ''; A.flash[inv] = { text: 'Your sheet was not changed: ' + err.message, bad: true }; render(); });
  }

  function doSearch(inv) {
    var q = ((A.form[inv] || {}).q || '').trim();
    if (q.length < 2) return;
    busy(inv);
    post({ action: 'match', names: [q] }).then(function (m) {
      A.busy = ''; A.search[inv] = { list: ((m.matches || [])[0] || {}).candidates || [] };
      if (!A.search[inv].list.length) A.flash[inv] = { text: 'No portal student found for "' + q + '".', bad: true };
      render();
    }).catch(function (err) { A.busy = ''; A.flash[inv] = { text: err.message, bad: true }; render(); });
  }

  /* -------------------------------------------- the certificate drawing */
  var BG = {}, fontsReady = null;
  /* The two typefaces closest to her Canva design, shipped with the app
     (academy/fonts, SIL Open Font License) so a slow or blocked Google Fonts
     can never put a plain fallback font on a student's certificate. */
  var LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  var LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
  var FACES = [
    ['Great Vibes', 'great-vibes-latin-400-normal', '400', LATIN], ['Great Vibes', 'great-vibes-latin-ext-400-normal', '400', LATIN_EXT],
    ['Lora', 'lora-latin-400-normal', '400', LATIN], ['Lora', 'lora-latin-ext-400-normal', '400', LATIN_EXT],
    ['Lora', 'lora-latin-500-normal', '500', LATIN], ['Lora', 'lora-latin-ext-500-normal', '500', LATIN_EXT]
  ];
  function loadFonts() {
    if (fontsReady) return fontsReady;
    if (typeof FontFace !== 'function' || !document.fonts) return (fontsReady = Promise.reject(new Error('This browser cannot load the certificate fonts.')));
    fontsReady = Promise.all(FACES.map(function (f) {
      var ff = new FontFace(f[0], 'url(/academy/fonts/' + f[1] + '.woff2) format("woff2")', { weight: f[2], unicodeRange: f[3] });
      document.fonts.add(ff);
      return ff.load();
    })).catch(function () {
      fontsReady = null;
      throw new Error('The certificate fonts did not load, so nothing was drawn. Check the connection and open it again.');
    });
    return fontsReady;
  }
  function bg(padi) {
    var src = padi ? '/academy/cert-bg-padi.jpg' : '/academy/cert-bg.jpg';
    if (BG[src]) return BG[src];
    BG[src] = new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { delete BG[src]; rej(new Error('The certificate background did not load.')); };
      im.src = src;
    });
    return BG[src];
  }
  function fit(ctx, text, font, size, maxW) {
    var s = size;
    do { ctx.font = font.replace('{s}', s); s -= 1; } while (ctx.measureText(text).width > maxW && s > 8);
  }
  function longDate(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? (+p[2]) + ' ' + MON[+p[1] - 1] + ' ' + p[0] : ''; }
  var drawSeq = 0;
  function draw() {
    var e = findE(A.gen), cv = document.getElementById('ac-canvas');
    if (!e || !cv) return Promise.resolve(null);
    var f = genDefaults(e), seq = ++drawSeq;
    return Promise.all([loadFonts(), bg(!!f.padi)]).then(function (r) {
      if (seq !== drawSeq) return null;
      var cv2 = document.getElementById('ac-canvas');
      if (!cv2) return null;
      var ctx = cv2.getContext('2d'), W = cv2.width, k = W / 1123;
      ctx.drawImage(r[1], 0, 0, W, cv2.height);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#16999b';
      fit(ctx, f.name, '{s}px "Great Vibes", cursive', Math.round(50 * k), 560 * k);
      ctx.fillText(f.name, 587 * k, 346 * k);
      ctx.fillStyle = '#e0609f';
      fit(ctx, f.course, '500 {s}px "Lora", Georgia, serif', Math.round(17.5 * k), 600 * k);
      ctx.fillText(f.course, 587 * k, 458 * k);
      ctx.fillStyle = '#7a5a3c';
      fit(ctx, longDate(f.date), '{s}px "Lora", Georgia, serif', Math.round(14 * k), 150 * k);
      ctx.fillText(longDate(f.date), 365 * k, 640 * k);
      fit(ctx, f.city, '{s}px "Lora", Georgia, serif', Math.round(14 * k), 170 * k);
      ctx.fillText(f.city, 365 * k, 660 * k);
      return cv2;
    }).catch(function (err) {
      var k = A.gen + '|DiveArts', was = A.flash[k] && A.flash[k].text;
      A.flash[k] = { text: err.message, bad: true };
      if (was !== err.message) setTimeout(render, 0);   /* once per new message, never a loop */
      return null;
    });
  }
  function toBlob(cv) { return new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.9); }); }
  function toB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { rej(new Error('The image could not be read.')); };
      r.readAsDataURL(blob);
    });
  }
  function doDownload(inv) {
    var e = findE(inv), f = genDefaults(e);
    draw().then(function (cv) { return cv && toBlob(cv); }).then(function (blob) {
      if (!blob) return;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'DAA certificate - ' + f.name.replace(/[^\w .-]+/g, '') + '.jpg';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    });
  }
  function doSaveDaa(inv) {
    var e = findE(inv), p = e && pickFor(e), f = e && genDefaults(e), key = inv + '|DiveArts';
    if (!p) return;
    if (!String(f.number || '').trim()) { A.flash[key] = { text: 'Type the DAA certificate number first.', bad: true }; render(); return; }
    busy(key);
    draw().then(function (cv) {
      if (!cv) throw new Error('The certificate could not be drawn.');
      return toBlob(cv);
    }).then(toB64).then(function (b64) {
      return post({ action: 'cert_file', profile_id: p.profile_id, data_base64: b64 });
    }).then(function (up) {
      return post({ action: 'cert', step: 'issue', invoice_no: inv, agency: 'DiveArts', profile_id: p.profile_id, course_name: e.course,
                    number: String(f.number).trim(), issued_on: f.date, file_url: up.file_url });
    }).then(function (j) {
      putCert(j.cert); A.busy = ''; A.gen = '';
      A.flash[key] = { text: 'Saved. The DAA certificate shows in ' + p.name + '\'s portal, number ' + j.cert.number + '.' };
      render();
    }).catch(function (err) { A.busy = ''; A.flash[key] = { text: 'Not saved: ' + err.message, bad: true }; render(); });
  }

  /* ------------------------------------------------------------- events */
  document.addEventListener('input', function (e) {
    var t = e.target, af = t && t.getAttribute && t.getAttribute('data-af');
    if (!af) return;
    var i = af.lastIndexOf('|'), key = af.slice(0, i), fld = af.slice(i + 1);
    var f = A.form[key] || (A.form[key] = {});
    f[fld] = t.type === 'checkbox' ? t.checked : t.value;
    if (/\|gen$/.test(key)) draw();
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.type === 'checkbox' && t.getAttribute('data-af')) { t.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  document.addEventListener('focusout', function () {
    setTimeout(function () {
      var root = document.getElementById(ROOT), ae = document.activeElement;
      if (A.pending && !(root && ae && root.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName))) render();
    }, 0);
  });
  document.addEventListener('click', function (e) {
    var root = document.getElementById(ROOT);
    if (!root || !root.contains(e.target)) return;
    var b = e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    var a = b.getAttribute('data-a'), inv = b.getAttribute('data-inv'), ag = b.getAttribute('data-ag');
    if (a === 'refresh') { A.notice = ''; A.flash = {}; load(); return; }
    if (a === 'pick') { A.picks[inv] = { profile_id: b.getAttribute('data-pid'), name: b.getAttribute('data-name') }; lsSet(LS_PICK, A.picks); render(); return; }
    if (a === 'unpick') { delete A.picks[inv]; lsSet(LS_PICK, A.picks); render(); return; }
    if (a === 'search') { doSearch(inv); return; }
    if (a === 'submit' || a === 'unsubmit' || a === 'issue') { doCert(inv, ag, a); return; }
    if (a === 'edit') { var f = A.form[b.getAttribute('data-k')] || (A.form[b.getAttribute('data-k')] = {}); f.edit = true; render(); return; }
    if (a === 'gen') { A.gen = A.gen === inv ? '' : inv; render(); return; }
    if (a === 'download') { doDownload(inv); return; }
    if (a === 'savedaa') { doSaveDaa(inv); return; }
    if (a === 'arm') {
      var k = b.getAttribute('data-k');
      if (A.arm !== k) {
        A.arm = k; render();
        setTimeout(function () { if (A.arm === k) { A.arm = ''; render(); } }, 5000);
        return;
      }
      var i = k.indexOf('|');
      doStatus(k.slice(i + 1), k.slice(0, i));
    }
  });

  /* business-panel.js calls this after drawing <div id="acad-root">. The sheet
     is read once per page load and again only on Refresh. */
  var loadedOnce = false;
  window.acadMount = function () {
    render();
    if (!loadedOnce) { loadedOnce = true; load(); }
  };
  window.__acadTest = { certTitle: certTitle, daaNumber: daaNumber, pickFor: pickFor, state: A };
})();
