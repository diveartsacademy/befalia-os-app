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
  var LS_LAST = 'acad_last_v3', LS_PICK = 'acad_picks_v2';   /* last v3: courses carry their package parts */
  var A = { data: null, err: '', loading: false, busy: '', arm: '', flash: {}, gen: '', form: {}, picks: {}, search: {}, forget: {}, pending: false, notice: '' };
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
      '.ac-part{border-top:1px solid var(--line);margin-top:10px;padding-top:4px}' +
      '.ac-ph{font:600 13.5px var(--sans);color:var(--aquasoft);margin-top:6px}' +
      '@media (max-width:520px){.ac-grid{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------ helpers */
  /* Every course block is identified by its ref (invoice, student and course,
     made by the server), never by the invoice alone: one invoice can hold two
     blocks, e.g. one student taking two courses (14 Oct 2026, after review).
     A package block (Zero to Hero, MI + EFR) holds several courses, its parts;
     each part has its own ref, <block ref>.<part key>, and its own certificates
     (Befa, 14 Oct 2026: "they get every course a certificate"). */
  function partsOf(e) { return (e.parts && e.parts.length) ? e.parts : [{ key: '', title: '', agencies: e.agencies || [] }]; }
  function partRef(e, pt) { return e.ref + (pt.key ? '.' + pt.key : ''); }
  function allBlocks() { var d = A.data || {}; return (d.certQueue || []).concat(d.enrolments || []); }
  function findP(pref) {
    var all = allBlocks();
    for (var i = 0; i < all.length; i++) {
      var ps = partsOf(all[i]);
      for (var j = 0; j < ps.length; j++) if (partRef(all[i], ps[j]) === pref) return { e: all[i], pt: ps[j], ref: pref, i: j, n: ps.length };
    }
    return null;
  }
  function certsFor(ref) { return ((A.data && A.data.certs) || []).filter(function (c) { return c.ref === ref; }); }
  function certOf(ref, ag) { return certsFor(ref).filter(function (c) { return c.agency === ag; })[0] || null; }
  function blockCerts(e) { return ((A.data && A.data.certs) || []).filter(function (c) { return c.ref === e.ref || String(c.ref || '').indexOf(e.ref + '.') === 0; }); }
  function matchesFor(name) {
    var m = ((A.data && A.data.matches) || []).filter(function (x) { return x.q === name; })[0];
    return (m && m.candidates) || [];
  }
  /* The portal student for a course block: an ISSUED certificate fixes it for
     good. Otherwise Befa's own pick, then the student of a certificate still in
     progress, then one exact name match. Never a guess. */
  function pickFor(e) {
    var made = blockCerts(e), issued = made.filter(function (c) { return c.status === 'issued'; })[0];
    if (issued) return { profile_id: issued.profile_id, name: issued.name || 'this student', locked: true };
    var p = A.picks[e.ref];
    if (p) return p;
    if (A.forget[e.ref]) return null;   /* Befa tapped Change: she picks again */
    if (made[0]) return { profile_id: made[0].profile_id, name: made[0].name || 'this student' };
    var c = matchesFor(e.student), exact = c.filter(function (x) { return x.score >= 100; });
    if (exact.length === 1) return { profile_id: exact[0].profile_id, name: exact[0].name || e.student, auto: true };
    return null;
  }
  /* A clean course name from the sheet's course text, which often carries dates,
     a second line or a list of what the package includes. Always editable. */
  function certTitle(course) {
    var raw = String(course || '').split('\n')[0];
    raw = raw.replace(/\s*\([^)]*\d[^)]*\)/g, '').replace(/\s+PADI Instructor Guide\b.*$/i, '').replace(/\s+/g, ' ').replace(/[\s-]+$/, '').trim();
    var parts = raw.split(' - ').map(function (x) { return x.trim(); }).filter(Boolean);
    var disc = (parts[0] || '').replace(/\s*Course$/i, '');
    var lastP = parts.length > 1 ? parts[parts.length - 1] : '';
    var out;
    if (!lastP || /^(Adult|Kids)$/i.test(lastP) || /^\d+x$/i.test(lastP)) out = parts[0] || raw;
    else if (disc && lastP.toLowerCase().indexOf(disc.toLowerCase()) < 0 && !/Mermaid|Dance/i.test(lastP)) {
      var m = lastP.match(/^(PADI|MFI|AIDA|EFR)\s+(.*)$/i);
      out = m ? m[1] + ' ' + disc + ' ' + m[2] : disc + ' ' + lastP;
    } else out = lastP;
    if (out.length > 70) out = out.slice(0, 70).replace(/\s+\S*$/, '');
    return out;
  }
  /* DAA plus the invoice (approved by Befa 14 Oct 2026). When one invoice holds
     more than one course block, -1, -2 in sheet order keep the numbers unique.
     A course inside a package adds its short code: DAA-AUG26-4-UWD, -AUWD, -UWDI. */
  function daaNumber(e, pt) {
    var base = 'DAA-' + String(e.invoice_no || '').replace(/^DAA[-\s]?/i, '');
    if (e.blocks_on_invoice > 1) {
      var same = allBlocks().filter(function (x) { return x.invoice_no === e.invoice_no; })
        .sort(function (a, b) { return a.sheet_row - b.sheet_row; });
      base += '-' + (same.indexOf(e) + 1);
    }
    return pt && pt.key ? base + '-' + pt.key.toUpperCase() : base;
  }
  function levelOf(e, pt) {
    var pref = partRef(e, pt || partsOf(e)[0]);
    var f = A.form[pref + '|lvl'] || (A.form[pref + '|lvl'] = {});
    if (f.level == null) {
      var made = certsFor(pref).filter(function (c) { return c.level; })[0];
      f.level = made ? made.level : ((pt && pt.title) || certTitle(e.course));
    }
    return f.level;
  }
  function allIssued(e) {
    return partsOf(e).every(function (pt) {
      var pref = partRef(e, pt);
      return (pt.agencies || []).concat(['DiveArts']).every(function (ag) { var c = certOf(pref, ag); return c && c.status === 'issued'; });
    });
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
  function dis() { return A.busy ? ' disabled' : ''; }

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
    var p = pickFor(e), ref = e.ref;
    var h;
    if (p) {
      h = '<div class="ac-row ac-cand"><span class="ac-pill ok">Portal: ' + esc(p.name) + '</span>' +
        (p.auto ? '<span class="ac-m">same name in the portal</span>' : '') +
        (p.locked ? '' : '<button class="ac-btn ghost" data-a="unpick" data-ref="' + esc(ref) + '"' + dis() + '>Change</button>') + '</div>';
    } else {
      var c = (A.search[ref] && A.search[ref].list) || matchesFor(e.student);
      h = '<div class="ac-row ac-cand"><span class="ac-pill wait">Portal student?</span>';
      if (c.length) {
        h += c.map(function (x) {
          return '<button class="ac-btn" data-a="pick" data-ref="' + esc(ref) + '" data-pid="' + esc(x.profile_id) + '" data-name="' + esc(x.name || '') + '">' +
            esc(x.name || 'No name') + (x.classes ? ' · ' + x.classes + ' classes' : '') + '</button>';
        }).join('');
      } else {
        h += '<span class="ac-m">No one by this name in the student portal. The DAA certificate can still be made, downloaded and sent on WhatsApp, but it can only show in a portal that has this student.</span>';
      }
      h += '</div><div class="ac-row"><input class="ac-in w" data-af="' + esc(ref) + '|q" placeholder="Search the portal by another name" value="' + esc((A.form[ref] || {}).q || '') + '"' + dis() + '>' +
        '<button class="ac-btn ghost" data-a="search" data-ref="' + esc(ref) + '"' + dis() + '>Search</button></div>';
    }
    return h;
  }

  function agencyLine(e, pt, ag, p) {
    var ref = partRef(e, pt), c = certOf(ref, ag), key = ref + '|' + ag, f = A.form[key] || {};
    var h = '<div class="ac-cert"><div class="ac-row"><span class="lbl">' + esc(ag) + '</span>';
    var off = (A.busy || !p) ? ' disabled' : '';
    if (c && c.status === 'issued' && !f.edit) {
      h += '<span class="ac-pill ok">Issued · ' + esc(c.number) + ' · ' + esc(dmy(c.issued_on)) + '</span>' +
        '<button class="ac-btn ghost" data-a="edit" data-k="' + esc(key) + '"' + dis() + '>Correct</button></div>';
    } else if (c && (c.status === 'submitted_to_agency' || (c.status === 'issued' && f.edit))) {
      h += (c.status === 'issued' ? '<span class="ac-pill ok">Issued · ' + esc(c.number) + '</span>' : '<span class="ac-pill wait">Submitted ' + esc(dmy(c.submitted_on)) + '</span>') + '</div>' +
        '<div class="ac-row"><input class="ac-in w" data-af="' + esc(key) + '|number" placeholder="' + esc(ag) + ' certificate number" value="' + esc(f.number != null ? f.number : (c.number || '')) + '"' + dis() + '>' +
        '<input class="ac-in" type="date" data-af="' + esc(key) + '|date" max="' + esc(witaToday()) + '" value="' + esc(issueDate(c, f)) + '"' + dis() + '>' +
        '<button class="ac-btn go" data-a="issue" data-ref="' + esc(ref) + '" data-ag="' + esc(ag) + '"' + off + '>Save as issued</button>' +
        (c.status === 'submitted_to_agency' ? '<button class="ac-btn ghost" data-a="unsubmit" data-ref="' + esc(ref) + '" data-ag="' + esc(ag) + '"' + off + '>Undo submitted</button>' : '') +
        (c.status === 'issued' ? '<button class="ac-btn ghost" data-a="noedit" data-k="' + esc(key) + '"' + dis() + '>Cancel</button>' : '') + '</div>' +
        '<div class="ac-m">Type the number exactly as ' + esc(ag) + ' sent it. The portal reads ISSUED only with a real number and date.</div>';
    } else {
      h += '<span class="ac-pill">Not submitted</span><button class="ac-btn warm" data-a="submit" data-ref="' + esc(ref) + '" data-ag="' + esc(ag) + '"' + off + '>Submitted to ' + esc(ag) + '</button></div>';
    }
    return h + fl(key) + '</div>';
  }
  /* The date the box shows is the date that is sent: what Befa typed, else the
     date already stored, else today. */
  function issueDate(c, f) { return f.date || (c && c.issued_on) || witaToday(); }

  function daaLine(e, pt, p) {
    var ref = partRef(e, pt), c = certOf(ref, 'DiveArts'), key = ref + '|DiveArts';
    var h = '<div class="ac-cert"><div class="ac-row"><span class="lbl">DAA</span>';
    if (c && c.status === 'issued') {
      h += '<span class="ac-pill ok">Issued · ' + esc(c.number) + ' · ' + esc(dmy(c.issued_on)) + '</span>' +
        (c.file_url ? '<a class="ac-btn ghost" href="' + esc(c.file_url) + '" target="_blank" rel="noopener">View</a>' : '');
    } else {
      h += '<span class="ac-pill">Not made</span>';
    }
    h += '<button class="ac-btn ' + (c ? 'ghost' : 'go') + '" data-a="gen" data-ref="' + esc(ref) + '"' + dis() + '>' + (A.gen === ref ? 'Close' : (c ? 'Make again' : 'Make DAA certificate')) + '</button></div>';
    if (c && c.status === 'issued' && c.file_url && A.gen !== ref) h += waRow(e, pt, ref, c);
    if (A.gen === ref) h += genPanel(e, pt, p);
    return h + fl(key) + '</div>';
  }

  function genDefaults(e, pt) {
    var ref = partRef(e, pt);
    var f = A.form[ref + '|gen'] || (A.form[ref + '|gen'] = {});
    var made = certOf(ref, 'DiveArts');
    if (f.name == null) f.name = e.student;
    if (f.course == null) f.course = levelOf(e, pt);
    if (f.date == null) f.date = (made && made.issued_on) || witaToday();
    if (f.city == null) f.city = 'Bali, Indonesia';
    if (f.padi == null) f.padi = (pt.agencies || []).indexOf('PADI') >= 0;
    if (f.number == null) f.number = (made && made.number) || daaNumber(e, pt);
    return f;
  }
  function genPanel(e, pt, p) {
    var ref = partRef(e, pt), f = genDefaults(e, pt), k = ref + '|gen';
    var inp = function (fld, label, type) {
      return '<label>' + esc(label) + '<input class="ac-in" ' + (type ? 'type="' + type + '" ' : '') + 'data-af="' + esc(k) + '|' + fld + '" value="' + esc(f[fld]) + '"' + (type === 'date' ? ' max="' + witaToday() + '"' : '') + dis() + '></label>';
    };
    var first = p ? String(p.name || '').split(' ')[0] : '';
    return '<div class="ac-gen"><div class="ac-grid">' + inp('name', 'Name on the certificate') + inp('course', 'Course line') +
      inp('date', 'Date', 'date') + inp('city', 'Place') + inp('number', 'DAA certificate number') +
      '<label>PADI logo<span class="ac-row" style="margin:0"><input type="checkbox" data-af="' + esc(k) + '|padi"' + (f.padi ? ' checked' : '') + dis() + '> top right corner</span></label></div>' +
      '<canvas id="ac-canvas" width="1684" height="1191"></canvas>' +
      '<div class="ac-row"><button class="ac-btn" data-a="download" data-ref="' + esc(ref) + '"' + dis() + '>Download PDF</button>' +
      '<button class="ac-btn" data-a="sharepdf" data-ref="' + esc(ref) + '"' + dis() + '>Send PDF on WhatsApp</button>' +
      '<button class="ac-btn go" data-a="savedaa" data-ref="' + esc(ref) + '"' + ((A.busy || !p) ? ' disabled' : '') + '>' +
      (A.busy === ref + '|DiveArts' ? 'Saving…' : 'Save to ' + esc(first ? first + '\'s' : 'the') + ' portal') + '</button></div>' +
      (p ? '' : '<div class="ac-m">Pick the portal student above to save it to the portal. Download and WhatsApp work without.</div>') +
      '<div class="ac-m">Check the name spelling before saving. Saving marks the DAA certificate issued with this number and date. Nothing is sent to the student by itself: WhatsApp opens for you to send.</div></div>';
  }

  /* WhatsApp, after the certificate is saved: the PDF link in a ready message to
     the student's own number, which Befa reads and sends herself. Never sent by
     the system (the customer-message freeze of 8 Sep 2026 still stands). */
  function waText(e, pt, link, lang) {
    var first = String(e.student || '').trim().split(/\s+/)[0] || '';
    var course = levelOf(e, pt);
    return lang === 'en'
      ? 'Hi ' + first + ', congratulations on completing ' + course + ' at DiveArts Academy. Here is your DiveArts Academy certificate' + (link ? ': ' + link : '.') + ' Thank you for training with us.'
      : 'Halo ' + first + ', selamat telah menyelesaikan ' + course + ' di DiveArts Academy. Berikut sertifikat DiveArts Academy kamu' + (link ? ': ' + link : '.') + ' Terima kasih sudah berlatih bersama kami.';
  }
  /* Bahasa for an Indonesian number, English otherwise, until Befa switches it. */
  function waLang(e, ref) {
    var f = A.form[ref + '|wa'] || {};
    return f.lang || (/^62/.test(waDigits(e.whatsapp)) ? 'id' : 'en');
  }
  /* The number as wa.me wants it: country code and digits only. Takes the first
     number when a cell holds two. A number the sheet stored without its leading
     0 (81234...) or written 62 0812... is read as Indonesian. Anything that does
     not look like a phone number gives '' and the button lets Befa pick the chat. */
  function waDigits(num) {
    var first = String(num || '').split(/[\/,;|]|\bor\b|\batau\b/i)[0];
    var plus = /^\s*\+/.test(first), d = first.replace(/\D/g, '');
    if (!plus) {
      if (/^0\d{8,13}$/.test(d)) d = '62' + d.slice(1);
      else if (/^8\d{8,12}$/.test(d)) d = '62' + d;
    }
    if (/^620\d{8,13}$/.test(d)) d = '62' + d.slice(3);
    return /^\d{8,15}$/.test(d) ? d : '';
  }
  function waRow(e, pt, ref, c) {
    var lang = waLang(e, ref), num = waDigits(e.whatsapp);
    var href = 'https://wa.me/' + (num.length >= 8 ? num : '') + '?text=' + encodeURIComponent(waText(e, pt, c.file_url, lang));
    return '<div class="ac-row">' +
      (num.length >= 8
        ? '<a class="ac-btn warm" href="' + esc(href) + '" target="_blank" rel="noopener">WhatsApp ' + esc(String(e.student || '').split(' ')[0]) + ' (' + esc(e.whatsapp) + ')</a>'
        : '<a class="ac-btn warm" href="' + esc(href) + '" target="_blank" rel="noopener">WhatsApp, pick the chat</a><span class="ac-m">' + (e.whatsapp ? 'The WhatsApp number in the sheet (' + esc(e.whatsapp) + ') does not look like a phone number.' : 'No WhatsApp number in the sheet for this student.') + '</span>') +
      '<button class="ac-btn ghost" data-a="walang" data-k="' + esc(ref) + '"' + dis() + '>' + (lang === 'en' ? 'English · switch to Bahasa' : 'Bahasa · switch to English') + '</button></div>';
  }

  function cqCard(e) {
    var p = pickFor(e), ref = e.ref, parts = partsOf(e), pkg = parts.length > 1;
    var h = '<div class="ac-card cq"><div class="ac-t">' + esc(e.student) + '</div>' +
      '<div class="ac-m">' + esc(e.course) + ' · ' + esc(e.invoice_no) + ' · row ' + esc(e.sheet_row) + (e.plan ? ' · ' + e.done + ' of ' + e.plan + ' sessions' : '') + (e.last_seen ? ' · last class ' + esc(e.last_seen) : '') + '</div>' +
      portalLine(e);
    if (pkg) h += '<div class="ac-note" style="margin-top:8px">A package: ' + parts.length + ' courses, each with its own certificates.</div>';
    parts.forEach(function (pt, i) {
      var pref = partRef(e, pt);
      h += '<div class="ac-part">' + (pkg ? '<div class="ac-ph">' + (i + 1) + ' of ' + parts.length + ' · ' + esc(pt.title) + '</div>' : '') +
        '<div class="ac-row"><label class="ac-m" style="flex:1 1 220px;display:flex;flex-direction:column;gap:3px">Course name shown in the portal' +
        '<input class="ac-in" data-af="' + esc(pref) + '|lvl|level" value="' + esc(levelOf(e, pt)) + '"' + dis() + '></label></div>';
      (pt.agencies || []).forEach(function (ag) { h += agencyLine(e, pt, ag, p); });
      h += daaLine(e, pt, p) + '</div>';
    });
    if (allIssued(e)) {
      h += '<div class="ac-row">' + armBtn('done|' + ref, 'Mark done in my sheet', 'Tap again: row ' + e.sheet_row + ' becomes done', 'go') + '</div>';
    }
    return h + fl(ref) + '</div>';
  }

  function openCard(e) {
    var pct = e.plan ? Math.min(100, Math.round(100 * e.done / e.plan)) : 0;
    return '<div class="ac-card"><div class="ac-t">' + esc(e.student) + '</div>' +
      '<div class="ac-m">' + esc(e.course) + ' · ' + esc(e.invoice_no) + ' · row ' + esc(e.sheet_row) + ' · ' + (e.plan ? e.done + ' of ' + e.plan + ' sessions' : e.done + ' sessions taught') +
      (e.last_seen ? ' · last class ' + esc(e.last_seen) : ' · no class yet') + '</div>' +
      (e.plan ? '<div class="ac-bar"><i style="width:' + pct + '%"></i></div>' : '') +
      '<div class="ac-row">' + armBtn('wait|' + e.ref, 'Course finished, waiting for certificate', 'Tap again to change row ' + e.sheet_row + ' in your sheet', 'ghost') + '</div>' +
      fl(e.ref) + '</div>';
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
    if (A.gen) draw().then(function (cv) { if (cv && !A.busy) preparePdf(); });
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

  function findE(ref) {
    var d = A.data || {};
    return (d.certQueue || []).concat(d.enrolments || []).filter(function (e) { return e.ref === ref; })[0];
  }
  function putCert(c) {
    var list = A.data.certs || (A.data.certs = []);
    var i = list.findIndex(function (x) { return x.ref === c.ref && x.agency === c.agency; });
    if (i >= 0) list[i] = c; else list.push(c);
    lsSet(LS_LAST, A.data);
  }
  function busy(key) { A.busy = key; A.flash[key] = null; render(); }

  function doCert(ref, ag, step) {
    var P = findP(ref), e = P && P.e, p = e && pickFor(e), key = ref + '|' + ag, f = A.form[key] || {}, c = certOf(ref, ag);
    if (!e || !p || A.busy) return;
    var body = { action: 'cert', step: step, invoice_no: e.invoice_no, ref: ref, agency: ag, profile_id: p.profile_id,
                 course_name: P.pt.key ? '' : e.course, level: levelOf(e, P.pt) };
    if (step === 'issue') {
      body.number = String(f.number != null ? f.number : ((c || {}).number || '')).trim();
      body.issued_on = issueDate(c, f);
      if (!body.number) { A.flash[key] = { text: 'Type the certificate number first.', bad: true }; render(); return; }
    }
    busy(key);
    post(body).then(function (j) {
      putCert(j.cert); A.busy = ''; delete A.form[key];
      A.flash[key] = { text: step === 'submit' ? 'Marked submitted. ' + p.name + '\'s portal shows it as waiting for ' + ag + '.'
        : step === 'unsubmit' ? 'Undone. You can change the portal student now if it was wrong.'
        : 'Issued. It shows in ' + p.name + '\'s portal with number ' + j.cert.number + ', dated ' + dmy(j.cert.issued_on) + '.' };
      render();
    }).catch(function (err) { A.busy = ''; A.flash[key] = { text: 'Not saved: ' + err.message, bad: true }; render(); });
  }

  function doStatus(ref, to) {
    var e = findE(ref);
    if (!e || A.busy) return;
    busy(ref);
    post({ action: 'status', sheet_row: e.sheet_row, student: e.student, invoice_no: e.invoice_no, to: to }).then(function (j) {
      A.busy = ''; A.arm = '';
      if (to === 'wait') {
        A.data.enrolments = A.data.enrolments.filter(function (x) { return x !== e; });
        e.status = j.to || 'course done, waiting for certificate';
        A.data.certQueue.unshift(e);
        A.notice = e.student + ' (' + e.invoice_no + ', row ' + e.sheet_row + ') moved to Finished, certificate to do. Your sheet now says "' + (j.to || '') + '".';
        lsSet(LS_LAST, A.data);
        render();
        post({ action: 'match', names: [e.student] }).then(function (m) {
          A.data.matches = (A.data.matches || []).filter(function (x) { return x.q !== e.student; }).concat(m.matches || []);
          lsSet(LS_LAST, A.data); render();
        }).catch(function () { /* the card offers search */ });
      } else {
        A.data.certQueue = A.data.certQueue.filter(function (x) { return x !== e; });
        A.notice = e.student + ' (' + e.invoice_no + ', row ' + e.sheet_row + ') is done. Your sheet now says "' + (j.to || '') + '".';
        lsSet(LS_LAST, A.data); render();
      }
    }).catch(function (err) { A.busy = ''; A.arm = ''; A.flash[ref] = { text: 'Your sheet was not changed: ' + err.message, bad: true }; render(); });
  }

  function doSearch(ref) {
    var q = ((A.form[ref] || {}).q || '').trim();
    if (q.length < 2 || A.busy) return;
    busy(ref);
    post({ action: 'match', names: [q] }).then(function (m) {
      A.busy = ''; A.search[ref] = { list: ((m.matches || [])[0] || {}).candidates || [] };
      if (!A.search[ref].list.length) A.flash[ref] = { text: 'No portal student found for "' + q + '".', bad: true };
      render();
    }).catch(function (err) { A.busy = ''; A.flash[ref] = { text: err.message, bad: true }; render(); });
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
    var P = findP(A.gen), cv = document.getElementById('ac-canvas');
    if (!P || !cv) return Promise.resolve(null);
    var f = genDefaults(P.e, P.pt), seq = ++drawSeq;
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
  /* One page, A4 landscape, the certificate JPEG filling it (the design is
     1684 x 1191, the A4 ratio). Written by hand: no library to load. */
  function pdfFromJpeg(jpg, w, h, title) {
    var enc = new TextEncoder(), chunks = [], len = 0, offs = [];
    var put = function (x) { var b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    var obj = function (n, body) { offs[n] = len; put(n + ' 0 obj\n' + body + '\nendobj\n'); };
    var W = 841.89, H = 595.28, cs = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
    var t = String(title || '').replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1');
    put('%PDF-1.4\n%âãÏÓ\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    offs[4] = len;
    put('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n');
    put(jpg); put('\nendstream\nendobj\n');
    obj(5, '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream');
    obj(6, '<< /Title (' + t + ') /Producer (Befalia OS) >>');
    var x = len, pad = function (n) { return ('0000000000' + n).slice(-10); };
    var xr = 'xref\n0 7\n0000000000 65535 f \n';
    for (var i = 1; i <= 6; i++) xr += pad(offs[i]) + ' 00000 n \n';
    put(xr + 'trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + x + '\n%%EOF\n');
    var out = new Uint8Array(len), o = 0;
    chunks.forEach(function (c) { out.set(c, o); o += c.length; });
    return out;
  }
  /* No dash in the name: the student sees it in WhatsApp. */
  function pdfName(f) { return 'DAA Certificate ' + String(f.name || '').replace(/[^\w .]+/g, '').replace(/\s+/g, ' ').trim() + '.pdf'; }
  /* The drawing as a PDF Blob. */
  function makePdf(f) {
    return draw().then(function (cv) {
      if (!cv) throw new Error('The certificate could not be drawn.');
      return toBlob(cv).then(function (blob) {
        if (!blob) throw new Error('The certificate image could not be made.');
        return blob.arrayBuffer().then(function (buf) {
          return new Blob([pdfFromJpeg(new Uint8Array(buf), cv.width, cv.height, 'DAA certificate ' + f.name + ' ' + f.number)], { type: 'application/pdf' });
        });
      });
    });
  }
  function doDownload(ref) {
    var P = findP(ref);
    if (!P) return;
    var f = genDefaults(P.e, P.pt);
    makePdf(f).then(function (pdf) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(pdf);
      a.download = pdfName(f);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }).catch(function (err) { A.flash[ref + '|DiveArts'] = { text: err.message, bad: true }; render(); });
  }
  /* The phone's share sheet with the PDF attached: Befa picks WhatsApp and the
     student's chat, and sends it herself. */
  /* The PDF is built as soon as the drawing settles, so the tap on Send opens
     the share sheet at once: iPhone Safari refuses a share that starts after a
     long wait. The ready PDF is tied to exactly what is on the form. */
  var PDF = { ref: '', sig: '', blob: null, seq: 0 };
  function pdfSig(f) { return JSON.stringify([f.name, f.course, f.date, f.city, f.number, !!f.padi]); }
  function preparePdf() {
    var P = findP(A.gen);
    if (!P) return;
    var f = genDefaults(P.e, P.pt), sig = pdfSig(f), ref = A.gen, seq = ++PDF.seq;
    if (PDF.ref === ref && PDF.sig === sig && PDF.blob) return;
    PDF.blob = null;
    makePdf(f).then(function (blob) {
      if (seq !== PDF.seq) return;
      PDF.ref = ref; PDF.sig = sig; PDF.blob = blob;
    }).catch(function () { /* draw() already shows why */ });
  }
  function doSharePdf(ref) {
    var P = findP(ref), key = ref + '|DiveArts';
    if (!P) return;
    var f = genDefaults(P.e, P.pt);
    if (!(PDF.ref === ref && PDF.sig === pdfSig(f) && PDF.blob)) {
      A.flash[key] = { text: 'The PDF is still being made. Tap Send PDF on WhatsApp again in a second.', bad: true };
      render(); preparePdf(); return;
    }
    var file = new File([PDF.blob], pdfName(f), { type: 'application/pdf' });
    var text = waText(P.e, P.pt, '', waLang(P.e, ref));
    if (!(navigator.canShare && navigator.canShare({ files: [file] }))) {
      A.flash[key] = { text: 'This browser cannot attach a file to WhatsApp. Download the PDF and attach it in WhatsApp, or save it to the portal and use the WhatsApp button with the link.', bad: true };
      render(); return;
    }
    navigator.share({ files: [file], text: text }).catch(function (err) {
      if (err && err.name === 'AbortError') return;   /* she closed the sheet */
      A.flash[key] = { text: 'Not shared: ' + (err && err.message || 'the phone refused'), bad: true }; render();
    });
  }
  function doSaveDaa(ref) {
    var P = findP(ref), e = P && P.e, p = e && pickFor(e), f = e && genDefaults(e, P.pt), key = ref + '|DiveArts';
    if (!p || A.busy) return;
    if (!String(f.number || '').trim()) { A.flash[key] = { text: 'Type the DAA certificate number first.', bad: true }; render(); return; }
    if (!String(f.name || '').trim()) { A.flash[key] = { text: 'The name on the certificate is empty.', bad: true }; render(); return; }
    busy(key);
    makePdf(f).then(toB64).then(function (b64) {
      return post({ action: 'cert_file', profile_id: p.profile_id, data_base64: b64 });
    }).then(function (up) {
      return post({ action: 'cert', step: 'issue', invoice_no: e.invoice_no, ref: ref, agency: 'DiveArts', profile_id: p.profile_id,
                    course_name: P.pt.key ? '' : e.course, level: String(f.course || '').trim() || levelOf(e, P.pt),
                    number: String(f.number).trim(), issued_on: f.date || witaToday(), file_url: up.file_url });
    }).then(function (j) {
      putCert(j.cert); A.busy = ''; A.gen = '';
      A.flash[key] = { text: 'Saved as PDF. The DAA certificate shows in ' + p.name + '\'s portal, number ' + j.cert.number + '. Use the WhatsApp button to send it.' };
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
    /* While a certificate is being saved, the drawing being saved is left alone. */
    if (/\|gen$/.test(key) && !A.busy) draw().then(function (cv) { if (cv) preparePdf(); });
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
    var a = b.getAttribute('data-a'), ref = b.getAttribute('data-ref'), ag = b.getAttribute('data-ag');
    if (a === 'refresh') { if (A.busy) return; A.notice = ''; A.flash = {}; load(); return; }
    if (A.busy) return;
    if (a === 'pick') { A.picks[ref] = { profile_id: b.getAttribute('data-pid'), name: b.getAttribute('data-name') || 'this student' }; delete A.forget[ref]; lsSet(LS_PICK, A.picks); render(); return; }
    if (a === 'unpick') { delete A.picks[ref]; A.forget[ref] = true; lsSet(LS_PICK, A.picks); render(); return; }
    if (a === 'search') { doSearch(ref); return; }
    if (a === 'submit' || a === 'unsubmit' || a === 'issue') { doCert(ref, ag, a); return; }
    if (a === 'edit') { var f = A.form[b.getAttribute('data-k')] || (A.form[b.getAttribute('data-k')] = {}); f.edit = true; render(); return; }
    if (a === 'noedit') { delete A.form[b.getAttribute('data-k')]; render(); return; }
    if (a === 'gen') { A.gen = A.gen === ref ? '' : ref; render(); return; }
    if (a === 'download') { doDownload(ref); return; }
    if (a === 'savedaa') { doSaveDaa(ref); return; }
    if (a === 'sharepdf') { doSharePdf(ref); return; }
    if (a === 'walang') { var wk = b.getAttribute('data-k'), wP = findP(wk), cur = wP ? waLang(wP.e, wk) : 'id'; (A.form[wk + '|wa'] = A.form[wk + '|wa'] || {}).lang = cur === 'en' ? 'id' : 'en'; render(); return; }
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
  window.__acadTest = { certTitle: certTitle, daaNumber: daaNumber, pickFor: pickFor, waText: waText, waDigits: waDigits, pdfFromJpeg: pdfFromJpeg, findP: findP, state: A };
})();
