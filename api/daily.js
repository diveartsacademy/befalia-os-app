// Morning job for the daily list. Vercel calls GET /api/daily at 00:05 in
// Asia/Makassar (16:05 UTC; Makassar is UTC+8 and does not use daylight saving).
// The same work also runs on the first To-Do load of the day, so a missed
// cron still fills the list the next time Befa opens it.
//
// CRON_SECRET must be set in Vercel. Vercel then sends
// Authorization: Bearer <CRON_SECRET> on the cron request. Without it this
// route refuses everyone, including the cron, and writes nothing.
import { cronAuthorized } from './_daily.js';
import { runDaily, witaDate } from './tasks.js';

function headers() {
  const token = process.env.NOTION_TOKEN;
  return { 'Authorization': 'Bearer ' + token, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'CRON_SECRET env var is not set in Vercel, so the morning job refuses every request' });
    return;
  }
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (!cronAuthorized(header, secret)) { res.status(401).json({ error: 'unauthorised' }); return; }
  if (!process.env.NOTION_TOKEN) { res.status(500).json({ error: 'NOTION_TOKEN env var is not set in Vercel' }); return; }
  try {
    const ran = await runDaily(headers(), witaDate());
    if (!ran.ok) { res.status(502).json({ ok: false, today: ran.today, error: ran.error || 'Daily tasks were not written' }); return; }
    // Counts only. The cron log does not need the task names.
    res.status(200).json({
      ok: true,
      today: ran.today,
      created: ran.created,
      archived: ran.archived,
      templates: (ran.templates || []).length,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
}
