// Secure Notion proxy — runs on Vercel. Holds the Notion token server-side (env var),
// so the phone app never sees it and Notion's browser (CORS) block is bypassed.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const token = process.env.NOTION_TOKEN;
  if (!token) { res.status(500).json({ error: 'NOTION_TOKEN env var is not set in Vercel' }); return; }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { action, pageId, title, text } = body;
  const H = {
    'Authorization': 'Bearer ' + token,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    if (action === 'read') {
      const r = await fetch('https://api.notion.com/v1/blocks/' + pageId + '/children?page_size=100', { headers: H });
      const d = await r.json();
      if (d.object === 'error') { res.status(400).json({ error: d.message }); return; }
      const lines = (d.results || []).map(blockText).filter(function (s) { return s !== null && s !== undefined; });
      res.status(200).json({ lines });
      return;
    }
    if (action === 'capture') {
      const r = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          parent: { page_id: pageId },
          properties: { title: { title: [{ text: { content: (title || 'Journal') } }] } },
          children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: (text || '') } }] } }]
        })
      });
      const d = await r.json();
      if (d.object === 'error') { res.status(400).json({ error: d.message }); return; }
      res.status(200).json({ ok: true, url: d.url });
      return;
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

function blockText(b) {
  const t = b.type;
  const node = b[t] || {};
  const rt = node.rich_text || [];
  const s = rt.map(function (x) { return x.plain_text; }).join('');
  if (!s) return null;
  if (t === 'bulleted_list_item' || t === 'numbered_list_item') return '- ' + s;
  if (t === 'heading_1' || t === 'heading_2' || t === 'heading_3') return '# ' + s;
  return s;
}
