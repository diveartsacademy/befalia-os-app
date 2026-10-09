// Reads the encrypted 2026 Apple Note history (api/_history-2026.js) for the
// To-Do History view. The key is not in the repo: it sits on a Notion page
// under Befa's To-Do ("History archive key"), read with the server's
// NOTION_TOKEN. The repo is public, so the archive only ships encrypted.
//
// Text format inside the archive, one line per entry:
//   @2026-01-31 31 saturday   starts a day (ISO date, then the heading she wrote)
//   <tabs>text                an item, tabs = indent level
//   <tabs># text              a heading line inside that day
//   a leading backslash escapes a literal @ or # or backslash
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { BLOB, SOURCE, SHA16 } from './_history-2026.js';

export const KEY_PAGE = (process.env.HISTORY_KEY_PAGE || '3f4eb411ed7a8138b0a3e8df57fde8c1').replace(/-/g, '');
const KEY_RE = /archive-key:\s*([A-Za-z0-9_-]{40,})/;

let cache = null; // { days, items } per warm function instance

export function parseArchive(text) {
  const days = [];
  let cur = null;
  for (const raw of String(text).split('\n')) {
    if (!raw.trim()) continue;
    if (raw[0] === '@') {
      const m = raw.match(/^@(\d{4}-\d{2}-\d{2})\s?(.*)$/);
      if (m) { cur = { d: m[1], h: m[2] || '', items: [] }; days.push(cur); continue; }
    }
    if (!cur) continue;
    let l = 0;
    while (raw[l] === '\t') l++;
    let t = raw.slice(l);
    let h = 0;
    if (t.startsWith('# ')) { h = 1; t = t.slice(2); }
    if (t[0] === '\\') t = t.slice(1);
    cur.items.push({ t, l, h });
  }
  return days;
}

export function decryptArchive(keyB64url, blob = BLOB) {
  const key = Buffer.from(keyB64url, 'base64url');
  if (key.length !== 32) throw new Error('History key has the wrong length');
  const buf = Buffer.from(blob, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  const gz = Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  const text = zlib.gunzipSync(gz).toString('utf8');
  const sha = crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
  if (sha !== SHA16) throw new Error('History archive failed its checksum');
  return text;
}

async function readKey(H) {
  if (process.env.HISTORY_KEY) return process.env.HISTORY_KEY.trim();
  const r = await fetch('https://api.notion.com/v1/blocks/' + KEY_PAGE + '/children?page_size=100', { headers: H });
  let j = {};
  try { j = await r.json(); } catch (e) { j = {}; }
  if (!r.ok || j.object === 'error') {
    const e = new Error(j.code === 'object_not_found'
      ? 'The History archive key page is not shared with the Befalia OS integration, or it was deleted.'
      : 'Notion error reading the history key: ' + (j.message || ('HTTP ' + r.status)));
    e.status = 502;
    throw e;
  }
  for (const b of j.results || []) {
    const body = b[b.type] || {};
    const txt = (body.rich_text || []).map((x) => x.plain_text || '').join('');
    const m = txt.match(KEY_RE);
    if (m) return m[1];
  }
  const e = new Error('The History archive key page no longer has its archive-key line.');
  e.status = 502;
  throw e;
}

export async function loadArchive(H) {
  if (cache) return cache;
  const key = await readKey(H);
  let text;
  try { text = decryptArchive(key); } catch (err) {
    const e = new Error('Could not open the 2026 history archive: ' + (err.message || err));
    e.status = 502;
    throw e;
  }
  const days = parseArchive(text);
  cache = { source: SOURCE, days, items: days.reduce((n, d) => n + d.items.length, 0) };
  return cache;
}
