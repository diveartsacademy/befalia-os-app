// Food-photo vision endpoint. Takes a base64 image, asks Claude to estimate
// calories + macros, returns JSON. Key lives server-side in Vercel env (ANTHROPIC_API_KEY).
//
// SPEND GATE. This endpoint is reachable by anyone who knows the URL, so the
// ceiling cannot live in the browser. Before any call to Anthropic is made, the
// handler reserves a slot in a daily meter stored in the title of a Notion page
// (VISION_METER_PAGE). Past the cap, or if the meter cannot be read or written,
// the request is refused and no Anthropic call happens. The gate fails closed on
// purpose: a meter that cannot be checked is not a meter.
//
// Env: ANTHROPIC_API_KEY (required), NOTION_TOKEN (required, already set for
// api/notion.js), VISION_DAILY_CAP (optional, default 15), VISION_METER_PAGE
// (optional, defaults to the page created for this).

import { requireKey } from './_auth.js';

const METER_PAGE = process.env.VISION_METER_PAGE || '3cfeb411ed7a816c9045c52d6648dab3';
const CAP = Math.max(1, parseInt(process.env.VISION_DAILY_CAP || '15', 10) || 15);
const MAX_IMG_CHARS = 8 * 1024 * 1024; // base64 payload ceiling, roughly 6 MB of image
const NH = function (token) {
  return { 'Authorization': 'Bearer ' + token, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
};

// The day rolls over at midnight WITA (UTC+8), where Befa is, not at midnight UTC.
function todayWITA() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

async function readMeter(token) {
  const r = await fetch('https://api.notion.com/v1/pages/' + METER_PAGE, { headers: NH(token) });
  if (!r.ok) throw new Error('meter page unreadable (HTTP ' + r.status + ')');
  const d = await r.json();
  const parts = (d.properties && d.properties.title && d.properties.title.title) || [];
  const t = parts.map(function (x) { return x.plain_text || ''; }).join('');
  const m = t.match(/(\d{4}-\d{2}-\d{2})\D+(\d+)\s*\/\s*(\d+)/);
  return m ? { date: m[1], used: parseInt(m[2], 10) || 0 } : { date: '', used: 0 };
}

async function writeMeter(token, date, used) {
  const title = '⛽ Vision Meter · ' + date + ' · ' + used + ' / ' + CAP;
  const r = await fetch('https://api.notion.com/v1/pages/' + METER_PAGE, {
    method: 'PATCH', headers: NH(token),
    body: JSON.stringify({ properties: { title: { title: [{ text: { content: title } }] } } })
  });
  if (!r.ok) throw new Error('meter page unwritable (HTTP ' + r.status + ')');
}

export default async function handler(req, res) {
  // CORS stays open because the dashboard also runs from the desktop artifact.
  // It is not a security control anyway: it constrains browsers, not curl. The
  // meter below is what actually caps spend.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-os-key');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // GET is a free health check for the gate itself: open /api/vision in a browser
  // to confirm the meter page is reachable and see today's count. Spends nothing.
  if (req.method === 'GET') {
    const t = process.env.NOTION_TOKEN;
    if (!t) { res.status(500).json({ ok: false, error: 'NOTION_TOKEN env var is not set in Vercel' }); return; }
    try {
      const meter = await readMeter(t);
      const d = todayWITA();
      res.status(200).json({ ok: true, day: d, used: meter.date === d ? meter.used : 0, cap: CAP });
    } catch (e) {
      res.status(503).json({ ok: false, error: String(e.message || e), hint: 'Open the Vision Meter page in Notion, click the three dots, Connections, and add the same integration that NOTION_TOKEN belongs to.' });
    }
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'POST or GET only' }); return; }
  if (!requireKey(req, res)) return;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: 'ANTHROPIC_API_KEY env var is not set in Vercel' }); return; }
  const ntoken = process.env.NOTION_TOKEN;
  if (!ntoken) { res.status(500).json({ error: 'NOTION_TOKEN env var is not set in Vercel, so the daily meter cannot be checked' }); return; }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  let img = body.img || '';
  const mime = body.mime || 'image/jpeg';
  const note = (body.note || '').toString().slice(0, 200);
  if (!img) { res.status(400).json({ error: 'no image' }); return; }
  if (!/^image\//.test(mime)) { res.status(400).json({ error: 'not an image' }); return; }
  // strip a data: prefix if present
  const comma = img.indexOf(',');
  if (img.slice(0, 5) === 'data:' && comma !== -1) img = img.slice(comma + 1);
  if (img.length > MAX_IMG_CHARS) { res.status(413).json({ error: 'image too large' }); return; }

  // ---- spend gate: reserve a slot before spending anything ----
  const day = todayWITA();
  let used;
  try {
    const meter = await readMeter(ntoken);
    used = (meter.date === day) ? meter.used : 0;
    if (used >= CAP) {
      res.status(429).json({
        error: 'Daily limit reached: ' + used + ' of ' + CAP + ' food photos today. It resets at midnight WITA.',
        capped: true, used: used, cap: CAP
      });
      return;
    }
    used = used + 1;
    await writeMeter(ntoken, day, used);
  } catch (e) {
    // Fail closed. An unreadable meter means no ceiling, so nothing is sent to Claude.
    res.status(503).json({ error: 'Daily meter could not be checked (' + (e.message || e) + '), so nothing was sent to Claude.' });
    return;
  }

  const sys = "You are a nutrition estimator for a personal diet tracker. You are given ONE photo of food or drink" +
    (note ? (" plus a note from the user: \"" + note + "\".") : ".") +
    " Identify the item and estimate its calories and macronutrients for the portion shown. Respond with ONLY a" +
    " compact JSON object and nothing else, no markdown, no code fences:" +
    " {\"food\":\"short name\",\"kcal\":<integer>,\"protein\":<grams integer>,\"fat\":<grams integer>,\"carbs\":<grams integer>}." +
    " Always give your single best estimate even if uncertain.";

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: sys,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: img } },
            { type: 'text', text: 'Estimate this food or drink. Reply with JSON only.' }
          ]
        }]
      })
    });
    const d = await r.json();
    if (d.error) { res.status(200).json({ error: (d.error.message || 'vision error'), used: used, cap: CAP }); return; }
    const text = (d.content && d.content[0] && d.content[0].text) ? d.content[0].text : '';
    const m = text.match(/\{[\s\S]*\}/);
    let out; try { out = JSON.parse(m ? m[0] : text); } catch (e) { out = null; }
    if (!out) { res.status(200).json({ error: 'could not read estimate', raw: text.slice(0, 200), used: used, cap: CAP }); return; }
    res.status(200).json({
      food: String(out.food || 'Food').slice(0, 60),
      kcal: Math.round(+out.kcal || 0),
      protein: Math.round(+out.protein || 0),
      fat: Math.round(+out.fat || 0),
      carbs: Math.round(+out.carbs || 0),
      used: used, cap: CAP
    });
  } catch (e) { res.status(200).json({ error: String(e), used: used, cap: CAP }); }
}
