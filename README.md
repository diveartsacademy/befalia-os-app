# Befalia OS — iPhone app (PWA)

A phone app for your Personal Life OS. It **reads** your goals, resurfaces past learnings, shows today's takeaways, and lets you **capture** journal entries straight to Notion from anywhere. Your Notion token stays on the server (never in the app), so it's secure and gets around Notion's browser block.

The heavy thinking (agents, research, the full desktop dashboard) stays on desktop. This app is your **capture-anywhere + quick-glance** surface.

---

## What you do (about 15 minutes, one time)

### Step 1 — Create your Notion token (you do this; I never see it)
1. Go to **notion.so/my-integrations** → **New integration**.
2. Name it `Befalia OS`, pick your workspace, submit.
3. Copy the **Internal Integration Secret** (starts with `ntn_` or `secret_`). Keep it private.

### Step 2 — Let the integration see your pages
1. In Notion, open your **Personal Life** page.
2. Top-right **•••** → **Connections** → **Befalia OS**. (This shares that page and everything under it with the app.)

### Step 3 — Put this folder on GitHub (all clickable, no terminal)
1. Go to **github.com/new**, create a repo named `befalia-os-app` (Private is fine).
2. On the repo page → **uploading an existing file** → drag in **everything inside this `befalia-os-app` folder** (index.html, manifest.webmanifest, sw.js, package.json, the `api` folder, the `icons` folder). Commit.

### Step 4 — Deploy on Vercel (free)
1. Go to **vercel.com** → sign in with GitHub → **Add New → Project** → import `befalia-os-app`.
2. Before you click Deploy: open **Environment Variables** and add
   - **Name:** `NOTION_TOKEN`
   - **Value:** *(paste the secret from Step 1)*
3. Click **Deploy**. In ~1 minute you get a URL like `https://befalia-os-app.vercel.app`.

### Step 5 — Install it on your iPhone
1. Open that URL in **Safari** on your iPhone.
2. Tap the **Share** button → **Add to Home Screen**.
3. You now have a **Befalia OS** icon that opens full-screen like a real app. 🎉

---

## Notes
- **Security:** the token lives only in Vercel's server env var. The app and your phone never hold it. Only pages you connected in Step 2 are reachable.
- **Editing:** for full editing keep the Notion iPhone app too — this app is quick capture + a glance.
- **Free:** Vercel's free tier is plenty. Viewing/logging uses your Notion API, not Claude tokens.
- **To change what shows:** the page IDs are at the top of `index.html` (the `PAGES` object).

If you'd rather not do the GitHub/Vercel steps yourself, tell me next session and I'll walk you through them live in your browser — you'll just log in and paste the token.
