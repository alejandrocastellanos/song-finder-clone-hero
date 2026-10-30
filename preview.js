'use strict';
/* Playable preview: a Clone Hero style note highway drawn on a canvas, synced to the song audio. */
const Preview = (() => {
  const LANE = ['#2fd36b', '#ff3b3b', '#ffd21f', '#3f8bff', '#ff8a1f'];
  const DRUM = ['#ff3b3b', '#ffd21f', '#3f8bff', '#2fd36b', '#ff8a1f'];
  const OPEN = '#b45cff', KICK = '#ff8a1f', SP = '#7df9ff';
  const LOOK = 1.5;          // seconds of notes visible ahead
  const DEPTH = 2.8;         // perspective depth at the far end

  let el, cv, ctx2d, actx, gain, buffers = [], sources = [], tl = null, song = null;
  let playing = false, startCtx = 0, startPos = 0, pausedPos = 0, duration = 0, raf = 0, clock0 = 0;
  let inst = 'guitar', diff = 'X', generated = [], onDownload = null, onExport = null, regenerate = null, hitFlash = [0, 0, 0, 0, 0, 0];

  const $ = s => el.querySelector(s);
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function build() {
    el = document.createElement('div');
    el.className = 'pv hidden';
    el.innerHTML = `
      <div class="pv-box" role="dialog" aria-modal="true" aria-label="Vista previa">
        <div class="pv-head">
          <div class="pv-art"></div>
          <div class="pv-info"><div class="pv-title"></div><div class="pv-artist"></div></div>
          <button class="pv-x" title="Cerrar">✕</button>
        </div>
        <div class="pv-stage">
          <canvas></canvas>
          <div class="pv-load"><div class="pv-load-txt">Cargando…</div><div class="pv-load-bar"><i></i></div></div>
        </div>
        <div class="pv-ctrl">
          <div class="pv-row">
            <div class="pv-inst"></div>
            <div class="pv-diff"></div>
          </div>
          <div class="pv-row">
            <button class="pv-play primary" disabled>▶</button>
            <span class="pv-time">0:00</span>
            <input class="pv-seek" type="range" min="0" max="1000" value="0" disabled>
            <span class="pv-dur">0:00</span>
            <input class="pv-vol" type="range" min="0" max="100" value="80" title="Volumen">
          </div>
          <div class="pv-row pv-knobs hidden">
            <span class="pv-kl" title="Solo cambian los niveles creados por la app; los originales del chart no se tocan">🎛 Ajustar niveles creados</span>
            <label class="pv-dens-l">Menos notas <input class="pv-dens" type="range" min="-2" max="2" step="1" value="0"> Más notas</label>
            <label class="chk"><input type="checkbox" class="pv-chords" checked> Acordes</label>
            <label class="chk"><input type="checkbox" class="pv-orange"> Naranja en Medio</label>
            <button class="pv-reset ghost">Restablecer</button>
          </div>
          <div class="pv-row pv-foot">
            <span class="pv-stats"></span>
            <div class="row" style="gap:8px">
              <button class="pv-edit" disabled title="Baja la canción como carpeta .zip para corregirla nota por nota en Moonscraper">✏️ Editar en Moonscraper</button>
              <button class="pv-dl primary" disabled>Descargar</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    cv = $('canvas'); ctx2d = cv.getContext('2d');
    $('.pv-x').onclick = close;
    el.addEventListener('click', e => { if (e.target === el) close(); });
    document.addEventListener('keydown', e => {
      if (el.classList.contains('hidden')) return;
      if (e.key === 'Escape') close();
      if (e.key === ' ' && e.target.tagName !== 'INPUT') { e.preventDefault(); toggle(); }
    });
    $('.pv-play').onclick = toggle;
    $('.pv-seek').oninput = e => seek(e.target.value / 1000 * duration);
    $('.pv-vol').oninput = e => { if (gain) gain.gain.value = e.target.value / 100; };
    $('.pv-dl').onclick = () => onDownload && onDownload();
    $('.pv-edit').onclick = () => onExport && onExport();
    let kt = 0;
    const knobChanged = () => { clearTimeout(kt); kt = setTimeout(applyKnobs, 180); };
    $('.pv-dens').oninput = knobChanged;
    $('.pv-chords').onchange = knobChanged;
    $('.pv-orange').onchange = knobChanged;
    $('.pv-reset').onclick = () => { showKnobs(CHB.DEFAULT_KNOBS); applyKnobs(); };
    new ResizeObserver(resize).observe($('.pv-stage'));
  }

  function resize() {
    const r = $('.pv-stage').getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
    draw();
  }

  /* ---------- audio ---------- */
  function now() {
    if (!playing) return pausedPos;
    return actx && buffers.length ? actx.currentTime - startCtx + startPos : (performance.now() - clock0) / 1000 + startPos;
  }
  function stopSources() { for (const s of sources) { try { s.stop(); } catch { } } sources = []; }
  function play(from) {
    stopSources();
    startPos = Math.max(0, Math.min(from, duration));
    if (actx && buffers.length) {
      if (actx.state === 'suspended') actx.resume();
      startCtx = actx.currentTime + 0.05;
      for (const b of buffers) {
        const s = actx.createBufferSource(); s.buffer = b; s.connect(gain);
        if (startPos < b.duration) s.start(startCtx, startPos);
        sources.push(s);
      }
    } else clock0 = performance.now();
    playing = true; $('.pv-play').textContent = '❚❚';
    loop();
  }
  function pause() { pausedPos = now(); playing = false; stopSources(); $('.pv-play').textContent = '▶'; draw(); }
  function toggle() { if (!tl) return; playing ? pause() : play(pausedPos >= duration - 0.2 ? 0 : pausedPos); }
  function seek(t) {
    if (playing) play(t);
    else { pausedPos = t; $('.pv-time').textContent = fmt(t); draw(); }
  }

  function loop() {
    cancelAnimationFrame(raf);
    const tick = () => {
      draw();
      const t = now();
      $('.pv-time').textContent = fmt(t);
      $('.pv-seek').value = duration ? Math.round(t / duration * 1000) : 0;
      if (t >= duration) { pause(); pausedPos = duration; return; }
      if (playing) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  /* ---------- drawing ---------- */
  function draw() {
    if (!cv || !ctx2d) return;
    const W = cv.width, H = cv.height, g = ctx2d;
    g.clearRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#07060a'); bg.addColorStop(1, '#170e10');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const notes = tl && tl.tracks[inst] && tl.tracks[inst][diff];
    const drums = inst === 'drums';
    const lanes = drums ? (notes && notes.some(n => n.lanes.includes(5)) ? 5 : 4) : 5;
    const strikeY = H * 0.86, horizon = H * 0.02, cx = W / 2;
    const wb = Math.min(W * 0.78, H * 1.05);
    const P = (p, x) => { const z = 1 + p * (DEPTH - 1); return { y: horizon + (strikeY - horizon) / z, x: cx + x / z, s: 1 / z }; };
    const laneX = i => (i + 0.5 - lanes / 2) * (wb / lanes);
    const t = now();

    // highway body
    const a = P(1, -wb / 2), b = P(1, wb / 2), c = P(0, wb / 2), d = P(0, -wb / 2);
    const hw = g.createLinearGradient(0, a.y, 0, H);
    hw.addColorStop(0, 'rgba(40,24,22,0)'); hw.addColorStop(0.35, '#211617'); hw.addColorStop(1, '#2e1c18');
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, H); g.lineTo(d.x, H); g.closePath(); g.fillStyle = hw; g.fill();
    // time grid (every half second) scrolling toward the player
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 2;
    for (let k = Math.ceil(t * 2) / 2; k < t + LOOK; k += 0.5) {
      const p = (k - t) / LOOK, l = P(p, -wb / 2), r = P(p, wb / 2);
      g.beginPath(); g.moveTo(l.x, l.y); g.lineTo(r.x, r.y); g.stroke();
    }
    // lane dividers and rails
    for (let i = 0; i <= lanes; i++) {
      const x = -wb / 2 + i * wb / lanes, f = P(1, x), n = P(0, x);
      g.strokeStyle = i === 0 || i === lanes ? '#7a4320' : 'rgba(255,255,255,.12)';
      g.lineWidth = i === 0 || i === lanes ? 4 : 1.5;
      g.beginPath(); g.moveTo(f.x, f.y); g.lineTo(n.x, n.y); g.stroke();
    }
    // strike line rings
    const gemW = wb / lanes * 0.62, gemH = gemW * 0.42;
    for (let i = 0; i < lanes; i++) {
      const col = drums ? DRUM[i] : LANE[i], x = cx + laneX(i), fl = hitFlash[i] > t - 0.12;
      g.lineWidth = 4; g.strokeStyle = col; g.fillStyle = fl ? col : '#120d0f';
      g.shadowColor = col; g.shadowBlur = fl ? 30 : 8;
      g.beginPath(); g.ellipse(x, strikeY, gemW / 2, gemH / 2, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.shadowBlur = 0;
    }
    if (!notes) return;

    // notes: find the first visible one with a binary search
    let lo = 0, hi = notes.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if ((notes[m].end || notes[m].t) < t - 0.1) lo = m + 1; else hi = m; }
    const visible = [];
    for (let i = lo; i < notes.length && notes[i].t < t + LOOK; i++) visible.push(notes[i]);
    // sustains first (behind the gems)
    for (const n of visible) {
      if (!n.end || n.end < t) continue;
      for (const ln of n.lanes) {
        if (ln < 0) continue;
        const p0 = Math.max(0, (n.t - t) / LOOK), p1 = Math.min(1, (n.end - t) / LOOK);
        const x = laneX(ln), s0 = P(p0, x), s1 = P(p1, x);
        g.strokeStyle = n.sp ? SP : LANE[ln]; g.globalAlpha = 0.75;
        g.lineCap = 'round';
        g.beginPath(); g.lineWidth = gemW * 0.22 * s0.s; g.moveTo(s0.x, s0.y); g.lineTo(s1.x, s1.y); g.stroke();
        g.globalAlpha = 1;
      }
    }
    // gems from far to near
    for (let i = visible.length - 1; i >= 0; i--) {
      const n = visible[i];
      if (n.t < t) {   // just played: light up the strike line
        for (const ln of n.lanes) if (n.t > t - 0.05) hitFlash[drums ? Math.max(0, ln - 1) : Math.max(0, ln)] = t;
        continue;
      }
      const p = (n.t - t) / LOOK;
      for (const ln of n.lanes) {
        if ((drums && ln === 0) || (!drums && ln < 0)) {          // kick / open note: a bar across the highway
          const l = P(p, -wb / 2 + 6), r = P(p, wb / 2 - 6);
          g.fillStyle = n.sp ? SP : drums ? KICK : OPEN; g.shadowColor = g.fillStyle; g.shadowBlur = 12;
          const h = Math.max(3, gemH * 0.35 * l.s);
          g.fillRect(l.x, l.y - h / 2, r.x - l.x, h); g.shadowBlur = 0;
          continue;
        }
        const lane = drums ? ln - 1 : ln;
        const pos = P(p, laneX(lane)), w = gemW * pos.s, h = gemH * pos.s;
        const col = n.sp ? SP : drums ? DRUM[lane] : LANE[lane];
        const gr = g.createRadialGradient(pos.x, pos.y - h * 0.25, 1, pos.x, pos.y, w / 2);
        gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, col); gr.addColorStop(1, shade(col));
        g.fillStyle = gr; g.shadowColor = col; g.shadowBlur = 14 * pos.s;
        g.beginPath(); g.ellipse(pos.x, pos.y, w / 2, h / 2, 0, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0; g.lineWidth = 2 * pos.s; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke();
      }
    }
  }
  function shade(hex) {
    const n = parseInt(hex.slice(1), 16), f = 0.45;
    return `rgb(${(n >> 16 & 255) * f | 0},${(n >> 8 & 255) * f | 0},${(n & 255) * f | 0})`;
  }

  /* ---------- controls ---------- */
  const INST = { guitar: 'Guitarra', bass: 'Bajo', rhythm: 'Rítmica', keys: 'Teclado', drums: 'Batería' };
  const DIFF = { E: 'Fácil', M: 'Medio', H: 'Difícil', X: 'Experto' };
  function renderControls() {
    const tracks = tl.tracks;
    $('.pv-inst').innerHTML = Object.keys(INST).filter(k => tracks[k]).map(k =>
      `<button data-i="${k}" class="${k === inst ? 'on' : ''}">${INST[k]}</button>`).join('');
    $('.pv-diff').innerHTML = ['E', 'M', 'H', 'X'].map(k => {
      const has = tracks[inst] && tracks[inst][k], gen = generated.includes(k + ':' + inst);
      return `<button data-d="${k}" class="gemb lv-${k} ${k === diff ? 'on' : ''}" ${has ? '' : 'disabled'} title="${has ? (gen ? 'Creado automáticamente' : 'Original del chart') : 'No disponible'}">${DIFF[k]}${gen ? ' <small>creado</small>' : ''}</button>`;
    }).join('');
    $('.pv-inst').onclick = e => { const k = e.target.dataset.i; if (!k) return; inst = k; pickDiff(); renderControls(); draw(); };
    $('.pv-diff').onclick = e => { const b = e.target.closest('button'); if (!b || b.disabled) return; diff = b.dataset.d; renderControls(); draw(); };
    $('.pv-knobs').classList.toggle('hidden', !generated.length);
    const notes = tracks[inst] && tracks[inst][diff];
    const count = notes ? notes.reduce((s, n) => s + n.lanes.length, 0) : 0;
    const nps = notes && duration ? (notes.length / duration).toFixed(1) : 0;
    $('.pv-stats').textContent = notes ? `${count} notas · ${nps} por segundo` : '';
  }
  function pickDiff() {
    const tr = tl.tracks[inst] || {};
    if (!tr[diff]) diff = ['M', 'E', 'H', 'X'].find(k => tr[k]) || 'X';
  }

  /* ---------- knobs for the generated levels ---------- */
  const readKnobs = () => ({ density: +$('.pv-dens').value, chords: $('.pv-chords').checked, orangeMedium: $('.pv-orange').checked });
  function showKnobs(k) {
    $('.pv-dens').value = k.density; $('.pv-chords').checked = k.chords; $('.pv-orange').checked = k.orangeMedium;
  }
  async function applyKnobs() {
    if (!tl || !regenerate) return;
    const my = song;
    $('.pv-stats').textContent = 'Recreando niveles…';
    try {
      const { bytes, added } = await regenerate(readKnobs());
      if (song !== my || !tl) return;
      generated = added;
      tl.tracks = CHB.songTimeline(CHB.readSng(bytes)).tracks;
      pickDiff(); renderControls(); draw();
    } catch (e) { $('.pv-stats').textContent = '✖ ' + e.message; }
  }

  function setLoading(text, frac) {
    $('.pv-load').classList.toggle('hidden', text === null);
    if (text !== null) { $('.pv-load-txt').textContent = text; $('.pv-load-bar i').style.width = Math.round((frac || 0) * 100) + '%'; }
  }

  /* opts: { song, fetchBytes(onProgress) -> Promise<{bytes, added}>, regenerate(knobs) -> Promise<{bytes, added}>,
             knobs, onDownload, onExport, preferDiff } */
  async function open(opts) {
    if (!el) build();
    close(true);
    song = opts.song; onDownload = opts.onDownload; onExport = opts.onExport; regenerate = opts.regenerate; generated = [];
    showKnobs(Object.assign({}, CHB.DEFAULT_KNOBS, opts.knobs || {})); $('.pv-knobs').classList.add('hidden');
    el.classList.remove('hidden'); document.body.classList.add('pv-open');
    $('.pv-title').textContent = song.name; $('.pv-artist').textContent = song.artist;
    $('.pv-art').style.backgroundImage = song.albumArtMd5 ? `url('${CHB.FILES}${song.albumArtMd5}.jpg')` : '';
    $('.pv-play').disabled = true; $('.pv-seek').disabled = true; $('.pv-dl').disabled = true; $('.pv-edit').disabled = true;
    $('.pv-inst').innerHTML = ''; $('.pv-diff').innerHTML = ''; $('.pv-stats').textContent = '';
    resize();
    const my = song;
    try {
      setLoading('Descargando canción…', 0);
      const { bytes, added } = await opts.fetchBytes((a, b) => setLoading(`Descargando canción… ${(a / 1048576).toFixed(1)} MB`, b ? a / b * 0.7 : 0.3));
      if (song !== my) return;
      generated = added;
      setLoading('Preparando notas…', 0.72);
      tl = CHB.songTimeline(CHB.readSng(bytes));
      if (!Object.keys(tl.tracks).length) throw new Error('Esta canción no trae notas que pueda mostrar.');
      if (!song.albumArtMd5 && tl.image) {
        const url = URL.createObjectURL(new Blob([tl.image.data]));
        $('.pv-art').style.backgroundImage = `url('${url}')`;
        document.body.style.setProperty('--bgart', `url('${url}')`); document.body.classList.add('has-art');
      }
      inst = tl.tracks.guitar ? 'guitar' : Object.keys(tl.tracks)[0];
      diff = opts.preferDiff || 'M'; pickDiff();
      setLoading('Preparando audio…', 0.8);
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      gain = actx.createGain(); gain.gain.value = $('.pv-vol').value / 100; gain.connect(actx.destination);
      const decoded = await Promise.all(tl.audio.map(f => actx.decodeAudioData(f.data.slice().buffer).catch(() => null)));
      if (song !== my) return;
      buffers = decoded.filter(Boolean);
      const lastNote = Math.max(0, ...Object.values(tl.tracks).flatMap(lv => Object.values(lv).map(n => n.length ? (n[n.length - 1].end || n[n.length - 1].t) : 0)));
      duration = Math.max(lastNote + 1, ...buffers.map(b => b.duration));
      $('.pv-dur').textContent = fmt(duration);
      setLoading(null);
      if (!buffers.length) $('.pv-stats').textContent = 'No se pudo reproducir el audio en este navegador; las notas sí se muestran.';
      $('.pv-play').disabled = false; $('.pv-seek').disabled = false; $('.pv-dl').disabled = false; $('.pv-edit').disabled = false;
      renderControls(); pausedPos = 0; draw();
      play(0);
    } catch (e) {
      if (song === my) setLoading('✖ ' + e.message, 0);
    }
  }

  function close(keepOpen) {
    cancelAnimationFrame(raf); stopSources(); playing = false; pausedPos = 0;
    buffers = []; tl = null;
    if (gain) { try { gain.disconnect(); } catch { } gain = null; }
    if (el && keepOpen !== true) { el.classList.add('hidden'); document.body.classList.remove('pv-open'); song = null; }
    if (el) $('.pv-play').textContent = '▶';
  }

  return { open, close };
})();
