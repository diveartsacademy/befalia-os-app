// Serves the app locally against the mocks: static files plus the /api routes,
// with a small shim for the Vercel req/res helpers the handlers use.
// Usage: node tests/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, seedTasks, seedCollections, state } from './mocks.mjs';

process.env.OS_KEY = process.env.OS_KEY || 'test-key';
process.env.NOTION_TOKEN = 'mock-notion';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'mock-anthropic';
install();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const seeded = { tasks: seedTasks(today) };
seedCollections();

const routes = {
  '/api/wardrobe': (await import('../api/wardrobe.js')).default,
  '/api/tasks': (await import('../api/tasks.js')).default,
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.css': 'text/css' };

export function start(port) {
  process.env.MOCK_FILE_BASE = 'http://localhost:' + port;
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__state') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ anthropicCalls: state.anthropicCalls, pages: state.pages.size, uploads: state.uploads.size, lastPrompt: state.lastPrompt })); return; }
    if (u.pathname.startsWith('/__file/')) { const up = state.uploads.get(u.pathname.split('/')[2]); if (!up || !up.buf) { res.statusCode = 404; res.end(); return; } res.setHeader('content-type', up.type); res.end(up.buf); return; }
    if (u.pathname === '/__multi') { state.multiNext = true; res.end('ok'); return; }
    const h = routes[u.pathname];
    if (h) {
      let raw = ''; for await (const c of req) raw += c;
      req.body = raw ? (() => { try { return JSON.parse(raw); } catch (e) { return raw; } })() : {};
      res.status = (s) => { res.statusCode = s; return res; };
      res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); return res; };
      try { await h(req, res); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: 'handler crashed: ' + e.message })); }
      return;
    }
    const f = path.join(root, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

if (process.argv[1] && process.argv[1].endsWith('serve.mjs')) {
  const port = +(process.argv[2] || 4317);
  await start(port);
  console.log('listening on http://localhost:' + port);
}
