// Secure Notion proxy for the phone. Holds the Notion token server-side (env var).
// Two protocols:
//   (A) MCP-emulation: { name, args } — mirrors the dashboard's Cowork connector so the SAME dashboard code runs on the phone.
//   (B) Simple actions: { action, ... } — kept for the earlier phone build during transition.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const token = process.env.NOTION_TOKEN;
  if (!token) { res.status(500).json({ error: 'NOTION_TOKEN env var is not set in Vercel' }); return; }
  const H = { 'Authorization': 'Bearer ' + token, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  try {
    // ---------- (A) MCP emulation ----------
    if (body.name) {
      const name = body.name, a = body.args || {};
      if (name.indexOf('notion-fetch') !== -1) {
        const text = await fetchPageText(a.id, H);
        res.status(200).json({ text }); return;
      }
      if (name.indexOf('notion-create-pages') !== -1) {
        const parentId = (a.parent && (a.parent.page_id || a.parent.pageId)) || a.parent;
        const out = [];
        for (const p of (a.pages || [])) {
          const title = (p.properties && p.properties.title) || p.title || 'Untitled';
          const r = await fetch('https://api.notion.com/v1/pages', { method: 'POST', headers: H, body: JSON.stringify({
            parent: { page_id: parentId },
            properties: { title: { title: [{ text: { content: String(title) } }] } },
            children: contentToBlocks(p.content || '')
          }) });
          const d = await r.json();
          if (d.object !== 'error') out.push({ id: d.id, url: d.url });
        }
        res.status(200).json({ pages: out }); return;
      }
      if (name.indexOf('notion-update-page') !== -1) {
        const id = a.page_id || a.pageId, cmd = a.command;
        if (cmd === 'update_properties') {
          const title = a.properties && a.properties.title;
          if (title != null) await fetch('https://api.notion.com/v1/pages/' + id, { method: 'PATCH', headers: H, body: JSON.stringify({ properties: { title: { title: [{ text: { content: String(title) } }] } } }) });
          res.status(200).json({ ok: true }); return;
        }
        if (cmd === 'replace_content') {
          await clearChildren(id, H);
          await appendBlocks(id, contentToBlocks(a.new_str || a.content || ''), H);
          res.status(200).json({ ok: true }); return;
        }
        // insert_content (start or end). Notion's public API can only append; 'start' entries land at the end for now.
        await appendBlocks(id, contentToBlocks(a.content || ''), H);
        res.status(200).json({ ok: true, note: (a.position && a.position.type === 'start') ? 'appended (api cannot prepend)' : 'appended' }); return;
      }
      if (name.indexOf('list_events') !== -1) { const events = await fetchCalendarCache(a, H); res.status(200).json({ events }); return; }
      res.status(200).json({ ok: true }); return;
    }

    // ---------- (B) simple actions (legacy) ----------
    const { action, pageId, title, text } = body;
    if (action === 'read') { const lines = (await fetchPageText(pageId, H)).replace(/^<content>\n?|\n?<\/content>$/g, '').split('\n').filter(Boolean); res.status(200).json({ lines }); return; }
    if (action === 'childPages') {
      const r = await fetch('https://api.notion.com/v1/blocks/' + pageId + '/children?page_size=100', { headers: H });
      const d = await r.json(); if (d.object === 'error') { res.status(400).json({ error: d.message }); return; }
      const pages = (d.results || []).filter(function (b) { return b.type === 'child_page'; }).map(function (b) { return { id: b.id, title: (b.child_page && b.child_page.title) || 'Untitled' }; });
      res.status(200).json({ pages }); return;
    }
    if (action === 'capture') {
      const r = await fetch('https://api.notion.com/v1/pages', { method: 'POST', headers: H, body: JSON.stringify({ parent: { page_id: pageId }, properties: { title: { title: [{ text: { content: (title || 'Journal') } }] } }, children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: (text || '') } }] } }] }) });
      const d = await r.json(); if (d.object === 'error') { res.status(400).json({ error: d.message }); return; }
      res.status(200).json({ ok: true, url: d.url }); return;
    }
    if (action === 'append') { await appendBlocks(pageId, [{ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: (text || '') } }] } }], H); res.status(200).json({ ok: true }); return; }
    res.status(400).json({ error: 'unknown request' });
  } catch (e) { res.status(500).json({ error: String(e) }); }
}

// Calendar cache page (auto-synced by the desktop dashboard). Phone reads it here.
const CAL_CACHE_ID = '3a5eb411ed7a81729e98c62a5e2fb7be';
async function fetchCalendarCache(a, H) {
  try {
    const r = await fetch('https://api.notion.com/v1/blocks/' + CAL_CACHE_ID + '/children?page_size=100', { headers: H });
    const d = await r.json();
    if (d.object === 'error') return [];
    const events = [];
    for (const b of (d.results || [])) {
      const t = b.type, node = b[t] || {};
      const s = (node.rich_text || []).map(function (x) { return x.plain_text; }).join('');
      if (!s || s.indexOf('|') === -1) continue;
      const parts = s.split('|');
      if (parts.length < 3) continue;
      const when = parts[0].trim(), kind = (parts[1] || '').trim().toUpperCase(), summary = (parts[2] || '').trim(), link = (parts[3] || '').trim();
      const ev = { summary: summary };
      if (kind === 'DATE') ev.start = { date: when }; else ev.start = { dateTime: when };
      if (link) ev.htmlLink = link;
      events.push(ev);
    }
    const startT = a.startTime ? new Date(a.startTime).getTime() : null;
    const endT = a.endTime ? new Date(a.endTime).getTime() : null;
    let out = events.filter(function (e) {
      const iso = e.start.dateTime || e.start.date; if (!iso) return true;
      const ts = new Date(iso).getTime();
      if (startT != null && ts < startT - 86400000) return false;
      if (endT != null && ts > endT) return false;
      return true;
    });
    out.sort(function (x, y) { return new Date(x.start.dateTime || x.start.date) - new Date(y.start.dateTime || y.start.date); });
    return out.slice(0, a.pageSize || 10);
  } catch (e) { return []; }
}

async function fetchPageText(id, H) {
  const r = await fetch('https://api.notion.com/v1/blocks/' + id + '/children?page_size=100', { headers: H });
  const d = await r.json();
  if (d.object === 'error') throw new Error(d.message);
  let out = '<content>\n';
  for (const b of (d.results || [])) {
    const t = b.type, node = b[t] || {};
    if (t === 'child_page') { out += '<page url="https://www.notion.so/' + (b.id || '').replace(/-/g, '') + '">' + ((b.child_page && b.child_page.title) || 'Untitled') + '</page>\n'; continue; }
    const s = (node.rich_text || []).map(function (x) { return x.plain_text; }).join('');
    if (t === 'code') { out += '```' + (node.language || '') + '\n' + s + '\n```\n'; continue; }
    if (!s) continue;
    if (t === 'heading_1') out += '# ' + s + '\n';
    else if (t === 'heading_2' || t === 'heading_3') out += '## ' + s + '\n';
    else if (t === 'bulleted_list_item' || t === 'numbered_list_item') out += '- ' + s + '\n';
    else if (t === 'to_do') out += '- ' + (node.checked ? '[x] ' : '[ ] ') + s + '\n';
    else if (t === 'quote' || t === 'callout') out += '> ' + s + '\n';
    else out += s + '\n';
  }
  out += '</content>';
  return out;
}

function contentToBlocks(content) {
  const lines = String(content || '').split('\n');
  const blocks = []; let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (/^```/.test(line.trim())) { // code fence
      const lang = line.trim().replace(/^```/, '').trim(); let code = []; i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i++; }
      i++;
      blocks.push({ object: 'block', type: 'code', code: { rich_text: chunkRT(code.join('\n')), language: (lang || 'plain text') } });
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    let type = 'paragraph', txt = line;
    if (/^#\s/.test(line)) { type = 'heading_1'; txt = line.replace(/^#\s/, ''); }
    else if (/^##\s/.test(line)) { type = 'heading_2'; txt = line.replace(/^##\s/, ''); }
    else if (/^[-*]\s/.test(line)) { type = 'bulleted_list_item'; txt = line.replace(/^[-*]\s/, ''); }
    const node = {}; node[type] = { rich_text: chunkRT(txt) };
    blocks.push(Object.assign({ object: 'block', type: type }, node));
    i++;
  }
  return blocks.length ? blocks : [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }];
}
// Notion rich_text has a 2000-char limit per item; chunk long strings.
function chunkRT(s) { s = String(s || ''); const out = []; for (let i = 0; i < s.length; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } }); return out.length ? out : [{ text: { content: '' } }]; }

async function appendBlocks(id, blocks, H) {
  if (!blocks || !blocks.length) return;
  await fetch('https://api.notion.com/v1/blocks/' + id + '/children', { method: 'PATCH', headers: H, body: JSON.stringify({ children: blocks }) });
}
async function clearChildren(id, H) {
  const r = await fetch('https://api.notion.com/v1/blocks/' + id + '/children?page_size=100', { headers: H });
  const d = await r.json(); if (d.object === 'error') return;
  for (const b of (d.results || [])) { if (b.type !== 'child_page') { try { await fetch('https://api.notion.com/v1/blocks/' + b.id, { method: 'DELETE', headers: H }); } catch (e) {} } }
}
