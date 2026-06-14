/* ============================================================
 *  NEXUS DASHBOARD — server
 *  Express + session auth + AI chat proxy + live news/Goodreads.
 *  Node >= 18 (uses built-in fetch). No build step.
 * ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

/* ---------- tiny .env loader (no extra dependency) ---------- */
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

const PORT = process.env.PORT || 3000;
const EMAIL = (process.env.DASHBOARD_EMAIL || 'michel.bouckaert@hotmail.com').toLowerCase();
const PASSWORD = process.env.DASHBOARD_PASSWORD || 'Bouckaert52';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10); // hashed at boot, never stored in plaintext at rest
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    name: 'nexus.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

/* ---------- auth helpers ---------- */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ ok: false, error: 'unauthenticated' });
}

/* ---------- static assets (css/js/img are public; pages are gated) ---------- */
const PUB = path.join(__dirname, 'public');
app.use('/assets', express.static(path.join(PUB, 'assets')));

/* ---------- page routes ---------- */
app.get('/', (req, res) => {
  if (req.session && req.session.user) return res.sendFile(path.join(PUB, 'dashboard.html'));
  return res.redirect('/login');
});
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  return res.sendFile(path.join(PUB, 'login.html'));
});

/* ---------- auth API ---------- */
app.post('/api/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const emailOk = email === EMAIL;
  const passOk = bcrypt.compareSync(password, PASSWORD_HASH);
  if (emailOk && passOk) {
    req.session.user = { email: EMAIL };
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) return res.json({ ok: true, user: req.session.user });
  return res.status(401).json({ ok: false });
});

/* ---------- which integrations are configured (drives widget UI) ---------- */
app.get('/api/config', requireAuth, (req, res) => {
  res.json({
    ok: true,
    providers: {
      claude: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      perplexity: !!process.env.PERPLEXITY_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
    },
    goodreads: !!process.env.GOODREADS_RSS_URL,
    spotifyUri: process.env.SPOTIFY_EMBED_URI || '',
    spotify: { configured: spotifyConfigured(), connected: spotConnected() },
    icloud: icloudConfigured(),
    ms: {
      configured: msConfigured(),
      professional: msConnected('professional'),
      personal: msConnected('personal'),
    },
  });
});

/* ============================================================
 *  AI CHAT PROXY — keeps keys server-side
 *  POST /api/chat { provider, message, history:[{role,content}] }
 * ============================================================ */
const PROVIDERS = {
  claude: async (message, history) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { needsKey: true };
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    const messages = [...history, { role: 'user', content: message }].map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 1024, messages }),
    });
    const data = await r.json();
    if (!r.ok) return { error: data.error?.message || `HTTP ${r.status}` };
    return { text: (data.content || []).map((c) => c.text).join('').trim() };
  },

  openai: async (message, history) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { needsKey: true };
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const messages = [...history, { role: 'user', content: message }];
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages }),
    });
    const data = await r.json();
    if (!r.ok) return { error: data.error?.message || `HTTP ${r.status}` };
    return { text: data.choices?.[0]?.message?.content?.trim() || '' };
  },

  perplexity: async (message, history) => {
    const key = process.env.PERPLEXITY_API_KEY;
    if (!key) return { needsKey: true };
    const model = process.env.PERPLEXITY_MODEL || 'sonar';
    const messages = [...history, { role: 'user', content: message }];
    const r = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages }),
    });
    const data = await r.json();
    if (!r.ok) return { error: data.error?.message || `HTTP ${r.status}` };
    return { text: data.choices?.[0]?.message?.content?.trim() || '' };
  },

  gemini: async (message, history) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { needsKey: true };
    const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    const contents = [...history, { role: 'user', content: message }].map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents }),
    });
    const data = await r.json();
    if (!r.ok) return { error: data.error?.message || `HTTP ${r.status}` };
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('').trim();
    return { text };
  },
};

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const provider = String(req.body.provider || '').toLowerCase();
    const message = String(req.body.message || '').slice(0, 8000);
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-12) : [];
    const fn = PROVIDERS[provider];
    if (!fn) return res.status(400).json({ ok: false, error: 'Unknown provider' });
    if (!message) return res.status(400).json({ ok: false, error: 'Empty message' });
    const out = await fn(message, history);
    if (out.needsKey) return res.json({ ok: false, needsKey: true, provider });
    if (out.error) return res.json({ ok: false, error: out.error });
    return res.json({ ok: true, text: out.text });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/* ============================================================
 *  MICROSOFT 365 — Outlook mail + calendar via Graph (OAuth2)
 *  Two accounts supported: slot "professional" and "personal".
 *  Register an app at https://entra.microsoft.com (see README),
 *  put MS_CLIENT_ID / MS_CLIENT_SECRET in .env, then click the
 *  "connect" button on the mail widget.
 * ============================================================ */
const MS = {
  clientId: process.env.MS_CLIENT_ID || '',
  clientSecret: process.env.MS_CLIENT_SECRET || '',
  tenant: process.env.MS_TENANT || 'common',
  redirect: process.env.MS_REDIRECT_URI || `http://localhost:${PORT}/auth/ms/callback`,
  scope: 'openid profile offline_access User.Read Mail.Read Mail.Send Calendars.Read',
};
const msConfigured = () => !!(MS.clientId && MS.clientSecret);
const MS_DIR = path.join(__dirname, 'data');
const msSlot = (s) => (s === 'personal' ? 'personal' : 'professional');
const msTokPath = (slot) => path.join(MS_DIR, `ms-${msSlot(slot)}.json`);
function msRead(slot) { try { return JSON.parse(fs.readFileSync(msTokPath(slot), 'utf8')); } catch (_) { return null; } }
function msSave(slot, data) { try { fs.mkdirSync(MS_DIR, { recursive: true }); fs.writeFileSync(msTokPath(slot), JSON.stringify(data, null, 2)); } catch (e) { console.warn('MS token not persisted:', e.message); } }
const msConnected = (slot) => !!msRead(slot);

async function msExchange(params) {
  const r = await fetch(`https://login.microsoftonline.com/${MS.tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: MS.clientId, client_secret: MS.clientSecret, redirect_uri: MS.redirect, ...params }).toString(),
  });
  return r.json();
}
async function msAccessToken(slot) {
  let tok = msRead(slot);
  if (!tok) return null;
  if (Date.now() < (tok.expires_at - 60000)) return tok.access_token;
  if (!tok.refresh_token) return null;
  const data = await msExchange({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, scope: MS.scope });
  if (data.access_token) { tok = { ...tok, ...data, expires_at: Date.now() + (data.expires_in || 3600) * 1000 }; msSave(slot, tok); return tok.access_token; }
  return null;
}
async function graphGet(slot, p) {
  const at = await msAccessToken(slot);
  if (!at) return null;
  const r = await fetch('https://graph.microsoft.com/v1.0' + p, { headers: { authorization: `Bearer ${at}` } });
  if (!r.ok) return null;
  return r.json();
}
function htmlToText(s) {
  return String(s || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}
function shortTime(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
async function msMail(slot) {
  const j = await graphGet(slot, '/me/messages?$top=8&$select=subject,from,bodyPreview,receivedDateTime,isRead,body');
  if (!j || !j.value) return null;
  return j.value.map((m) => ({
    id: m.id,
    from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Unknown',
    email: m.from?.emailAddress?.address || '',
    subject: m.subject || '(no subject)',
    preview: m.bodyPreview || '',
    body: m.body?.contentType === 'html' ? htmlToText(m.body.content) : (m.body?.content || m.bodyPreview || ''),
    unread: m.isRead === false,
    time: shortTime(m.receivedDateTime),
  }));
}
async function msEvents(slot, start, end) {
  const p = `/me/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}&$select=subject,start,end,location&$orderby=start/dateTime&$top=60`;
  const j = await graphGet(slot, p);
  if (!j || !j.value) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return j.value.map((e) => {
    const s = new Date((e.start?.dateTime || '') + 'Z'); const en = new Date((e.end?.dateTime || '') + 'Z');
    const mins = Math.round((en - s) / 60000);
    const dur = isNaN(mins) || mins <= 0 ? '' : (mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`);
    const date = isNaN(s) ? '' : `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
    return {
      title: e.subject || '(busy)', date, iso: isNaN(s) ? '' : s.toISOString(),
      time: isNaN(s) ? '' : s.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      dur, cal: slot === 'personal' ? 'outlook-personal' : 'outlook', location: e.location?.displayName || '',
    };
  });
}
async function msSendReply(slot, to, subject, body) {
  const at = await msAccessToken(slot);
  if (!at) return false;
  const r = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { subject, body: { contentType: 'Text', content: body }, toRecipients: [{ emailAddress: { address: to } }] } }),
  });
  return r.ok;
}

const msStates = new Map();
app.get('/auth/ms/login', requireAuth, (req, res) => {
  if (!msConfigured()) return res.status(400).send('Microsoft app not configured. Add MS_CLIENT_ID and MS_CLIENT_SECRET to .env, then restart.');
  const slot = msSlot(req.query.slot);
  const state = crypto.randomBytes(12).toString('hex');
  msStates.set(state, slot); setTimeout(() => msStates.delete(state), 10 * 60 * 1000);
  const url = `https://login.microsoftonline.com/${MS.tenant}/oauth2/v2.0/authorize?` + new URLSearchParams({
    client_id: MS.clientId, response_type: 'code', redirect_uri: MS.redirect, response_mode: 'query', scope: MS.scope, state,
  }).toString();
  res.redirect(url);
});
app.get('/auth/ms/callback', requireAuth, async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.send(`Microsoft sign-in error: ${error_description || error}. <a href="/">back</a>`);
  const slot = msStates.get(state);
  if (!code || !slot) return res.send('Invalid sign-in state. <a href="/">back</a>');
  msStates.delete(state);
  const data = await msExchange({ grant_type: 'authorization_code', code: String(code), scope: MS.scope });
  if (!data.access_token) return res.send(`Token exchange failed: ${data.error_description || data.error || 'unknown'}. <a href="/">back</a>`);
  let account = '';
  try { const me = await (await fetch('https://graph.microsoft.com/v1.0/me', { headers: { authorization: `Bearer ${data.access_token}` } })).json(); account = me.userPrincipalName || me.mail || ''; } catch (_) {}
  msSave(slot, { ...data, expires_at: Date.now() + (data.expires_in || 3600) * 1000, account });
  res.redirect('/?connected=' + slot);
});
app.post('/auth/ms/disconnect', requireAuth, (req, res) => {
  try { fs.unlinkSync(msTokPath(req.body.slot)); } catch (_) {}
  res.json({ ok: true });
});

/* ============================================================
 *  iCLOUD (CalDAV) — Reminders (VTODO) + Calendar (VEVENT)
 *  Apple ID + app-specific password (appleid.apple.com).
 * ============================================================ */
const ICLOUD = {
  user: (process.env.ICLOUD_USERNAME || '').trim(),
  pass: (process.env.ICLOUD_APP_PASSWORD || '').replace(/\s+/g, ''),
  base: 'https://caldav.icloud.com',
};
const icloudConfigured = () => !!(ICLOUD.user && ICLOUD.pass);
// Apple app-specific passwords are shown as xxxx-xxxx-xxxx-xxxx. Some setups
// want the dashes, some don't — so we try both and remember which works.
const icloudPassCandidates = () => {
  const seen = new Set(); const out = [];
  for (const p of [ICLOUD.pass, ICLOUD.pass.replace(/-/g, '')]) { if (p && !seen.has(p)) { seen.add(p); out.push(p); } }
  return out;
};
let icloudActivePass = '';
const icloudAuthWith = (pass) => 'Basic ' + Buffer.from(ICLOUD.user + ':' + pass).toString('base64');
const icloudAuth = () => icloudAuthWith(icloudActivePass || ICLOUD.pass);
async function dav(method, url, body, depth, pass) {
  const headers = { authorization: pass ? icloudAuthWith(pass) : icloudAuth() };
  if (body) headers['content-type'] = 'application/xml; charset=utf-8';
  if (depth != null) headers['depth'] = String(depth);
  const r = await fetch(url, { method, headers, body, redirect: 'follow' });
  return { status: r.status, ok: r.ok, text: await r.text(), url: r.url, etag: r.headers.get('etag') };
}
function absUrl(href, baseUrl) {
  if (!href) return null;
  href = href.trim();
  if (/^https?:\/\//.test(href)) return href;
  try { return new URL(baseUrl).origin + href; } catch (_) { return ICLOUD.base + href; }
}
function xmlText(block, tag) { const m = block.match(new RegExp('<[^>]*' + tag + '[^>]*>([\\s\\S]*?)<\\/[^>]*' + tag + '>', 'i')); return m ? m[1].trim() : ''; }

let icloudDisc = { at: 0, data: null };
async function icloudDiscover() {
  if (icloudDisc.data && Date.now() - icloudDisc.at < 30 * 60 * 1000) return icloudDisc.data;
  const principalBody = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
  let p1 = null;
  for (const cand of icloudPassCandidates()) {
    p1 = await dav('PROPFIND', ICLOUD.base + '/', principalBody, 0, cand);
    if (p1.status === 207 || /current-user-principal/i.test(p1.text)) { icloudActivePass = cand; break; }
  }
  if (!p1 || (p1.status !== 207 && !/current-user-principal/i.test(p1.text))) {
    throw new Error(`iCloud auth failed (HTTP ${p1 ? p1.status : '?'}). Check the Apple ID and that the app-specific password is current.`);
  }
  // NOTE: iCloud's PROPFIND responses namespace every element, e.g.
  // <current-user-principal xmlns="DAV:"><href xmlns="DAV:">/…/principal/</href>…
  // and emit <comp name='VEVENT' …/> with SINGLE quotes. The tag/attr-tolerant
  // patterns below ([^>]* after the tag name) handle both styles.
  const principalHref = (p1.text.match(/current-user-principal[\s\S]*?<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i) || [])[1];
  if (!principalHref) throw new Error('iCloud principal not found (HTTP ' + p1.status + ')');
  const principalUrl = absUrl(principalHref, p1.url);
  const p2 = await dav('PROPFIND', principalUrl, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>', 0);
  const homeHref = (p2.text.match(/calendar-home-set[\s\S]*?<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i) || [])[1];
  if (!homeHref) throw new Error('iCloud calendar-home not found');
  const homeUrl = absUrl(homeHref, p2.url);
  const p3 = await dav('PROPFIND', homeUrl, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>', 1);
  const responses = p3.text.match(/<[^>]*response[^>]*>[\s\S]*?<\/[^>]*response>/gi) || [];
  const calendars = [];
  for (const resp of responses) {
    const href = (resp.match(/<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i) || [])[1];
    const comps = (resp.match(/comp\s+name=['"]([^'"]+)['"]/gi) || []).map((s) => s.match(/name=['"]([^'"]+)['"]/i)[1]);
    // Skip non-calendar collections (the /calendars/ home root, scheduling
    // inbox/outbox, notification store). Real calendars have <calendar/> or a
    // subscribed resourcetype; the home root is a bare <collection/>.
    const resType = xmlText(resp, 'resourcetype');
    if (!href || !comps.length || !/calendar|subscribed/i.test(resType)) continue;
    calendars.push({ url: absUrl(href, p3.url), name: xmlText(resp, 'displayname') || 'Calendar', comps });
  }
  icloudDisc = { at: Date.now(), data: { calendars } };
  return icloudDisc.data;
}
// iCalendar helpers
const unfold = (s) => s.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
function icalField(block, name) {
  const m = block.match(new RegExp('^' + name + '(?:;[^:\\n]*)?:(.*)$', 'im'));
  return m ? m[1].trim().replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';') : '';
}
function parseDt(val) {
  if (!val) return null;
  const m = val.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, Y, Mo, D, h, mi, s, z] = m;
  if (h == null) return { date: `${Y}-${Mo}-${D}`, time: '', iso: `${Y}-${Mo}-${D}` };
  const iso = `${Y}-${Mo}-${D}T${h}:${mi}:${s}${z ? 'Z' : ''}`;
  const dt = new Date(iso);
  return { date: `${Y}-${Mo}-${D}`, time: isNaN(dt) ? '' : dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), iso };
}
function durFrom(a, b) { if (!a || !b || !a.iso || !b.iso) return ''; const m = Math.round((new Date(b.iso) - new Date(a.iso)) / 60000); if (isNaN(m) || m <= 0) return ''; return m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`; }
function decodeXml(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

async function icloudReminders() {
  const { calendars } = await icloudDiscover();
  const lists = [];
  for (const cal of calendars.filter((c) => c.comps.includes('VTODO'))) {
    const body = '<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>';
    const r = await dav('REPORT', cal.url, body, 1);
    const responses = r.text.match(/<[^>]*:response>[\s\S]*?<\/[^>]*:response>/gi) || r.text.match(/<response>[\s\S]*?<\/response>/gi) || [];
    const items = [];
    for (const resp of responses) {
      const href = (resp.match(/<[^>]*href>([\s\S]*?)<\/[^>]*href>/i) || [])[1];
      const dataM = resp.match(/<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/i);
      if (!href || !dataM) continue;
      const ics = unfold(decodeXml(dataM[1]));
      const summary = icalField(ics, 'SUMMARY');
      if (!summary) continue;
      const status = icalField(ics, 'STATUS').toUpperCase();
      items.push({ id: icalField(ics, 'UID') || href, href: absUrl(href, cal.url), text: summary, done: status === 'COMPLETED', due: icalField(ics, 'DUE') });
    }
    items.sort((a, b) => Number(a.done) - Number(b.done));
    lists.push({ name: cal.name, items });
  }
  return lists.filter((l) => l.items.length || true);
}
async function icloudEvents(startISO, endISO) {
  const { calendars } = await icloudDiscover();
  const events = [];
  const range = `<c:time-range start="${startISO.replace(/[-:]/g, '').replace(/\.\d+/, '')}" end="${endISO.replace(/[-:]/g, '').replace(/\.\d+/, '')}"/>`;
  for (const cal of calendars.filter((c) => c.comps.includes('VEVENT'))) {
    const body = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">${range}</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const r = await dav('REPORT', cal.url, body, 1);
    const datas = r.text.match(/<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/gi) || [];
    for (const d of datas) {
      const ics = unfold(decodeXml(d.replace(/<[^>]*calendar-data[^>]*>/i, '').replace(/<\/[^>]*calendar-data>/i, '')));
      for (const ve of (ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [])) {
        const summary = icalField(ve, 'SUMMARY'); if (!summary) continue;
        const start = parseDt(icalField(ve, 'DTSTART')); const end = parseDt(icalField(ve, 'DTEND'));
        events.push({ title: summary, date: start?.date || '', time: start?.time || '', iso: start?.iso || '', dur: durFrom(start, end), cal: 'icloud', location: icalField(ve, 'LOCATION') });
      }
    }
  }
  return events;
}
function setIcal(ics, name, value) {
  const re = new RegExp('^' + name + '(?:;[^:\\n]*)?:.*$', 'im');
  if (re.test(ics)) return ics.replace(re, name + ':' + value);
  return ics.replace(/END:VTODO/i, name + ':' + value + '\r\nEND:VTODO');
}
async function icloudToggle(href, done) {
  const g = await dav('GET', href);
  if (!g.ok) return false;
  let ics = g.text;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  if (done) { ics = setIcal(ics, 'STATUS', 'COMPLETED'); ics = setIcal(ics, 'PERCENT-COMPLETE', '100'); ics = setIcal(ics, 'COMPLETED', stamp); }
  else { ics = setIcal(ics, 'STATUS', 'NEEDS-ACTION'); ics = ics.replace(/^COMPLETED(?:;[^:\n]*)?:.*\r?\n/gim, ''); ics = setIcal(ics, 'PERCENT-COMPLETE', '0'); }
  const put = await fetch(href, { method: 'PUT', headers: { authorization: icloudAuth(), 'content-type': 'text/calendar; charset=utf-8', ...(g.etag ? { 'if-match': g.etag } : {}) }, body: ics });
  return put.ok;
}
async function icloudAdd(text) {
  const { calendars } = await icloudDiscover();
  const cal = calendars.find((c) => c.comps.includes('VTODO'));
  if (!cal) return false;
  const uid = 'nexus-' + Date.now() + '@nexus';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//NEXUS//EN\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:${stamp}\r\nSUMMARY:${text.replace(/\r?\n/g, ' ')}\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR`;
  const url = cal.url.replace(/\/?$/, '/') + uid + '.ics';
  const put = await fetch(url, { method: 'PUT', headers: { authorization: icloudAuth(), 'content-type': 'text/calendar; charset=utf-8', 'if-none-match': '*' }, body: ics });
  return put.ok;
}
app.post('/api/todos/toggle', requireAuth, async (req, res) => {
  if (!icloudConfigured()) return res.json({ ok: false });
  try { res.json({ ok: await icloudToggle(req.body.href, !!req.body.done) }); } catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/todos/add', requireAuth, async (req, res) => {
  if (!icloudConfigured() || !req.body.text) return res.json({ ok: false });
  try { res.json({ ok: await icloudAdd(String(req.body.text)) }); } catch (e) { res.json({ ok: false, error: e.message }); }
});
// Diagnostic — tells you exactly what iCloud returns. Open /api/icloud/test while logged in.
app.get('/api/icloud/test', requireAuth, async (req, res) => {
  if (!icloudConfigured()) return res.json({ ok: false, configured: false, note: 'Set ICLOUD_USERNAME and ICLOUD_APP_PASSWORD in .env, then RESTART the server.' });
  try {
    icloudDisc = { at: 0, data: null }; icloudActivePass = '';
    const d = await icloudDiscover();
    res.json({
      ok: true, user: ICLOUD.user, calendarsFound: d.calendars.length,
      reminderLists: d.calendars.filter((c) => c.comps.includes('VTODO')).map((c) => c.name),
      eventCalendars: d.calendars.filter((c) => c.comps.includes('VEVENT')).map((c) => c.name),
    });
  } catch (e) {
    res.json({ ok: false, configured: true, user: ICLOUD.user, error: e.message });
  }
});

/* ============================================================
 *  NEWS — live RSS/Atom aggregation (no dependency parser)
 * ============================================================ */
const DEFAULT_FEEDS = [
  'https://www.tijd.be/rss/top_stories.xml',
  'https://www.knack.be/feed/',
  'https://trends.knack.be/feed/',
  'https://www.ft.com/rss/home',
  'https://www.economist.com/latest/rss.xml',
  'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
];

// friendly source labels for the feed hosts
const SOURCE_LABELS = {
  'tijd.be': 'De Tijd',
  'knack.be': 'Knack',
  'trends.knack.be': 'Trends',
  'ft.com': 'FT',
  'economist.com': 'Economist',
  'nytimes.com': 'NYT',
};
function labelFor(host) {
  const h = host.replace(/^rss\./, '').replace(/^www\./, '');
  if (SOURCE_LABELS[h]) return SOURCE_LABELS[h];
  const base = h.split('.').slice(-2).join('.');
  return SOURCE_LABELS[base] || h;
}

const NAMED_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&nbsp;': ' ', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–',
  '&lsquo;': '‘', '&rsquo;': '’', '&ldquo;': '“', '&rdquo;': '”', '&eacute;': 'é', '&egrave;': 'è',
};
function stripTag(s) {
  return s
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&[a-zA-Z]+;/g, (m) => NAMED_ENTITIES[m.toLowerCase()] || m)
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? stripTag(m[1]) : '';
}
function pickLink(block) {
  // RSS <link>...</link> OR Atom <link href="..."/>
  let m = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (m && stripTag(m[1])) return stripTag(m[1]);
  m = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  return m ? m[1] : '';
}
function parseFeed(xml, sourceHost) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 12)) {
    const title = pick(b, 'title');
    if (!title) continue;
    items.push({
      title,
      link: pickLink(b),
      date: pick(b, 'pubDate') || pick(b, 'updated') || pick(b, 'published') || '',
      source: sourceHost,
    });
  }
  return items;
}

app.get('/api/news', requireAuth, async (req, res) => {
  const feeds = (process.env.NEWS_FEEDS && process.env.NEWS_FEEDS.split(',').map((s) => s.trim()).filter(Boolean)) || DEFAULT_FEEDS;
  const results = await Promise.allSettled(
    feeds.map(async (url) => {
      const r = await fetch(url, { headers: { 'user-agent': 'NexusDashboard/1.0' } });
      const xml = await r.text();
      let host = url;
      try { host = labelFor(new URL(url).hostname); } catch (_) {}
      return parseFeed(xml, host);
    })
  );
  // sort each feed's own items by recency, then round-robin across feeds so
  // every source is represented (a global sort lets the busiest feeds starve others)
  const lists = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)))
    .filter((a) => a.length);
  const items = [];
  for (let round = 0; round < 6; round++) {
    for (const list of lists) if (list[round]) items.push(list[round]);
  }
  res.json({ ok: true, items: items.slice(0, 30) });
});

/* ============================================================
 *  GOODREADS — live currently-reading via shelf RSS
 * ============================================================ */
// Goodreads' shelf RSS does NOT carry reading progress (their API is closed),
// so we let the user set progress manually and persist it here, keyed by book.
const GR_FILE = path.join(__dirname, 'data', 'goodreads-progress.json');
const grRead = () => { try { return JSON.parse(fs.readFileSync(GR_FILE, 'utf8')); } catch (_) { return {}; } };
const grSave = (o) => { try { fs.mkdirSync(path.dirname(GR_FILE), { recursive: true }); fs.writeFileSync(GR_FILE, JSON.stringify(o, null, 2)); } catch (e) { console.warn('goodreads progress not persisted:', e.message); } };

app.get('/api/goodreads', requireAuth, async (req, res) => {
  const url = process.env.GOODREADS_RSS_URL;
  if (!url) return res.json({ ok: false, needsConfig: true });
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'NexusDashboard/1.0' } });
    const xml = await r.text();
    const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    const prog = grRead();
    const books = blocks.slice(0, 8).map((b) => {
      const id = pick(b, 'book_id') || pick(b, 'guid') || pick(b, 'title');
      const coverM = (b.match(/<book_large_image_url>([\s\S]*?)<\/book_large_image_url>/i) || [])[1]
        || (b.match(/<book_image_url>([\s\S]*?)<\/book_image_url>/i) || [])[1] || '';
      return {
        id,
        title: pick(b, 'title'),
        author: pick(b, 'author_name') || pick(b, 'authorName') || '',
        cover: coverM ? stripTag(coverM) : '',
        pages: parseInt(pick(b, 'num_pages'), 10) || 0,
        progress: Math.max(0, Math.min(100, prog[id] || 0)),
      };
    });
    res.json({ ok: true, books });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});
app.post('/api/goodreads/progress', requireAuth, (req, res) => {
  const id = String(req.body.id || '');
  const pct = Math.max(0, Math.min(100, Math.round(Number(req.body.pct) || 0)));
  if (!id) return res.status(400).json({ ok: false });
  const prog = grRead(); prog[id] = pct; grSave(prog);
  res.json({ ok: true, pct });
});

/* ============================================================
 *  DEMO DATA endpoints for credentialed widgets (placeholders).
 *  Each documents the real integration path in the README.
 * ============================================================ */
// To-do list is file-backed so edits persist across restarts.
// Real iCloud Reminders would replace read/write with CalDAV calls.
const TODOS_FILE = path.join(__dirname, 'data', 'todos.json');
const TODOS_SEED = {
  lists: [
    { name: 'Today', items: [
      { id: 't1', text: 'Vaderdag BBQ — pick up at Bellegem 19:30', done: false },
      { id: 't2', text: 'Review KairoDesigns mockups', done: false },
      { id: 't3', text: 'Reply to landlord email', done: true },
    ] },
    { name: 'Project Clean Desk', items: [
      { id: 't4', text: 'Archive Q1 screenshots', done: false },
      { id: 't5', text: 'Sort Propaganda folder', done: false },
    ] },
  ],
};
function readTodos() {
  try { return JSON.parse(fs.readFileSync(TODOS_FILE, 'utf8')); }
  catch (_) { return TODOS_SEED; }
}
function writeTodos(data) {
  try { fs.mkdirSync(path.dirname(TODOS_FILE), { recursive: true }); fs.writeFileSync(TODOS_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.warn('todos not persisted (read-only fs?):', e.message); }
}
app.get('/api/todos', requireAuth, async (req, res) => {
  if (icloudConfigured()) {
    try { const lists = await icloudReminders(); return res.json({ ok: true, source: 'icloud', lists }); }
    catch (e) { return res.json({ ok: true, source: 'local', error: e.message, ...readTodos() }); }
  }
  res.json({ ok: true, source: 'local', ...readTodos() });
});
app.post('/api/todos', requireAuth, (req, res) => {
  // client sends the full {lists:[...]} state; we persist it.
  const lists = Array.isArray(req.body.lists) ? req.body.lists : null;
  if (!lists) return res.status(400).json({ ok: false, error: 'lists required' });
  writeTodos({ lists });
  res.json({ ok: true });
});

function demoAgenda() {
  const pad = (n) => String(n).padStart(2, '0');
  const day = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const mk = (off, time, title, cal, dur, location = '') => ({ date: day(off), time, title, cal, dur, location, iso: `${day(off)}T${time}:00` });
  return [
    mk(0, '09:30', 'Standup — Tijdlijn Tool', 'outlook', '30m'),
    mk(0, '13:00', 'Lunch w/ design team', 'icloud', '1h', 'Ghent'),
    mk(0, '16:00', 'BNP call — mortgage', 'outlook', '45m'),
    mk(0, '19:30', 'Vaderdag BBQ — Bellegem', 'icloud', '2h', 'Bellegem'),
    mk(1, '10:00', 'Sprint review', 'outlook', '1h'),
    mk(1, '18:00', 'Gym', 'icloud', '1h'),
    mk(2, '11:00', 'Dentist', 'icloud', '30m', 'Kortrijk'),
    mk(3, '14:00', 'KairoDesigns client call', 'outlook', '1h'),
    mk(5, '20:00', 'Concert — AB Brussels', 'icloud', '3h', 'Brussels'),
  ];
}
app.get('/api/agenda', requireAuth, async (req, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 42 * 864e5); // ~6 weeks, enough for the month view
  let events = []; let live = false; let icloudError;
  // personal Outlook only (professional needs admin approval)
  if (msConnected('personal')) { const ev = await msEvents('personal', start, end); if (ev) { events = events.concat(ev); live = true; } }
  if (icloudConfigured()) {
    try { const ev = await icloudEvents(start.toISOString(), end.toISOString()); if (ev && ev.length) { events = events.concat(ev); live = true; } }
    catch (e) { icloudError = e.message; }
  }
  if (!live) events = demoAgenda();
  events.sort((a, b) => ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')));
  res.json({ ok: true, demo: !live, events, icloudError });
});

const DEMO_MAIL = {
  professional: [
        { id: 'm1', from: 'Anke V.', email: 'anke@tijdlijn.app', subject: 'Re: Tijdlijn Tool sprint review', preview: 'Looks good — one note on the…', unread: true, time: '08:41',
          body: 'Hi Michel,\n\nReviewed the build — looks good. One note on the auth gate: can we make the session timeout configurable? 7 days feels long for the admin panel.\n\nAlso, the sprint review is moved to 11:00.\n\nThanks,\nAnke' },
        { id: 'm2', from: 'Jira', email: 'no-reply@jira.com', subject: '[NEXUS-204] assigned to you', preview: 'Build the auth gate for…', unread: true, time: '07:55',
          body: 'NEXUS-204 has been assigned to you by Anke V.\n\nSummary: Build the auth gate for the dashboard.\nPriority: High\nSprint: 24.6\n\nView issue in Jira.' },
        { id: 'm3', from: 'Bram', email: 'bram@studio.be', subject: 'Invoice May', preview: 'Attached is the…', unread: false, time: 'Yest',
          body: 'Hey,\n\nAttached is the invoice for May. Let me know if anything looks off.\n\nCheers,\nBram' },
  ],
  personal: [
    { id: 'm4', from: 'Goodreads', email: 'updates@goodreads.com', subject: 'New from authors you follow', preview: '3 new releases this week', unread: true, time: '06:20',
      body: 'Authors you follow have 3 new releases this week. Tap to see them on your shelf.' },
    { id: 'm5', from: 'BNP Paribas Fortis', email: 'no-reply@bnpparibasfortis.be', subject: 'Your monthly statement', preview: 'Your statement is ready', unread: false, time: 'Fri',
      body: 'Your monthly statement is ready to view in Easy Banking. Log in to download the PDF.' },
  ],
};
app.get('/api/mail', requireAuth, async (req, res) => {
  const accounts = {};
  const connected = {};
  for (const slot of ['professional', 'personal']) {
    if (msConnected(slot)) {
      const live = await msMail(slot);
      accounts[slot] = live && live.length ? live : DEMO_MAIL[slot];
      connected[slot] = !!live;
    } else {
      accounts[slot] = DEMO_MAIL[slot];
      connected[slot] = false;
    }
  }
  res.json({ ok: true, demo: !connected.professional && !connected.personal, connected, accounts });
});

// Reply: real send via Graph when that account is connected, else demo echo.
app.post('/api/mail/reply', requireAuth, async (req, res) => {
  const { to, subject, body } = req.body || {};
  const slot = msSlot(req.body.slot);
  if (!body) return res.status(400).json({ ok: false, error: 'empty reply' });
  if (msConnected(slot)) {
    const sent = await msSendReply(slot, to, subject, body);
    return res.json({ ok: sent, demo: false, error: sent ? undefined : 'Graph send failed' });
  }
  console.log(`  ▸ [demo] reply queued → ${to} | ${subject}`);
  res.json({ ok: true, demo: true, sent: { to, subject, body, at: new Date().toISOString() } });
});

app.get('/api/finance', requireAuth, (req, res) => {
  res.json({
    ok: true,
    demo: true,
    currency: 'EUR',
    balance: 8421.57,
    accounts: [
      { name: 'Checking', balance: 3120.4 },
      { name: 'Savings', balance: 5012.0 },
      { name: 'Credit', balance: -289.17 },
    ],
    monthSpend: 1843.22,
    monthBudget: 2500,
    categories: [
      { name: 'Groceries', value: 412 },
      { name: 'Transport', value: 188 },
      { name: 'Dining', value: 254 },
      { name: 'Subscriptions', value: 96 },
      { name: 'Home', value: 893 },
    ],
    trend: [220, 180, 90, 310, 140, 60, 210, 280, 120, 70, 160, 240, 90, 130],
  });
});

app.get('/api/traffic', requireAuth, (req, res) => {
  res.json({
    ok: true,
    demo: true,
    range: '7d',
    sites: [
      { domain: 'kairodesigns.be', visitors: 4821, change: 12.4, series: [320, 410, 380, 520, 610, 700, 881] },
      { domain: 'tempus.app', visitors: 2190, change: -3.1, series: [410, 360, 330, 300, 280, 260, 250] },
      { domain: 'bouckaert.dev', visitors: 932, change: 28.7, series: [80, 95, 110, 130, 160, 175, 182] },
    ],
  });
});

/* ============================================================
 *  UKRAINE FRONT — DeepStateMAP (occupied/liberated) + air alerts
 *  Open-source intelligence, not official. Sourced + dated in UI.
 * ============================================================ */
// DeepState fill colors → our categories
const DS_OCCUPIED = new Set(['#a52714', '#ff5252', '#880e4f', '#bcaaa4']); // russian-controlled / contested / unknown
const DS_LIBERATED = new Set(['#0f9d58']); // retaken by Ukraine
let warCache = { at: 0, data: null };
app.get('/api/warmap', requireAuth, async (req, res) => {
  try {
    if (warCache.data && Date.now() - warCache.at < 30 * 60 * 1000) return res.json(warCache.data);
    const r = await fetch('https://deepstatemap.live/api/history/last', { headers: { 'user-agent': 'NexusDashboard/1.0' } });
    const j = await r.json();
    const round = (n) => Math.round(n * 1000) / 1000;
    const out = [];
    for (const f of (j.map?.features || [])) {
      if (f.geometry?.type !== 'Polygon') continue;
      const fill = (f.properties?.fill || '').toLowerCase();
      let cat = null;
      if (DS_OCCUPIED.has(fill)) cat = 'occupied';
      else if (DS_LIBERATED.has(fill)) cat = 'liberated';
      else continue; // skip water/other tiny polygons
      const ring = f.geometry.coordinates[0].map((c) => [round(c[1]), round(c[0])]); // [lat,lng]
      if (ring.length > 3) out.push({ cat, ring });
    }
    const data = { ok: true, datetime: j.datetime || '', source: 'DeepStateMAP', polygons: out };
    warCache = { at: Date.now(), data };
    res.json(data);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// oblast centroids keyed by alerts.com.ua state id (1..25)
const OBLAST_CENTROIDS = {
  1: [49.23, 28.47], 2: [50.85, 25.0], 3: [48.46, 34.6], 4: [48.3, 37.6], 5: [50.4, 28.6],
  6: [48.4, 23.0], 7: [47.5, 35.2], 8: [48.6, 24.6], 9: [50.2, 30.4], 10: [48.4, 32.2],
  11: [48.9, 38.6], 12: [49.6, 23.9], 13: [47.4, 31.6], 14: [46.6, 30.6], 15: [49.6, 34.0],
  16: [50.7, 26.2], 17: [50.9, 34.0], 18: [49.4, 25.7], 19: [49.8, 36.4], 20: [46.7, 33.0],
  21: [49.3, 27.1], 22: [49.3, 31.9], 23: [48.4, 25.9], 24: [51.2, 31.6], 25: [50.45, 30.52],
};
let alertCache = { at: 0, data: null };
app.get('/api/waralerts', requireAuth, async (req, res) => {
  try {
    if (alertCache.data && Date.now() - alertCache.at < 60 * 1000) return res.json(alertCache.data);
    const r = await fetch('https://alerts.com.ua/api/states', { headers: { 'user-agent': 'NexusDashboard/1.0' } });
    const j = await r.json();
    const active = (j.states || []).filter((s) => s.alert).map((s) => ({
      id: s.id, name: (s.name_en || '').replace(/ oblast$/i, ''), at: OBLAST_CENTROIDS[s.id] || null,
    }));
    const data = { ok: true, count: active.length, alerts: active };
    alertCache = { at: Date.now(), data };
    res.json(data);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/* ============================================================
 *  SPOTIFY — OAuth + playlist picker (plays via embed)
 * ============================================================ */
const SPOTIFY = {
  clientId: process.env.SPOTIFY_CLIENT_ID || '',
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  redirect: process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${PORT}/auth/spotify/callback`,
  scope: 'playlist-read-private playlist-read-collaborative user-read-email',
};
const spotifyConfigured = () => !!(SPOTIFY.clientId && SPOTIFY.clientSecret);
const SPOT_FILE = path.join(__dirname, 'data', 'spotify.json');
const spotRead = () => { try { return JSON.parse(fs.readFileSync(SPOT_FILE, 'utf8')); } catch (_) { return null; } };
const spotSave = (d) => { try { fs.mkdirSync(path.dirname(SPOT_FILE), { recursive: true }); fs.writeFileSync(SPOT_FILE, JSON.stringify(d, null, 2)); } catch (e) { console.warn('spotify token not persisted:', e.message); } };
const spotConnected = () => !!spotRead();
async function spotToken() {
  let t = spotRead();
  if (!t) return null;
  if (Date.now() < t.expires_at - 60000) return t.access_token;
  if (!t.refresh_token) return null;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(SPOTIFY.clientId + ':' + SPOTIFY.clientSecret).toString('base64') },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token }).toString(),
  });
  const d = await r.json();
  if (d.access_token) { t = { ...t, ...d, expires_at: Date.now() + (d.expires_in || 3600) * 1000 }; spotSave(t); return t.access_token; }
  return null;
}
const spotStates = new Set();
app.get('/auth/spotify/login', requireAuth, (req, res) => {
  if (!spotifyConfigured()) return res.status(400).send('Spotify app not configured. Add SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET to .env, then restart.');
  const state = crypto.randomBytes(10).toString('hex'); spotStates.add(state); setTimeout(() => spotStates.delete(state), 6e5);
  const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: SPOTIFY.clientId, response_type: 'code', redirect_uri: SPOTIFY.redirect, scope: SPOTIFY.scope, state,
  }).toString();
  res.redirect(url);
});
app.get('/auth/spotify/callback', requireAuth, async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(`Spotify sign-in error: ${error}. <a href="/">back</a>`);
  if (!code || !spotStates.has(state)) return res.send('Invalid Spotify sign-in state. <a href="/">back</a>');
  spotStates.delete(state);
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(SPOTIFY.clientId + ':' + SPOTIFY.clientSecret).toString('base64') },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: String(code), redirect_uri: SPOTIFY.redirect }).toString(),
  });
  const d = await r.json();
  if (!d.access_token) return res.send(`Spotify token exchange failed: ${d.error_description || d.error || 'unknown'}. <a href="/">back</a>`);
  spotSave({ ...d, expires_at: Date.now() + (d.expires_in || 3600) * 1000 });
  res.redirect('/?spotify=connected');
});
app.post('/auth/spotify/disconnect', requireAuth, (req, res) => { try { fs.unlinkSync(SPOT_FILE); } catch (_) {} res.json({ ok: true }); });
app.get('/api/spotify/playlists', requireAuth, async (req, res) => {
  if (!spotConnected()) return res.json({ ok: false, needsConnect: true, configured: spotifyConfigured() });
  const at = await spotToken();
  if (!at) return res.json({ ok: false, needsConnect: true, configured: spotifyConfigured() });
  const r = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', { headers: { authorization: `Bearer ${at}` } });
  const d = await r.json();
  if (!r.ok) return res.json({ ok: false, error: d.error?.message || 'spotify error' });
  const playlists = (d.items || []).map((p) => ({ id: p.id, name: p.name, tracks: p.tracks?.total || 0, image: p.images?.[0]?.url || '' }));
  res.json({ ok: true, playlists });
});

/* ---------- fallback ---------- */
app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// Only start a listener when run directly (`node server.js`).
// When imported (e.g. by a Vercel serverless function), just export the app.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  ▓ NEXUS DASHBOARD online → http://localhost:${PORT}`);
    console.log(`  ▓ Login: ${EMAIL}`);
    console.log(`  ▓ AI providers configured: ${['claude','openai','perplexity','gemini'].filter(p=>{
      return p==='claude'?process.env.ANTHROPIC_API_KEY:p==='openai'?process.env.OPENAI_API_KEY:p==='perplexity'?process.env.PERPLEXITY_API_KEY:process.env.GEMINI_API_KEY;
    }).join(', ') || 'none (add keys to .env)'}\n`);
  });
}

module.exports = app;
