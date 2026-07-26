// Food-photo vision endpoint. Takes a base64 image, asks Claude to estimate
// calories + macros, returns JSON. Key lives server-side in Vercel env (ANTHROPIC_API_KEY).
export default async function handler(req, res) {
  // CORS (so the desktop artifact can call it cross-origin too)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: 'ANTHROPIC_API_KEY env var is not set in Vercel' }); return; }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  let img = body.img || '';
  const mime = body.mime || 'image/jpeg';
  const note = (body.note || '').toString().slice(0, 200);
  if (!img) { res.status(400).json({ error: 'no image' }); return; }
  // strip a data: prefix if present
  const comma = img.indexOf(',');
  if (img.slice(0, 5) === 'data:' && comma !== -1) img = img.slice(comma + 1);

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
    if (d.error) { res.status(200).json({ error: (d.error.message || 'vision error') }); return; }
    const text = (d.content && d.content[0] && d.content[0].text) ? d.content[0].text : '';
    const m = text.match(/\{[\s\S]*\}/);
    let out; try { out = JSON.parse(m ? m[0] : text); } catch (e) { out = null; }
    if (!out) { res.status(200).json({ error: 'could not read estimate', raw: text.slice(0, 200) }); return; }
    res.status(200).json({
      food: String(out.food || 'Food').slice(0, 60),
      kcal: Math.round(+out.kcal || 0),
      protein: Math.round(+out.protein || 0),
      fat: Math.round(+out.fat || 0),
      carbs: Math.round(+out.carbs || 0)
    });
  } catch (e) { res.status(200).json({ error: String(e) }); }
}
