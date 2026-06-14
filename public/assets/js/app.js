/* ============================================================
   NEXUS DASHBOARD — front-end controller
   ============================================================ */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = async (path, opts) => {
    const r = await fetch(path, opts);
    if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); }
    return r.json();
  };

  /* ---------- theme switcher ---------- */
  const THEME_VIZ = {
    'tech':        { cyan: '46,242,224',  amber: '255,178,74',  magenta: '255,77,141' },
    'white-gold':  { cyan: '184,146,60',  amber: '212,175,55',  magenta: '192,138,90' },
    'dark-classy': { cyan: '201,162,110', amber: '224,184,122', magenta: '176,122,82' },
  };
  function applyTheme(name) {
    if (!THEME_VIZ[name]) name = 'tech';
    document.body.setAttribute('data-theme', name);
    if (window.NexusVisuals && NexusVisuals.setTheme) NexusVisuals.setTheme(THEME_VIZ[name]);
    try { localStorage.setItem('nexus.theme', name); } catch (_) {}
    const sel = $('#themeSelect'); if (sel && sel.value !== name) sel.value = name;
  }
  let savedTheme = 'tech';
  try { savedTheme = localStorage.getItem('nexus.theme') || 'tech'; } catch (_) {}
  applyTheme(savedTheme);
  { const sel = $('#themeSelect'); if (sel) sel.addEventListener('change', () => applyTheme(sel.value)); }

  /* ---------- background + visual canvases ---------- */
  NexusVisuals.particleField($('#bg-canvas'));
  document.querySelectorAll('canvas[data-viz]').forEach((c) => {
    const fn = NexusVisuals[c.dataset.viz];
    if (fn) fn(c);
  });

  /* ---------- clock + telemetry ---------- */
  function tick() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    $('#clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    $('#date').textContent = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  }
  tick(); setInterval(tick, 1000);

  // animated "cognitive core" load + latency flicker
  let load = 42;
  setInterval(() => {
    load += (Math.random() - 0.5) * 8; load = Math.max(18, Math.min(96, load));
    const cl = $('#coreLoad'); if (cl) cl.textContent = Math.round(load) + '%';
    const lat = $('#lat'); if (lat) lat.textContent = (8 + Math.round(Math.random() * 18)) + 'ms';
  }, 1400);

  /* ---------- session ---------- */
  api('/api/me').then((m) => {
    if (m.ok) {
      $('#userEmail').textContent = m.user.email;
      $('#sesId').textContent = Math.random().toString(16).slice(2, 6).toUpperCase();
    }
  });
  $('#logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login';
  });

  /* ---------- fullscreen ---------- */
  const fsBtn = $('#fullscreen');
  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)
        .call(document.documentElement).catch(() => {});
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = document.fullscreenElement ? '⛶ EXIT' : '⛶ FULL';
  });

  /* ---------- toast + modal helpers ---------- */
  function toast(msg) {
    const t = el('div', 'toast', esc(msg));
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2600);
  }
  function openModal(buildFn) {
    const bg = el('div', 'modal-bg');
    const modal = el('div', 'modal');
    bg.appendChild(modal);
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
    buildFn(modal, close);
    document.body.appendChild(bg);
    return close;
  }

  /* ============================================================
     AI CONSOLE — live chat, 4 providers
     ============================================================ */
  const PROVIDERS = [
    { id: 'claude', name: 'Claude', web: 'https://claude.ai/new', prefill: false },
    { id: 'openai', name: 'ChatGPT', web: 'https://chatgpt.com/?q=', prefill: true },
    { id: 'perplexity', name: 'Perplexity', web: 'https://www.perplexity.ai/search?q=', prefill: true },
    { id: 'gemini', name: 'Gemini', web: 'https://gemini.google.com/app', prefill: false },
  ];
  const KEY_HINT = {
    claude: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    perplexity: 'PERPLEXITY_API_KEY',
    gemini: 'GEMINI_API_KEY',
  };
  const prov = (id) => PROVIDERS.find((p) => p.id === id);
  let activeProvider = 'claude';
  const histories = { claude: [], openai: [], perplexity: [], gemini: [] };
  let providerOn = {};

  function renderAiTabs() {
    const wrap = $('#aiTabs'); wrap.innerHTML = '';
    PROVIDERS.forEach((p) => {
      const on = providerOn[p.id];
      const t = el('div', `ai-tab ${on ? 'on' : 'off'} ${p.id === activeProvider ? 'active' : ''}`,
        `<span class="pd"></span>${p.name}`);
      t.addEventListener('click', () => { activeProvider = p.id; renderAiTabs(); renderAiLog(); updateHint(); });
      wrap.appendChild(t);
    });
  }
  function updateHint() {
    const p = prov(activeProvider);
    const on = providerOn[activeProvider];
    $('#aiHint').innerHTML = on
      ? `<b>OPEN ↗</b> uses your ${p.name} subscription (no extra cost) · <b>SEND</b> answers inline via API (paid per use)`
      : `<b>OPEN ↗</b> uses your ${p.name} subscription (no extra cost) · <b>SEND</b> needs <code>${KEY_HINT[activeProvider]}</code> in .env`;
  }
  function renderAiLog() {
    const log = $('#aiLog'); log.innerHTML = '';
    const h = histories[activeProvider];
    if (!h.length) {
      log.appendChild(el('div', 'msg sys', `▸ ${prov(activeProvider).name}. Type a prompt, then OPEN ↗ (free) or SEND (API).`));
    } else {
      h.forEach((m) => log.appendChild(el('div', `msg ${m.role === 'user' ? 'user' : 'bot'}`, esc(m.content))));
    }
    log.scrollTop = log.scrollHeight;
  }

  // OPEN ↗ — launch the provider's web app in a new tab (uses the
  // subscription, no API cost). These sites block iframe embedding.
  $('#aiOpen').addEventListener('click', async () => {
    const p = prov(activeProvider);
    const text = $('#aiInput').value.trim();
    let url = p.web;
    if (text && p.prefill) {
      url = p.web + encodeURIComponent(text);
    } else if (text) {
      try { await navigator.clipboard.writeText(text); toast('Prompt copied — paste it into the ' + p.name + ' tab'); } catch (_) {}
    }
    window.open(url, '_blank', 'noopener');
  });

  // SEND — inline answer via API (metered)
  $('#aiForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#aiInput');
    const text = input.value.trim();
    if (!text) return;
    if (!providerOn[activeProvider]) {
      toast('No API key for ' + prov(activeProvider).name + ' — use OPEN ↗, or add ' + KEY_HINT[activeProvider]);
      return;
    }
    input.value = '';
    const h = histories[activeProvider];
    h.push({ role: 'user', content: text });
    renderAiLog();
    const log = $('#aiLog');
    const thinking = el('div', 'msg bot', '<span class="spin">▮▮▮</span>');
    log.appendChild(thinking); log.scrollTop = log.scrollHeight;
    try {
      const res = await api('/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: activeProvider, message: text, history: h.slice(0, -1) }),
      });
      thinking.remove();
      if (res.ok) {
        h.push({ role: 'assistant', content: res.text });
      } else if (res.needsKey) {
        log.appendChild(el('div', 'msg sys', `Not connected — add <code>${KEY_HINT[activeProvider]}</code> to .env`));
      } else {
        log.appendChild(el('div', 'msg sys', '⚠ ' + esc(res.error || 'error')));
      }
      renderAiLog();
    } catch (_) {
      thinking.remove();
      log.appendChild(el('div', 'msg sys', '⚠ connection error'));
    }
  });

  /* ============================================================
     CONFIG (drives badges + provider lights)
     ============================================================ */
  api('/api/config').then((c) => {
    if (!c.ok) return;
    providerOn = c.providers || {};
    const anyOn = Object.values(providerOn).some(Boolean);
    $('#aiMeta').innerHTML = `<span class="badge ${anyOn ? 'live' : 'off'}">${anyOn ? 'API live' : 'launch mode'}</span>`;
    renderAiTabs(); renderAiLog(); updateHint();
    loadGoodreads(c.goodreads);
    loadSpotify(c);
    msConfig = c.ms || { configured: false };
    if (mailData) renderMail();
  });

  // returning from a Microsoft / Spotify sign-in
  (function () {
    const m = location.search.match(/[?&]connected=(professional|personal)/);
    if (m) { toast('Connected ' + m[1] + ' Outlook account ✓'); history.replaceState({}, '', '/'); }
    if (/[?&]spotify=connected/.test(location.search)) { toast('Spotify connected ✓'); history.replaceState({}, '', '/'); }
  })();

  /* ============================================================
     NEWS (live)
     ============================================================ */
  api('/api/news').then((n) => {
    const box = $('#news'); box.innerHTML = '';
    if (!n.ok || !n.items.length) { box.innerHTML = '<div class="empty">No feed items.</div>'; $('#newsMeta').innerHTML = '<span class="badge off">offline</span>'; return; }
    $('#newsMeta').innerHTML = '<span class="badge live">live</span>';
    n.items.slice(0, 14).forEach((it) => {
      const row = el('div', 'news',
        `<span class="src">${esc(it.source)}</span><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a>`);
      box.appendChild(row);
    });
  }).catch(() => { $('#news').innerHTML = '<div class="empty">Feed error.</div>'; });

  /* ============================================================
     AGENDA (demo → CalDAV/Graph)
     ============================================================ */
  let agendaEvents = [], agendaMode = 'day', selectedDay = null;
  const AGENDA_MODES = [['day', 'Today'], ['week', 'Week'], ['month', 'Month'], ['list', 'All']];
  const eventsOn = (ds) => agendaEvents.filter((e) => e.date === ds);
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayStr = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  function fmtDateLabel(ds) {
    if (ds === dayStr(0)) return 'Today';
    if (ds === dayStr(1)) return 'Tomorrow';
    const d = new Date(ds + 'T00:00:00');
    return isNaN(d) ? ds : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  }
  function evtRow(e) {
    const isI = String(e.cal || '').startsWith('icloud');
    const row = el('div', 'evt'); row.style.cursor = 'pointer';
    row.innerHTML = `<span class="t">${esc(e.time || '—')}</span>
       <div class="body"><div class="ttl">${esc(e.title)}</div><div class="sub">${esc(e.dur || '')}${e.location ? ' · ' + esc(e.location) : ''}</div></div>
       <span class="tag ${isI ? 'icloud' : 'outlook'}">${isI ? 'iCloud' : 'Outlook'}</span>`;
    row.addEventListener('click', () => openEvent(e));
    return row;
  }
  function openEvent(e) {
    openModal((modal, close) => {
      const isI = String(e.cal || '').startsWith('icloud');
      modal.innerHTML = `<div class="mh"><h3>${esc(e.title)}</h3><span class="x" title="close">✕</span></div>
        <div class="meta-row">${esc(fmtDateLabel(e.date))} · ${esc(e.time || 'all day')}${e.dur ? ' · ' + esc(e.dur) : ''}</div>
        <div class="mbody">Calendar: ${isI ? 'iCloud' : 'Outlook'}${e.location ? '\nLocation: ' + esc(e.location) : ''}</div>`;
      modal.querySelector('.x').addEventListener('click', close);
    });
  }
  function renderAgendaModes() {
    const wrap = $('#agendaModes'); wrap.innerHTML = '';
    AGENDA_MODES.forEach(([id, label]) => {
      const t = el('div', `tab ${id === agendaMode ? 'active' : ''}`, label);
      t.addEventListener('click', () => { agendaMode = id; renderAgendaModes(); renderAgenda(); });
      wrap.appendChild(t);
    });
  }
  function renderMonth() {
    const box = $('#agenda'); box.innerHTML = '';
    const now = new Date(); const y = now.getFullYear(), mo = now.getMonth();
    box.appendChild(el('div', 'cal-title', now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })));
    const grid = el('div', 'cal-grid');
    ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].forEach((d) => grid.appendChild(el('div', 'cal-h', d)));
    const startDow = (new Date(y, mo, 1).getDay() + 6) % 7; // Monday-first
    const ndays = new Date(y, mo + 1, 0).getDate();
    for (let i = 0; i < startDow; i++) grid.appendChild(el('div', 'cal-cell empty-cell'));
    const today = dayStr(0);
    for (let d = 1; d <= ndays; d++) {
      const ds = `${y}-${pad2(mo + 1)}-${pad2(d)}`;
      const cell = el('div', 'cal-cell');
      if (ds === today) cell.classList.add('today');
      if (ds === selectedDay) cell.classList.add('sel');
      const has = eventsOn(ds).length;
      cell.innerHTML = `<span class="dn">${d}</span>${has ? '<span class="cal-dot"></span>' : ''}`;
      if (has) { cell.classList.add('has'); cell.addEventListener('click', () => { selectedDay = ds; renderMonth(); }); }
      grid.appendChild(cell);
    }
    box.appendChild(grid);
    const sel = selectedDay || today;
    const list = el('div'); list.style.marginTop = '12px';
    list.appendChild(el('div', 'list-sub', fmtDateLabel(sel)));
    const evs = eventsOn(sel);
    if (!evs.length) list.appendChild(el('div', 'empty', 'No events.'));
    else evs.forEach((e) => list.appendChild(evtRow(e)));
    box.appendChild(list);
  }
  function renderAgenda() {
    if (agendaMode === 'month') return renderMonth();
    const box = $('#agenda'); box.innerHTML = '';
    let evs = agendaEvents.slice();
    if (agendaMode === 'day') evs = evs.filter((e) => e.date === dayStr(0));
    else if (agendaMode === 'week') { const end = dayStr(7); evs = evs.filter((e) => e.date >= dayStr(0) && e.date <= end); }
    if (!evs.length) { box.innerHTML = '<div class="empty">No events in this view.</div>'; return; }
    if (agendaMode === 'day') { evs.forEach((e) => box.appendChild(evtRow(e))); return; }
    const groups = {};
    evs.forEach((e) => { (groups[e.date] = groups[e.date] || []).push(e); });
    Object.keys(groups).sort().forEach((ds) => {
      box.appendChild(el('div', 'list-sub', esc(fmtDateLabel(ds))));
      groups[ds].forEach((e) => box.appendChild(evtRow(e)));
    });
  }
  api('/api/agenda').then((a) => {
    agendaEvents = a.events || [];
    const badge = $('#agendaBadge');
    if (!a.demo) { badge.className = 'badge live'; badge.textContent = 'live'; }
    if (a.icloudError) { badge.className = 'badge demo'; badge.textContent = 'iCloud ✕'; badge.title = a.icloudError; }
    renderAgendaModes(); renderAgenda();
  });

  /* ============================================================
     MARKETS — TradingView Advanced Chart + watchlist (interactive).
     Symbols mirror Michel's Apple Stocks list; search/switch live
     inside the widget. Theme follows the dashboard theme.
     ============================================================ */
  (function initMarkets() {
    const box = $('#markets'), badge = $('#mktBadge');
    if (!box) return;
    const WATCHLIST = ['TVC:DJI', 'NASDAQ:AAPL', 'NYSE:NKE', 'EURONEXT:ROU'];
    const tvTheme = () => (document.body.getAttribute('data-theme') === 'white-gold' ? 'light' : 'dark');
    function build() {
      box.innerHTML = '';
      const container = el('div', 'tradingview-widget-container');
      container.style.cssText = 'height:100%;width:100%';
      const widget = el('div', 'tradingview-widget-container__widget');
      widget.style.cssText = 'height:100%;width:100%';
      container.appendChild(widget);
      box.appendChild(container);
      const cfg = {
        autosize: true,
        symbol: 'NASDAQ:AAPL',
        interval: 'D',
        timezone: 'Europe/Brussels',
        theme: tvTheme(),
        style: '1',
        locale: 'en',
        withdateranges: true,
        hide_side_toolbar: false,
        allow_symbol_change: true,
        watchlist: WATCHLIST,
        details: false,
        calendar: false,
        support_host: 'https://www.tradingview.com',
      };
      const sc = document.createElement('script');
      sc.type = 'text/javascript';
      sc.async = true;
      sc.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
      sc.innerHTML = JSON.stringify(cfg);
      container.appendChild(sc);
      if (badge) { badge.className = 'badge live'; badge.textContent = 'TradingView'; }
    }
    build();
    // Rebuild so the chart's light/dark matches the dashboard theme.
    let lastTheme = document.body.getAttribute('data-theme');
    const sel = $('#themeSelect');
    if (sel) sel.addEventListener('change', () => setTimeout(() => {
      const t = document.body.getAttribute('data-theme');
      if (t !== lastTheme) { lastTheme = t; build(); }
    }, 60));
  })();

  /* ============================================================
     MAIL (demo → Microsoft Graph)
     ============================================================ */
  let mailData = null, mailTab = 'personal', mailConnected = {}, msConfig = { configured: false };
  function openMail(mail) {
    openModal((modal, close) => {
      modal.innerHTML =
        `<div class="mh"><h3>${esc(mail.subject)}</h3><span class="x" title="close">✕</span></div>
         <div class="meta-row">From ${esc(mail.from)} &lt;${esc(mail.email || '')}&gt; · ${esc(mail.time)}</div>
         <div class="mbody">${esc(mail.body || mail.preview)}</div>
         <textarea placeholder="Reply to ${esc(mail.from)}…"></textarea>
         <div class="mactions"><button class="btn-primary" data-send>SEND REPLY ▸</button><button class="btn-ghost" data-cancel>CLOSE</button></div>`;
      modal.querySelector('.x').addEventListener('click', close);
      modal.querySelector('[data-cancel]').addEventListener('click', close);
      const ta = modal.querySelector('textarea'); ta.focus();
      modal.querySelector('[data-send]').addEventListener('click', async () => {
        const body = ta.value.trim();
        if (!body) { toast('Write a reply first'); return; }
        try {
          const r = await api('/api/mail/reply', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slot: mailTab, to: mail.email, subject: 'Re: ' + mail.subject, body }),
          });
          if (r.ok) {
            mail.unread = false; mail.replied = true;
            toast(r.demo ? 'Reply queued (demo) — connect Outlook to actually send' : 'Reply sent');
            close(); renderMail();
          } else toast('Could not send');
        } catch (_) { toast('Connection error'); }
      });
    });
  }
  function renderMail() {
    const listBox = $('#mailList'); listBox.innerHTML = '';
    // connect bar for this account slot
    if (msConfig.configured && !mailConnected[mailTab]) {
      const bar = el('div', 'connect-bar');
      bar.innerHTML = `<span>Showing demo mail.</span><button class="mini-btn">⚇ Connect ${mailTab} Outlook</button>`;
      bar.querySelector('button').addEventListener('click', () => { location.href = '/auth/ms/login?slot=' + mailTab; });
      listBox.appendChild(bar);
    } else if (mailConnected[mailTab]) {
      const bar = el('div', 'connect-bar');
      bar.innerHTML = `<span style="color:var(--green)">● live</span><button class="mini-btn" data-dc>disconnect</button>`;
      bar.querySelector('[data-dc]').addEventListener('click', async () => {
        await fetch('/auth/ms/disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: mailTab }) });
        toast('Disconnected ' + mailTab + ' Outlook'); location.reload();
      });
      listBox.appendChild(bar);
    }
    (mailData[mailTab] || []).forEach((mail) => {
      const row = el('div', `mail ${mail.unread ? 'unread' : ''}`);
      row.innerHTML =
        `<div class="row1"><span class="from">${esc(mail.from)}</span><span class="time">${esc(mail.time)}</span><span class="mail-del" title="Delete">✕</span></div>
         <div class="subj">${esc(mail.subject)}${mail.replied ? ' · <span style="color:var(--green)">replied</span>' : ''}</div>
         <div class="prev">${esc(mail.preview)}</div>`;
      row.addEventListener('click', () => { mail.unread = false; openMail(mail); renderMail(); });
      row.querySelector('.mail-del').addEventListener('click', (e) => { e.stopPropagation(); deleteMail(mail); });
      listBox.appendChild(row);
    });
  }
  async function deleteMail(mail) {
    const list = mailData[mailTab] || [];
    const i = list.indexOf(mail);
    if (i === -1) return;
    list.splice(i, 1); // optimistic removal
    renderMail();
    try {
      const r = await api('/api/mail/delete', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot: mailTab, id: mail.id }),
      });
      if (!r.ok) { list.splice(i, 0, mail); renderMail(); toast('Delete failed'); }
      else toast(r.demo ? 'Removed (demo)' : 'Moved to Deleted Items');
    } catch (_) { list.splice(i, 0, mail); renderMail(); toast('Delete failed'); }
  }
  api('/api/mail').then((m) => {
    mailData = m.accounts;
    mailConnected = m.connected || {};
    const box = $('#mail'); box.innerHTML = '';
    const listBox = el('div'); listBox.id = 'mailList'; box.appendChild(listBox);
    renderMail();
  });

  /* ============================================================
     WEB TRAFFIC (demo → Plausible/Umami/GA4)
     ============================================================ */
  api('/api/traffic').then((t) => {
    const box = $('#traffic'); box.innerHTML = '';
    (t.sites || []).forEach((s) => {
      const row = el('div', 'site');
      row.innerHTML = `<span class="dom">${esc(s.domain)}</span><canvas class="spark"></canvas>
        <span class="vis">${s.visitors.toLocaleString()}</span>
        <span class="chg ${s.change >= 0 ? 'up' : 'down'}">${s.change >= 0 ? '▲' : '▼'}${Math.abs(s.change)}%</span>`;
      box.appendChild(row);
      NexusVisuals.sparkline(row.querySelector('canvas'), s.series, s.change >= 0 ? NexusVisuals.COLORS.CYAN : NexusVisuals.COLORS.MAGENTA);
    });
  });

  /* ============================================================
     GOODREADS (live RSS if configured, else demo)
     ============================================================ */
  function loadGoodreads(configured) {
    const box = $('#goodreads');
    if (!configured) {
      $('#grBadge').className = 'badge demo'; $('#grBadge').textContent = 'demo';
      const demo = [
        { title: 'Neuromancer', author: 'William Gibson', pct: 64 },
        { title: 'Project Hail Mary', author: 'Andy Weir', pct: 28 },
        { title: 'The Dawn of Everything', author: 'Graeber & Wengrow', pct: 12 },
      ];
      box.innerHTML = '';
      demo.forEach((b) => {
        const row = el('div', 'book');
        row.innerHTML = `<div class="cov"></div><div class="info">
          <div class="bt">${esc(b.title)}</div><div class="ba">${esc(b.author)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${b.pct}%"></div></div></div>`;
        box.appendChild(row);
      });
      box.appendChild(el('div', 'empty', 'Add <code>GOODREADS_RSS_URL</code> to .env for live shelf data.'));
      return;
    }
    api('/api/goodreads').then((g) => {
      box.innerHTML = '';
      if (!g.ok || !(g.books || []).length) { box.innerHTML = '<div class="empty">No books on shelf.</div>'; return; }
      $('#grBadge').className = 'badge live'; $('#grBadge').textContent = 'live';
      const label = (b, pct) => (b.pages ? `${Math.round((pct / 100) * b.pages)}/${b.pages}` : `${pct}%`);
      g.books.forEach((b) => {
        const row = el('div', 'book');
        row.innerHTML = `<div class="cov" style="${b.cover ? `background-image:url('${esc(b.cover)}')` : ''}"></div>
          <div class="info"><div class="bt">${esc(b.title)}</div><div class="ba">${esc(b.author)}</div>
          <div class="gr-prog"><div class="bar-track gr-bar" title="tap to set your progress"><div class="bar-fill" style="width:${b.progress}%"></div></div><span class="gr-pct">${label(b, b.progress)}</span></div></div>`;
        const bar = row.querySelector('.gr-bar');
        const fill = bar.querySelector('.bar-fill');
        const pctEl = row.querySelector('.gr-pct');
        bar.addEventListener('click', (ev) => {
          const rect = bar.getBoundingClientRect();
          const pct = Math.max(0, Math.min(100, Math.round(((ev.clientX - rect.left) / rect.width) * 100)));
          fill.style.width = pct + '%'; pctEl.textContent = label(b, pct); b.progress = pct;
          fetch('/api/goodreads/progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: b.id, pct }) }).catch(() => {});
        });
        box.appendChild(row);
      });
      box.appendChild(el('div', 'empty', "Tap a bar to set your progress — Goodreads' feed doesn't include it."));
    });
  }

  /* ============================================================
     SPOTIFY (embed if configured, else now-playing demo)
     ============================================================ */
  function parseSpotify(s) {
    s = (s || '').trim();
    let m = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/);
    if (m) return { kind: m[1], id: m[2] };
    m = s.match(/spotify:(playlist|album|track|artist|show|episode):([A-Za-z0-9]+)/);
    if (m) return { kind: m[1], id: m[2] };
    return null;
  }
  const spotifyEmbed = (kind, id) =>
    `<div class="spotify-embed"><iframe style="height:152px" loading="lazy" src="https://open.spotify.com/embed/${kind}/${id}?utm_source=nexus&theme=0"></iframe></div>`;

  function loadSpotify(c) {
    const box = $('#spotify');
    const sc = (c && c.spotify) || { configured: false, connected: false };

    // 1) Fully connected → live playlist picker
    if (sc.connected) {
      $('#spBadge').className = 'badge live'; $('#spBadge').textContent = 'live';
      box.innerHTML = '<div class="empty">Loading your playlists…</div>';
      api('/api/spotify/playlists').then((r) => {
        if (!r.ok || !(r.playlists || []).length) { box.innerHTML = '<div class="empty">No playlists found.</div>'; return; }
        box.innerHTML = '';
        const picker = el('div', 'sp-picker');
        const sel = document.createElement('select');
        r.playlists.forEach((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = `${p.name} · ${p.tracks}`; sel.appendChild(o); });
        const dc = el('span', 'mini-btn', 'disconnect');
        picker.append(sel, dc);
        box.appendChild(picker);
        const embed = el('div'); box.appendChild(embed);
        const show = (id) => { embed.innerHTML = spotifyEmbed('playlist', id); };
        show(r.playlists[0].id);
        sel.addEventListener('change', () => show(sel.value));
        dc.addEventListener('click', async () => { await fetch('/auth/spotify/disconnect', { method: 'POST' }); toast('Spotify disconnected'); location.reload(); });
      }).catch(() => { box.innerHTML = '<div class="empty">Spotify error.</div>'; });
      return;
    }

    // 2) App registered but not signed in → connect button
    if (sc.configured) {
      $('#spBadge').className = 'badge off'; $('#spBadge').textContent = 'connect';
      box.innerHTML = '';
      const wrap = el('div', 'sp-connect');
      wrap.appendChild(el('div', 'empty', 'Sign in to browse and play your own playlists here.'));
      const btn = el('button', 'btn-primary', 'Connect Spotify ▸');
      btn.style.cssText = 'padding:10px 16px;border-radius:8px;font-family:var(--font-disp);letter-spacing:2px;font-size:12px;cursor:pointer;';
      btn.addEventListener('click', () => { location.href = '/auth/spotify/login'; });
      wrap.appendChild(btn);
      box.appendChild(wrap);
      return;
    }

    // 3) Legacy single-playlist embed via SPOTIFY_EMBED_URI
    const sp = parseSpotify(c && c.spotifyUri);
    if (sp) {
      $('#spBadge').className = 'badge live'; $('#spBadge').textContent = 'embed';
      box.innerHTML = spotifyEmbed(sp.kind, sp.id);
      return;
    }

    // 4) Nothing set up → demo + hint
    $('#spBadge').className = 'badge off'; $('#spBadge').textContent = 'setup';
    box.innerHTML = `<div class="np"><div class="art"></div><div><div class="tn">Not connected</div><div class="an">Spotify</div></div></div>
      <div class="empty" style="margin-top:10px">Add a Spotify app (<code>SPOTIFY_CLIENT_ID</code>/<code>SECRET</code>) for the full playlist picker.</div>`;
  }

  /* ============================================================
     FORMULA 1 — schedule, results, standings + weekend mode
     ============================================================ */
  (function initF1() {
    const tabsEl = $('#f1Tabs'), bodyEl = $('#f1Body'), metaEl = $('#f1Meta');
    if (!tabsEl || !bodyEl) return;
    let data = null, activeTab = null;
    const fmt = (iso) => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
    function countdown(iso) {
      const ms = new Date(iso) - Date.now();
      if (isNaN(ms) || ms <= 0) return null;
      const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      if (d > 0) return `${d}d ${h}h ${m}m`;
      if (h > 0) return `${h}h ${m}m ${ss}s`;
      return `${m}m ${ss}s`;
    }
    function setTabs(names) {
      tabsEl.innerHTML = '';
      names.forEach((n) => {
        const b = el('button', 'f1-tab' + (n === activeTab ? ' active' : ''), n);
        b.addEventListener('click', () => { activeTab = n; render(); });
        tabsEl.appendChild(b);
      });
    }
    const rows = (arr) => '<div class="f1-table">' + arr.join('') + '</div>';
    function viewWeekend() {
      const n = data.next; if (!n) return '<div class="empty">No upcoming race.</div>';
      const cd = countdown(n.raceIso);
      const toRace = new Date(n.raceIso) - Date.now();
      const raceEnded = Date.now() > new Date(n.raceIso).getTime() + 4 * 3600 * 1000;
      const watchActive = toRace <= 10 * 60 * 1000 && !raceEnded;
      let html = `<div class="f1-hero">
        <div><div class="f1-race-name">${esc(n.name)}</div><div class="f1-sub">${esc(n.circuit)} · ${esc(n.locality)}, ${esc(n.country)}</div></div>
        <div class="f1-when"><div class="f1-when-label">RACE · YOUR TIME</div><div class="f1-when-val">${fmt(n.raceIso)}</div>${cd ? `<div class="f1-cd">starts in ${cd}</div>` : '<div class="f1-cd live">● RACE UNDERWAY</div>'}</div>
      </div>`;
      if (watchActive) html += `<a class="f1-watch" href="${esc(data.watchUrl)}" target="_blank" rel="noopener">▶ WATCH RACE</a>`;
      else if (!raceEnded) html += `<div class="f1-watch disabled">▶ Watch unlocks 10 min before lights out</div>`;
      html += '<div class="f1-section-title">Qualifying</div>';
      if (data.quali && data.quali.length) {
        html += rows(data.quali.slice(0, 12).map((q) => `<div class="f1-row"><span class="f1-pos">${q.pos}</span><span class="f1-drv">${esc(q.driver)}</span><span class="f1-team">${esc(q.team)}</span><span class="f1-val">${esc(q.best)}</span></div>`));
      } else html += '<div class="empty">Qualifying results not out yet — they appear here as soon as the session ends.</div>';
      return html;
    }
    function viewNext() {
      const n = data.next; if (!n) return '<div class="empty">No upcoming race.</div>';
      const cd = countdown(n.raceIso);
      let html = `<div class="f1-hero">
        <div><div class="f1-race-name">${esc(n.name)}</div><div class="f1-sub">${esc(n.circuit)} · ${esc(n.locality)}, ${esc(n.country)}</div></div>
        <div class="f1-when"><div class="f1-when-label">RACE · YOUR TIME</div><div class="f1-when-val">${fmt(n.raceIso)}</div>${cd ? `<div class="f1-cd">in ${cd}</div>` : ''}</div>
      </div>`;
      html += '<div class="f1-section-title">Weekend schedule · your local time</div>';
      html += rows((n.sessions || []).map((s) => `<div class="f1-row"><span class="f1-drv">${esc(s.label)}</span><span class="f1-val wide">${fmt(s.iso)}</span></div>`));
      return html;
    }
    function viewLast() {
      const l = data.last; if (!l) return '<div class="empty">No recent results.</div>';
      let html = `<div class="f1-section-title">${esc(l.name)} · ${esc(l.date)}</div>`;
      html += rows(l.results.map((r) => `<div class="f1-row"><span class="f1-pos">${r.pos}</span><span class="f1-drv">${esc(r.driver)}</span><span class="f1-team">${esc(r.team)}</span><span class="f1-val">${esc(r.time)}</span><span class="f1-pts">${esc(r.points)}</span></div>`));
      return html;
    }
    function viewChamp() {
      const d = data.standings.drivers, c = data.standings.constructors;
      const dr = '<div class="f1-col"><div class="f1-section-title">Drivers</div>' + rows(d.slice(0, 12).map((x) => `<div class="f1-row"><span class="f1-pos">${x.pos}</span><span class="f1-drv">${esc(x.driver)}</span><span class="f1-team">${esc(x.team)}</span><span class="f1-pts">${esc(x.points)}</span></div>`)) + '</div>';
      const co = '<div class="f1-col"><div class="f1-section-title">Constructors</div>' + rows(c.slice(0, 12).map((x) => `<div class="f1-row"><span class="f1-pos">${x.pos}</span><span class="f1-drv">${esc(x.team)}</span><span class="f1-pts">${esc(x.points)}</span></div>`)) + '</div>';
      return '<div class="f1-champ">' + dr + co + '</div>';
    }
    function render() {
      if (!data || !data.ok) { bodyEl.innerHTML = '<div class="empty">F1 data unavailable.</div>'; tabsEl.innerHTML = ''; return; }
      const tabs = data.weekend ? ['Weekend', 'Last GP', 'Championship'] : ['Up Next', 'Last GP', 'Championship'];
      if (!tabs.includes(activeTab)) activeTab = tabs[0];
      setTabs(tabs);
      bodyEl.innerHTML = activeTab === 'Weekend' ? viewWeekend()
        : activeTab === 'Up Next' ? viewNext()
        : activeTab === 'Last GP' ? viewLast() : viewChamp();
    }
    function load() {
      api('/api/f1').then((d) => {
        data = d;
        if (metaEl) metaEl.textContent = d.ok ? (d.weekend ? 'race weekend' : 'live') : 'offline';
        render();
      }).catch(() => { bodyEl.innerHTML = '<div class="empty">F1 error.</div>'; });
    }
    load();
    setInterval(load, 90 * 1000);
    // live countdown / watch-button unlock — refresh the time-sensitive views each second
    setInterval(() => { if (data && data.ok && (activeTab === 'Weekend' || activeTab === 'Up Next')) render(); }, 1000);
  })();

  /* ============================================================
     UKRAINE LIVE FRONT — Leaflet + DeepStateMAP + air alerts
     ============================================================ */
  function initWarMap() {
    const mapEl = $('#warMap');
    if (!mapEl || typeof L === 'undefined') return;
    // Frame all of Ukraine by default, every load.
    const UA_BOUNDS = L.latLngBounds([[44.0, 22.0], [52.5, 40.4]]);
    const map = L.map(mapEl, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, maxBounds: UA_BOUNDS.pad(0.4) });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: 'DeepStateMAP · alerts.com.ua · © OpenStreetMap, CARTO', subdomains: 'abcd', maxZoom: 10, minZoom: 4,
    }).addTo(map);
    const frameUkraine = () => map.fitBounds(UA_BOUNDS, { padding: [6, 6] });
    frameUkraine();
    setTimeout(() => { map.invalidateSize(); frameUkraine(); }, 300);

    // occupied / liberated polygons
    api('/api/warmap').then((w) => {
      if (!w.ok) { $('#warMeta').innerHTML = '<span class="badge off">offline</span>'; return; }
      $('#warMeta').innerHTML = '<span class="badge live">DeepStateMAP</span>';
      (w.polygons || []).forEach((p) => {
        const occ = p.cat === 'occupied';
        L.polygon(p.ring, {
          color: occ ? '#ff5a6e' : '#57f08a', weight: 0.6,
          fillColor: occ ? '#ff5a6e' : '#57f08a', fillOpacity: occ ? 0.28 : 0.18,
        }).addTo(map);
      });
      const stats = $('#warStats');
      const when = w.datetime ? `Updated ${w.datetime}` : 'Updated —';
      stats.innerHTML = `<div class="st">Source<b>DeepStateMAP</b></div><div class="st">Frontline<b>${when}</b></div><div class="st" id="alertStat">Air alerts<b>…</b></div>`;
      // keep the view framed on all of Ukraine (don't auto-zoom to the front)
    }).catch(() => { $('#warMeta').innerHTML = '<span class="badge off">offline</span>'; });

    // active air-raid alerts
    const alertLayer = L.layerGroup().addTo(map);
    function loadAlerts() {
      api('/api/waralerts').then((a) => {
        if (!a.ok) return;
        alertLayer.clearLayers();
        (a.alerts || []).forEach((al) => {
          if (!al.at) return;
          const icon = L.divIcon({ className: '', html: '<div class="alert-dot pulse" style="width:12px;height:12px;background:#ffb24a;border-radius:50%;"></div>', iconSize: [12, 12] });
          L.marker(al.at, { icon }).bindPopup('Air alert: ' + al.name).addTo(alertLayer);
        });
        const st = $('#alertStat');
        if (st) st.innerHTML = `Air alerts<b class="alert">${a.count} active</b>`;
      }).catch(() => {});
    }
    loadAlerts();
    setInterval(loadAlerts, 60000);
  }
  initWarMap();
})();
