// Secure Notion proxy — runs on Vercel. Holds the Notion token server-side (env var),
// so the phone app never sees it and Notion's browser (CORS) block is bypassed.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const token = process.env.NOTION_TOKEN;
  if (!token) { res.status(500).json({ error: 'NOTION_TOKEN env var is not set in Vercel' }); return; }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { action, pageId, title, text, query } = body;
  const H = {
    'Authorization': 'Bearer ' + token,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    if (action === 'read') {
      const lines = await readPage(pageId, H);
      res.status(200).json({ lines });
      return;
    }
    if (action === 'readMulti') {
      // pageId is an array; returns { <id>: [lines] }
      const ids = Array.isArray(pageId) ? pageId : [pageId];
      const out = {};
      await Promise.all(ids.map(async function (id) { out[id] = await readPage(id, H).catch(function () { return []; }); }));
      res.status(200).json({ pages: out });
      return;
    }
    if (action === 'childPages') {
      // returns child sub-pages of a page: [{id,title}]
      const r = await fetch('https://api.notion.com/v1/blocks/' + pageId + '/children?page_size=100', { headers: H });
      const d = await r.json();
      if (d.object === 'error') { res.status(400).json({ error: d.message }); return; }
      const pages = (d.results || []).filter(function (b) { return b.type === 'child_page'; })
        .map(function (b) { return { id: b.id, title: (b.child_page && b.child_page.title) || 'Untitled' }; });
      res.status(200).json({ pages });
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
    if (action === 'append') {
      // add a bullet line to the TOP of a page (used for chief chat / social ideas / focus)
      const r = await fetch('https://api.notion.com/v1/blocks/' + pageId + '/children', {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ children: [{ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: (text || '') } }] } }] })
      });
      const d = await r.json();
      if (d.object === 'error') { res.status(400).json({ error: d.message }); return; }
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

async function readPage(pageId, H) {
  const r = await fetch('https://api.notion.com/v1/blocks/' + pageId + '/children?page_size=100', { headers: H });
  const d = await r.json();
  if (d.object === 'error') throw new Error(d.message);
  return (d.results || []).map(blockText).filter(function (s) { return s !== null && s !== undefined; });
}

function blockText(b) {
  const t = b.type;
  const node = b[t] || {};
  const rt = node.rich_text || [];
  const s = rt.map(function (x) { return x.plain_text; }).join('');
  if (t === 'child_page') return '## ' + ((b.child_page && b.child_page.title) || 'Untitled');
  if (!s) return null;
  if (t === 'bulleted_list_item' || t === 'numbered_list_item') return '- ' + s;
  if (t === 'to_do') return (node.checked ? '[x] ' : '[ ] ') + s;
  if (t === 'heading_1' || t === 'heading_2' || t === 'heading_3') return '# ' + s;
  if (t === 'quote' || t === 'callout') return '> ' + s;
  return s;
}
