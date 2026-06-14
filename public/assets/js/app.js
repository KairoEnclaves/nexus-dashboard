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
     TO-DO (demo → iCloud Reminders via CalDAV)
     ============================================================ */
  let todoState = { lists: [] };
  let todoSource = 'local';
  let todoError = '';
  let icloudConfigured = false;
  let saveT;
  function saveTodos() {
    if (todoSource !== 'local') return;
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      fetch('/api/todos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lists: todoState.lists }) }).catch(() => {});
    }, 250);
  }
  function setTodoBadge() {
    const b = $('#todoBadge'); if (!b) return;
    if (todoSource === 'icloud') { b.className = 'badge live'; b.textContent = 'iCloud'; }
    else { b.className = 'badge demo'; b.textContent = 'local'; }
  }
  async function toggleTodo(it) {
    const newVal = !it.done;
    if (todoSource === 'icloud') {
      it.done = newVal; renderTodos();
      const r = await fetch('/api/todos/toggle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ href: it.href, done: newVal }) }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r.ok) { it.done = !newVal; renderTodos(); toast('iCloud update failed'); }
    } else { it.done = newVal; renderTodos(); saveTodos(); }
  }
  function renderTodos() {
    const box = $('#todos'); box.innerHTML = '';
    if (todoError) {
      const note = el('div', 'empty');
      note.innerHTML = `iCloud not connected — ${esc(todoError)}<br><a href="/api/icloud/test" target="_blank">run diagnostic</a> · then check .env + restart`;
      box.appendChild(note);
    }
    todoState.lists.forEach((list) => {
      box.appendChild(el('div', 'list-sub', esc(list.name)));
      const wrap = el('div', 'list');
      list.items.forEach((it, ii) => {
        const row = el('div', `todo ${it.done ? 'done' : ''}`);
        const del = todoSource === 'local' ? '<span class="del" title="delete">✕</span>' : '';
        row.innerHTML = `<span class="box">${it.done ? '✓' : ''}</span><span class="txt">${esc(it.text)}</span>${del}`;
        row.querySelector('.box').addEventListener('click', () => toggleTodo(it));
        const d = row.querySelector('.del');
        if (d) d.addEventListener('click', () => { list.items.splice(ii, 1); renderTodos(); saveTodos(); });
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    });
    const add = el('div', 'todo-add');
    add.innerHTML = `<input placeholder="add ${todoSource === 'icloud' ? 'iCloud reminder' : 'task'}…" maxlength="140" /><button title="add">+</button>`;
    const inp = add.querySelector('input');
    const commit = async () => {
      const v = inp.value.trim(); if (!v) return;
      if (todoSource === 'icloud') {
        inp.value = '';
        const r = await fetch('/api/todos/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: v }) }).then((x) => x.json()).catch(() => ({ ok: false }));
        if (r.ok) { toast('Added to iCloud ✓'); reloadTodos(); } else toast('Could not add to iCloud');
      } else {
        if (!todoState.lists.length) todoState.lists.push({ name: 'Tasks', items: [] });
        todoState.lists[0].items.push({ id: 't' + Date.now(), text: v, done: false });
        inp.value = ''; renderTodos(); saveTodos(); inp.focus();
      }
    };
    add.querySelector('button').addEventListener('click', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    box.appendChild(add);
  }
  function reloadTodos() {
    api('/api/todos').then((t) => { todoSource = t.source || 'local'; todoError = t.error || ''; todoState = { lists: t.lists || [] }; setTodoBadge(); renderTodos(); });
  }
  reloadTodos();

  /* ============================================================
     FINANCE (demo → GoCardless Bank Account Data)
     ============================================================ */
  api('/api/finance').then((f) => {
    const box = $('#finance'); box.innerHTML = '';
    const fmt = (n) => n.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    box.appendChild(el('div', 'fin-top', `<span class="fin-bal">€${fmt(f.balance)}</span><span class="fin-cur">${esc(f.currency)} · NET</span>`));
    const accts = el('div', 'fin-accts');
    f.accounts.forEach((a) => accts.appendChild(el('div', 'fin-acct', `${esc(a.name)}<b>€${fmt(a.balance)}</b>`)));
    box.appendChild(accts);
    const pct = Math.min(100, (f.monthSpend / f.monthBudget) * 100);
    box.appendChild(el('div', 'fin-acct', `Spent €${fmt(f.monthSpend)} / €${fmt(f.monthBudget)} this month`));
    const track = el('div', 'bar-track'); track.appendChild(el('div', 'bar-fill')).style.width = pct + '%';
    box.appendChild(track);
    const cats = el('div', 'fin-cats');
    const max = Math.max(...f.categories.map((c) => c.value));
    f.categories.forEach((c) => {
      const row = el('div', 'fin-cat');
      row.innerHTML = `<span class="nm">${esc(c.name)}</span><span class="tr"><span class="bar-track"><span class="bar-fill" style="width:${(c.value / max) * 100}%"></span></span></span><span class="vl">€${c.value}</span>`;
      cats.appendChild(row);
    });
    box.appendChild(cats);
  });

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
        `<div class="row1"><span class="from">${esc(mail.from)}</span><span class="time">${esc(mail.time)}</span></div>
         <div class="subj">${esc(mail.subject)}${mail.replied ? ' · <span style="color:var(--green)">replied</span>' : ''}</div>
         <div class="prev">${esc(mail.preview)}</div>`;
      row.addEventListener('click', () => { mail.unread = false; openMail(mail); renderMail(); });
      listBox.appendChild(row);
    });
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
