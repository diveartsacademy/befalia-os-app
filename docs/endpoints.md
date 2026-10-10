# Endpoint inventory — befalia-os-app

Last checked 9 October 2026 (WITA). Update this file in the same commit as any
change to a route. A route that is not listed here has not been reviewed.

Host: Vercel, project `befalia-os-app`, team `diveartsacademy-7751`.
Front door: the site is served as plain static files plus serverless functions.
There is no platform-level login in front of it, so each route defends itself.

## Routes

| Route | Methods | What it does | Secrets it holds | Gate | Worst case if the gate fails |
|---|---|---|---|---|---|
| `/api/notion` | POST | Proxy to the Notion API. Emulates the Cowork MCP calls so the same dashboard code runs on the phone. Reads and writes pages. | `NOTION_TOKEN` | `x-os-key` header checked against `OS_KEY` | A stranger reads and writes every page the token can reach: journal, health, relationships, finance |
| `/api/tasks` | POST | The To-Do tab. Lists, creates, edits, ticks and deletes (archives) tasks in the Notion **Tasks** database under Personal Life / Befa's To-Do, and nothing else: every edit first checks that the page's parent is that database and refuses anything else with 403. Fields are whitelisted. "Completed on" is stamped server-side in WITA | `NOTION_TOKEN` | `x-os-key` header checked against `OS_KEY` | A stranger reads, edits or archives to-do tasks. They cannot reach journal, health or finance pages through this route |
| `/api/tasks` | GET | Free health check for the To-Do. Returns `{ok, today, keyGate, total, open, doneToday, untitled, archive:{ok, days, items, first, last}}`: counts only, no task names, notes or dates | `NOTION_TOKEN` | none, deliberately | Someone learns how many tasks exist and how many were ticked today. Nothing else is exposed |
| `/api/tasks` `{action:'history'}` | POST | The 2026 Apple Note history (1 Jan to 9 Oct 2026, To do section) for the History view and calendar. Stored AES-256-GCM encrypted in `api/_history-2026.js` because this repo is public; the key lives on the Notion page "History archive key (do not delete)" under Befa's To-Do (override with `HISTORY_KEY_PAGE` or `HISTORY_KEY`). Read only | `NOTION_TOKEN` | `x-os-key` | A stranger with the OS key reads the old Apple Note days. Without the key page the archive is unreadable ciphertext |
| `/api/goals` | GET | Counts-only health check (rows per year, highlight count). No goal names | `NOTION_TOKEN` | none, deliberately | Someone learns how many goals exist per year |
| `/api/goals` | POST | The Goals tab. Lists, creates, edits status of, and archives rows in the Notion **Yearly Goals Tracker** database only (403 for any other parent). `Kind` = Goal or Highlight | `NOTION_TOKEN` (`GOALS_DB_ID` optional) | `x-os-key` | A stranger reads or edits yearly goals and highlights |
| `/api/classlog` | GET | Says only whether sending to the DiveArts books is switched on: `{ok, sendReady, notion}`. No values | none | none, deliberately | Someone learns whether the sheet service env vars are set |
| `/api/classlog` | POST | Class expenses (added 10 Oct 2026). `draft` saves a class's cost lines and students as JSON in the row's `Expenses` property. `send` writes them ONCE to the DiveArts books through the DAA sheet service ("DAA Instructor - scripts" Apps Script, actions `saveSession` then `saveSessionDetail`, same as the DiveArts OS instructor page), then stores the returned `SES-...` id in `Session ID`. Refuses any page that is not Tasks DB + Section Classes + Type Event, any row that already has a Session ID (409), a send before the class day in WITA, components outside the DiveArts OS list, lines over Rp20.000.000, more than 20 lines or 12 students. Instructor is always diveartsacademy@gmail.com, source `personal-os`, actor `diveartsacademy@gmail.com via Personal OS` | `NOTION_TOKEN`, `DAA_API_URL`, `DAA_API_KEY` (same values as the divearts-os Cloudflare env; never sent to the browser) | `x-os-key` | A stranger with the OS key writes made-up class costs into OS_SESSIONS, OS_SESSION_COSTS and the 1. SESSION EXPENSES tab. Bounded by the checks above and logged in OS_WRITE_LOG with the Personal OS actor, but this is the first route here that writes money into the business books, so the OS key now guards more than personal notes |
| `/api/vision` | POST | Sends one food photo to Claude and returns a calorie and macro estimate | `ANTHROPIC_API_KEY`, `NOTION_TOKEN` | `x-os-key`, then a daily cap of `VISION_DAILY_CAP` (15) held in a Notion page | A stranger spends the Anthropic key. The cap bounds it at 15 calls per day even so |
| `/api/vision` | GET | Free health check. Returns `{ok, day, used, cap}` and nothing else | none | none, deliberately | Someone learns how many food photos were logged today. Nothing else is exposed |
| `/api/_auth.js` | n/a | Shared key check. Underscore-prefixed files under `/api` are not routed by Vercel, so this is not reachable | reads `OS_KEY` | n/a | n/a |

## The key

The comparison ignores leading and trailing spaces, line breaks and wrapping quotes on both sides (added 10 Oct 2026 after a pasted key looped on the lock screen). The lock screen now checks a key with `POST /api/tasks {action:'ping'}` before saving it, and says plainly when the server refuses it.

One shared key, set as `OS_KEY` in the Vercel project environment. The dashboard
is a public static page, so the key cannot live in `index.html`. It is typed once
per device, kept in that browser's `localStorage`, and sent as `x-os-key`.

Honest limits, so nobody is surprised later:

- One key for everyone. No per-person identity, so the logs cannot say who did what.
- No rotation schedule. Changing it means updating `OS_KEY` in Vercel and re-entering it on every device. The client handles this by itself: any 401 clears the stored key and asks again.
- Anyone holding the key has everything. This moves the endpoints from open to the whole internet down to open to whoever has the key. That is a first step, not a finish line.
- If `OS_KEY` is not set in Vercel, both routes refuse every request with a 500. That is deliberate. A gate that is not configured is not a gate.

## To-Do (`/api/tasks`) details

- Database: `ac45a1773bfc4e3c96652745a1ea4c46` (override with `TASKS_DB_ID` in Vercel if it ever moves). The Befalia OS integration sees it because it sits under Personal Life.
- Actions: `list`, `create`, `update`, `archive`. Delete is an archive, so a deleted task can be restored from Notion trash.
- Ticking sets Done, Status Done and Completed on (today in WITA) together. Unticking clears all three.
- The client shows a change at once, then replaces it with what Notion returned. A refused write rolls back on screen and says "not saved".
- Verified 9 October 2026 against a local mock of the Notion API (pagination past 100, foreign page refused, bad area and bad date refused, tick and untick, rollback on a simulated Notion error, create, edit, sub-task, archive). **Not yet verified against the live Notion database** at the time of writing. That is the first check on the preview.

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

## History archive and Goals (added 10 Oct 2026)

- The Apple Note "2026" (To do section onward, 276 days, 3955 lines) is archived read only. History and the calendar show it as "From your Apple Note" lines. Ticks were not carried over: AppleScript cannot read checklist state, so those lines are what was written that day, not a claim it was done.
- If the archive ever needs rebuilding: encrypt the text with a fresh 32-byte key, write the module, and replace the archive-key line on the Notion key page. `parseArchive` documents the text format.
- Classes where Befalia is the instructor (Google Calendar "DiveArts Bali" and "DiveArts Jakarta", description contains "Instructor: Befalia") are copied into the Tasks database as Events in Section Classes by a daily scheduled task at 05:54 WITA. Each row carries `gcal:<eventId>` markers in Notes; the task never deletes, it flags cancellations in Notes.
- Past Events drop off the To-Do list (they stay on the calendar) and never count as overdue.

## Drag, titles and sub-tasks (added 10 Oct 2026)

- `/api/tasks` `update` now accepts `completedOn` (YYYY-MM-DD, today or earlier) so a done task can be moved to the day it was really done.
- Drag a task by its ⠿ handle. On a calendar day or the day strip at the bottom: done task = change the done day; open task on a past day = mark done that day; open task on today or later = schedule it (times and ranges keep their length). On a title = move it there (sub-tasks follow). On another task = make it a sub-task. Every drop has Undo.
- Titles are the Notion Section select. "+ Title" makes an empty title kept on this device until its first task is added. ✎ renames a title by updating every task in it.
- Each title has an inline add line. Enter adds; Tab (or ↳) makes the next ones sub-tasks of the task above; Shift+Tab or Backspace on an empty line goes back.
- The list mirrors her "TO DO LIST 2026" Apple Note exactly (10 Oct 2026 re-sync). Areas follow the note's headings in order: Main (the untitled top block), DiveArts, Sea Diva, TailCraft, Personal, Schedule. Each note heading is a Section (title); indented note lines are sub-tasks (Parent task).
- `Order` (Notion number) holds the note's line order, in steps of 10. Titles sort by the smallest Order inside them; tasks and sub-tasks sort by Order, then created time. New tasks (any create path) and drag moves get the end of their title (max Order + 10). Filter and search views still sort by urgency.
- Class events synced from Google Calendar (Type Event, Section `Classes`) are not note lines, so the list hides them outside filter/search; they stay on the calendar and Home.
- Lines with no heading in the note have no Section and render straight under the area header, with no title row.
- Status `Parked` = an open task that is no longer in the note. The client drops Parked rows on load, so they never show on the list, calendar, Home or counts. They stay in Notion. GET health reports `parked` and open counts per area.
- The earlier "AI to-do" block (Grok / Claude / Codex grouping) was removed at her request: never regroup her tasks into titles she did not write.

## Classes and class expenses (added 10 Oct 2026)

- Classes come from the scheduled task "Sync Befa teaching classes to To-Do" (daily 05:54 WITA). It copies from the DiveArts Bali and Jakarta Google calendars: course sessions whose description says `Instructor: Befalia`, and Bali events whose title ends `· Regular class` (written by the weekly schedule task once Befa confirms). Rows are Section `Classes`, Type Event, with `gcal:` markers in Notes. Course rows also carry `Students: Name | invoice | course; ...` in Notes.
- Before 10 Oct the sync missed every regular class, because the weekly schedule task writes them without an instructor line. Fixed in the task prompt; the 10 Oct and 18 Oct Bali regular classes were added by hand the same day.
- The sync never touches `Expenses` or `Session ID`.
- Tapping a class opens the editor with a Class expenses panel: venue and type, cost lines (DiveArts OS components: pool ticket, Grab/transport, fuel, toll, parking, accommodation, consumables, videographer, equipment, other), students (prefilled from the class), Save draft, and Send to DiveArts books (two taps).
- Why send is once only: `saveSessionDetail` replaces the cost and attendance lines for a session, but the copy into "1. SESSION EXPENSES" in Befa's workbook happens only the first time (the sheet stamps the session id in column K and skips it afterwards). A second send would change OS_SESSION_COSTS without reaching her books, so a sent class is read only here.
- If `saveSession` works and `saveSessionDetail` fails, the session id is kept as `pendingSessionId` in the draft, and the next Send fills that same session instead of creating a second one.
- To switch sending on, add `DAA_API_URL` and `DAA_API_KEY` in Vercel (Production), the same values the divearts-os Cloudflare Pages project uses. Until then drafts work and Send explains what is missing.
- Tested on the local mock with a fake sheet service (draft, two-tap send, payload shape, read-only after send, 409 on resend, future-day refusal, mid-way failure and retry, gates). Not yet tested against the real Apps Script.
