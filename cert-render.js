/* ---------------------------------------------------------------------------
   TailCraft design certificates (8 Nov 2026)

   Draws Befa's own certificate artwork with the customer's details on it.
   The two backgrounds are the artwork of her Google Slides templates
   "TAILCRAFT - 1 YEAR EXCLUSIVE CERTIFICATE" and "TAILCRAFT - PERMANENT
   EXCLUSIVE CERTIFICATE" (Drive folder TAILCRAFT CERTIFICATES (IP)), taken out
   of the template unchanged. The three fields sit exactly where the
   template's {{Client Name}}, {{Tail Design Name}} and {{Date}} boxes sit,
   in the same font (EB Garamond) and colour, measured from the template PDF.

   Used by the Befalia OS Business tab, the TailCraft dashboard and the public
   certificate page, so a certificate looks the same everywhere.

   TCCert.draw(canvas, d) -> Promise
     d = { kind: 'one_year' | 'lifetime', name, design, dateText, line }
   TCCert.pdf(canvas, fileName)  needs jsPDF loaded (window.jspdf)
--------------------------------------------------------------------------- */
(function (root) {
  'use strict';
  var BASE = (root.TC_CERT_BASE || '');
  /* Page is 1500 x 1060 points in the template; the artwork is 2000 x 1414. */
  var PT = 2000 / 1500;
  var KINDS = {
    one_year: {
      label: '1 year exclusive', bg: BASE + '/img/certs/tailcraft-1-year.jpg', colour: '#a44c7c', lineColour: '#5b4a7a',
      top: 540.6, bottom: 579.8, line: 946,
      cols: [{ x: 459.6, w: 250 }, { x: 787.4, w: 330 }, { x: 1087.5, w: 215 }]
    },
    lifetime: {
      label: 'Lifetime exclusive', bg: BASE + '/img/certs/tailcraft-lifetime.jpg', colour: '#ecd4dc', lineColour: '#d9c7a0',
      top: 458.6, bottom: 497.8, line: 552,
      cols: [{ x: 459.6, w: 250 }, { x: 773.6, w: 330 }, { x: 1087.5, w: 215 }]
    }
  };
  var fontReady = null;
  function loadFont() {
    if (fontReady) return fontReady;
    if (!root.FontFace || !root.document) return (fontReady = Promise.resolve());
    var faces = [
      new FontFace('TCGaramond', 'url(' + BASE + '/fonts/eb-garamond-latin-400-normal.woff2) format("woff2")',
        { unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' }),
      new FontFace('TCGaramond', 'url(' + BASE + '/fonts/eb-garamond-latin-ext-400-normal.woff2) format("woff2")',
        { unicodeRange: 'U+0100-02AF,U+0304,U+0308,U+0329,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' })
    ];
    fontReady = Promise.all(faces.map(function (f) { return f.load().then(function (x) { document.fonts.add(x); }); }))
      .catch(function () { /* fall back to Georgia */ });
    return fontReady;
  }
  var imgs = {};
  function loadImg(src) {
    if (imgs[src]) return imgs[src];
    imgs[src] = new Promise(function (ok, bad) {
      var i = new Image(); i.crossOrigin = 'anonymous';
      i.onload = function () { ok(i); }; i.onerror = function () { delete imgs[src]; bad(new Error('The certificate artwork did not load.')); };
      i.src = src;
    });
    return imgs[src];
  }
  /* Largest size up to the template's (30 pt) that fits the column. */
  function fit(ctx, text, maxPx, startPx) {
    var size = startPx;
    for (; size > 14; size -= 1) {
      ctx.font = size + 'px TCGaramond, "EB Garamond", Georgia, serif';
      if (ctx.measureText(text).width <= maxPx) break;
    }
    return size;
  }
  function draw(canvas, d) {
    var k = KINDS[d && d.kind] || KINDS.one_year;
    return Promise.all([loadFont(), loadImg(k.bg)]).then(function (r) {
      var img = r[1];
      canvas.width = 2000; canvas.height = 1414;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 2000, 1414);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = k.colour;
      /* The template's text boxes are 39 pt tall for 30 pt type; the baseline
         sits about three quarters of the way down the box. */
      var base = (k.top + (k.bottom - k.top) * 0.74) * PT;
      [d.name, d.design, d.dateText].forEach(function (t, i) {
        t = String(t || '').trim();
        if (!t) return;
        var c = k.cols[i];
        fit(ctx, t, c.w * PT, Math.round(30 * PT));
        ctx.fillText(t, c.x * PT, base);
      });
      if (d.line) {
        ctx.fillStyle = k.lineColour;
        fit(ctx, d.line, 900 * PT, Math.round(15 * PT));
        ctx.fillText(String(d.line), 750 * PT, k.line * PT);
      }
      return canvas;
    });
  }
  function pdf(canvas, fileName) {
    var J = root.jspdf && root.jspdf.jsPDF;
    if (!J) throw new Error('The PDF maker did not load.');
    var doc = new J({ orientation: 'landscape', unit: 'pt', format: [1500, 1060] });
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 1500, 1060);
    doc.save(fileName || 'TailCraft certificate.pdf');
  }
  /* "Personal licence · Worldwide · Certificate TC-IP-2026-001" */
  var SCOPE = { personal: 'Personal licence', school: 'School licence', brand: 'Brand licence' };
  function lineFor(c) {
    return [SCOPE[c.scope] || '', c.territory || '', c.cert_no ? 'Certificate ' + c.cert_no : '']
      .filter(Boolean).join('  ·  ');
  }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function dateText(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : '';
  }
  root.TCCert = { KINDS: KINDS, SCOPE: SCOPE, draw: draw, pdf: pdf, lineFor: lineFor, dateText: dateText };
})(typeof window !== 'undefined' ? window : globalThis);
