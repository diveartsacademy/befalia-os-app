# Endpoint inventory — befalia-os-app

Last checked 3 September 2026 (WITA). Update this file in the same commit as any
change to a route. A route that is not listed here has not been reviewed.

Host: Vercel, project `befalia-os-app`, team `diveartsacademy-7751`.
Front door: the site is served as plain static files plus serverless functions.
There is no platform-level login in front of it, so each route defends itself.

## Routes

| Route | Methods | What it does | Secrets it holds | Gate | Worst case if the gate fails |
|---|---|---|---|---|---|
| `/api/notion` | POST | Proxy to the Notion API. Emulates the Cowork MCP calls so the same dashboard code runs on the phone. Reads and writes pages. | `NOTION_TOKEN` | `x-os-key` header checked against `OS_KEY` | A stranger reads and writes every page the token can reach: journal, health, relationships, finance |
| `/api/vision` | POST | Sends one food photo to Claude and returns a calorie and macro estimate | `ANTHROPIC_API_KEY`, `NOTION_TOKEN` | `x-os-key`, then a daily cap of `VISION_DAILY_CAP` (15) held in a Notion page | A stranger spends the Anthropic key. The cap bounds it at 15 calls per day even so |
| `/api/vision` | GET | Free health check. Returns `{ok, day, used, cap}` and nothing else | none | none, deliberately | Someone learns how many food photos were logged today. Nothing else is exposed |
| `/api/_auth.js` | n/a | Shared key check. Underscore-prefixed files under `/api` are not routed by Vercel, so this is not reachable | reads `OS_KEY` | n/a | n/a |

## The key

One shared key, set as `OS_KEY` in the Vercel project environment. The dashboard
is a public static page, so the key cannot live in `index.html`. It is typed once
per device, kept in that browser's `localStorage`, and sent as `x-os-key`.

Honest limits, so nobody is surprised later:

- One key for everyone. No per-person identity, so the logs cannot say who did what.
- No rotation schedule. Changing it means updating `OS_KEY` in Vercel and re-entering it on every device. The client handles this by itself: any 401 clears the stored key and asks again.
- Anyone holding the key has everything. This moves the endpoints from open to the whole internet down to open to whoever has the key. That is a first step, not a finish line.
- If `OS_KEY` is not set in Vercel, both routes refuse every request with a 500. That is deliberate. A gate that is not configured is not a gate.

## Other network calls the client makes

| From | To | Note |
|---|---|---|
| `index.html`, `askClaude()` | `hook.eu1.make.com/3ga58ebevmcuol8c2jjnahrixxeclp1c` | A Make webhook, unauthenticated by design of that platform. Make organisation 7740420 is paused, so this is believed dead, but the URL is still in the page. Anyone reading the page source has it. Worth deleting when the Make exit finishes |

## What has actually been tested, and what has not

Verified against the running preview deployment on 3 September 2026:

- `GET /api/vision` returns the meter state
- a non-image and an empty POST are refused before the meter or Anthropic is touched
- a real photo runs end to end and moves the meter
- with the meter forced to 15 of 15, a POST returns 429 and no Anthropic call is made

Not yet verified live at the time of writing: the 401 path on both routes with the
new `OS_KEY` gate. That is the first thing to check after `OS_KEY` is set in Vercel.
