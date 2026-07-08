# SRV-CORE — CTF Live Comm Tool

A two-sided chat system for a live CTF:

- **/admin** — your control dashboard. Create user accounts, see everyone in a
  sidebar, click into a thread, type a reply. Every reply you send appears to
  the participant as coming from "the server."
- **/client** — the page your participants open. Looks like a secure terminal
  session. They type a message, see a "processing..." animation with a fake
  pipeline (VALIDATING INPUT / ROUTING PACKET / etc.), and then your reply
  appears as a `[SERVER]` line — no sign a person is on the other end.

No database, no build step, no local installs required. Everything below is
done through websites in your browser.

---

## 1. Put the code on GitHub (no git commands needed)

1. Go to [github.com](https://github.com) and make a free account if you
   don't have one.
2. Click the **+** in the top right → **New repository**. Name it something
   like `ctf-comm`. Keep it **Public** (required for free hosting tiers).
   Click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Drag in every file from this project, keeping the folder structure:
   - `package.json`
   - `server.js`
   - `public/client/index.html`
   - `public/admin/index.html`
5. Click **Commit changes**.

## 2. Deploy for free on Render

1. Go to [render.com](https://render.com) and sign up free (you can sign in
   with your GitHub account, which makes step 3 easier).
2. Click **New +** → **Web Service**.
3. Connect your GitHub account if prompted, then select the `ctf-comm` repo.
4. Fill in:
   - **Name:** anything, e.g. `srv-core`
   - **Region:** closest to you
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. Scroll to **Environment Variables** and add two:
   - `ADMIN_USER` → pick your own admin username
   - `ADMIN_PASS` → pick a real password (don't leave the default!)
6. Click **Create Web Service**. Wait for the build to finish (a couple of
   minutes). You'll get a URL like `https://srv-core.onrender.com`.

Your two pages are now live at:
- `https://srv-core.onrender.com/admin`
- `https://srv-core.onrender.com/client`

### ⚠️ Free tier behavior to know
Render's free web services **go to sleep after 15 minutes with no traffic**,
and take 30–60 seconds to "wake up" on the next request. For a live event:
- Open the `/admin` page yourself a minute or two before the event starts to
  wake it up.
- If it's been idle mid-event, the *first* message after a gap may take an
  extra 30–60 seconds before the "processing" animation even starts — that's
  the server waking up, not your app being slow. You could ping the site
  every 10 minutes during the event (e.g., from your phone) to keep it warm.

---

## 3. Set up participants before the event

1. Open `https://YOUR-URL.onrender.com/admin`, log in with the admin
   username/password you set in step 2.5.
2. Click **+ NEW USER** for each participant. Give each one:
   - a username (their login id)
   - a password
   - a label (what shows in your sidebar, e.g. "Team Alpha")
3. Give each participant their username + password through whatever channel
   makes sense (paper, email, DM) along with the client link:
   `https://YOUR-URL.onrender.com/client`

Note: since there's no database, if the Render service **restarts**
(redeploys, or occasionally on the free tier), the user list resets. Create
your users right before the event starts, and avoid pushing new code changes
mid-event.

---

## 4. Making the client feel like a real app (instead of a browser tab)

A genuine compiled `.exe` needs to be built on an actual Windows machine (or
a flaky Wine setup) — not reliable to hand you here. Instead, this trick gets
the same *feel* (no address bar, no tabs, looks like a standalone window)
using nothing but a shortcut:

**Windows, using Chrome or Edge:**
1. Right-click the desktop → **New** → **Shortcut**.
2. For the location, paste (adjust the URL and browser path if needed):
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=https://YOUR-URL.onrender.com/client
   ```
3. Name the shortcut whatever you like (e.g. "SRV-CORE Terminal") and give it
   a custom icon if you want (Shortcut Properties → Change Icon).
4. Double-clicking it opens the client page in its own window with **no
   browser UI at all** — participants won't see it's Chrome underneath.

You can zip this shortcut (or a `.bat` file containing the same command) and
send it to participants alongside their credentials — double-click to
"connect," matching the brief without needing a real compiled binary.

If you later want an actual signed `.exe`, the cleanest free path is to put
this project's client into an Electron shell and build it via **GitHub
Actions** (which provides free Windows runners) — happy to set that up if you
want to go that route, just note it involves a bit more GitHub setup.

---

## 5. Local testing (optional)

If you want to try it on your own machine before deploying:
```
npm install
npm start
```
Then open `http://localhost:3000/admin` and `http://localhost:3000/client` in
two separate browser tabs/windows.

---

## How it works, briefly

- `server.js` — one Node process serving both pages, a small REST API
  (admin login, create user, list users, get thread, send reply; client
  login), and a Socket.IO real-time channel that pushes client messages to
  the admin dashboard instantly and pushes admin replies to the right
  client instantly.
- Everything is stored in memory (no database) — simplest possible setup for
  a short-lived event with a handful of users.
- Passwords are hashed with bcrypt before being stored, even in memory.
