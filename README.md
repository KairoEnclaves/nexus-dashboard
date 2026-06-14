# NEXUS — Personal Command Deck

A private, cyberpunk-styled personal dashboard: glassy neon panes, animated
visuals, and live widgets. Built on a small Node/Express backend so the login
is real (hashed password + session cookie) and the AI chat keys stay
server-side.

![aesthetic: dark teal-black, neon cyan + amber, scanlines]

---

## Quick start

```bash
cd nexus-dashboard
cp .env.example .env        # then edit .env (see below)
npm install
npm start
```

Open **http://localhost:3000** and log in with the credentials in your `.env`
(defaults to `michel.bouckaert@hotmail.com` / `Bouckaert52`).

> Requires Node 18+ (uses the built-in `fetch`). Tested on Node 22.

---

## What's live vs. demo right now

| Widget | State | How it works / how to make it live |
|---|---|---|
| **AI Console** (Claude, ChatGPT, Perplexity, Gemini) | **Working now** (two modes) | A tab per provider with two buttons. **OPEN ↗** launches the provider's web app in a new tab — uses your existing subscription, **no extra cost** (ChatGPT & Perplexity get your prompt pre-filled; Claude & Gemini open the app and your prompt is copied to the clipboard to paste). **SEND** answers inline via the provider's API — only works if you add that key to `.env`, and it's metered/paid. See "AI: launch vs API" below. |
| **News** | **Live** | Pulls real RSS server-side, round-robin so every source is represented: **De Tijd, Knack, Trends, FT, Economist, NYT World**. Override with `NEWS_FEEDS` in `.env`. |
| **Ukraine — Live Front** | **Live** | Dark Leaflet map of occupied (red) vs retaken (green) territory from **DeepStateMAP**, plus pulsing **air-raid alerts** per oblast from **alerts.com.ua** (refreshes each minute). Both are free, no key. See the data/caveat note below. |
| **Reading (Goodreads)** | **Live** via RSS | Goodreads stopped issuing API keys in 2020, but per-shelf **RSS still works** for the book list. Their feed carries **no reading progress**, so each book gets a **tap-to-set** progress bar that's saved on the server (shows pages too, when the feed includes a page count). Set `GOODREADS_RSS_URL` to your *Currently Reading* shelf RSS. |
| **Spotify** | **Full integration** (OAuth) | Sign in once and a dropdown lets you pick **any of your own playlists** and play it in the widget. Register a free Spotify app (`SPOTIFY_CLIENT_ID`/`SECRET`) — see setup below. (Simpler fallback: `SPOTIFY_EMBED_URI` embeds one fixed playlist with no sign-in.) Playback is full-length when you're logged into Spotify Premium in the same browser; otherwise 30-second previews. |
| **Reminders / To-Do** | **Live (iCloud) or local** | With `ICLOUD_*` set, it reads your real iCloud Reminders over CalDAV — check a box to complete it (writes back to iCloud) and add new ones. Without iCloud it's a local check/add/delete list persisted to `data/todos.json`. |
| **Agenda (iCloud + Outlook)** | **Live + interactive** | Merges Outlook (Graph) and iCloud (CalDAV) events across ~6 weeks. Switch between **Today / Week / Month / All** views (Month is a calendar grid with event dots) and click any event for details. Demo data until you connect an account. |
| **Outlook Mail (personal)** | **Interactive** (demo) → Graph | Single personal account (the professional tab was removed — work tenants need admin approval). Click a mail to read the full body and **reply** in-widget; connect via Microsoft Graph to go live. |
| **Finance (BNP Paribas Fortis)** | Demo | BNP has **no public personal API**. Realistic route: **GoCardless Bank Account Data** (formerly Nordigen) — free open-banking AIS tier, supports BNP Paribas Fortis (BIC `GEBABEBB`) with 730 days of transactions. Alternative: import a CSV export. Wire into `/api/finance`. |
| **Web Traffic** | Demo | Plug in **Plausible**, **Umami**, **GA4**, or **Cloudflare Analytics** per site. Wire into `/api/traffic`. |

Plus a **⛶ FULL** button in the top bar toggles browser full-screen (kiosk-style).

### AI: launch vs API (the cost question)

You were right — the API costs extra. Here's the trade-off:

- **OPEN ↗ (default, free):** opens the real Claude/ChatGPT/Perplexity/Gemini web app in a focused side **popup window** and rides your existing subscription. No per-message cost. (ChatGPT and Perplexity get your typed prompt pre-filled; Claude and Gemini open with it copied to your clipboard.)
- **SEND (API, paid):** keeps the conversation inside the widget, but every message bills your API account by tokens. Add the key only for providers where you want inline answers.

**Can't I just run Perplexity/ChatGPT *inside* the pane?** No — and it's not a limitation I can code around. Every one of these sites sends an `X-Frame-Options` / `Content-Security-Policy: frame-ancestors` header that tells the browser to refuse rendering them in an `<iframe>`. That's enforced by the browser, set by them on purpose (clickjacking protection + ToS). A workaround proxy that strips those headers would break their login/auth, violate their terms, and likely get blocked. So the realistic options are exactly the three the widget gives you: **popup window** (free, your subscription), **inline API** (paid), or copy-paste. The popup is the closest thing to "in the dashboard."

You don't have to choose globally — each provider tab offers both. Leave the API keys blank and the console works fine in pure popup mode.

Each demo endpoint lives in `server.js` and is clearly marked — swap the demo
payload for a real API call and the widget updates with no front-end changes.

---

## `.env` reference

```ini
DASHBOARD_EMAIL=michel.bouckaert@hotmail.com
DASHBOARD_PASSWORD=Bouckaert52        # change before hosting
SESSION_SECRET=<long-random-string>   # change before hosting
PORT=3000

ANTHROPIC_API_KEY=        ANTHROPIC_MODEL=claude-sonnet-4-6
OPENAI_API_KEY=           OPENAI_MODEL=gpt-4o-mini
PERPLEXITY_API_KEY=       PERPLEXITY_MODEL=sonar
GEMINI_API_KEY=           GEMINI_MODEL=gemini-1.5-flash

NEWS_FEEDS=               # comma-separated RSS urls (optional)
GOODREADS_RSS_URL=        # your currently-reading shelf RSS

SPOTIFY_CLIENT_ID=        # full playlist picker (recommended)
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://localhost:3000/auth/spotify/callback
SPOTIFY_EMBED_URI=        # OR just one fixed playlist link (no sign-in)

MS_CLIENT_ID=             # Outlook mail + calendar (Microsoft Graph)
MS_CLIENT_SECRET=
MS_TENANT=common
MS_REDIRECT_URI=http://localhost:3000/auth/ms/callback
```

The password is hashed with bcrypt **at boot** — it is never compared in
plaintext. Sessions use an http-only cookie.

---

## Setting up the widgets

### Goodreads (free, ~1 min)

1. Sign in to goodreads.com.
2. **My Books** → in the left sidebar under *Bookshelves*, click **currently-reading**.
3. Scroll to the very bottom of that page → click the orange **RSS** link.
4. Copy the URL from the address bar — it looks like
   `https://www.goodreads.com/review/list_rss/12345678?key=…&shelf=currently-reading`.
5. Put it in `.env` as `GOODREADS_RSS_URL=…` and restart. (Your profile can't be fully private for the feed to work.)

### Spotify — full playlist picker (~5 min, one-time)

1. Go to **https://developer.spotify.com/dashboard** → **Create app**.
2. Name it anything. **Redirect URI:** `http://localhost:3000/auth/spotify/callback`. APIs used: **Web API**. Save.
3. Open the app → **Settings** → copy **Client ID** → `SPOTIFY_CLIENT_ID`, and **View client secret** → `SPOTIFY_CLIENT_SECRET`.
4. Restart the server, then click **Connect Spotify** in the widget and sign in. A dropdown of your playlists appears — pick one and it plays. (Full tracks need Spotify Premium logged into the same browser; otherwise 30-second previews.)

*Simpler alternative:* skip the app and just set `SPOTIFY_EMBED_URI` to one playlist link — no sign-in, no picker.

### Ukraine front map — data & caveats

The map is **open-source intelligence, not official data**, and is labelled as such in the widget. Occupied/retaken areas come from **DeepStateMAP** (a Ukrainian OSINT project, updated ~daily) and are rendered faithfully from their own color coding. The pulsing dots are **active air-raid alerts** per oblast (alerts.com.ua) — the closest free real-time signal; precise missile-strike geolocation isn't openly available. I deliberately don't print a single "% occupied" number, because it can't be derived accurately from the raw polygons (the layers overlap). Treat it as an indicative situational map.

### Outlook mail + calendar — both accounts (~10 min, one-time)

The dashboard talks to Microsoft Graph. You register a free app once, then click
**Connect** on the mail widget for each account (work + personal).

1. Go to **https://entra.microsoft.com** → **Applications → App registrations → New registration**.
2. **Name:** `NEXUS Dashboard`. **Supported account types:** *Accounts in any organizational directory and personal Microsoft accounts* (this is what lets both your work account **and** your hotmail account connect).
3. **Redirect URI:** platform **Web**, value `http://localhost:3000/auth/ms/callback`. Click **Register**.
4. On the overview page, copy **Application (client) ID** → `MS_CLIENT_ID` in `.env`.
5. **Certificates & secrets → New client secret** → copy the secret **Value** (not the ID) → `MS_CLIENT_SECRET`.
6. **API permissions → Add a permission → Microsoft Graph → Delegated** → add `Mail.Read`, `Mail.Send`, `Calendars.Read`, `User.Read`, `offline_access`.
7. Leave `MS_TENANT=common`. Restart the server.
8. On the mail widget, click **⚇ Connect professional Outlook**, sign in with your work account; then switch to the **PERSONAL** tab and **⚇ Connect personal Outlook** with your hotmail account. Done — real mail, reply, and today's calendar events flow in. The **Agenda** widget automatically merges both connected calendars.

Tokens are stored locally in `data/ms-*.json` and auto-refresh. A **disconnect** link sits in each tab.

> When you later host this on a real domain, add that domain's
> `https://…/auth/ms/callback` as a second redirect URI in the app registration
> and update `MS_REDIRECT_URI`.

### iCloud reminders + iCloud calendar (~2 min)

Built and live — Apple has no public API, but both work over **CalDAV** with an
app-specific password:

1. Sign in at **appleid.apple.com** → **Sign-In & Security → App-Specific Passwords** → **Generate** one (call it "NEXUS"). You'll get a password like `abcd-efgh-ijkl-mnop`.
2. In `.env`: `ICLOUD_USERNAME=your@appleid.email` and `ICLOUD_APP_PASSWORD=abcd-efgh-ijkl-mnop` (spaces/dashes are fine, they're stripped).
3. Restart. The **Reminders** widget now shows your real iCloud reminder lists — tick one to complete it (it writes back to iCloud) or type to add a new one. The **Agenda** widget pulls in your iCloud calendar events alongside Outlook.

If the credentials are wrong or Apple rejects them, the widgets quietly fall
back to local/demo data rather than erroring.

**Not working? Open the built-in diagnostic.** While logged in, visit
**`/api/icloud/test`** (e.g. `http://localhost:3000/api/icloud/test`). It tells
you exactly what Apple returned and lists the calendars it found. The Reminders
widget also now shows the error inline. Most common causes, in order:

1. **The server wasn't restarted** after you edited `.env` — env is read once at boot. Stop it and `npm start` again.
2. **You used your normal Apple password.** It must be an **app-specific** password from appleid.apple.com (regular passwords + 2FA accounts return HTTP 401/403).
3. **Typo or expired** app-specific password — generate a fresh one. (The app now tries the password both with and without the `xxxx-xxxx` dashes automatically, so either format is fine.)
4. You're editing a different copy of `.env` than the one the running server loads.

If `/api/icloud/test` shows your calendars but a reminder won't toggle or an
event looks off, tell me what it returned and I'll adjust the CalDAV parsing.

## Hosting it online

Important context first: this is a **stateful** app. It keeps your login
session, your connected Outlook/Spotify/iCloud tokens, your local reminders,
and some caches **on the server** (in memory + `data/*.json`). That one fact
decides which host is painless and which needs a tweak.

### Option A — Render (FREE, recommended) — or Koyeb

You wanted free. As of 2026, **Render** still has a genuinely free web-service tier
that runs the app as a normal Node process — no code changes needed. (**Fly.io**
dropped its free tier and **Railway** is now usage-billed, so skip those for free.
**Koyeb**'s free tier works the same way if you prefer it.)

1. Push this folder to a GitHub repo (`.gitignore` already excludes `.env`, `data/`, `node_modules/`).
2. **render.com** → **New → Web Service** → connect the repo. Instance type: **Free**.
3. Build command `npm install`, start command `npm start`.
4. **Environment**: add every value from your `.env` as environment variables (never commit `.env`). Set a long random `SESSION_SECRET`.
5. Update redirect URIs to your new HTTPS URL — Spotify dashboard (`https://yourapp.onrender.com/auth/spotify/callback`, and set `SPOTIFY_REDIRECT_URI`); same for Azure if you ever use Outlook.

**What "free" costs you here:** Render's free tier sleeps after ~15 min idle (first hit after that takes ~30–60s to wake) and its disk resets on each deploy/restart. Because your secrets live in **environment variables**, the widgets that read from env every time — **iCloud reminders + calendar, news, Goodreads, the AI launchers, the Ukraine map** — keep working fine across restarts. Only the **OAuth** connection (Spotify) and your **login session** are stored on disk/in-memory, so after a sleep or redeploy you'd log in again and re-connect Spotify once. For a personal dashboard that's usually an acceptable trade for $0. (Render also offers a cheap paid tier with a persistent disk + no sleep if you outgrow it.)

### Option B — Vercel  (what you asked for; one caveat)

This repo already ships a `vercel.json` and `api/index.js`, so it **deploys** to Vercel as-is:

1. Push to GitHub → on **vercel.com** → **Add New → Project** → import the repo. Framework preset: **Other**, no build step.
2. **Settings → Environment Variables**: add every value from your `.env` (`DASHBOARD_EMAIL`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`, all AI keys, `MS_*`, `SPOTIFY_*`, `ICLOUD_*`).
3. Update redirect URIs to `https://yourapp.vercel.app/…` in Azure and the Spotify dashboard (and the matching `*_REDIRECT_URI` env vars).
4. Deploy.

**The honest caveat:** Vercel is **serverless** — functions are stateless and the filesystem is read-only except `/tmp`. So on Vercel, out of the box:

- News, AI launch, the Ukraine map, and the whole UI work fine (all stateless).
- **Login sessions and your saved Outlook/Spotify/iCloud connections + reminders won't persist** — each cold start forgets them, because here they live in memory / on disk.

To make those survive on Vercel you move two things to external storage: the **session store** and the **token/reminder store** → **Vercel KV** (Upstash Redis) or a tiny Postgres. It's a contained refactor (swap `express-session`'s memory store for `connect-redis`, and the `data/*.json` read/writes for KV calls).

**Want me to do that KV refactor so it runs fully on Vercel?** Just ask. If you'd rather not, Option A gets you everything working with no code changes.

## Security note before you host it publicly

This is solid for local use, but for a public host you should:

1. Put it behind **HTTPS** (a reverse proxy like Caddy/Nginx, or a platform
   that terminates TLS) and set the session cookie to `secure: true`.
2. Use a long random `SESSION_SECRET` and a strong `DASHBOARD_PASSWORD`.
3. Consider a persistent session store (the default is in-memory, so sessions
   reset on restart).
4. Add rate-limiting on `/api/login`.

---

## Project layout

```
nexus-dashboard/
├─ server.js              # express app: auth, AI proxy, news, demo endpoints
├─ .env.example           # copy to .env
├─ package.json
└─ public/
   ├─ login.html          # access gate
   ├─ dashboard.html      # the bento grid
   └─ assets/
      ├─ css/style.css     # the whole cyberpunk theme
      └─ js/
         ├─ visuals.js      # canvas animations (neural net, waveform, radar…)
         └─ app.js          # widget logic + chat
```

## Customising the look

All colours and the grid live in `public/assets/css/style.css` (`:root`
variables at the top). Panels are placed in `dashboard.html` with simple span
classes (`c4 r2` = 4 columns, 2 rows). The animated visual panels just point a
`<canvas data-viz="...">` at a function in `visuals.js` — available ones:
`particleField`, `waveform`, `spectrum`, `neuralOrb`, `radar`, `dataRain`.
