'use strict';
/* Experimental: builds a playable Expert guitar chart from an audio file.
   Onsets come from spectral flux, the beat grid from a dynamic-programming beat tracker (Ellis 2007),
   and lanes follow the pitch contour (harmonic product spectrum). Browser only (uses Web Audio to decode). */
const AutoChart = (() => {
  const SR = 22050, N = 1024, HOP = 256, RES = 192;
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* ---------- DSP helpers ---------- */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < half; j++) {
          const a = i + j, b = a + half;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  const hann = n => Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));

  function spectrum(x, start, n, win, re, im) {
    for (let i = 0; i < n; i++) { const s = x[start + i]; re[i] = (s === undefined ? 0 : s) * win[i]; im[i] = 0; }
    fft(re, im);
  }

  // moving average over +-w frames
  function movingMean(a, w) {
    const pre = new Float64Array(a.length + 1);
    for (let i = 0; i < a.length; i++) pre[i + 1] = pre[i] + a[i];
    return Float32Array.from(a, (_, i) => { const lo = Math.max(0, i - w), hi = Math.min(a.length, i + w + 1); return (pre[hi] - pre[lo]) / (hi - lo); });
  }

  /* ---------- 1. decode to mono 22.05 kHz ---------- */
  async function decode(bytes) {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ac.decodeAudioData(bytes.slice().buffer);
    ac.close && ac.close();
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * SR), SR);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const mono = (await off.startRendering()).getChannelData(0);
    return { mono, duration: buf.duration, original: buf };
  }

  /* ---------- 2. onset envelope (spectral flux) and energy ---------- */
  async function onsetEnvelope(x, onProgress) {
    const frames = Math.max(1, Math.floor((x.length - N) / HOP) + 1);
    const flux = new Float32Array(frames), energy = new Float32Array(frames);
    const win = hann(N), re = new Float32Array(N), im = new Float32Array(N);
    let prev = new Float32Array(N / 2), cur = new Float32Array(N / 2);
    // only the guitar range counts: skips kick drum lows and hi-hat/cymbal highs
    const k0 = Math.ceil(100 * N / SR), k1 = Math.floor(5000 * N / SR);
    for (let f = 0; f < frames; f++) {
      spectrum(x, f * HOP, N, win, re, im);
      let fl = 0, en = 0;
      for (let k = k0; k <= k1; k++) {
        const m = Math.hypot(re[k], im[k]);
        cur[k] = Math.log1p(100 * m);
        const d = cur[k] - prev[k]; if (d > 0) fl += d;
        en += m * m;
      }
      flux[f] = fl; energy[f] = Math.sqrt(en);
      const t = prev; prev = cur; cur = t;
      if (f % 2000 === 0) { onProgress(f / frames); await tick(); }
    }
    flux[0] = 0;
    return { flux, energy, fps: SR / HOP };
  }

  /* ---------- 3. tempo + beat tracking ---------- */
  function beatTrack(env, fps) {
    // tempo: autocorrelation with a preference around 120 BPM
    const minLag = Math.round(fps * 60 / 200), maxLag = Math.round(fps * 60 / 60);
    let best = minLag, bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
      const bpm = 60 * fps / lag;
      s *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      if (s > bestScore) { bestScore = s; best = lag; }
    }
    const P = best;
    // dynamic programming: each beat wants a strong onset and an interval close to P
    const n = env.length, score = new Float32Array(n), back = new Int32Array(n).fill(-1), tight = 100;
    for (let t = 0; t < n; t++) {
      let bestPrev = -1, bestVal = 0;
      for (let p = t - Math.round(2 * P); p <= t - Math.round(P / 2); p++) {
        if (p < 0) continue;
        const v = score[p] - tight * Math.pow(Math.log((t - p) / P), 2);
        if (bestPrev < 0 || v > bestVal) { bestVal = v; bestPrev = p; }
      }
      score[t] = env[t] + (bestPrev >= 0 ? bestVal : 0);
      back[t] = bestPrev;
    }
    let t = n - 1;
    for (let i = Math.max(0, n - P); i < n; i++) if (score[i] > score[t]) t = i;
    const beats = [];
    while (t >= 0) { beats.push(t); t = back[t]; }
    return { beats: beats.reverse(), bpm: 60 * fps / P };
  }

  /* ---------- 4. pitch at a given time (harmonic product spectrum) ---------- */
  function pitchAt(x, sec) {
    const n = 4096, win = hann(n), re = new Float32Array(n), im = new Float32Array(n);
    spectrum(x, Math.max(0, Math.round(sec * SR) + 256), n, win, re, im);
    const mag = new Float32Array(n / 2);
    for (let k = 0; k < n / 2; k++) mag[k] = Math.log1p(Math.hypot(re[k], im[k]));
    const lo = Math.floor(70 * n / SR), hi = Math.ceil(1000 * n / SR);
    let bestK = 0, best = -Infinity;
    for (let k = lo; k <= hi && 3 * k < n / 2; k++) {
      const v = mag[k] + mag[2 * k] + mag[3 * k];
      if (v > best) { best = v; bestK = k; }
    }
    return bestK ? bestK * SR / n : 0;
  }

  /* ---------- 5. notes -> chart ---------- */
  function buildChart({ x, flux, energy, fps, beatsSec, duration, sensitivity, name, artist }) {
    // onsets: local peaks above a moving threshold
    const mean = movingMean(flux, Math.round(fps * 0.25));
    let sum = 0, sum2 = 0; for (const v of flux) { sum += v; sum2 += v * v; }
    const std = Math.sqrt(Math.max(1e-9, sum2 / flux.length - (sum / flux.length) ** 2));
    const delta = [1.6, 1.15, 0.8, 0.55][sensitivity] ?? 0.8;
    const onsets = [];
    const latency = (N / 2) / SR;
    for (let i = 3; i < flux.length - 3; i++) {
      const v = flux[i];
      if (v < mean[i] + delta * std * 0.5) continue;
      let peak = true;
      for (let j = i - 3; j <= i + 3; j++) if (j !== i && flux[j] > v) { peak = false; break; }
      if (!peak) continue;
      if (onsets.length && i - onsets[onsets.length - 1].f < Math.round(fps * 0.07)) continue;
      onsets.push({ f: i, t: i / fps + latency, s: (v - mean[i]) / std });
    }

    // beat grid: tick 0 at time 0, one beat every RES ticks, tempo follows the tracked beats
    const beats = beatsSec.slice();
    const avg = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
    while (beats.length && beats[0] - avg > 0.05) beats.unshift(beats[0] - avg);
    if (!beats.length || beats[0] > 0.02) beats.unshift(0); else beats[0] = 0;
    while (beats[beats.length - 1] < duration + avg) beats.push(beats[beats.length - 1] + avg);
    const toTick = t => {
      let lo = 0, hi = beats.length - 2;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (beats[m] <= t) lo = m; else hi = m - 1; }
      return (lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo])) * RES;
    };

    // quantize to 16ths (or 8th-note triplets when clearly closer)
    const byTick = new Map();
    for (const o of onsets) {
      const raw = toTick(o.t);
      const q16 = Math.round(raw / 48) * 48, q3 = Math.round(raw / 64) * 64;
      const q = Math.abs(raw - q16) <= 14 || Math.abs(raw - q3) >= Math.abs(raw - q16) ? q16 : q3;
      const prev = byTick.get(q);
      if (!prev || o.s > prev.s) byTick.set(q, { ...o, tick: q });
    }
    let notes = [...byTick.values()].sort((a, b) => a.tick - b.tick);
    // keep Expert close to a hand-made density, dropping the weakest notes first (notes on the beat weigh more)
    const maxPerSec = [2, 2.75, 3.5, 5][sensitivity] ?? 3.5;
    const weight = n => n.s + (n.tick % RES === 0 ? 1 : n.tick % (RES / 2) === 0 ? 0.5 : 0);
    for (let s = 0; s < duration; s += 2) {
      const inWin = notes.filter(n => n.t >= s && n.t < s + 2), keep = Math.round(maxPerSec * 2);
      if (inWin.length > keep) {
        const drop = new Set(inWin.sort((a, b) => weight(a) - weight(b)).slice(0, inWin.length - keep));
        notes = notes.filter(n => !drop.has(n));
      }
    }

    // lanes follow the pitch contour
    let lane = 2, lastSemi = null, edgeRun = 0;
    const strong = notes.map(n => n.s).sort((a, b) => a - b)[Math.floor(notes.length * 0.88)] ?? Infinity;
    for (const n of notes) {
      const hz = pitchAt(x, n.t);
      const semi = hz ? 12 * Math.log2(hz / 440) : null;
      if (semi === null || lastSemi === null) lane = semi === null ? (lane + 2) % 5 : lane;
      else {
        const ds = semi - lastSemi;
        if (Math.abs(ds) >= 0.5) lane += Math.sign(ds) * Math.min(2, Math.max(1, Math.round(Math.abs(ds) / 2.5)));
      }
      if (lane < 0 || lane > 4) { lane = Math.max(0, Math.min(4, lane)); edgeRun++; } else edgeRun = 0;
      if (edgeRun > 3) { lane = 2; edgeRun = 0; }   // recenter after hugging an edge
      n.lanes = [lane];
      if (n.s >= strong && n.tick % RES === 0) n.lanes.push(lane <= 2 ? lane + 2 : lane - 2);   // accents become chords
      if (semi !== null) lastSemi = semi;
    }

    // sustains where the sound keeps ringing before a long gap
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i], next = notes[i + 1];
      const gap = (next ? next.tick : n.tick + 4 * RES) - n.tick;
      n.len = 0;
      if (gap < RES) continue;
      const e0 = energy[n.f] || 0, later = energy[Math.min(energy.length - 1, n.f + Math.round(fps * 0.35))] || 0;
      if (e0 && later > 0.45 * e0) n.len = Math.max(0, Math.floor((gap - 48) / 48) * 48);
    }

    // tempo map, sections and star power
    const sync = ['0 = TS 4'];
    for (let i = 0; i < beats.length - 1; i++) {
      const bpm = 60 / Math.max(1e-3, beats[i + 1] - beats[i]);
      sync.push(`${i * RES} = B ${Math.round(Math.min(999, bpm) * 1000)}`);
    }
    const lastTick = notes.length ? notes[notes.length - 1].tick : 0;
    const events = [];
    for (let b = 0, k = 1; b * RES <= lastTick; b += 32, k++) events.push(`${b * RES} = E "section Parte ${k}"`);
    const lines = [];
    for (const n of notes) for (const l of n.lanes) lines.push([n.tick, `${n.tick} = N ${l} ${n.len}`]);
    for (let b = 16; b * RES < lastTick; b += 64) {
      const a = b * RES, z = (b + 8) * RES;
      if (notes.some(n => n.tick >= a && n.tick < z)) lines.push([a, `${a} = S 2 ${z - a}`]);
    }
    lines.sort((a, b) => a[0] - b[0]);
    const q = s => String(s).replace(/"/g, "'");
    const chart = [
      '[Song]', '{', `  Name = "${q(name)}"`, `  Artist = "${q(artist)}"`, '  Charter = "CH Buscador (automático)"',
      '  Offset = 0', `  Resolution = ${RES}`, '  Player2 = bass', '  Difficulty = 0', '  PreviewStart = 0', '  PreviewEnd = 0', '  Genre = "rock"', '  MediaType = "cd"', '}',
      '[SyncTrack]', '{', ...sync.map(s => '  ' + s), '}',
      '[Events]', '{', ...events.map(s => '  ' + s), '}',
      '[ExpertSingle]', '{', ...lines.map(l => '  ' + l[1]), '}', '',
    ].join('\r\n');
    return { chart, notes: notes.length };
  }

  /* ---------- WAV encoder for formats Clone Hero can't play ---------- */
  function toWav(buf) {
    const ch = Math.min(2, buf.numberOfChannels), len = buf.length, out = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true);
    out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, buf.sampleRate, true);
    out.setUint32(28, buf.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
    w(36, 'data'); out.setUint32(40, len * ch * 2, true);
    const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
    let p = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7FFF, true); p += 2; }
    return new Uint8Array(out.buffer);
  }

  /* file: File; opts: { name, artist, sensitivity 0..3, onProgress(text, fraction) } -> { bytes (.sng, Expert only), bpm, notes, duration } */
  async function create(file, opts) {
    const say = opts.onProgress || (() => { });
    const bytes = new Uint8Array(await file.arrayBuffer());
    say('Leyendo el audio…', 0.05); await tick();
    const { mono, duration, original } = await decode(bytes);
    if (duration < 5) throw new Error('El audio es demasiado corto.');
    say('Buscando cada golpe de la canción…', 0.15);
    const { flux, energy, fps } = await onsetEnvelope(mono, f => say('Buscando cada golpe de la canción…', 0.15 + f * 0.5));
    say('Siguiendo el pulso…', 0.7); await tick();
    const mean = movingMean(flux, Math.round(fps * 0.25));
    const env = Float32Array.from(flux, (v, i) => Math.max(0, v - mean[i]));
    const { beats, bpm } = beatTrack(env, fps);
    const latency = (N / 2) / SR;
    say('Repartiendo notas en los botones…', 0.85); await tick();
    const { chart, notes } = buildChart({ x: mono, flux, energy, fps, beatsSec: beats.map(b => b / fps + latency), duration, sensitivity: opts.sensitivity ?? 2, name: opts.name, artist: opts.artist });
    const ext = (file.name.match(/\.(ogg|opus|mp3|wav)$/i) || [])[1];
    const audio = ext ? { name: 'song.' + ext.toLowerCase(), data: bytes } : { name: 'song.wav', data: toWav(original) };
    const meta = [
      ['name', opts.name], ['artist', opts.artist], ['charter', 'CH Buscador (automático)'], ['genre', 'rock'],
      ['song_length', String(Math.round(duration * 1000))], ['diff_guitar', '-1'], ['loading_phrase', 'Chart creado automáticamente desde el audio con CH Buscador'],
    ];
    const sng = CHB.writeSng({ version: 1, meta, files: [{ name: 'notes.chart', data: new TextEncoder().encode(chart) }, audio] });
    say('¡Listo!', 1);
    return { bytes: sng, bpm, notes, duration };
  }

  return { create };
})();
