/* ============================================================
   NEXUS VISUALS — canvas animation toolkit
   All visuals are self-contained, DPR-aware, and resize-safe.
   ============================================================ */
window.NexusVisuals = (function () {
  const CYAN = '46,242,224';
  const AMBER = '255,178,74';
  const MAGENTA = '255,77,141';

  function setup(canvas) {
    const ctx = canvas.getContext('2d');
    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, r.width * dpr);
      canvas.height = Math.max(1, r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas._w = r.width;
      canvas._h = r.height;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    window.addEventListener('resize', resize);
    return ctx;
  }

  /* ---- 1. PARTICLE FIELD (background neural net) ---- */
  function particleField(canvas) {
    const ctx = setup(canvas);
    let pts = [];
    function seed() {
      const n = Math.round((canvas._w * canvas._h) / 16000);
      pts = Array.from({ length: Math.max(28, Math.min(110, n)) }, () => ({
        x: Math.random() * canvas._w,
        y: Math.random() * canvas._h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
      }));
    }
    seed();
    let lastW = canvas._w;
    function frame() {
      if (canvas._w !== lastW) { seed(); lastW = canvas._w; }
      const w = canvas._w, h = canvas._h;
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
          const d = Math.hypot(dx, dy);
          if (d < 130) {
            ctx.strokeStyle = `rgba(${CYAN},${(1 - d / 130) * 0.18})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
          }
        }
      }
      for (const p of pts) {
        ctx.fillStyle = `rgba(${CYAN},0.7)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    frame();
  }

  /* ---- 2. WAVEFORM (audio-style oscilloscope) ---- */
  function waveform(canvas, color = CYAN) {
    const ctx = setup(canvas);
    let t = 0;
    function frame() {
      const w = canvas._w, h = canvas._h;
      ctx.clearRect(0, 0, w, h);
      t += 0.03;
      ctx.lineWidth = 2;
      for (let layer = 0; layer < 3; layer++) {
        ctx.beginPath();
        const amp = (h / 2) * (0.5 - layer * 0.13);
        const a = 1 - layer * 0.28;
        for (let x = 0; x <= w; x += 4) {
          const k = x / w;
          const y = h / 2 +
            Math.sin(k * 9 + t + layer) * amp * Math.sin(t * 0.6 + layer) +
            Math.sin(k * 22 - t * 1.4) * amp * 0.25;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${color},${0.25 * a + 0.15})`;
        ctx.shadowBlur = 8; ctx.shadowColor = `rgba(${color},0.5)`;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      requestAnimationFrame(frame);
    }
    frame();
  }

  /* ---- 3. SPECTRUM BARS (equalizer) ---- */
  function spectrum(canvas) {
    const ctx = setup(canvas);
    const N = 40;
    const vals = Array.from({ length: N }, () => Math.random());
    const tgt = vals.slice();
    let tick = 0;
    function frame() {
      const w = canvas._w, h = canvas._h;
      ctx.clearRect(0, 0, w, h);
      if (tick++ % 6 === 0) for (let i = 0; i < N; i++) tgt[i] = Math.random();
      const bw = w / N;
      for (let i = 0; i < N; i++) {
        vals[i] += (tgt[i] - vals[i]) * 0.12;
        const bh = vals[i] * h * 0.9 + 2;
        const g = ctx.createLinearGradient(0, h, 0, h - bh);
        g.addColorStop(0, `rgba(${CYAN},0.15)`);
        g.addColorStop(1, `rgba(${CYAN},0.85)`);
        ctx.fillStyle = g;
        ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
      }
      requestAnimationFrame(frame);
    }
    frame();
  }

  /* ---- 4. NEURAL ORB (rotating point sphere) ---- */
  function neuralOrb(canvas) {
    const ctx = setup(canvas);
    const N = 220;
    const pts = Array.from({ length: N }, () => {
      const th = Math.acos(2 * Math.random() - 1);
      const ph = Math.random() * Math.PI * 2;
      return { th, ph };
    });
    let rot = 0;
    function frame() {
      const w = canvas._w, h = canvas._h;
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.36;
      const cx = w / 2, cy = h / 2;
      rot += 0.005;
      const proj = pts.map((p) => {
        const x = R * Math.sin(p.th) * Math.cos(p.ph + rot);
        const y = R * Math.sin(p.th) * Math.sin(p.ph + rot);
        const z = R * Math.cos(p.th);
        const s = (z + R) / (2 * R);
        return { sx: cx + x, sy: cy + y * 0.55, z, s };
      });
      proj.sort((a, b) => a.z - b.z);
      for (let i = 0; i < proj.length; i += 1) {
        const a = proj[i];
        for (let j = i + 1; j < Math.min(i + 4, proj.length); j++) {
          const b = proj[j];
          const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
          if (d < 40) {
            ctx.strokeStyle = `rgba(${CYAN},${0.1 * a.s})`;
            ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
          }
        }
      }
      for (const a of proj) {
        ctx.fillStyle = `rgba(${CYAN},${0.25 + a.s * 0.7})`;
        ctx.beginPath(); ctx.arc(a.sx, a.sy, 0.7 + a.s * 1.8, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    frame();
  }

  /* ---- 5. RADAR SWEEP ---- */
  function radar(canvas) {
    const ctx = setup(canvas);
    let ang = 0;
    const blips = Array.from({ length: 7 }, () => ({ a: Math.random() * Math.PI * 2, r: 0.3 + Math.random() * 0.65 }));
    function frame() {
      const w = canvas._w, h = canvas._h;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42;
      ctx.strokeStyle = `rgba(${CYAN},0.18)`;
      for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 3, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      ang += 0.02;
      const g = ctx.createConicGradient ? ctx.createConicGradient(ang, cx, cy) : null;
      if (g) {
        g.addColorStop(0, `rgba(${CYAN},0.35)`);
        g.addColorStop(0.08, `rgba(${CYAN},0)`);
        g.addColorStop(1, `rgba(${CYAN},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, ang - 0.5, ang); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = `rgba(${CYAN},0.5)`;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); ctx.stroke();
      for (const b of blips) {
        const diff = Math.abs(((ang - b.a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
        const fade = Math.max(0, 1 - diff / 1.2);
        ctx.fillStyle = `rgba(${AMBER},${fade})`;
        ctx.beginPath(); ctx.arc(cx + Math.cos(b.a) * R * b.r, cy + Math.sin(b.a) * R * b.r, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    frame();
  }

  /* ---- 6. DATA RAIN (matrix-ish) ---- */
  function dataRain(canvas) {
    const ctx = setup(canvas);
    const chars = '01░▓<>/\\=+*アカサタ#'.split('');
    let cols = [];
    function seed() {
      const n = Math.floor(canvas._w / 12);
      cols = Array.from({ length: n }, () => Math.random() * canvas._h);
    }
    seed();
    let lastW = canvas._w;
    function frame() {
      if (canvas._w !== lastW) { seed(); lastW = canvas._w; }
      const w = canvas._w, h = canvas._h;
      ctx.fillStyle = 'rgba(3,8,12,0.22)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = '12px Share Tech Mono, monospace';
      for (let i = 0; i < cols.length; i++) {
        const ch = chars[(Math.random() * chars.length) | 0];
        ctx.fillStyle = `rgba(${CYAN},0.85)`;
        ctx.fillText(ch, i * 12, cols[i]);
        cols[i] = cols[i] > h + Math.random() * 80 ? 0 : cols[i] + 12;
      }
      requestAnimationFrame(frame);
    }
    frame();
  }

  /* ---- sparkline (static, for widgets) ---- */
  function sparkline(canvas, data, color = CYAN) {
    const ctx = setup(canvas);
    function draw() {
      const w = canvas._w, h = canvas._h;
      ctx.clearRect(0, 0, w, h);
      if (!data || !data.length) return;
      const max = Math.max(...data), min = Math.min(...data);
      const rng = max - min || 1;
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((v - min) / rng) * (h - 6) - 3;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = `rgba(${color},0.9)`;
      ctx.lineWidth = 1.8; ctx.shadowBlur = 6; ctx.shadowColor = `rgba(${color},0.6)`;
      ctx.stroke();
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, `rgba(${color},0.25)`); g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g; ctx.shadowBlur = 0; ctx.fill();
    }
    draw();
    new ResizeObserver(draw).observe(canvas);
  }

  return { particleField, waveform, spectrum, neuralOrb, radar, dataRain, sparkline, COLORS: { CYAN, AMBER, MAGENTA } };
})();
