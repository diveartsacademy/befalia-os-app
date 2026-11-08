/* dating-panel.js — the Dating profile in the Relationship tab, drawn instead of listed (8 Nov 2026).
   ---------------------------------------------------------------------------
   Befa: "I really don't like how it just looks like all text. Make it like
   About Me, with logos ... it needs to fill the whole page in website view."

   Everything comes from the Notion page "Dating Profile Answers" (under Love
   Life), read live, so editing the page in Notion changes this section.
   The page is written as:
     ## Section            a heading per part
     Label: answer         a short answer on one line
     Label                 a title line, then the answer on the next line
     - Label: answer       a bullet with an answer (applications, yes/no)
     - [ ] thing           a to-do
     1. thing              a numbered line
   Any photo added to the page in Notion shows (the first one in the hero).
   Every answer has a Copy button, for pasting into the next form.
   Private mode blurs it like the other Relationship cards.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';
  var ROOT = 'dp-root';
  var PAGE = '412eb411ed7a81aaba7bf068bd96ce91';
  var S = { text: '', err: '', loading: false, loaded: false };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function content(text) { var m = String(text || '').match(/<content>([\s\S]*?)<\/content>/); return m ? m[1] : String(text || ''); }
  // The phone bridge sends plain text; the desktop connector sends <b>bold</b>, **bold**, [text](url) and \escapes.
  function clean(s) {
    return String(s || '')
      .replace(/\[([^\]]*)\]\((?:https?:|mailto:)[^)\s]*\)/g, '$1')
      .replace(/<\/?(?:b|strong|i|em|u)>/gi, '')
      .replace(/\*\*/g, '')
      .replace(/\\([~*_"'\[\]()#.!-])/g, '$1')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
      .trim();
  }

  /* ---------- parser (pure; exposed for tests) ---------- */
  var FACT = /^([^:]{2,40}):\s+(.+)$/;
  function isFact(l) { var m = l.match(FACT); return !!(m && m[1].split(/\s+/).length <= 7 && !/[.!?]$/.test(m[1])); }
  function isTitle(l, next) { return l.length <= 60 && !/[.!?:,]$/.test(l) && !isFact(l) && !/^[-*]\s|^\d+\.\s|^##\s/.test(l) && !!next && !/^##\s/.test(next); }

  function parse(text) {
    var raw = content(text).split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var out = { intro: '', sections: [], images: [] };
    var cur = { title: '', items: [] }, pending = '';
    function push() { if (cur.title || cur.items.length) out.sections.push(cur); }
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      if (/^#\s/.test(r)) continue;
      var img = r.match(/^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/);
      if (img) { out.images.push({ src: img[2], cap: clean(img[1]), section: cur.title }); continue; }
      var l = clean(r);
      if (!l) continue;
      if (/^##\s/.test(l)) { push(); cur = { title: l.replace(/^##\s+/, ''), items: [] }; pending = ''; continue; }
      if (pending) { cur.items.push({ type: 'block', label: pending, text: l }); pending = ''; continue; }
      var td = l.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
      if (td) { cur.items.push({ type: 'todo', done: td[1] !== ' ', text: td[2] }); continue; }
      var bl = l.match(/^[-*•]\s+(.*)$/);
      if (bl) {
        var bm = bl[1].match(/^([^:]{2,70}):\s+(.+)$/);
        cur.items.push(bm ? { type: 'fact', label: bm[1].trim(), value: bm[2].trim(), bullet: true } : { type: 'bullet', text: bl[1] });
        continue;
      }
      var nm = l.match(/^(\d+)\.\s+(.*)$/);
      if (nm) { cur.items.push({ type: 'num', n: +nm[1], text: nm[2] }); continue; }
      if (isFact(l)) { var fm = l.match(FACT); cur.items.push({ type: 'fact', label: fm[1].trim(), value: fm[2].trim() }); continue; }
      var next = raw[i + 1] ? clean(raw[i + 1]) : '';
      if (isTitle(l, next)) { pending = l; continue; }
      if (!out.sections.length && !cur.title && !out.intro) { out.intro = l; continue; }
      cur.items.push({ type: 'p', text: l });
    }
    if (pending) cur.items.push({ type: 'block', label: pending, text: '' });
    push();
    return out;
  }

  function find(p, re) { for (var i = 0; i < p.sections.length; i++) if (re.test(p.sections[i].title)) return p.sections[i]; return null; }
  function status(v) {
    if (/submitted|applied|sent/i.test(v)) return { k: 'done', t: 'Submitted' };
    if (/active|live|matched/i.test(v)) return { k: 'live', t: 'Active' };
    if (/started|progress|draft|page \d/i.test(v)) return { k: 'wip', t: 'In progress' };
    return { k: 'info', t: '' };
  }
  function yesNo(v) { return /^yes\b/i.test(v) ? 'yes' : /^no\b/i.test(v) ? 'no' : 'info'; }
  // "Personality: a, b, and c. Physical: d." -> chips a, b, c and the physical note.
  function dealBreakers(text) {
    var m = String(text || '').match(/personality:\s*(.+?)(?:\.\s*physical:\s*(.+?))?\.?$/i);
    if (!m) return { chips: [], physical: '', rest: text };
    var chips = m[1].split(/,\s*(?:and\s+)?|\s+and\s+(?=lack|not|no\b)/i).map(function (s) { return s.replace(/^and\s+/i, '').trim(); }).filter(Boolean);
    return { chips: chips, physical: (m[2] || '').trim(), rest: '' };
  }
  var ICONS = [
    [/name/i, '👤'], [/\bage\b|birth/i, '🎂'], [/based|city|live/i, '📍'], [/height/i, '📏'], [/phone|whatsapp/i, '📱'],
    [/e-?mail/i, '✉️'], [/instagram/i, '📸'], [/linkedin/i, '🔗'], [/language/i, '🗣️'],
    [/profession|work|job|career/i, '💼'], [/education|school|study/i, '🎓'], [/background|grew|family/i, '🌱'],
    [/weekend|rhythm|day/i, '🌅'], [/hobb|interest/i, '🤿'], [/12 months|excite|future/i, '✨'],
    [/read|watch|listen|media/i, '🎬'], [/drink|smoke|drug/i, '🍃'], [/religio|faith/i, '🕊️'], [/politic/i, '⚖️'],
    [/physical|look|attract/i, '💪'], [/personality/i, '💛'], [/\bdeal/i, '🚫'], [/ethnic|race/i, '🌍'],
    [/location|relocat|distance/i, '✈️'], [/else|other/i, '🌊'], [/kid|child/i, '👶'], [/date/i, '🥂'], [/range/i, '🎯']
  ];
  function icon(label) { for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(label)) return ICONS[i][1]; return '💬'; }

  /* ---------- styles ---------- */
  function css() {
    if (document.getElementById('dp-css')) return;
    var s = document.createElement('style');
    s.id = 'dp-css';
    s.textContent = [
      '#dp-root{--dp-gold:#f2c97d;--dp-coral:#ff8fa3;--dp-sea:#7fe3c6;margin-top:14px;}',
      '#dp-root .dp-card{position:relative;border-radius:26px;background:linear-gradient(165deg,rgba(13,46,68,.62),rgba(4,18,29,.78));border:1px solid rgba(46,230,255,.13);box-shadow:var(--shadow);padding:20px;margin:0 0 16px;overflow:hidden;}',
      '#dp-root h3{font-family:var(--serif);font-weight:600;font-size:21px;color:var(--aquasoft);margin:0;display:flex;align-items:center;gap:10px;}',
      '#dp-root h3 .hi{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;font-size:18px;background:rgba(242,201,125,.1);border:1px solid rgba(242,201,125,.28);}',
      '#dp-root .dp-sub{font-size:13px;color:var(--muted);margin:4px 0 0;line-height:1.45;}',
      '#dp-root .dp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;}',
      '#dp-root .dp-head a{font-size:12.5px;color:var(--aquasoft);white-space:nowrap;}',
      /* hero */
      '#dp-root .hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:20px;padding:0;background:#06192a;}',
      '@media(max-width:860px){#dp-root .hero{grid-template-columns:1fr;}}',
      '#dp-root .hero .art{position:absolute;inset:0;background:radial-gradient(70% 90% at 92% 10%,rgba(255,143,163,.20),transparent 60%),radial-gradient(80% 90% at 0% 100%,rgba(46,230,255,.16),transparent 60%),linear-gradient(160deg,#0c3954,#04121d 75%);}',
      '#dp-root .hero .who{position:relative;padding:26px 24px 22px;display:flex;gap:18px;align-items:center;}',
      '@media(max-width:560px){#dp-root .hero .who{flex-direction:column;align-items:flex-start;}}',
      '#dp-root .portrait{flex:none;width:118px;height:118px;border-radius:50%;object-fit:cover;border:3px solid rgba(242,201,125,.8);box-shadow:0 0 0 6px rgba(242,201,125,.12),0 14px 34px rgba(0,0,0,.5);background:#0c2a3d;display:grid;place-items:center;font:600 50px var(--serif);color:var(--dp-gold);}',
      '#dp-root .kicker{font:700 11px var(--sans);letter-spacing:3px;color:var(--dp-coral);text-transform:uppercase;}',
      '#dp-root .name{font-family:var(--serif);font-size:clamp(28px,4.6vw,42px);line-height:1.04;color:#fff;font-weight:600;margin:4px 0 6px;}',
      '#dp-root .intro{font-size:14px;color:var(--muted);line-height:1.5;margin:0 0 12px;max-width:52ch;}',
      '#dp-root .pills{display:flex;flex-wrap:wrap;gap:7px;}',
      '#dp-root .pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 12px;background:rgba(3,14,24,.6);border:1px solid rgba(46,230,255,.18);font-size:12.5px;color:var(--ink);}',
      '#dp-root .apps{position:relative;padding:22px 22px 22px 0;display:grid;gap:10px;align-content:center;}',
      '@media(max-width:860px){#dp-root .apps{padding:0 20px 22px;}}',
      '#dp-root .apps .lbl{font:700 11px var(--sans);letter-spacing:2px;color:var(--aquasoft);text-transform:uppercase;}',
      '#dp-root .app{display:flex;align-items:center;gap:12px;border-radius:16px;padding:11px 14px;background:rgba(3,14,24,.6);border:1px solid rgba(46,230,255,.12);}',
      '#dp-root .app .ai{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:16px;flex:none;}',
      '#dp-root .app.done .ai{background:rgba(127,227,198,.16);color:var(--dp-sea);}',
      '#dp-root .app.wip .ai{background:rgba(242,201,125,.16);color:var(--dp-gold);}',
      '#dp-root .app.live .ai,#dp-root .app.info .ai{background:rgba(46,230,255,.14);color:var(--aquasoft);}',
      '#dp-root .app .t{font-weight:650;font-size:14px;color:var(--ink);line-height:1.25;}',
      '#dp-root .app .s{font-size:12px;color:var(--muted);margin-top:2px;}',
      '#dp-root .tag{margin-left:auto;font:700 10.5px var(--sans);letter-spacing:1px;text-transform:uppercase;border-radius:999px;padding:4px 9px;white-space:nowrap;}',
      '#dp-root .app.done .tag{background:rgba(127,227,198,.16);color:var(--dp-sea);}',
      '#dp-root .app.wip .tag{background:rgba(242,201,125,.16);color:var(--dp-gold);}',
      '#dp-root .app.live .tag{background:rgba(46,230,255,.16);color:var(--aquasoft);}',
      /* yes/no and stats */
      '#dp-root .yn{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;}',
      '#dp-root .q{display:flex;gap:12px;align-items:center;border-radius:18px;padding:12px 14px;background:rgba(4,18,29,.55);border:1px solid rgba(46,230,255,.10);}',
      '#dp-root .q .m{width:36px;height:36px;border-radius:50%;flex:none;display:grid;place-items:center;font:800 17px var(--sans);}',
      '#dp-root .q.yes .m{background:rgba(127,227,198,.16);color:var(--dp-sea);border:1px solid rgba(127,227,198,.4);}',
      '#dp-root .q.no .m{background:rgba(255,143,163,.14);color:var(--dp-coral);border:1px solid rgba(255,143,163,.4);}',
      '#dp-root .q.info .m{background:rgba(242,201,125,.12);color:var(--dp-gold);border:1px solid rgba(242,201,125,.35);font-size:16px;}',
      '#dp-root .q .k{font-size:12px;color:var(--muted);line-height:1.3;}',
      '#dp-root .q .v{font-size:14.5px;font-weight:650;color:var(--ink);line-height:1.3;margin-top:2px;}',
      '#dp-root .stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:12px;}',
      '#dp-root .stat{border-radius:18px;padding:14px 16px;background:rgba(242,201,125,.07);border:1px solid rgba(242,201,125,.24);display:flex;gap:12px;align-items:center;}',
      '#dp-root .stat .e{font-size:26px;}',
      '#dp-root .stat .n{font-family:var(--serif);font-size:24px;line-height:1.05;color:#fff;}',
      '#dp-root .stat .l{font-size:12px;color:var(--muted);margin-top:3px;}',
      /* answer cards */
      '#dp-root .cards{column-width:320px;column-gap:12px;}',
      '#dp-root .cards>.ans{break-inside:avoid;-webkit-column-break-inside:avoid;margin:0 0 12px;}',
      '#dp-root .dealbox{margin:0 0 12px;}',
      '#dp-root .ans{border-radius:18px;padding:14px 16px 12px;background:rgba(4,18,29,.55);border:1px solid rgba(46,230,255,.10);display:flex;flex-direction:column;gap:8px;}',
      '#dp-root .ans .top{display:flex;align-items:center;gap:10px;}',
      '#dp-root .ans .e{width:36px;height:36px;border-radius:12px;flex:none;display:grid;place-items:center;font-size:19px;background:rgba(46,230,255,.08);border:1px solid rgba(46,230,255,.18);}',
      '#dp-root .ans .h{font-weight:650;font-size:14.5px;color:var(--ink);line-height:1.25;}',
      '#dp-root .ans p{margin:0;font-size:13.5px;line-height:1.55;color:#cfe7f3;}',

      '#dp-root .copy{align-self:flex-end;border:1px solid var(--aqualine);background:transparent;color:var(--aquasoft);border-radius:999px;padding:4px 11px;font:600 11.5px var(--sans);cursor:pointer;}',
      '#dp-root .copy.ok{background:rgba(127,227,198,.16);color:var(--dp-sea);border-color:rgba(127,227,198,.4);}',
      '#dp-root .chips{display:flex;flex-wrap:wrap;gap:7px;}',
      '#dp-root .no-chip{border-radius:999px;padding:6px 12px;font-size:12.5px;color:#ffd5dd;background:rgba(255,143,163,.10);border:1px solid rgba(255,143,163,.32);}',
      '#dp-root .note{font-size:12.5px;color:var(--muted);}',
      /* contact rows */
      '#dp-root .rows{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;}',
      '#dp-root .row{display:flex;align-items:center;gap:10px;border-radius:14px;padding:9px 12px;background:rgba(4,18,29,.45);}',
      '#dp-root .row .e{font-size:18px;width:26px;text-align:center;}',
      '#dp-root .row .k{font-size:11.5px;color:var(--muted);}',
      '#dp-root .row .v{font-size:13.5px;color:var(--ink);word-break:break-word;}',
      '#dp-root .row .copy{margin:0 0 0 auto;}',
      /* photos + prep */
      '#dp-root .two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;}',
      '@media(max-width:860px){#dp-root .two{grid-template-columns:1fr;}}',
      '#dp-root .two .dp-card{margin:0;}',
      '#dp-root .photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;}',
      '#dp-root .ph{border-radius:16px;overflow:hidden;position:relative;aspect-ratio:3/4;background:linear-gradient(160deg,#145a7a,#0a2436);border:1px solid rgba(242,201,125,.25);display:flex;flex-direction:column;justify-content:flex-end;padding:12px;}',
      '#dp-root .ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}',
      '#dp-root .ph::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgba(3,12,20,.88));}',
      '#dp-root .ph>span{position:relative;z-index:1;font-size:12.5px;color:#fff;line-height:1.35;}',
      '#dp-root .ph .n{position:absolute;top:10px;left:10px;z-index:1;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--dp-gold);color:#2a1c05;font:800 13px var(--sans);}',
      '#dp-root .ph .cam{position:absolute;top:38%;left:0;right:0;text-align:center;font-size:30px;z-index:1;opacity:.8;}',
      '#dp-root .todo{display:flex;gap:11px;align-items:flex-start;padding:10px 0;border-top:1px solid rgba(46,230,255,.08);font-size:13.5px;line-height:1.45;color:var(--ink);}',
      '#dp-root .todo:first-of-type{border-top:none;}',
      '#dp-root .todo .b{width:20px;height:20px;border-radius:6px;flex:none;margin-top:1px;border:1.5px solid var(--aqualine);display:grid;place-items:center;font-size:12px;color:var(--dp-sea);}',
      '#dp-root .todo.done{color:var(--muted);text-decoration:line-through;}',
      '#dp-root .err{color:#ff9db0;font-size:13px;}',
      '#dp-root .retry{margin-top:10px;}',
      '#dp-root .copy:focus-visible,#dp-root a:focus-visible{outline:2px solid var(--aqua);outline-offset:2px;}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------- drawing ---------- */
  var COPY = [];
  function copyBtn(text) { if (!text) return ''; COPY.push(String(text)); return '<button class="copy" type="button" data-copy="' + (COPY.length - 1) + '">Copy</button>'; }
  function notionLink() { return '<a href="https://app.notion.com/p/' + PAGE + '" target="_blank" rel="noopener">Edit in Notion</a>'; }
  function head(ic, title, sub, link) {
    return '<div class="dp-head"><div><h3><span class="hi">' + ic + '</span>' + esc(title) + '</h3>' + (sub ? '<p class="dp-sub">' + esc(sub) + '</p>' : '') + '</div>' + (link ? notionLink() : '') + '</div>';
  }
  function factsOf(sec) { return sec ? sec.items.filter(function (x) { return x.type === 'fact'; }) : []; }
  function factMap(sec) { var m = {}; factsOf(sec).forEach(function (f) { m[f.label.toLowerCase()] = f.value; }); return m; }
  function pick(map, re) { for (var k in map) if (re.test(k)) return map[k]; return ''; }

  function heroHTML(p) {
    var qf = factMap(find(p, /quick field|basics|contact/i));
    var apps = factsOf(find(p, /application/i));
    var name = pick(qf, /^name/) || 'My dating profile';
    var short = name.replace(/\s*\(([^)]+)\)\s*$/, '');
    var nick = (name.match(/\(([^)]+)\)/) || [])[1] || '';
    var initial = (nick || short).charAt(0).toUpperCase() || 'B';
    var age = (pick(qf, /^age/).match(/^\s*(\d{2})\b/) || [])[1] || '';
    var based = pick(qf, /^based|^city|^location/).replace(/\s*\(.*\)\s*$/, '');
    var pills = [];
    if (based) pills.push(['📍', based]);
    if (age) pills.push(['🎂', age]);
    var h = pick(qf, /^height/); if (h) pills.push(['📏', h.replace(/\s*\(.*\)/, '')]);
    var lang = pick(qf, /^language/); if (lang) pills.push(['🗣️', lang]);
    var photo = p.images[0];
    var face = photo ? '<img class="portrait" src="' + esc(photo.src) + '" alt="' + esc(photo.cap || short) + '">' : '<div class="portrait" aria-hidden="true">' + esc(initial) + '</div>';
    var appsHTML = apps.length ? '<div class="apps"><div class="lbl">Where I have applied</div>' + apps.map(function (a) {
      var st = status(a.value);
      var mark = st.k === 'done' ? '✓' : st.k === 'wip' ? '…' : '♥';
      return '<div class="app ' + st.k + '"><div class="ai">' + mark + '</div><div><div class="t">' + esc(a.label) + '</div><div class="s">' + esc(a.value) + '</div></div>' + (st.t ? '<span class="tag">' + st.t + '</span>' : '') + '</div>';
    }).join('') + '</div>' : '';
    return '<section class="dp-card hero sensitive"><div class="art"></div><div class="who">' + face + '<div><div class="kicker">💌 Dating profile</div><h2 class="name">' + esc(short) + (nick ? ' <span style="color:var(--dp-gold);font-size:.6em">' + esc(nick) + '</span>' : '') + '</h2>'
      + (p.intro ? '<p class="intro">' + esc(p.intro) + '</p>' : '')
      + '<div class="pills">' + pills.map(function (x) { return '<span class="pill">' + x[0] + ' ' + esc(x[1]) + '</span>'; }).join('') + '</div></div></div>' + appsHTML + '</section>';
  }

  function quickHTML(p) {
    var sec = find(p, /quick answer|at a glance|yes|basics/i);
    var fs = factsOf(sec);
    if (!fs.length) return '';
    return '<section class="dp-card sensitive">' + head('⚡', 'At a glance', 'The quick-choice questions most forms ask.', true)
      + '<div class="yn">' + fs.map(function (f) {
        var k = yesNo(f.value), m = k === 'yes' ? '✓' : k === 'no' ? '✕' : icon(f.label);
        return '<div class="q ' + k + '"><div class="m">' + m + '</div><div><div class="k">' + esc(f.label) + '</div><div class="v">' + esc(f.value) + '</div></div></div>';
      }).join('') + '</div></section>';
  }

  function cardHTML(item) {
    var label = item.label, text = item.text || item.value || '';
    if (/deal/i.test(label)) {
      var d = dealBreakers(text);
      if (d.chips.length) {
        return '<div class="ans dealbox"><div class="top"><div class="e">🚫</div><div class="h">' + esc(label) + '</div></div><div class="chips">' + d.chips.map(function (c) { return '<span class="no-chip">' + esc(c) + '</span>'; }).join('') + '</div>'
          + (d.physical ? '<div class="note">Physical: ' + esc(d.physical) + '</div>' : '') + copyBtn(text) + '</div>';
      }
    }
    return '<div class="ans"><div class="top"><div class="e">' + icon(label) + '</div><div class="h">' + esc(label) + '</div></div>' + (text ? '<p>' + esc(text) + '</p>' : '') + copyBtn(text) + '</div>';
  }

  function lookingHTML(p) {
    var sec = find(p, /looking for|partner|want/i);
    if (!sec) return '';
    var stats = sec.items.filter(function (x) { return x.type === 'fact' && /range|age|height/i.test(x.label) && x.value.length < 40; });
    var rest = sec.items.filter(function (x) { return stats.indexOf(x) === -1 && (x.type === 'block' || x.type === 'fact' || x.type === 'p'); });
    var deal = rest.filter(function (x) { return /\bdeal/i.test(x.label || ''); });
    rest = rest.filter(function (x) { return deal.indexOf(x) === -1; });
    return '<section class="dp-card sensitive">' + head('💞', 'What I\'m looking for', 'Who I want to meet, and what is a no.', true)
      + (stats.length ? '<div class="stats">' + stats.map(function (s) { return '<div class="stat"><div class="e">' + icon(s.label) + '</div><div><div class="n">' + esc(s.value) + '</div><div class="l">' + esc(s.label) + '</div></div></div>'; }).join('') + '</div>' : '')
      + deal.map(function (x) { return cardHTML(x); }).join('')
      + '<div class="cards">' + rest.map(function (x) { return x.type === 'p' ? cardHTML({ label: 'Note', text: x.text }) : cardHTML(x); }).join('') + '</div></section>';
  }

  function aboutHTML(p) {
    var sec = find(p, /about me/i);
    if (!sec) return '';
    var items = sec.items.filter(function (x) { return x.type === 'block' || x.type === 'fact' || x.type === 'p'; });
    return '<section class="dp-card sensitive">' + head('🌊', 'About me', 'My answers, ready to copy into the next form.', true)
      + '<div class="cards">' + items.map(function (x) { return x.type === 'p' ? cardHTML({ label: 'More', text: x.text }) : cardHTML(x); }).join('') + '</div></section>';
  }

  function contactHTML(p) {
    var fs = factsOf(find(p, /quick field|basics|contact/i));
    if (!fs.length) return '';
    return '<section class="dp-card sensitive">' + head('🪪', 'Form basics', 'Name, contacts and the short fields.', true)
      + '<div class="rows">' + fs.map(function (f) { return '<div class="row"><div class="e">' + icon(f.label) + '</div><div><div class="k">' + esc(f.label) + '</div><div class="v">' + esc(f.value) + '</div></div>' + copyBtn(f.value) + '</div>'; }).join('') + '</div></section>';
  }

  function photosHTML(p) {
    var sec = find(p, /photo/i);
    if (!sec) return '';
    var pics = p.images.filter(function (im) { return /photo/i.test(im.section); });
    var list = sec.items.filter(function (x) { return x.type === 'num' || x.type === 'bullet'; });
    var notes = sec.items.filter(function (x) { return x.type === 'p'; });
    var tiles = pics.length ? pics.map(function (im, i) { return '<div class="ph"><img src="' + esc(im.src) + '" alt="' + esc(im.cap || 'Photo') + '" loading="lazy"><div class="n">' + (i + 1) + '</div>' + (im.cap ? '<span>' + esc(im.cap) + '</span>' : '') + '</div>'; }).join('')
      : list.map(function (x, i) { return '<div class="ph"><div class="n">' + (x.n || i + 1) + '</div><div class="cam">📸</div><span>' + esc(x.text) + '</span></div>'; }).join('');
    return '<section class="dp-card sensitive">' + head('📸', sec.title, notes.map(function (n) { return n.text; }).join(' '), false)
      + '<div class="photos">' + tiles + '</div></section>';
  }

  function prepHTML(p) {
    var sec = find(p, /interview|prep|think/i);
    if (!sec) return '';
    var todos = sec.items.filter(function (x) { return x.type === 'todo' || x.type === 'bullet'; });
    var open = todos.filter(function (t) { return !t.done; }).length;
    return '<section class="dp-card sensitive">' + head('🧭', 'Interview prep', open + ' of ' + todos.length + ' still to think through. Tick them in Notion.', true)
      + todos.map(function (t) { return '<div class="todo' + (t.done ? ' done' : '') + '"><span class="b">' + (t.done ? '✓' : '') + '</span><span>' + esc(t.text) + '</span></div>'; }).join('') + '</section>';
  }

  function otherHTML(p) {
    var known = /application|quick field|basics|contact|quick answer|at a glance|looking for|partner|want|about me|photo|interview|prep|think/i;
    return p.sections.filter(function (s) { return s.title && !known.test(s.title); }).map(function (s) {
      return '<section class="dp-card sensitive">' + head(icon(s.title), s.title, '', true) + '<div class="cards">' + s.items.map(function (x) {
        if (x.type === 'block' || x.type === 'fact') return cardHTML(x);
        return cardHTML({ label: '', text: x.text });
      }).join('') + '</div></section>';
    }).join('');
  }

  function html(p) {
    COPY = [];
    return heroHTML(p) + quickHTML(p) + lookingHTML(p) + aboutHTML(p) + contactHTML(p)
      + '<div class="two">' + photosHTML(p) + prepHTML(p) + '</div>' + otherHTML(p);
  }

  function render() {
    var root = document.getElementById(ROOT);
    if (!root) return;
    css();
    if (S.err) { root.innerHTML = '<section class="dp-card">' + head('💌', 'Dating profile', '', true) + '<p class="err">Could not load your Dating Profile Answers from Notion right now.</p><button class="copy retry" type="button" data-retry>Try again</button></section>'; return; }
    if (!S.loaded) { root.innerHTML = '<section class="dp-card" style="min-height:220px" aria-label="Loading your dating profile"><p class="dp-sub">Loading your dating profile from Notion…</p></section>'; return; }
    var p = parse(S.text);
    if (!p.sections.length) { root.innerHTML = '<section class="dp-card">' + head('💌', 'Dating profile', 'The Notion page is empty. Add your answers there and they show here.', true) + '</section>'; return; }
    root.innerHTML = html(p);
  }

  function copyText(t, btn) {
    var done = function () { btn.textContent = 'Copied ✓'; btn.classList.add('ok'); setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('ok'); }, 1600); };
    var fallback = function () { try { var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); document.body.removeChild(ta); if (ok) done(); else btn.textContent = 'Copy failed'; } catch (e) { btn.textContent = 'Copy failed'; } };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(done, fallback); return; } } catch (e) { }
    fallback();
  }

  function load() {
    if (S.loading || typeof fetchNotion !== 'function') return;
    S.loading = true; S.err = '';
    fetchNotion(PAGE).then(function (d) { S.text = (d && d.text) || ''; S.loaded = true; }, function (e) { S.err = (e && e.message) || 'error'; })
      .then(function () { S.loading = false; render(); });
  }

  document.addEventListener('click', function (e) {
    var root = document.getElementById(ROOT);
    if (!root || !root.contains(e.target)) return;
    var c = e.target.closest('[data-copy]');
    if (c) { var sec = c.closest('.sensitive'); if (document.body.classList.contains('private') && sec && !sec.classList.contains('revealed')) return; copyText(COPY[+c.getAttribute('data-copy')] || '', c); return; }
    if (e.target.closest('[data-retry]')) { S.err = ''; render(); load(); }
  });

  window.__dpParse = { parse: parse, dealBreakers: dealBreakers, status: status, yesNo: yesNo, icon: icon, html: function (text) { return html(parse(text)); } };
  window.dpOpen = function () { render(); if (!S.loaded) load(); };
})();
