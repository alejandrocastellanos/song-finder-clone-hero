'use strict';
/* Experimental: builds a playable Expert guitar chart from an audio file.
   A semitone spectrogram gives the onsets (pitched range only) and the pitch of each note, a dynamic-programming
   beat tracker (Ellis 2007) the tempo map, and bars that sound alike are charted together so riffs repeat.
   Browser only (uses Web Audio to decode). */
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

  /* ---------- 2. semitone spectrogram (MIDI 28..100) and onset novelty ---------- */
  const M0 = 28, M1 = 100, NB = M1 - M0 + 1;
  function semitoneMap(n) {
    const map = new Int16Array(n / 2).fill(-1);
    for (let k = 1; k < n / 2; k++) { const m = Math.round(69 + 12 * Math.log2(k * SR / n / 440)); if (m >= M0 && m <= M1) map[k] = m - M0; }
    return map;
  }
  // log energy per semitone, one row of NB values per frame
  async function semigram(x, n, hop, onProgress) {
    const frames = Math.max(1, Math.floor((x.length - n) / hop) + 1), S = new Float32Array(frames * NB);
    const win = hann(n), re = new Float32Array(n), im = new Float32Array(n), map = semitoneMap(n), acc = new Float64Array(NB);
    for (let f = 0; f < frames; f++) {
      spectrum(x, f * hop, n, win, re, im); acc.fill(0);
      for (let k = 1; k < n / 2; k++) if (map[k] >= 0) acc[map[k]] += re[k] * re[k] + im[k] * im[k];
      for (let b = 0; b < NB; b++) S[f * NB + b] = Math.log1p(1000 * Math.sqrt(acc[b]));
      if (f % 2000 === 0) { onProgress(f / frames); await tick(); }
    }
    return { S, frames, fps: SR / hop, latency: n / 2 / SR };
  }
  // rising energy in the pitched range (E2 and up) for notes, and below it for the kick
  function novelty(G) {
    const { S, frames } = G, pitched = new Float32Array(frames), low = new Float32Array(frames);
    for (let f = 1; f < frames; f++) {
      let p = 0, l = 0;
      for (let b = 0; b < NB; b++) { const d = S[f * NB + b] - S[(f - 1) * NB + b]; if (d > 0) { if (b + M0 < 40) l += d; else p += d; } }
      pitched[f] = p; low[f] = l;
    }
    return { pitched, low };
  }
  // average spectrum between two times
  function vecAt(G, a, b) {
    const f0 = Math.max(0, Math.floor(a * G.fps)), f1 = Math.max(f0 + 1, Math.floor(b * G.fps)), v = new Float32Array(NB);
    let n = 0;
    for (let f = f0; f < f1 && f < G.frames; f++) { for (let k = 0; k < NB; k++) v[k] += G.S[f * NB + k]; n++; }
    if (n) for (let k = 0; k < NB; k++) v[k] /= n;
    return v;
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


  /* ---------- 4. pitch and timbre of a note ---------- */
  const HARM = [0, 12, 19, 24, 28, 31];   // semitones from the fundamental to its first harmonics
  const floorOf = v => Float32Array.from(v).sort()[v.length >> 1];
  // the most likely fundamental between E2 and E5 (harmonic summation above the noise floor)
  function salience(v, lo = 40, hi = 76) {
    const fl = floorOf(v);
    let best = lo, bv = -Infinity;
    for (let m = lo; m <= hi; m++) {
      let s = 0;
      for (let h = 0; h < HARM.length; h++) { const b = m - M0 + HARM[h]; if (b < NB) s += Math.pow(0.8, h) * Math.max(0, v[b] - fl); }
      if (s > bv) { bv = s; best = m; }
    }
    return best;
  }
  // timbre fingerprint: unit vector of what stands above the floor, C2..F#6
  function shape(v) {
    const a = v.slice(36 - M0, 90 - M0), fl = floorOf(a), o = a.map(x => Math.max(0, x - fl));
    let n = 0; for (const x of o) n += x * x; n = Math.sqrt(n) || 1;
    return o.map(x => x / n);
  }
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const centroid = v => { let a = 0, w = 0; for (let i = 0; i < v.length; i++) { a += v[i] * v[i] * i; w += v[i] * v[i]; } return w ? a / w : 0; };

  /* ---------- 5. beat grid: tick 0 at time 0, one beat every RES ticks ---------- */
  function beatGrid(beatsSec, duration) {
    const beats = beatsSec.slice();
    const avg = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
    while (beats.length && beats[0] - avg > 0.05) beats.unshift(beats[0] - avg);
    if (!beats.length || beats[0] > 0.02) beats.unshift(0); else beats[0] = 0;
    while (beats[beats.length - 1] < duration + avg) beats.push(beats[beats.length - 1] + avg);
    const toSec = tk => { const i = Math.min(beats.length - 2, Math.floor(tk / RES)); return beats[i] + (tk / RES - i) * (beats[i + 1] - beats[i]); };
    return { beats, toSec };
  }

  /* ---------- 6. audio -> notes ----------
     Tuned against official Harmonix charts (Rock Band) of 12 songs, 4 of them kept aside to check:
     - notes sit on the 16th-note grid where the pitched range (not the cymbals) jumps;
     - bars that sound alike are grouped and charted once from all of them together, so a repeated
       riff gets the same notes and buttons every time (in real charts it does; before this it never did);
     - buttons follow the pitch of each note within the riff, and the riff's place on the fretboard
       follows how high it sounds compared with the rest of the song;
     - Harmonix changes button on ~3 of every 4 notes, so only a near-identical sound repeats it. */
  // beats (in seconds) from the pitched range plus the kick; G2 is the 2048/256 semitone spectrogram
  function trackBeats(G2, nov) {
    const fps = G2.fps, both = Float32Array.from(nov.pitched, (v, i) => v + nov.low[i]), bm = movingMean(both, Math.round(fps * 0.25));
    const { beats, bpm } = beatTrack(Float32Array.from(both, (v, i) => Math.max(0, v - bm[i])), fps);
    return { beats: beats.map(b => b / fps + G2.latency + 0.015), bpm };
  }

  /* opts.beats: beat times (s) to follow instead of finding them, so the notes land on a song's own tempo map;
     opts.bass: read a bass line (lower range, onsets from the low end too, no chords) */
  async function analyze(x, duration, sensitivity, say = () => { }, opts = {}) {
    const LO = opts.bass ? 28 : 40, HI = opts.bass ? 60 : 76;
    const G2 = await semigram(x, 2048, 256, f => say('Buscando cada golpe de la canción…', 0.15 + f * 0.3));
    const G4 = await semigram(x, 4096, 512, f => say('Escuchando las notas…', 0.45 + f * 0.25));
    say('Siguiendo el pulso…', 0.72); await tick();
    const nov = novelty(G2), fps = G2.fps, lat = G2.latency + 0.015;
    const tracked = opts.beats && opts.beats.length > 8 ? null : trackBeats(G2, nov);
    const beatsSec = tracked ? tracked.beats : opts.beats;
    const bpm = tracked ? tracked.bpm : Math.round(60 * (beatsSec.length - 1) / Math.max(1e-3, beatsSec[beatsSec.length - 1] - beatsSec[0]));
    const grid = beatGrid(beatsSec, duration);

    say('Buscando los riffs que se repiten…', 0.8); await tick();
    // strength of each 16th: the biggest normalised jump within 25 ms of it
    const c = opts.bass ? Float32Array.from(nov.pitched, (v, i) => v + nov.low[i]) : nov.pitched, mean = movingMean(c, Math.round(fps));
    let su = 0, s2 = 0; for (const v of c) { su += v; s2 += v * v; }
    const std = Math.sqrt(Math.max(1e-9, s2 / c.length - (su / c.length) ** 2));
    const nSlots = (grid.beats.length - 1) * 4, slotT = new Float64Array(nSlots + 1), str = new Float32Array(nSlots);
    for (let k = 0; k <= nSlots; k++) slotT[k] = grid.toSec(k * 48);
    for (let k = 0; k < nSlots; k++) {
      const f0 = Math.max(1, Math.round((slotT[k] - lat - 0.025) * fps)), f1 = Math.min(c.length - 2, Math.round((slotT[k] - lat + 0.025) * fps));
      let m = -9;
      for (let f = f0; f <= f1; f++) if (c[f] >= c[f - 1] && c[f] >= c[f + 1]) m = Math.max(m, (c[f] - mean[f]) / std);
      str[k] = m;
    }
    // each bar (4 beats): its rhythm plus its harmony every 8th
    const nBars = Math.floor(nSlots / 16), feat = [];
    for (let b = 0; b < nBars; b++) {
      const f = [];
      for (let k = 0; k < 16; k++) f.push(Math.max(0, str[b * 16 + k]));
      for (let q = 0; q < 8; q++) {
        const i = b * 16 + q * 2, v = vecAt(G4, slotT[i], slotT[i + 2]), fl = floorOf(v), ch = new Float32Array(12);
        for (let m = LO; m < LO + 48; m++) ch[m % 12] += Math.max(0, v[m - M0] - fl);
        for (const x of ch) f.push(x * 0.5);
      }
      const n = Math.sqrt(dot(f, f)) || 1;
      feat.push(f.map(x => x / n));
    }
    const cl = new Int32Array(nBars), groups = [];
    for (let b = 0; b < nBars; b++) {
      let best = -1, bs = -1;
      for (let g = 0; g < groups.length; g++) { const s = dot(feat[b], feat[groups[g][0]]); if (s > bs) { bs = s; best = g; } }
      if (best >= 0 && bs >= 0.75) { cl[b] = best; groups[best].push(b); } else { cl[b] = groups.length; groups.push([b]); }
    }

    say('Repartiendo notas en los botones…', 0.86); await tick();
    // one rhythm per group, from the average of all its bars; strongest hits and beats win, at least minGap apart
    const minGap = [0.35, 0.26, 0.2, 0.16][sensitivity] ?? 0.2;
    const patterns = groups.map(members => {
      const avg = new Float32Array(16);
      for (const b of members) for (let k = 0; k < 16; k++) avg[k] += str[b * 16 + k] / members.length;
      const beatLen = members.reduce((a, b) => a + slotT[b * 16 + 16] - slotT[b * 16], 0) / members.length / 4;
      const cand = [];
      for (let k = 0; k < 16; k++) if (avg[k] >= 0.35) cand.push({ k, s: avg[k], w: avg[k] + (k % 4 === 0 ? 0.6 : k % 2 === 0 ? 0.3 : 0), sec: k * beatLen / 4 });
      return CHB.spacedPick(cand, minGap, x => x.sec, x => x.w);
    });
    // pitch and timbre of each note, averaged over every bar of its group
    const info = patterns.map((pat, g) => pat.map(({ k }) => {
      const acc = new Float32Array(NB);
      for (const b of groups[g]) {
        const i = b * 16 + k, v = vecAt(G4, slotT[i] + 0.03, Math.min(slotT[i] + 0.25, slotT[Math.min(nSlots, i + 2)]));
        for (let x = 0; x < NB; x++) acc[x] += v[x] / groups[g].length;
      }
      return { p: salience(acc, LO, HI), v: shape(acc) };
    }));
    const allP = info.flatMap((list, g) => list.map(n => ({ p: n.p, w: groups[g].length })));
    const pct = p => { let below = 0, tot = 0; for (const a of allP) { tot += a.w; if (a.p < p) below += a.w; } return tot ? below / tot : 0.5; };
    const lanes = info.map(list => {
      if (!list.length) return [];
      const rel = [0];
      for (let i = 1; i < list.length; i++) {
        if (dot(list[i].v, list[i - 1].v) >= 0.9) { rel.push(rel[i - 1]); continue; }
        let d = list[i].p - list[i - 1].p;
        if (Math.abs(d) < 0.5) d = centroid(list[i].v) - centroid(list[i - 1].v);
        rel.push(rel[i - 1] + (d >= 0 ? 1 : -1) * (Math.abs(d) >= 5 ? 2 : 1));
      }
      const lo = Math.min(...rel), span = Math.max(...rel) - lo, sc = span > 4 ? 4 / span : 1, spanS = Math.round(span * sc);
      const med = list.map(n => n.p).sort((a, b) => a - b)[list.length >> 1];
      const base = Math.max(0, Math.min(4 - spanS, Math.round(pct(med) * 4 - spanS / 2)));
      return rel.map(r => base + Math.round((r - lo) * sc));
    });

    const notes = [];
    for (let b = 0; b < nBars; b++) patterns[cl[b]].forEach((n, j) => {
      const i = b * 16 + n.k;
      notes.push({ tick: i * 48, t: slotT[i], s: n.s, beat: n.k % 4 === 0, lanes: [lanes[cl[b]][j]] });
    });
    // accents on the beat become two-button chords (two apart, the most common shape in official charts)
    const strong = notes.map(n => n.s).sort((a, b) => a - b)[Math.floor(notes.length * 0.88)] ?? Infinity;
    if (!opts.bass) for (const n of notes) if (n.s >= strong && n.beat) n.lanes.push(n.lanes[0] <= 2 ? n.lanes[0] + 2 : n.lanes[0] - 2);
    // sustains where the sound keeps ringing until a later note
    const level = (a, b) => { const v = vecAt(G4, a, b); let e = 0; for (let m = LO; m < LO + 44; m++) e += v[m - M0]; return e / 44; };
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i], next = notes[i + 1], gap = (next ? next.t : n.t + 2) - n.t, gapTicks = (next ? next.tick : n.tick + 4 * RES) - n.tick;
      n.len = 0;
      if (gap < 0.45) continue;
      if (level(n.t + 0.03, n.t + 0.12) - level(n.t + gap * 0.5, n.t + gap * 0.8) < 1) n.len = Math.max(0, Math.floor((gapTicks - 48) / 48) * 48);
    }
    return { notes, grid, bpm };
  }

  /* ---------- 7. notes -> .chart ---------- */
  function writeChart({ notes, grid, name, artist }) {
    // tempo map, sections and star power
    const beats = grid.beats, sync = ['0 = TS 4'];
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
    return [
      '[Song]', '{', `  Name = "${q(name)}"`, `  Artist = "${q(artist)}"`, '  Charter = "CH Buscador (automático)"',
      '  Offset = 0', `  Resolution = ${RES}`, '  Player2 = bass', '  Difficulty = 0', '  PreviewStart = 0', '  PreviewEnd = 0', '  Genre = "rock"', '  MediaType = "cd"', '}',
      '[SyncTrack]', '{', ...sync.map(s => '  ' + s), '}',
      '[Events]', '{', ...events.map(s => '  ' + s), '}',
      '[ExpertSingle]', '{', ...lines.map(l => '  ' + l[1]), '}', '',
    ].join('\r\n');
  }
  /* ---------- drums ----------
     Tuned against the drum charts of the same official songs. The percussive part of the sound is kept
     with median filters (drums are short in time and wide in frequency; guitars and voices are the opposite),
     then read on the 16th-note grid, and bars that sound alike are played the same way.
     Against the hand-made charts: kick F 0.62 -> 0.74, snare 0.31 -> 0.58, cymbals 0.69 -> 0.81 (songs kept aside). */
  async function drumHits(x, onProgress = () => { }, beatsSec = null) {
    const K = N / 2, frames = Math.max(1, Math.floor((x.length - N) / HOP) + 1), fps = SR / HOP, duration = x.length / SR;
    const M = new Float32Array(frames * K), win = hann(N), re = new Float32Array(N), im = new Float32Array(N);
    for (let f = 0; f < frames; f++) {
      spectrum(x, f * HOP, N, win, re, im);
      for (let k = 0; k < K; k++) M[f * K + k] = Math.hypot(re[k], im[k]);
      if (f % 2000 === 0) { onProgress(f / frames * 0.3); await tick(); }
    }
    const bin = hz => Math.round(hz * N / SR);
    const bands = { kick: [bin(40), bin(150)], body: [bin(150), bin(350)], snare: [bin(1500), bin(6000)], hat: [bin(6000), bin(10500)] };
    const top = bands.hat[1], flux = {}, energy = {};
    for (const b in bands) { flux[b] = new Float32Array(frames); energy[b] = new Float32Array(frames); }
    let prev = new Float32Array(top + 1), cur = new Float32Array(top + 1);
    const tmp = new Float32Array(17), med = n => { const a = tmp.subarray(0, n).sort(); return a[n >> 1]; };
    for (let f = 0; f < frames; f++) {
      for (let k = 0; k <= top; k++) {
        let n = 0;
        for (let j = Math.max(0, k - 8); j <= Math.min(K - 1, k + 8); j++) tmp[n++] = M[f * K + j];
        const p = med(n);
        n = 0;
        for (let j = Math.max(0, f - 8); j <= Math.min(frames - 1, f + 8); j++) tmp[n++] = M[j * K + k];
        const h = med(n), m = M[f * K + k];
        cur[k] = Math.log1p(100 * m * (p * p) / (p * p + h * h + 1e-12));
      }
      if (f) for (const b in bands) {
        const [lo, hi] = bands[b];
        let fl = 0, en = 0;
        for (let k = lo; k <= hi; k++) { const d = cur[k] - prev[k]; if (d > 0) fl += d; en += cur[k]; }
        flux[b][f] = fl / (hi - lo + 1); energy[b][f] = en / (hi - lo + 1);
      }
      const t = prev; prev = cur; cur = t;
      if (f % 1000 === 0) { onProgress(0.3 + f / frames * 0.6); await tick(); }
    }
    // the grid: the song's own beats when it has a chart, otherwise tracked from the audio
    if (!beatsSec) { const G2 = await semigram(x, 2048, 256, () => { }); beatsSec = trackBeats(G2, novelty(G2)).beats; }
    const grid = beatGrid(beatsSec, duration), lat = (N / 2) / SR;
    const z = {};
    for (const b in bands) {
      const a = flux[b], m = movingMean(a, Math.round(fps * 0.3));
      let su = 0, s2 = 0; for (const v of a) { su += v; s2 += v * v; }
      const sd = Math.sqrt(Math.max(1e-9, s2 / a.length - (su / a.length) ** 2));
      z[b] = Float32Array.from(a, (v, i) => (v - m[i]) / sd);
    }
    const nSlots = (grid.beats.length - 1) * 4, slotT = new Float64Array(nSlots + 1);
    for (let k = 0; k <= nSlots; k++) slotT[k] = grid.toSec(k * 48);
    const peakNear = (a, t) => {
      const f0 = Math.max(1, Math.round((t - lat - 0.03) * fps)), f1 = Math.min(a.length - 2, Math.round((t - lat + 0.03) * fps));
      let m = -3; for (let f = f0; f <= f1; f++) if (a[f] >= a[f - 1] && a[f] >= a[f + 1]) m = Math.max(m, a[f]);
      return m;
    };
    const st = { k: new Float32Array(nSlots), s: new Float32Array(nSlots), h: new Float32Array(nSlots) };
    for (let k = 0; k < nSlots; k++) {
      const t = slotT[k];
      st.k[k] = peakNear(z.kick, t); st.s[k] = 0.3 * peakNear(z.snare, t) + 0.7 * peakNear(z.body, t); st.h[k] = peakNear(z.hat, t);
    }
    // bars that sound alike share one pattern, from the average of all of them
    const nBars = Math.floor(nSlots / 16), feat = [];
    for (let b = 0; b < nBars; b++) {
      const f = []; for (const key of ['k', 's', 'h']) for (let k = 0; k < 16; k++) f.push(Math.max(0, st[key][b * 16 + k]));
      const n = Math.sqrt(dot(f, f)) || 1; feat.push(f.map(v => v / n));
    }
    const cl = new Int32Array(nBars), groups = [];
    for (let b = 0; b < nBars; b++) {
      let best = -1, bs = -1;
      for (let g = 0; g < groups.length; g++) { const v = dot(feat[b], feat[groups[g][0]]); if (v > bs) { bs = v; best = g; } }
      if (best >= 0 && bs >= 0.8) { cl[b] = best; groups[best].push(b); } else { cl[b] = groups.length; groups.push([b]); }
    }
    const avg = groups.map(m => {
      const o = { k: new Float32Array(16), s: new Float32Array(16), h: new Float32Array(16) };
      for (const b of m) for (const key of ['k', 's', 'h']) for (let k = 0; k < 16; k++) o[key][k] += st[key][b * 16 + k] / m.length;
      return o;
    });
    // backbeat: the pair of beats where the snare sits (2 and 4 in almost every rock song)
    let ph = 0, phScore = -Infinity;
    for (let p = 0; p < 2; p++) {
      let sc = 0;
      for (let b = 0; b < nBars; b++) { const a = avg[cl[b]]; sc += a.s[(4 + 4 * p) % 16] + a.s[(12 + 4 * p) % 16] - a.s[(4 * p) % 16] - a.s[(8 + 4 * p) % 16]; }
      if (sc > phScore) { phScore = sc; ph = p; }
    }
    const inBar = k => (k - 4 * ph + 16) % 8;
    const hits = [], hats = [];
    for (let b = 0; b < nBars; b++) {
      const a = avg[cl[b]];
      for (let k = 0; k < 16; k++) {
        const t = slotT[b * 16 + k];
        if (a.k[k] + (inBar(k) === 0 ? 0.6 : 0) >= 2.4) hits.push({ t, lane: 0 });
        if (a.s[k] + (inBar(k) === 4 ? 0.6 : 0) >= 2.2) hits.push({ t, lane: 1 });
        if (a.h[k] >= (k % 2 === 0 ? 1 : 1.5)) { const h = { t, lane: 2, v: a.h[k] }; hits.push(h); hats.push(h); }
      }
    }
    // a loud cymbal that keeps ringing is a crash (green), at most one every 2 seconds
    const loud = hats.map(h => h.v).sort((p, q) => p - q)[Math.floor(hats.length * 0.9)] ?? Infinity;
    let lastCrash = -Infinity;
    for (const h of hats) {
      const f = Math.round((h.t - lat) * fps), start = energy.hat[f] || 0, ring = energy.hat[Math.min(frames - 1, f + Math.round(fps * 0.35))] || 0;
      if (h.v >= loud && ring > 0.9 * start && h.t - lastCrash > 2) { h.lane = 4; lastCrash = h.t; }
      delete h.v;
    }
    onProgress(1);
    return hits.sort((p, q) => p.t - q.t);
  }

  // beat times of a song that has a chart, from its own tempo map
  function chartBeats(sng, duration) {
    const clock = CHB.songClock(sng), beats = [];
    for (let k = 0; ; k++) {
      let lo = 0, hi = duration;
      if (clock.toTick(hi) < k * clock.res) break;
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (clock.toTick(m) < k * clock.res) lo = m; else hi = m; }
      if (!beats.length || hi - beats[beats.length - 1] > 0.05) beats.push(hi);
    }
    return beats;
  }

  async function mixToMono(files) {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const bufs = (await Promise.all(files.map(f => ac.decodeAudioData(f.data.slice().buffer).catch(() => null)))).filter(Boolean);
    ac.close && ac.close();
    if (!bufs.length) throw new Error('No se pudo leer el audio de esta canción.');
    const dur = Math.max(...bufs.map(b => b.duration));
    const off = new OfflineAudioContext(1, Math.ceil(dur * SR), SR);
    for (const b of bufs) { const s = off.createBufferSource(); s.buffer = b; s.connect(off.destination); s.start(); }
    return (await off.startRendering()).getChannelData(0);
  }

  /* Adds an Expert drum track to a parsed .sng that has none. Uses the drum stems when the song has them.
     Returns { fromStems } and mutates sng. */
  async function addDrums(sng, onProgress = () => { }) {
    const audio = sng.files.filter(f => /\.(ogg|opus|mp3|wav)$/i.test(f.name) && !/^(preview|crowd)\./i.test(f.name));
    const stems = audio.filter(f => /^drums/i.test(f.name));
    const mono = await mixToMono(stems.length ? stems : audio);
    const hits = await drumHits(mono, onProgress, chartBeats(sng, mono.length / SR));
    if (!hits.length || !CHB.addDrumTrack(sng, hits)) throw new Error('No se pudo crear la batería.');
    return { fromStems: stems.length > 0, hits: hits.length };
  }

  /* Adds an Expert bass or keys track to a parsed .sng that has the instrument's own audio (bass.ogg, keys.opus…)
     but no notes for it. The notes follow the song's tempo map, so they line up with the other instruments.
     Rock Band conversions keep the bass in rhythm.ogg: it's used for the bass when there's no bass audio and no
     rhythm part, and it sounds low. Checked against the official bass of 6 Rock Band songs: F 0.69-0.88.
     Returns { notes } and mutates sng, or null when there is no usable audio for it. */
  const PART_AUDIO = { bass: /^bass\.(ogg|opus|mp3|wav)$/i, keys: /^keys\.(ogg|opus|mp3|wav)$/i }, RHYTHM_AUDIO = /^rhythm\.(ogg|opus|mp3|wav)$/i;
  function partAudio(sng, inst) {
    const own = sng.files.filter(f => PART_AUDIO[inst].test(f.name));
    if (own.length || inst !== 'bass' || CHB.hasPart(sng, 'rhythm')) return { files: own, rhythm: false };
    return { files: sng.files.filter(f => RHYTHM_AUDIO.test(f.name)), rhythm: true };
  }
  const hasPartAudio = (sng, inst) => partAudio(sng, inst).files.length > 0;
  // how much of the sound stays under 250 Hz (about 1.1 for a bass, 0.45-1 for guitars)
  async function lowShare(x) {
    const n = Math.min(x.length, SR * 90), buf = new AudioBuffer({ length: n, sampleRate: SR, numberOfChannels: 1 });
    buf.copyToChannel(x.subarray(0, n), 0);
    const off = new OfflineAudioContext(1, n, SR), src = off.createBufferSource(), lp = off.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 250; src.buffer = buf; src.connect(lp); lp.connect(off.destination); src.start();
    const y = (await off.startRendering()).getChannelData(0);
    let a = 0, b = 0; for (let i = 0; i < n; i += 4) { a += y[i] * y[i]; b += x[i] * x[i]; }
    return b ? Math.sqrt(a / b) : 0;
  }
  async function addPart(sng, inst, onProgress = () => { }) {
    const { files, rhythm } = partAudio(sng, inst);
    if (!files.length) return null;
    const mono = await mixToMono(files);
    // an almost silent file is a placeholder, not a part
    let e = 0, k = 0; for (let i = 0; i < mono.length; i += 64, k++) e += mono[i] * mono[i];
    if (!k || Math.sqrt(e / k) < 0.004) return null;
    if (rhythm && (await lowShare(mono)) < 0.9) return null;   // a rhythm guitar, not a bass
    const duration = mono.length / SR;
    // from its own track the notes are clear, so it can keep fast lines (min. 0.16 s apart)
    const { notes, grid } = await analyze(mono, duration, 3, onProgress, { beats: chartBeats(sng, duration), bass: inst === 'bass' });
    if (notes.length < 16) return null;
    const out = notes.map(n => ({ t: n.t, end: n.len ? grid.toSec(n.tick + n.len) : 0, lanes: n.lanes }));
    return CHB.addFretTrack(sng, inst, out) ? { notes: notes.length } : null;
  }

  /* ---------- Opus encoder (WebCodecs) in an Ogg container, for formats Clone Hero may not play ---------- */
  const OGG_CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let r = i << 24; for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04C11DB7 : r << 1; t[i] = r >>> 0; }
    return t;
  })();
  // one Ogg page: header + segment table + the packets it carries (each packet already fits in this page)
  function oggPage(packets, granule, serial, seq, flags) {
    const lacing = [];
    for (const p of packets) { let n = p.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
    const body = packets.reduce((s, p) => s + p.length, 0), page = new Uint8Array(27 + lacing.length + body), dv = new DataView(page.buffer);
    page.set([0x4F, 0x67, 0x67, 0x53], 0); page[5] = flags;
    dv.setUint32(6, granule % 0x100000000, true); dv.setUint32(10, Math.floor(granule / 0x100000000), true);
    dv.setUint32(14, serial, true); dv.setUint32(18, seq, true); page[26] = lacing.length;
    page.set(lacing, 27);
    let p = 27 + lacing.length; for (const k of packets) { page.set(k, p); p += k.length; }
    let crc = 0; for (let i = 0; i < page.length; i++) crc = ((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ page[i]) & 255]) >>> 0;
    dv.setUint32(22, crc, true);
    return page;
  }
  /* AudioBuffer -> Ogg Opus bytes (48 kHz, 160 kbps), or null when this browser can't encode Opus.
     The pre-skip comes from the encoder itself, so the audio starts exactly where the original did. */
  async function encodeOpus(buf) {
    if (typeof AudioEncoder === 'undefined') return null;
    const ch = Math.min(2, buf.numberOfChannels), config = { codec: 'opus', sampleRate: 48000, numberOfChannels: ch, bitrate: 160000 };
    try { if (!(await AudioEncoder.isConfigSupported(config)).supported) return null; } catch { return null; }
    // to 48 kHz, the only rate Opus works at
    const off = new OfflineAudioContext(ch, Math.ceil(buf.duration * 48000), 48000), src = off.createBufferSource();
    src.buffer = buf; src.connect(off.destination); src.start();
    const pcm = await off.startRendering(), total = pcm.length;
    const packets = [], frames = []; let head = null, failed = null;
    const enc = new AudioEncoder({
      output: (chunk, meta) => {
        const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); packets.push(d); frames.push(Math.round((chunk.duration || 20000) * 48 / 1000));
        const desc = meta && meta.decoderConfig && meta.decoderConfig.description;
        if (desc && !head) head = new Uint8Array(desc instanceof ArrayBuffer ? desc : desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength));
      },
      error: e => { failed = e; },
    });
    enc.configure(config);
    const block = 48000;   // one second at a time
    for (let s = 0; s < total; s += block) {
      const n = Math.min(block, total - s), data = new Float32Array(n * ch);
      for (let c = 0; c < ch; c++) data.set(pcm.getChannelData(c).subarray(s, s + n), c * n);
      enc.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(s / 48 * 1000), data }));
      if (enc.encodeQueueSize > 20) await new Promise(r => setTimeout(r, 0));
    }
    await enc.flush(); enc.close();
    if (failed || !packets.length) return null;
    // OpusHead: the encoder's own when it gives one (it carries the real pre-skip), otherwise libopus' usual 312 samples
    if (!head || String.fromCharCode(...head.subarray(0, 8)) !== 'OpusHead') {
      head = new Uint8Array(19); const dv = new DataView(head.buffer);
      head.set([79, 112, 117, 115, 72, 101, 97, 100], 0); head[8] = 1; head[9] = ch; dv.setUint16(10, 312, true); dv.setUint32(12, buf.sampleRate, true);
    }
    const preskip = new DataView(head.buffer, head.byteOffset).getUint16(10, true);
    const vendor = new TextEncoder().encode('CH Buscador'), tags = new Uint8Array(8 + 4 + vendor.length + 4), tv = new DataView(tags.buffer);
    tags.set([79, 112, 117, 115, 84, 97, 103, 115], 0); tv.setUint32(8, vendor.length, true); tags.set(vendor, 12); tv.setUint32(12 + vendor.length, 0, true);
    const serial = (Math.random() * 0xFFFFFFFF) >>> 0, pages = [oggPage([head], 0, serial, 0, 2), oggPage([tags], 0, serial, 1, 0)];
    // audio: about a second of packets per page; the last granule marks where the audio really ends
    let seq = 2, done = 0;
    for (let i = 0; i < packets.length; i += 50) {
      const group = packets.slice(i, i + 50), last = i + 50 >= packets.length;
      for (let j = i; j < i + group.length; j++) done += frames[j];
      // granule = samples decoded so far, pre-skip included (RFC 7845)
      pages.push(oggPage(group, last ? preskip + total : Math.min(done, preskip + total), serial, seq++, last ? 4 : 0));
    }
    const out = new Uint8Array(pages.reduce((s, p) => s + p.length, 0));
    let p = 0; for (const pg of pages) { out.set(pg, p); p += pg.length; }
    return out;
  }

  /* ---------- WAV encoder, the last resort when the browser can't encode Opus ---------- */
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

  /* The audio as Clone Hero surely plays it: MP3, OGG and Opus go in as they came; anything else (WAV, M4A, FLAC…)
     is re-encoded to Opus, the format chart guides recommend (checked: starts within 0.5 ms of the original, and a
     4-minute song takes ~2.5 s and ~4.6 MB instead of ~40 MB of WAV). WAV only if this browser can't encode Opus. */
  async function audioFile(file, bytes, original) {
    const ext = (file.name.match(/\.(ogg|opus|mp3)$/i) || [])[1];
    if (ext) return { name: 'song.' + ext.toLowerCase(), data: bytes };
    const opus = await encodeOpus(original).catch(() => null);
    return opus ? { name: 'song.opus', data: opus } : { name: 'song.wav', data: toWav(original) };
  }

  /* Only the tempo map, for charting by hand in Moonscraper: song folder (song.ini + notes.chart with the beats + audio).
     Each beat is fitted to its neighbours (two each side), so the BPM doesn't jitter from beat to beat:
     against official tempo maps that keeps 84% of beats within 50 ms and cuts the BPM jitter about five times.
     -> { zip, folder, bpm, beats } */
  async function tempoMap(file, opts) {
    const say = opts.onProgress || (() => { });
    const bytes = new Uint8Array(await file.arrayBuffer());
    say('Leyendo el audio…', 0.05); await tick();
    const { mono, duration, original } = await decode(bytes);
    if (duration < 5) throw new Error('El audio es demasiado corto.');
    const G2 = await semigram(mono, 2048, 256, f => say('Buscando cada golpe de la canción…', 0.1 + f * 0.7));
    say('Siguiendo el pulso…', 0.85); await tick();
    const { beats, bpm } = trackBeats(G2, novelty(G2));
    const smooth = beats.map((_, i) => {
      const lo = Math.max(0, i - 2), hi = Math.min(beats.length - 1, i + 2);
      let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
      for (let j = lo; j <= hi; j++) { sx += j; sy += beats[j]; sxx += j * j; sxy += j * beats[j]; n++; }
      const m = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
      return m * i + (sy - m * sx) / n;
    });
    const grid = beatGrid(smooth, duration);
    const chart = writeChart({ notes: [], grid, name: opts.name, artist: opts.artist });
    const sng = {
      version: 1,
      meta: [['name', opts.name], ['artist', opts.artist], ['charter', 'Mapa de tempo: CH Buscador'], ['song_length', String(Math.round(duration * 1000))], ['delay', '0']],
      files: [{ name: 'notes.chart', data: new TextEncoder().encode(chart) }, (await audioFile(file, bytes, original))],
    };
    const folder = CHB.folderName(sng);
    say('¡Listo!', 1);
    return { zip: CHB.makeZip(CHB.sngToFolder(sng).map(f => ({ name: `${folder}/${f.name}`, data: f.data }))), folder, bpm, beats: grid.beats.length };
  }

  /* file: File; opts: { name, artist, sensitivity 0..3, onProgress(text, fraction) } -> { bytes (.sng, Expert only), bpm, notes, duration } */
  async function create(file, opts) {
    const say = opts.onProgress || (() => { });
    const bytes = new Uint8Array(await file.arrayBuffer());
    say('Leyendo el audio…', 0.05); await tick();
    const { mono, duration, original } = await decode(bytes);
    if (duration < 5) throw new Error('El audio es demasiado corto.');
    const { notes, grid, bpm } = await analyze(mono, duration, opts.sensitivity ?? 2, say);
    const chart = writeChart({ notes, grid, name: opts.name, artist: opts.artist });
    say('Preparando el audio para Clone Hero…', 0.88);
    const audio = await audioFile(file, bytes, original);
    const meta = [
      ['name', opts.name], ['artist', opts.artist], ['charter', 'CH Buscador (automático)'], ['genre', 'rock'],
      ['song_length', String(Math.round(duration * 1000))], ['diff_guitar', '-1'], ['loading_phrase', 'Chart creado automáticamente desde el audio con CH Buscador'],
    ];
    const parsed = { version: 1, meta, files: [{ name: 'notes.chart', data: new TextEncoder().encode(chart) }, audio] };
    let drumHitCount = 0;
    if (opts.drums !== false) {
      say('Sacando la batería…', 0.9);
      const hits = await drumHits(mono, f => say('Sacando la batería…', 0.9 + f * 0.09), grid.beats);
      if (hits.length && CHB.addDrumTrack(parsed, hits)) drumHitCount = hits.length;
    }
    say('¡Listo!', 1);
    return { bytes: CHB.writeSng(parsed), bpm, notes: notes.length, duration, drumHits: drumHitCount, audio: audio.name };
  }

  return { create, tempoMap, addDrums, addPart, hasPartAudio, drumHits, _analyze: analyze };
})();
