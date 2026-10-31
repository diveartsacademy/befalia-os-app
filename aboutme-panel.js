/* aboutme-panel.js — the About Me tab, drawn instead of listed (19 Oct 2026).
   ---------------------------------------------------------------------------
   Befa: "I don't want it to look like notes ... especially About Me and
   Finance. Images and elements, so I don't have to read carefully."

   Everything still comes from her Notion pages, read live, so editing a page
   in Notion changes this tab. Each page is drawn for what it is:
     Impact by Numbers   the big numbers across the hero
     Medals & Trophies   a trophy cabinet by year, mermaid and dance apart,
                         a medal per line (gold for a win, silver for runner-up,
                         a ribbon for finals and top places, a flag for
                         representing Indonesia, a star for special awards)
     Film, TV & Stage    posters for the films and shows, then the stage work
     My Personality      type chips, the through-line, trait cards, strengths
                         and blind spots, and the three tarot cards
                         Birth Chart (1 Nov 2026): a drawn chart wheel, the
                         big three, element balance, every placement with
                         its reading, and the key aspects
     Kind Words          quote cards
     Gallery             her photos: any photo she adds to the Notion page
   A photo added to any of these pages in Notion shows. The hero uses the
   first photo in Gallery, or /img/aboutme/portrait.jpg, or her initial.
   Private mode blurs the personality and kind words like other cards.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';
  var ROOT = 'me-root';
  var PAGES = {
    impact: '3a2eb411ed7a8158b681de12fb6587b0',
    medals: '3a2eb411ed7a8151ac94c380e41244e1',
    film: '3a2eb411ed7a81368908e4f0d95e8b46',
    kind: '3a2eb411ed7a81bdbfc6c9acd41588c3',
    gallery: '3a2eb411ed7a81aba6caf53124b39333',
    personality: '3a2eb411ed7a81d694b7d9b1dbaa32f6'
  };
  var IMG = { hero: '/img/aboutme/hero.jpg', portrait: '/img/aboutme/portrait.jpg', film: '/img/aboutme/film.jpg' };
  var S = { md: {}, err: {}, loading: false, loaded: false, medalTab: 'all' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function notionUrl(id) { return 'https://app.notion.com/p/' + id; }
  function content(text) { var m = String(text || '').match(/<content>([\s\S]*?)<\/content>/); return (m ? m[1] : String(text || '')).replace(/\\([~*_])/g, '$1'); }
  function lines(md) { return String(md || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }
  function clean(s) { return String(s || '').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1').replace(/\*([^*]+)\*/g, '$1').trim(); }

  /* ---------- parsers (pure; exposed for tests) ---------- */
  function images(md) {
    var out = [];
    lines(md).forEach(function (l) { var m = l.match(/^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/); if (m) out.push({ src: m[2], cap: m[1] }); });
    return out;
  }
  function sections(md) {
    var out = [], cur = { title: '', lines: [] };
    lines(md).forEach(function (l) {
      if (/^#\s/.test(l)) { return; }
      if (/^##\s/.test(l)) { if (cur.title || cur.lines.length) out.push(cur); cur = { title: l.replace(/^##\s+/, ''), lines: [] }; return; }
      cur.lines.push(l);
    });
    if (cur.title || cur.lines.length) out.push(cur);
    return out;
  }
  function bullets(ls) { return ls.filter(function (l) { return /^[-•]\s/.test(l); }).map(function (l) { return clean(l.replace(/^[-•]\s+/, '')); }).filter(Boolean); }

  function parseImpact(md, year) {
    year = year || new Date().getFullYear();
    return lines(md).map(function (l) {
      var m = l.match(/^([^:]{2,60}):\s*(.+)$/);
      if (!m || /^https?/i.test(m[2])) return null;
      var label = clean(m[1]), val = clean(m[2]).replace(/\\([~*_])/g, '$1'), big = '', sub = label;
      var since = val.match(/^~?\s*((?:19|20)\d{2})\b/);
      if (/since/i.test(label) && since) {
        // "Dancing since: 2009 (~16 years)" reads as 16 years, since 2009.
        var paren = val.match(/\(\s*~?\s*(\d+)\s*years?\s*\)/i);
        big = String(paren ? +paren[1] : year - +since[1]) + ' yrs';
        sub = label.replace(/\s*since$/i, '') + ', since ' + since[1];
      } else {
        var n = val.match(/^~?\s*(\d+\+?)\s*(years?)?/i);
        if (n) { big = n[1] + (n[2] ? ' yrs' : ''); var rest = val.slice(n[0].length).replace(/^\s*[-–—:,]?\s*/, '').replace(/^\((.*)\)$/, '$1'); if (rest) sub = label + ': ' + rest; }
        else big = val;
      }
      return { label: label, big: big, sub: sub, raw: val };
    }).filter(Boolean);
  }

  // The medal follows the title first ("Sea Queen of Indonesia · ... · Runner-up ..."
  // is the crown, not the runner-up), then the rest of the line.
  function medalKind(title, rest) {
    return medalOf(title) || medalOf(rest || '') || 'star';
  }
  function medalOf(t) {
    if (/\b(1st|first)\b|winner|\bjuara\b/i.test(t) && !/runner/i.test(t)) return 'gold';
    if (/runner-?up|2nd|second/i.test(t)) return 'silver';
    if (/representative/i.test(t)) return 'flag';
    if (/best|favou?rite|most|queen/i.test(t)) return 'star';
    if (/top\s*\d+|finalist|3rd|third/i.test(t)) return 'ribbon';
    return '';
  }
  function parseMedals(md) {
    var out = [];
    sections(md).forEach(function (sec) {
      var group = /dance/i.test(sec.title) ? 'dance' : 'mermaid';
      bullets(sec.lines).forEach(function (b) {
        var m = b.match(/^(\d{4}(?:\s*[–-]\s*\d{4})?)\s*[—–-]\s*(.+)$/);
        var year = m ? m[1].replace(/\s/g, '') : '', text = m ? m[2] : b;
        var where = '';
        var pm = text.match(/\(([^)]+)\)\s*$/);
        if (pm) { where = pm[1]; text = text.slice(0, pm.index).trim(); }
        var partsDot = text.split(/\s+·\s+/);
        out.push({ group: group, section: sec.title, year: year, title: partsDot[0], extra: partsDot.slice(1), where: where, kind: medalKind(partsDot[0], partsDot.slice(1).join(' ')) });
      });
    });
    return out;
  }

  function parseFilm(md) {
    var films = [], stage = [];
    sections(md).forEach(function (sec) {
      bullets(sec.lines).forEach(function (b) {
        var m = b.match(/^["“]([^"”]+)["”]\s*[—–-]\s*(.+)$/);
        if (m && /film|tv/i.test(sec.title)) {
          var meta = m[2], role = '', year = '';
          var pm = meta.match(/\(([^)]*)\)\s*$/);
          if (pm) { var inner = pm[1].split(','); year = (inner[inner.length - 1].match(/\d{4}/) || [''])[0]; role = inner.slice(0, year ? -1 : undefined).join(',').trim(); meta = meta.slice(0, pm.index).trim(); }
          films.push({ title: m[1], kind: meta, role: role, year: year, netflix: /netflix/i.test(b) });
        } else stage.push({ section: sec.title, text: b });
      });
    });
    return { films: films, stage: stage };
  }

  function parsePersonality(md) {
    var secs = sections(md), out = { types: [], through: '', core: [], profile: [], tarot: [], disagree: [], who: [] };
    var all = lines(md);
    var mb = (all.join(' ').match(/MBTI\s+([EI][NS][TF][JP])/) || [])[1];
    var blood = (all.join(' ').match(/Blood type\s+(AB|A|B|O)\b/i) || [])[1];
    var sun = (all.join(' ').match(/Sun in\s+([A-Z][a-z]+)/) || [])[1];
    var zod = (all.join(' ').match(/Chinese zodiac:\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/) || [])[1];
    if (mb) out.types.push({ k: mb, v: 'MBTI' });
    var moon = (all.join(' ').match(/Moon in\s+([A-Z][a-z]+)/) || [])[1];
    var rise = (all.join(' ').match(/\b([A-Z][a-z]+) rising\b/) || [])[1];
    if (sun) out.types.push({ k: sun, v: 'Sun sign' });
    if (moon) out.types.push({ k: moon, v: 'Moon sign' });
    if (rise) out.types.push({ k: rise, v: 'Rising sign' });
    if (zod) out.types.push({ k: zod, v: 'Chinese zodiac' });
    if (blood) out.types.push({ k: 'Type ' + blood.toUpperCase(), v: 'Blood type' });
    secs.forEach(function (sec) {
      var t = sec.title.toLowerCase();
      if (/core synthesis/.test(t)) {
        sec.lines.forEach(function (l) { var m = l.match(/^The through-line:\s*(.+)$/i); if (m) out.through = clean(m[1]); });
        out.core = bullets(sec.lines).map(function (b) { var p = b.split(/\s+[—–]\s+/); return { trait: p[0], from: p.slice(1).join(' — ') }; });
      } else if (/practical profile/.test(t)) {
        sec.lines.forEach(function (l) { var m = clean(l).match(/^([A-Z][A-Za-z ]{3,30}):\s*(.+)$/); if (m) out.profile.push({ k: m[1], v: m[2] }); });
      } else if (/tarot/.test(t)) {
        bullets(sec.lines).forEach(function (b) {
          var m = b.match(/^([^—–]+?)\s+[—–]\s+([^:]+):\s*(.+)$/);
          if (m) out.tarot.push({ role: m[1].trim(), card: m[2].trim(), text: m[3].trim(), reversed: /reversed/i.test(m[2]) });
        });
      } else if (/disagree/.test(t)) {
        out.disagree = bullets(sec.lines);
      } else if (/^who you are/.test(t)) {
        out.who = bullets(sec.lines);
      }
    });
    return out;
  }

  /* Birth chart (1 Nov 2026), from the "Birth Chart" and "Key Aspects"
     sections of My Personality. A placement line reads
       - Sun: Pisces 2°03' · house 1 · reading
     and an aspect line
       - Sun conjunct Saturn, orb 0°42': reading */
  var SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
  function parseChart(md) {
    var out = { placements: [], aspects: [], elements: [], modes: [], polarity: [], note: '', big: [] };
    sections(md).forEach(function (sec) {
      var t = sec.title.toLowerCase();
      if (/birth chart/.test(t)) {
        sec.lines.forEach(function (l) {
          var c = clean(l), m;
          if ((m = c.match(/^(Elements|Modes|Polarity):\s*(.+)$/i))) {
            out[m[1].toLowerCase()] = m[2].split(/\s*·\s*/).map(function (x) { var p = x.match(/^([A-Za-z]+)\s+(\d+)$/); return p ? { k: p[1], n: +p[2] } : null; }).filter(Boolean);
          } else if ((m = c.match(/^Big three:\s*(.+)$/i))) {
            out.big = m[1].split(/\s*·\s*/).map(function (x) { var p = x.split(/\s+/); return { k: p[0], sign: p[1] || '' }; });
          } else if ((m = c.match(/^Chart:\s*(.+)$/i))) { out.note = m[1]; }
        });
        bullets(sec.lines).forEach(function (b) {
          var m = b.match(/^([A-Za-z ]+?):\s*([A-Z][a-z]+)\s+(\d{1,2})°(\d{1,2})'?\s*(R)?\s*(?:·\s*house\s+(\d{1,2}))?\s*(?:·\s*(.+))?$/);
          if (!m || SIGNS.indexOf(m[2]) < 0) return;
          var lon = SIGNS.indexOf(m[2]) * 30 + (+m[3]) + (+m[4]) / 60;
          out.placements.push({ name: m[1].trim(), sign: m[2], deg: +m[3], min: +m[4], retro: !!m[5], house: m[6] ? +m[6] : null, text: (m[7] || '').trim(), lon: lon });
        });
      } else if (/key aspects/.test(t)) {
        bullets(sec.lines).forEach(function (b) {
          var m = b.match(/^([A-Za-z ]+?)\s+(conjunct|trine|square|sextile|opposite|opposition)\s+([A-Za-z ]+?),\s*orb\s+([\d°']+)\s*:\s*(.+)$/i);
          if (m) out.aspects.push({ a: m[1].trim(), type: m[2].toLowerCase(), b: m[3].trim(), orb: m[4], text: m[5].trim() });
        });
      }
    });
    return out;
  }

  function parseKind(md) {
    return lines(md).filter(function (l) { return /^>\s|^[-•]\s/.test(l); }).map(function (l) { return clean(l.replace(/^(>|[-•])\s*/, '')); })
      .filter(function (t) { return t.length > 3; });
  }

  /* ---------- styles ---------- */
  function css() {
    if (document.getElementById('me-css')) return;
    var s = document.createElement('style');
    s.id = 'me-css';
    s.textContent = [
      '#me-root{--me-gold:#f2c97d;--me-silver:#d7e3ee;--me-coral:#ff8fa3;--me-sea:#7fe3c6;margin-top:14px;}',
      '#me-root .me-card{position:relative;border-radius:26px;background:linear-gradient(165deg,rgba(13,46,68,.62),rgba(4,18,29,.78));border:1px solid rgba(46,230,255,.13);box-shadow:var(--shadow);padding:20px;margin:0 0 16px;overflow:hidden;}',
      '#me-root h3{font-family:var(--serif);font-weight:600;font-size:21px;color:var(--aquasoft);margin:0 0 4px;}',
      '#me-root .me-sub{font-size:13px;color:var(--muted);margin:0;line-height:1.45;}',
      '#me-root .me-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px;}',
      '#me-root .me-head a{font-size:12.5px;color:var(--aquasoft);white-space:nowrap;}',
      /* hero */
      '#me-root .hero{min-height:300px;padding:0;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);background:#06192a;}',
      '@media(max-width:760px){#me-root .hero{grid-template-columns:1fr;}}',
      '#me-root .hero .art{position:absolute;inset:0;background:radial-gradient(90% 80% at 85% 20%,rgba(242,201,125,.22),transparent 60%),radial-gradient(80% 90% at 0% 100%,rgba(46,230,255,.18),transparent 60%),linear-gradient(160deg,#0c3954,#04121d 75%);background-size:cover;background-position:center;}',
      '#me-root .hero .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(3,12,20,.88),rgba(3,12,20,.45) 60%,rgba(3,12,20,.15));}',
      '#me-root .hero .who{position:relative;padding:28px 24px 24px;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;}',
      '#me-root .portrait{width:112px;height:112px;border-radius:50%;object-fit:cover;border:3px solid rgba(242,201,125,.8);box-shadow:0 0 0 6px rgba(242,201,125,.12),0 14px 34px rgba(0,0,0,.5);background:#0c2a3d;display:grid;place-items:center;font:600 46px var(--serif);color:var(--me-gold);margin-bottom:10px;}',
      '#me-root .name{font-family:var(--serif);font-size:clamp(30px,5.4vw,46px);line-height:1.02;color:#fff;font-weight:600;margin:0;}',
      '#me-root .title{font-size:15px;color:var(--me-gold);margin:2px 0 0;}',
      '#me-root .stats{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:22px 20px;align-content:center;}',
      '#me-root .stat{border-radius:18px;padding:12px 14px;background:rgba(3,14,24,.55);border:1px solid rgba(242,201,125,.16);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}',
      '#me-root .stat .n{font-family:var(--serif);font-size:30px;line-height:1;color:#fff;}',
      '#me-root .stat .l{font-size:12px;color:var(--muted);margin-top:4px;line-height:1.3;}',
      '#me-root .stat.wide{grid-column:1/-1;display:flex;align-items:center;gap:12px;}',
      '#me-root .nflx{font:900 22px/1 var(--sans);color:#e50914;letter-spacing:-1px;}',
      /* medals */
      '#me-root .chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px;}',
      '#me-root .chip{border:1px solid var(--aqualine);background:transparent;color:var(--ink);border-radius:999px;padding:6px 13px;font:600 13px var(--sans);cursor:pointer;}',
      '#me-root .chip.on{background:var(--aqua);color:#03121d;border-color:var(--aqua);}',
      '#me-root .year{display:grid;grid-template-columns:62px 1fr;gap:12px;padding:12px 0;border-top:1px solid rgba(46,230,255,.09);}',
      '#me-root .year:first-of-type{border-top:none;}',
      '#me-root .year .y{font-family:var(--serif);font-size:22px;color:var(--aquasoft);line-height:1.2;}',
      '@media(max-width:560px){#me-root .year{grid-template-columns:1fr;gap:8px;}#me-root .medals{grid-template-columns:1fr;}}',
      '#me-root .medals{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;}',
      '#me-root .medal{display:flex;gap:12px;align-items:flex-start;border-radius:18px;padding:12px 14px;background:rgba(4,18,29,.55);border:1px solid rgba(46,230,255,.10);}',
      '#me-root .medal svg{flex:none;}',
      '#me-root .medal .t{font-weight:650;font-size:14px;color:var(--ink);line-height:1.3;}',
      '#me-root .medal .x{font-size:12.5px;color:var(--me-gold);margin-top:3px;line-height:1.35;}',
      '#me-root .medal .w{font-size:12px;color:var(--muted);margin-top:3px;}',
      /* films */
      '#me-root .posters{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 2px 12px;}',
      '#me-root .poster{scroll-snap-align:start;flex:0 0 150px;aspect-ratio:2/3;border-radius:16px;position:relative;overflow:hidden;padding:12px;display:flex;flex-direction:column;justify-content:flex-end;background:linear-gradient(180deg,rgba(4,18,29,0) 30%,rgba(4,18,29,.92)),linear-gradient(150deg,#145a7a,#0a2436);border:1px solid rgba(46,230,255,.16);box-shadow:0 12px 26px rgba(0,8,18,.5);}',
      '#me-root .poster .bg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.55;}',
      '#me-root .poster>*:not(.bg){position:relative;}',
      '#me-root .poster .pt{font-family:var(--serif);font-size:18px;line-height:1.1;color:#fff;font-weight:600;}',
      '#me-root .poster .pm{font-size:11.5px;color:var(--aquasoft);margin-top:5px;line-height:1.3;}',
      '#me-root .poster .py{position:absolute;top:10px;right:10px;font:700 11px var(--sans);color:var(--ink);background:rgba(3,12,20,.6);border-radius:999px;padding:3px 8px;}',
      '#me-root .poster .nb{position:absolute;top:8px;left:10px;}',
      '#me-root .stage{margin-top:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;}',
      '#me-root .stage div{font-size:13px;color:var(--ink);line-height:1.45;padding:10px 12px;border-radius:14px;background:rgba(4,18,29,.45);}',
      '#me-root .stage b{display:block;font-size:11.5px;color:var(--muted);font-weight:600;margin-bottom:2px;}',
      /* personality */
      '#me-root .types{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 16px;}',
      '#me-root .type{border-radius:16px;padding:10px 14px;background:rgba(242,201,125,.08);border:1px solid rgba(242,201,125,.28);}',
      '#me-root .type .k{font-family:var(--serif);font-size:20px;color:#fff;line-height:1.1;}',
      '#me-root .type .v{font-size:11.5px;color:var(--muted);}',
      '#me-root .through{font-family:var(--serif);font-size:clamp(20px,3.2vw,26px);line-height:1.3;color:#fff;margin:4px 0 16px;max-width:30ch;}',
      '#me-root .traits{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:16px;}',
      '#me-root .trait{border-radius:16px;padding:12px 14px;background:rgba(4,18,29,.55);border-left:3px solid var(--aqua);}',
      '#me-root .trait .a{font-size:14px;font-weight:650;color:var(--ink);line-height:1.3;}',
      '#me-root .trait .b{font-size:12px;color:var(--muted);margin-top:4px;line-height:1.35;}',
      '#me-root .prof{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-bottom:18px;}',
      '#me-root .prof div{border-radius:16px;padding:12px 14px;background:rgba(4,18,29,.45);font-size:13px;line-height:1.5;color:var(--ink);}',
      '#me-root .prof b{display:block;font-size:12px;margin-bottom:3px;}',
      '#me-root .tarot{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}',
      '@media(max-width:700px){#me-root .tarot{grid-template-columns:1fr;}}',
      '#me-root .tcard{border-radius:18px;padding:14px;background:linear-gradient(170deg,#1b2f55,#0a1630);border:1px solid rgba(242,201,125,.35);position:relative;overflow:hidden;}',
      '#me-root .tcard .face{height:108px;border-radius:12px;margin-bottom:12px;display:grid;place-items:center;background:radial-gradient(70% 70% at 50% 40%,rgba(242,201,125,.30),transparent 70%),linear-gradient(180deg,#24406e,#101d3b);border:1px solid rgba(242,201,125,.25);}',
      '#me-root .tcard.rev .face svg{transform:rotate(180deg);}',
      '#me-root .tcard .r{font-size:11.5px;color:var(--me-gold);font-weight:600;}',
      '#me-root .tcard .c{font-family:var(--serif);font-size:19px;color:#fff;margin:2px 0 6px;line-height:1.15;}',
      '#me-root .tcard .x{font-size:12.5px;color:var(--muted);line-height:1.45;}',
      /* birth chart */
      '#me-root .bc{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:18px;align-items:start;}',
      '@media(max-width:760px){#me-root .bc{grid-template-columns:1fr;}}',
      '#me-root .wheel{width:100%;max-width:340px;aspect-ratio:1;margin:0 auto;display:block;}',
      '#me-root .wheel text{font-family:"Segoe UI Symbol","Apple Symbols","Noto Sans Symbols",var(--sans);}',
      '#me-root .big3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:12px;}',
      '#me-root .big3>div{border-radius:16px;padding:10px 12px;background:rgba(242,201,125,.08);border:1px solid rgba(242,201,125,.28);text-align:center;}',
      '#me-root .big3 .g{font-size:22px;color:var(--me-gold);line-height:1;}',
      '#me-root .big3 .k{font-family:var(--serif);font-size:18px;color:#fff;margin-top:4px;}',
      '#me-root .big3 .v{font-size:11px;color:var(--muted);}',
      '#me-root .bars{display:grid;gap:7px;margin-bottom:12px;}',
      '#me-root .bar{display:grid;grid-template-columns:62px 1fr 18px;gap:8px;align-items:center;font-size:12px;color:var(--muted);}',
      '#me-root .bar i{display:block;height:8px;border-radius:99px;background:rgba(46,230,255,.10);overflow:hidden;}',
      '#me-root .bar i b{display:block;height:100%;border-radius:99px;}',
      '#me-root .bar span:last-child{color:var(--ink);text-align:right;}',
      '#me-root .pl{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;margin-top:14px;}',
      '#me-root .pl>div{border-radius:16px;padding:11px 13px;background:rgba(4,18,29,.5);display:grid;grid-template-columns:30px 1fr;gap:4px 10px;}',
      '#me-root .pl .g{grid-row:span 2;font-size:22px;color:var(--me-gold);line-height:1.2;text-align:center;}',
      '#me-root .pl .h{font-size:13.5px;font-weight:650;color:var(--ink);}',
      '#me-root .pl .h small{font-weight:500;color:var(--aquasoft);margin-left:4px;}',
      '#me-root .pl .x{font-size:12.5px;color:var(--muted);line-height:1.45;}',
      '#me-root .asp{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin-top:10px;}',
      '#me-root .asp>div{font-size:12.5px;color:var(--muted);line-height:1.45;padding:10px 12px;border-radius:14px;background:rgba(4,18,29,.45);}',
      '#me-root .asp b{display:block;color:var(--ink);font-size:13px;margin-bottom:2px;}',
      '#me-root .asp .o{color:var(--aquasoft);font-weight:500;font-size:11.5px;margin-left:4px;}',
      /* kind + gallery */
      '#me-root .quotes{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;}',
      '#me-root .quote{border-radius:18px;padding:16px;background:rgba(242,201,125,.06);border:1px solid rgba(242,201,125,.2);font-family:var(--serif);font-size:16px;line-height:1.45;color:#fff;}',
      '#me-root .empty{display:flex;gap:14px;align-items:center;border-radius:18px;padding:16px;border:1px dashed rgba(46,230,255,.28);color:var(--muted);font-size:13.5px;line-height:1.45;}',
      '#me-root .empty .ic{font-size:26px;}',
      '#me-root .empty a{color:var(--aquasoft);font-weight:600;}',
      '#me-root .gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;}',
      '#me-root .gal figure{margin:0;border-radius:14px;overflow:hidden;aspect-ratio:1;background:#0b2233;}',
      '#me-root .gal img{width:100%;height:100%;object-fit:cover;display:block;}',
      '#me-root .err{color:#ff9db0;font-size:13px;}',
      '#me-root .chip:focus-visible,#me-root a:focus-visible{outline:2px solid var(--aqua);outline-offset:2px;}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------- drawing ---------- */
  var MEDAL_FILL = { gold: ['#f6d58a', '#c99a3d'], silver: ['#eef4f8', '#9fb2c2'], ribbon: ['#8df3ff', '#2aa9c9'], star: ['#ffd9a8', '#e09a52'], flag: ['#ff8fa3', '#d45a6e'] };
  function medalSVG(kind) {
    var f = MEDAL_FILL[kind] || MEDAL_FILL.star, id = 'mg' + kind;
    var inner = kind === 'flag'
      ? '<rect x="13" y="13" width="18" height="6" fill="#d8283b"/><rect x="13" y="19" width="18" height="6" fill="#fff"/>'
      : kind === 'star' ? '<path d="M22 11l3.2 6.6 7.2 1-5.2 5 1.3 7.2L22 27.4l-6.5 3.4 1.3-7.2-5.2-5 7.2-1z" fill="rgba(255,255,255,.85)"/>'
        : '<text x="22" y="27" text-anchor="middle" font-family="Georgia,serif" font-size="12" font-weight="700" fill="rgba(40,28,6,.75)">' + (kind === 'gold' ? '1' : kind === 'silver' ? '2' : '★') + '</text>';
    return '<svg width="44" height="52" viewBox="0 0 44 52" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + f[0] + '"/><stop offset="1" stop-color="' + f[1] + '"/></linearGradient></defs>'
      + '<path d="M14 34l-5 16 7-4 4 6 4-14z M30 34l5 16-7-4-4 6-4-14z" fill="' + f[1] + '" opacity=".75"/>'
      + '<circle cx="22" cy="21" r="16" fill="url(#' + id + ')"/><circle cx="22" cy="21" r="12.5" fill="none" stroke="rgba(255,255,255,.45)"/>' + inner + '</svg>';
  }
  function tarotSVG(card) {
    var c = card.toLowerCase();
    var g = /star/.test(c) ? '<path d="M30 6l5 15 16 0-13 9 5 15-13-9-13 9 5-15-13-9 16 0z" fill="#f2c97d"/>'
      : /cup/.test(c) ? '<path d="M14 10h32c0 14-7 22-16 22S14 24 14 10z M27 32h6v10h8v4H19v-4h8z" fill="#8df3ff"/>'
        : /wand/.test(c) ? '<path d="M28 6h4v42h-4z" fill="#f2c97d"/><path d="M30 6c6 4 8 9 6 14-3-3-5-3-6 0-1-3-3-3-6 0-2-5 0-10 6-14z" fill="#ff8fa3"/>'
          : '<circle cx="30" cy="26" r="16" fill="none" stroke="#f2c97d" stroke-width="3"/>';
    return '<svg width="60" height="54" viewBox="0 0 60 54" aria-hidden="true">' + g + '</svg>';
  }

  function heroHTML() {
    var gal = images(S.md.gallery);
    var impact = parseImpact(S.md.impact);
    var portrait = gal.length ? gal[0].src : null;
    var stats = impact.filter(function (x) { return !/netflix/i.test(x.label); }).slice(0, 8);
    var nf = impact.filter(function (x) { return /netflix/i.test(x.label); })[0];
    return '<section class="me-card hero" aria-label="About me">'
      + '<div class="art" data-art="hero"></div><div class="shade"></div>'
      + '<div class="who">' + (portrait ? '<img class="portrait" src="' + esc(portrait) + '" alt="Befalia">' : '<div class="portrait" data-portrait>B</div>')
      + '<p class="name">Befalia Aisarahmadani</p><p class="title">Sea Queen of Indonesia</p>'
      + '<p class="me-sub" style="max-width:38ch">Mermaid, dancer, director and founder of DiveArts, Sea Diva and TailCraft.</p></div>'
      + '<div class="stats">' + (S.err.impact ? '<p class="err">Impact by Numbers did not load.</p>' : stats.map(function (x) {
        return '<div class="stat"><div class="n">' + esc(x.big) + '</div><div class="l">' + esc(x.sub) + '</div></div>';
      }).join('') + (nf ? '<div class="stat wide"><span class="nflx">N</span><div><div class="n" style="font-size:22px">' + esc(nf.raw) + '</div><div class="l">Netflix feature</div></div></div>' : ''))
      + '</div></section>';
  }

  function medalsHTML() {
    if (S.err.medals) return '<section class="me-card"><h3>Trophy cabinet</h3><p class="err">Medals & Trophies did not load.</p></section>';
    var all = parseMedals(S.md.medals);
    if (!all.length) return '';
    var list = all.filter(function (m) { return S.medalTab === 'all' || m.group === S.medalTab; });
    var years = [], by = {};
    list.forEach(function (m) { var y = m.year || 'Other'; if (!by[y]) { by[y] = []; years.push(y); } by[y].push(m); });
    var wins = all.filter(function (m) { return m.kind === 'gold'; }).length;
    var tab = function (k, label, n) { return '<button class="chip' + (S.medalTab === k ? ' on' : '') + '" data-me="medal" data-k="' + k + '">' + label + ' ' + n + '</button>'; };
    return '<section class="me-card"><div class="me-head"><div><h3>Trophy cabinet</h3><p class="me-sub">' + all.length + ' titles and placements, ' + wins + ' of them first place.</p></div><a href="' + notionUrl(PAGES.medals) + '" target="_blank" rel="noopener">Edit in Notion</a></div>'
      + '<div class="chips">' + tab('all', 'All', all.length) + tab('mermaid', 'Mermaid & underwater', all.filter(function (m) { return m.group === 'mermaid'; }).length) + tab('dance', 'Dance', all.filter(function (m) { return m.group === 'dance'; }).length) + '</div>'
      + years.map(function (y) {
        return '<div class="year"><div class="y">' + esc(y.replace('–', '–​')) + '</div><div class="medals">' + by[y].map(function (m) {
          return '<div class="medal">' + medalSVG(m.kind) + '<div><div class="t">' + esc(m.title) + '</div>'
            + (m.extra.length ? '<div class="x">' + m.extra.map(esc).join('<br>') + '</div>' : '')
            + (m.where ? '<div class="w">' + esc(m.where) + '</div>' : '') + '</div></div>';
        }).join('') + '</div></div>';
      }).join('') + '</section>';
  }

  function filmHTML() {
    if (S.err.film) return '<section class="me-card"><h3>On screen and on stage</h3><p class="err">Film, TV & Stage did not load.</p></section>';
    var f = parseFilm(S.md.film);
    if (!f.films.length && !f.stage.length) return '';
    var films = f.films.slice().sort(function (a, b) { return (b.netflix - a.netflix) || ((b.year || '') > (a.year || '') ? 1 : -1); });
    var groups = {};
    f.stage.forEach(function (s) { (groups[s.section] = groups[s.section] || []).push(s.text); });
    return '<section class="me-card"><div class="me-head"><div><h3>On screen and on stage</h3><p class="me-sub">' + f.films.length + ' films and shows.</p></div><a href="' + notionUrl(PAGES.film) + '" target="_blank" rel="noopener">Edit in Notion</a></div>'
      + '<div class="posters" role="list">' + films.map(function (x) {
        return '<article class="poster" role="listitem"><div class="bg" data-art="film"></div>' + (x.netflix ? '<span class="nb nflx">N</span>' : '') + (x.year ? '<span class="py">' + esc(x.year) + '</span>' : '')
          + '<div class="pt">' + esc(x.title) + '</div><div class="pm">' + esc(x.role || x.kind) + '</div></article>';
      }).join('') + '</div>'
      + '<div class="stage">' + Object.keys(groups).map(function (k) {
        return groups[k].map(function (t) { var p = t.split(/:\s(.+)/); return '<div><b>' + esc(p.length > 1 ? p[0] : k) + '</b>' + esc(p.length > 1 ? p[1] : t) + '</div>'; }).join('');
      }).join('') + '</div></section>';
  }

  function personalityHTML() {
    if (S.err.personality) return '<section class="me-card sensitive"><h3>How I am wired</h3><p class="err">My Personality did not load.</p></section>';
    var p = parsePersonality(S.md.personality);
    if (!p.types.length && !p.core.length && !p.who.length) return '';
    var colors = { Strengths: 'var(--me-sea)', 'Blind spots': 'var(--me-coral)', 'Growth edges': 'var(--me-gold)' };
    return '<section class="me-card sensitive"><div class="me-head"><div><h3>How I am wired</h3><p class="me-sub">Self-reflection from your personality page, not a diagnosis.</p></div><a href="' + notionUrl(PAGES.personality) + '" target="_blank" rel="noopener">Edit in Notion</a></div>'
      + (p.types.length ? '<div class="types">' + p.types.map(function (t) { return '<div class="type"><div class="k">' + esc(t.k) + '</div><div class="v">' + esc(t.v) + '</div></div>'; }).join('') + '</div>' : '')
      + (p.through ? '<p class="through">' + esc(p.through.charAt(0).toUpperCase() + p.through.slice(1)) + '</p>' : '')
      + (p.core.length ? '<div class="traits">' + p.core.map(function (c) { return '<div class="trait"><div class="a">' + esc(c.trait) + '</div>' + (c.from ? '<div class="b">' + esc(c.from) + '</div>' : '') + '</div>'; }).join('') + '</div>' : '')
      + (p.profile.length ? '<div class="prof">' + p.profile.map(function (x) { return '<div><b style="color:' + (colors[x.k] || 'var(--aquasoft)') + '">' + esc(x.k) + '</b>' + esc(x.v) + '</div>'; }).join('') + '</div>' : '')
      + (p.tarot.length ? '<h3 style="font-size:17px;margin:4px 0 10px">This chapter, in three cards</h3><div class="tarot">' + p.tarot.map(function (t) {
        return '<div class="tcard' + (t.reversed ? ' rev' : '') + '"><div class="face">' + tarotSVG(t.card) + '</div><div class="r">' + esc(t.role) + '</div><div class="c">' + esc(t.card) + '</div><div class="x">' + esc(t.text) + '</div></div>';
      }).join('') + '</div>' : '')
      + '</section>';
  }

  var GLYPH = { Sun: '☉', Moon: '☽', Mercury: '☿', Venus: '♀', Mars: '♂', Jupiter: '♃', Saturn: '♄', Uranus: '♅', Neptune: '♆', Pluto: '♇', Lilith: '⚸', 'North Node': '☊', Ascendant: 'AC', Midheaven: 'MC', 'Part of Fortune': '⊗' };
  var SGLYPH = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
  var ELCOL = { Water: '#5ec8ff', Earth: '#9fd38a', Air: '#d7e3ee', Fire: '#ff8f6b', Mutable: '#7fe3c6', Fixed: '#f2c97d', Cardinal: '#ff8fa3', Feminine: '#c9a7ff', Masculine: '#8df3ff' };
  var VS = '\uFE0E';
  function wheelSVG(c) {
    var asc = (c.placements.filter(function (p) { return p.name === 'Ascendant'; })[0] || { lon: 0 }).lon;
    var C = 170, R1 = 160, R2 = 132, R3 = 112, R4 = 64;
    var pt = function (lon, r) { var a = (180 + (lon - asc)) * Math.PI / 180; return [C + r * Math.cos(a), C - r * Math.sin(a)]; };
    var f = function (n) { return n.toFixed(1); };
    var out = '<svg class="wheel" viewBox="0 0 340 340" role="img" aria-label="Birth chart wheel">'
      + '<circle cx="170" cy="170" r="' + R1 + '" fill="rgba(4,18,29,.6)" stroke="rgba(242,201,125,.45)"/>'
      + '<circle cx="170" cy="170" r="' + R2 + '" fill="none" stroke="rgba(242,201,125,.30)"/>'
      + '<circle cx="170" cy="170" r="' + R4 + '" fill="rgba(13,46,68,.55)" stroke="rgba(46,230,255,.18)"/>';
    for (var i = 0; i < 12; i++) {
      var a = pt(i * 30, R1), b = pt(i * 30, R2), g = pt(i * 30 + 15, (R1 + R2) / 2);
      out += '<line x1="' + f(a[0]) + '" y1="' + f(a[1]) + '" x2="' + f(b[0]) + '" y2="' + f(b[1]) + '" stroke="rgba(242,201,125,.30)"/>'
        + '<text x="' + f(g[0]) + '" y="' + f(g[1]) + '" text-anchor="middle" dominant-baseline="central" font-size="15" fill="' + ELCOL[['Fire', 'Earth', 'Air', 'Water'][i % 4]] + '">' + SGLYPH[i] + VS + '</text>';
    }
    // the horizon and meridian
    var mc = (c.placements.filter(function (p) { return p.name === 'Midheaven'; })[0] || null);
    [[asc, 'AC'], [asc + 180, 'DC']].concat(mc ? [[mc.lon, 'MC'], [mc.lon + 180, 'IC']] : []).forEach(function (x) {
      var a = pt(x[0], R2), b = pt(x[0], R4), l = pt(x[0], R4 - 12);
      out += '<line x1="' + f(a[0]) + '" y1="' + f(a[1]) + '" x2="' + f(b[0]) + '" y2="' + f(b[1]) + '" stroke="rgba(46,230,255,.45)" stroke-dasharray="' + (x[1] === 'AC' || x[1] === 'MC' ? '0' : '3 3') + '"/>'
        + '<text x="' + f(l[0]) + '" y="' + f(l[1]) + '" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700" fill="var(--aquasoft)">' + x[1] + '</text>';
    });
    // planets, spread so close ones do not sit on each other
    var ps = c.placements.filter(function (p) { return GLYPH[p.name] && p.name !== 'Ascendant' && p.name !== 'Midheaven' && p.name !== 'Part of Fortune'; })
      .map(function (p) { return { p: p, at: p.lon }; }).sort(function (a, b) { return a.at - b.at; });
    for (var pass = 0; pass < 4; pass++) for (var j = 1; j < ps.length; j++) if (ps[j].at - ps[j - 1].at < 9) ps[j].at = ps[j - 1].at + 9;
    ps.forEach(function (x) {
      var t = pt(x.p.lon, R2), t2 = pt(x.p.lon, R2 - 6), g = pt(x.at, R3 - 10);
      out += '<line x1="' + f(t[0]) + '" y1="' + f(t[1]) + '" x2="' + f(t2[0]) + '" y2="' + f(t2[1]) + '" stroke="#f2c97d"/>'
        + '<text x="' + f(g[0]) + '" y="' + f(g[1]) + '" text-anchor="middle" dominant-baseline="central" font-size="' + (x.p.name.length > 6 && GLYPH[x.p.name].length > 1 ? 10 : 16) + '" fill="#fff"><title>' + esc(x.p.name + ' in ' + x.p.sign) + '</title>' + GLYPH[x.p.name] + VS + '</text>';
    });
    return out + '</svg>';
  }
  function chartHTML() {
    if (S.err.personality) return '';
    var c = parseChart(S.md.personality);
    if (!c.placements.length) return '';
    var by = {}; c.placements.forEach(function (p) { by[p.name] = p; });
    var big = [['Sun', 'Sun', '☉'], ['Moon', 'Moon', '☽'], ['Ascendant', 'Rising', 'AC']].filter(function (b) { return by[b[0]]; });
    var bars = function (list) {
      var max = Math.max.apply(null, list.map(function (x) { return x.n; }).concat([1]));
      return list.map(function (x) { return '<div class="bar"><span>' + esc(x.k) + '</span><i><b style="width:' + Math.round(x.n / max * 100) + '%;background:' + (ELCOL[x.k] || 'var(--aqua)') + '"></b></i><span>' + x.n + '</span></div>'; }).join('');
    };
    var deg = function (p) { return p.deg + '°' + (p.min < 10 ? '0' : '') + p.min + '′' + (p.retro ? ' ℞' : ''); };
    return '<section class="me-card sensitive"><div class="me-head"><div><h3>Birth chart</h3><p class="me-sub">' + esc(c.note || 'From your calculated natal chart.') + ' Astrology is a lens for reflection, not fact.</p></div><a href="' + notionUrl(PAGES.personality) + '" target="_blank" rel="noopener">Edit in Notion</a></div>'
      + '<div class="bc"><div>' + wheelSVG(c) + '</div><div>'
      + (big.length ? '<div class="big3">' + big.map(function (b) { var p = by[b[0]]; return '<div><div class="g">' + b[2] + VS + '</div><div class="k">' + esc(p.sign) + '</div><div class="v">' + b[1] + '</div></div>'; }).join('') + '</div>' : '')
      + (c.elements.length ? '<div class="bars">' + bars(c.elements) + '</div>' : '')
      + (c.modes.length ? '<div class="bars">' + bars(c.modes) + '</div>' : '')
      + '</div></div>'
      + '<div class="pl">' + c.placements.map(function (p) {
        return '<div><span class="g">' + (GLYPH[p.name] || '•') + VS + '</span><span class="h">' + esc(p.name) + ' in ' + esc(p.sign) + '<small>' + deg(p) + (p.house ? ' · house ' + p.house : '') + '</small></span><span class="x">' + esc(p.text) + '</span></div>';
      }).join('') + '</div>'
      + (c.aspects.length ? '<h3 style="font-size:17px;margin:16px 0 0">Key aspects</h3><div class="asp">' + c.aspects.map(function (a) {
        return '<div><b>' + (GLYPH[a.a] || '') + VS + ' ' + esc(a.a) + ' ' + esc(a.type) + ' ' + esc(a.b) + ' ' + (GLYPH[a.b] || '') + VS + '<span class="o">orb ' + esc(a.orb) + '</span></b>' + esc(a.text) + '</div>';
      }).join('') + '</div>' : '')
      + '</section>';
  }

  function kindHTML() {
    var q = parseKind(S.md.kind);
    return '<section class="me-card sensitive"><div class="me-head"><div><h3>Kind words</h3><p class="me-sub">For the days you need them.</p></div><a href="' + notionUrl(PAGES.kind) + '" target="_blank" rel="noopener">Edit in Notion</a></div>'
      + (q.length ? '<div class="quotes">' + q.map(function (t) { return '<blockquote class="quote">' + esc(t) + '</blockquote>'; }).join('') + '</div>'
        : '<div class="empty"><span class="ic">💌</span><div>No messages yet. When a student or parent sends something kind, paste it into <a href="' + notionUrl(PAGES.kind) + '" target="_blank" rel="noopener">Kind Words</a> as a bullet or quote. It shows here as a card.</div></div>')
      + '</section>';
  }

  function galleryHTML() {
    var g = images(S.md.gallery);
    return '<section class="me-card"><div class="me-head"><div><h3>Gallery</h3><p class="me-sub">' + (g.length ? g.length + ' photos' : 'Your proudest moments') + '</p></div><a href="' + notionUrl(PAGES.gallery) + '" target="_blank" rel="noopener">Add photos in Notion</a></div>'
      + (g.length ? '<div class="gal">' + g.map(function (x) { return '<figure><img src="' + esc(x.src) + '" alt="' + esc(x.cap || 'Photo') + '" loading="lazy"></figure>'; }).join('') + '</div>'
        : '<div class="empty"><span class="ic">📸</span><div>Open <a href="' + notionUrl(PAGES.gallery) + '" target="_blank" rel="noopener">Gallery</a> in Notion on your phone and add photos. The first one becomes your portrait at the top of this page.</div></div>')
      + '</section>';
  }

  function render() {
    var root = document.getElementById(ROOT);
    if (!root) return;
    css();
    if (!S.loaded) { root.innerHTML = '<div class="me-card" style="min-height:260px" aria-label="Loading"></div>'; return; }
    root.innerHTML = heroHTML() + medalsHTML() + filmHTML() + personalityHTML() + chartHTML() + kindHTML() + galleryHTML();
    art(root);
  }

  var ART_OK = {};
  function art(root) {
    Object.keys(IMG).forEach(function (k) {
      var els = root.querySelectorAll('[data-art="' + k + '"]');
      var portraitSlot = k === 'portrait' ? root.querySelector('[data-portrait]') : null;
      if (!els.length && !portraitSlot) return;
      var apply = function () {
        els.forEach(function (el) { el.style.backgroundImage = 'url(' + IMG[k] + ')'; });
        if (portraitSlot) { var im = document.createElement('img'); im.className = 'portrait'; im.src = IMG.portrait; im.alt = 'Befalia'; portraitSlot.replaceWith(im); }
      };
      if (ART_OK[k] === true) return apply();
      if (ART_OK[k] === false) return;
      var im = new Image();
      im.onload = function () { ART_OK[k] = true; apply(); };
      im.onerror = function () { ART_OK[k] = false; };
      im.src = IMG[k];
    });
  }

  function load() {
    if (S.loading || typeof fetchNotion !== 'function') return;
    S.loading = true;
    var keys = Object.keys(PAGES);
    Promise.all(keys.map(function (k) {
      return fetchNotion(PAGES[k]).then(function (d) { S.md[k] = content(d && d.text); delete S.err[k]; })
        .catch(function (e) { S.err[k] = String(e && e.message || e); });
    })).then(function () { S.loading = false; S.loaded = true; render(); });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#me-root [data-me]');
    if (!b) return;
    if (b.getAttribute('data-me') === 'medal') { S.medalTab = b.getAttribute('data-k'); render(); }
  });

  window.meOpen = function () { render(); if (!S.loaded) load(); };
  window.__meParse = { parseImpact: parseImpact, parseMedals: parseMedals, parseFilm: parseFilm, parsePersonality: parsePersonality, parseChart: parseChart, parseKind: parseKind, images: images };
})();
