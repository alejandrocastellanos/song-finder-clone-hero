/* CH Buscador core: Chorus Encore search, .sng read/write and difficulty generation.
   Works in the browser (window.CHB) and in Node 18+ (require). No dependencies. */
(function (root) {
  'use strict';

  const utf8 = new TextDecoder('utf-8'), enc = new TextEncoder();
  const randomBytes = n => {
    const b = new Uint8Array(n);
    if (globalThis.crypto && globalThis.crypto.getRandomValues) return globalThis.crypto.getRandomValues(b);
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  };

  /* ---------- .sng container (https://github.com/mdsitton/SngFileFormat) ---------- */
  function xorData(src, mask) {
    const d = new Uint8Array(src.length);
    for (let j = 0; j < src.length; j++) d[j] = src[j] ^ (mask[j & 15] ^ (j & 0xFF));
    return d;
  }

  function readSng(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (utf8.decode(u8.subarray(0, 6)) !== 'SNGPKG') throw new Error('No es un archivo .sng');
    let p = 6;
    const version = dv.getUint32(p, true); p += 4;
    const mask = u8.slice(p, p + 16); p += 16;
    p += 8;
    const mcount = Number(dv.getBigUint64(p, true)); p += 8;
    const meta = [];
    for (let i = 0; i < mcount; i++) {
      const kl = dv.getInt32(p, true); p += 4; const k = utf8.decode(u8.subarray(p, p + kl)); p += kl;
      const vl = dv.getInt32(p, true); p += 4; const v = utf8.decode(u8.subarray(p, p + vl)); p += vl;
      meta.push([k, v]);
    }
    p += 8;
    const fcount = Number(dv.getBigUint64(p, true)); p += 8;
    const files = [];
    for (let i = 0; i < fcount; i++) {
      const nl = u8[p++]; const name = utf8.decode(u8.subarray(p, p + nl)); p += nl;
      const len = Number(dv.getBigUint64(p, true)); p += 8;
      const off = Number(dv.getBigUint64(p, true)); p += 8;
      files.push({ name, data: xorData(u8.subarray(off, off + len), mask) });
    }
    return { version, meta, files };
  }

  function writeSng(sng) {
    const mask = randomBytes(16);
    const metaParts = sng.meta.map(([k, v]) => [enc.encode(k), enc.encode(v)]);
    const metaLen = 8 + metaParts.reduce((s, [k, v]) => s + 8 + k.length + v.length, 0);
    const names = sng.files.map(f => enc.encode(f.name));
    const idxLen = 8 + names.reduce((s, n) => s + 1 + n.length + 16, 0);
    const dataLen = sng.files.reduce((s, f) => s + f.data.length, 0);
    const out = new Uint8Array(6 + 4 + 16 + 8 + metaLen + 8 + idxLen + 8 + dataLen);
    const dv = new DataView(out.buffer);
    let p = 0;
    out.set(enc.encode('SNGPKG'), p); p += 6;
    dv.setUint32(p, sng.version, true); p += 4;
    out.set(mask, p); p += 16;
    dv.setBigUint64(p, BigInt(metaLen), true); p += 8;
    dv.setBigUint64(p, BigInt(metaParts.length), true); p += 8;
    for (const [k, v] of metaParts) {
      dv.setInt32(p, k.length, true); p += 4; out.set(k, p); p += k.length;
      dv.setInt32(p, v.length, true); p += 4; out.set(v, p); p += v.length;
    }
    dv.setBigUint64(p, BigInt(idxLen), true); p += 8;
    dv.setBigUint64(p, BigInt(names.length), true); p += 8;
    let off = p + (idxLen - 8) + 8;
    sng.files.forEach((f, i) => {
      out[p++] = names[i].length; out.set(names[i], p); p += names[i].length;
      dv.setBigUint64(p, BigInt(f.data.length), true); p += 8;
      dv.setBigUint64(p, BigInt(off), true); p += 8;
      off += f.data.length;
    });
    dv.setBigUint64(p, BigInt(dataLen), true); p += 8;
    for (const f of sng.files) { out.set(xorData(f.data, mask), p); p += f.data.length; }
    return out;
  }

  /* ---------- difficulty generation ---------- */
  // gap in beats, max notes per chord, fret map for lanes 0..4, MIDI base note
  const LEVELS = [
    { key: 'H', name: 'Hard',   gap: 0.25, chord: 2, map: [0, 1, 2, 3, 4], midi: 84 },
    { key: 'M', name: 'Medium', gap: 0.5,  chord: 2, map: [0, 1, 2, 3, 3], midi: 72 },
    { key: 'E', name: 'Easy',   gap: 1.0,  chord: 1, map: [0, 1, 1, 2, 2], midi: 60 },
  ];

  /* Tuning knobs for the generated levels.
     density: -2 (fewer notes) .. 2 (more notes); chords: false = single notes only; orangeMedium: allow orange in Medium. */
  const DEFAULT_KNOBS = { density: 0, chords: true, orangeMedium: false };
  function levelsFor(knobs) {
    const k = Object.assign({}, DEFAULT_KNOBS, knobs || {});
    const f = [2, 1.5, 1, 0.75, 0.5][Math.max(-2, Math.min(2, k.density | 0)) + 2];
    return LEVELS.map(l => ({
      ...l,
      gap: l.gap * f,
      chord: k.chords ? l.chord : 1,
      map: l.key === 'M' && k.orangeMedium ? [0, 1, 2, 3, 4] : l.map,
    }));
  }

  function reduceChords(chords, res, lv, drums) {
    const minGap = res * lv.gap, kept = [];
    let last = -Infinity;
    for (const c of chords) {
      if (c.t - last < minGap) continue;
      let fr = [...new Set(c.frets)].sort((a, b) => a - b);
      if (drums) {
        if (fr.length > lv.chord) { const pads = fr.filter(f => f !== 0); fr = pads.length ? pads.slice(0, lv.chord) : [0]; }
      } else {
        if (fr.length > 1) fr = fr.filter(f => f !== 7);   // open note inside a chord
        fr = [...new Set(fr.map(f => f === 7 ? 7 : lv.map[f]))].sort((a, b) => a - b);
        if (fr.length > lv.chord) fr = lv.chord === 1 ? [fr[fr.length - 1]] : [fr[0], fr[fr.length - 1]];
      }
      kept.push({ t: c.t, frets: fr, len: drums ? 0 : c.len, cym: c.cym });
      last = c.t;
    }
    if (!drums) {
      for (let i = 0; i < kept.length; i++) {
        let len = kept[i].len;
        if (i + 1 < kept.length) { const room = kept[i + 1].t - kept[i].t - res / 4; if (len > room) len = Math.max(0, room); }
        if (len < res / 2) len = 0;
        kept[i].len = Math.round(len);
      }
    }
    return kept;
  }

  const CHART_TRACKS = { Single: 'guitar', DoubleGuitar: 'guitar', DoubleRhythm: 'rhythm', DoubleBass: 'bass', Keyboard: 'keys', Drums: 'drums' };

  function reduceChartText(text, want, allInst, levels = LEVELS) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const secs = []; let cur = null;
    for (const l of lines) {
      const m = l.match(/^\s*\[(.+)\]\s*$/);
      if (m) { cur = { name: m[1], lines: [] }; secs.push(cur); continue; }
      if (cur && !/^\s*[{}]\s*$/.test(l) && l.trim() !== '') cur.lines.push(l.trim());
    }
    const byName = Object.fromEntries(secs.map(s => [s.name, s]));
    let res = 192;
    for (const l of (byName.Song ? byName.Song.lines : [])) { const m = l.match(/^Resolution\s*=\s*(\d+)/); if (m) res = +m[1]; }
    const hasNotes = s => s && s.lines.some(l => /=\s*N\s/.test(l));
    const added = [];
    for (const ins of Object.keys(CHART_TRACKS)) {
      if (!allInst && ins !== 'Single') continue;
      const ex = byName['Expert' + ins];
      if (!hasNotes(ex)) continue;
      const drums = ins === 'Drums';
      const map = new Map(), extra = [];
      for (const l of ex.lines) {
        const m = l.match(/^(\d+)\s*=\s*N\s+(\d+)\s+(\d+)/);
        if (m) {
          const t = +m[1], f = +m[2], len = +m[3];
          if (!map.has(t)) map.set(t, { t, frets: [], len: 0, cym: new Set() });
          const c = map.get(t);
          if (drums) {
            if (f >= 66 && f <= 68) c.cym.add(f - 64);
            else if (f <= 5) c.frets.push(f);
          } else if (f !== 5 && f !== 6) { c.frets.push(f); c.len = Math.max(c.len, len); }
          continue;
        }
        if (/^\d+\s*=\s*(S\s+2\s|E\s)/.test(l)) extra.push(l);   // star power, solos
      }
      const chords = [...map.values()].filter(c => c.frets.length).sort((a, b) => a.t - b.t);
      for (const lv of levels) {
        if (!want.includes(lv.key) || hasNotes(byName[lv.name + ins])) continue;
        const out = [];
        for (const c of reduceChords(chords, res, lv, drums)) {
          for (const f of c.frets) {
            out.push([c.t, `${c.t} = N ${f} ${c.len}`]);
            if (drums && c.cym.has(f)) out.push([c.t, `${c.t} = N ${f + 64} 0`]);
          }
        }
        for (const e of extra) out.push([parseInt(e, 10), e]);
        out.sort((a, b) => a[0] - b[0]);
        const name = lv.name + ins, newLines = out.map(x => x[1]);
        if (byName[name]) byName[name].lines = newLines;
        else { const sec = { name, lines: newLines }; secs.splice(secs.indexOf(ex) + 1, 0, sec); byName[name] = sec; }
        added.push(`${lv.key}:${CHART_TRACKS[ins]}`);
      }
    }
    if (!added.length) return { added };
    const txt = secs.map(s => `[${s.name}]\r\n{\r\n${s.lines.map(l => '  ' + l + '\r\n').join('')}}\r\n`).join('');
    return { added, text: txt };
  }

  /* ---------- MIDI ---------- */
  function readVar(u8, p) { let v = 0, b; do { b = u8[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return [v, p]; }
  function writeVar(v, out) { const b = [v & 0x7f]; while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80); for (const x of b) out.push(x); }

  function parseMidi(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const tag = p => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    if (tag(0) !== 'MThd') throw new Error('MIDI inválido');
    const hlen = dv.getUint32(0 + 4), fmt = dv.getUint16(8), ntr = dv.getUint16(10), div = dv.getUint16(12);
    let p = 8 + hlen; const tracks = [];
    for (let k = 0; k < ntr && p < u8.length; k++) {
      const id = tag(p), len = dv.getUint32(p + 4); p += 8; const end = p + len;
      if (id !== 'MTrk') { p = end; continue; }
      let t = 0, rs = 0, d, q, l; const ev = [];
      while (p < end) {
        [d, p] = readVar(u8, p); t += d;
        let st = u8[p];
        if (st === 0xFF) { const type = u8[p + 1]; [l, q] = readVar(u8, p + 2); ev.push({ t, meta: type, data: u8.slice(q, q + l) }); p = q + l; }
        else if (st === 0xF0 || st === 0xF7) { [l, q] = readVar(u8, p + 1); ev.push({ t, raw: u8.slice(p, q + l) }); p = q + l; }
        else {
          if (st & 0x80) { p++; rs = st; } else st = rs;
          const hi = st & 0xF0, n = (hi === 0xC0 || hi === 0xD0) ? 1 : 2;
          ev.push({ t, st, d1: u8[p], d2: n === 2 ? u8[p + 1] : 0, n }); p += n;
        }
      }
      tracks.push(ev); p = end;
    }
    return { fmt, div, tracks };
  }

  function writeMidi(m) {
    const chunks = [];
    const be32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    chunks.push(Uint8Array.from([0x4D, 0x54, 0x68, 0x64, ...be32(6), 0, m.fmt, (m.tracks.length >> 8) & 255, m.tracks.length & 255, (m.div >> 8) & 255, m.div & 255]));
    for (const ev of m.tracks) {
      const body = []; let last = 0, maxT = 0;
      const evs = ev.filter(e => e.meta !== 0x2F);
      for (const e of evs) maxT = Math.max(maxT, e.t);
      evs.push({ t: maxT, meta: 0x2F, data: new Uint8Array(0) });
      for (const e of evs) {
        writeVar(e.t - last, body); last = e.t;
        if (e.meta !== undefined) { body.push(0xFF, e.meta); writeVar(e.data.length, body); for (const x of e.data) body.push(x); }
        else if (e.raw) { for (const x of e.raw) body.push(x); }
        else { body.push(e.st, e.d1); if (e.n === 2) body.push(e.d2); }
      }
      chunks.push(Uint8Array.from([0x4D, 0x54, 0x72, 0x6B, ...be32(body.length)]), Uint8Array.from(body));
    }
    const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  const MIDI_TRACKS = { 'PART GUITAR': 'guitar', 'PART GUITAR COOP': 'guitar', 'PART RHYTHM': 'rhythm', 'PART BASS': 'bass', 'PART KEYS': 'keys', 'PART DRUMS': 'drums' };

  function reduceMidi(u8, want, allInst, levels = LEVELS) {
    const m = parseMidi(u8), res = m.div, added = [];
    const latin = new TextDecoder('latin1');
    for (const ev of m.tracks) {
      const nameEv = ev.find(e => e.meta === 3);
      const tname = nameEv ? latin.decode(nameEv.data).trim() : '';
      const inst = MIDI_TRACKS[tname];
      if (!inst || (!allInst && tname !== 'PART GUITAR')) continue;
      const drums = inst === 'drums';
      const isOn = e => e.st !== undefined && (e.st & 0xF0) === 0x90 && e.d2 > 0;
      const isOff = e => e.st !== undefined && ((e.st & 0xF0) === 0x80 || ((e.st & 0xF0) === 0x90 && e.d2 === 0));
      const open = new Map(), map = new Map(); let chan = 0;
      for (const e of ev) {
        if (e.st === undefined || e.d1 < 96 || e.d1 > 100) continue;
        if (isOn(e)) { open.set(e.d1, e.t); chan = e.st & 0x0F; }
        else if (isOff(e) && open.has(e.d1)) {
          const t = open.get(e.d1); open.delete(e.d1);
          if (!map.has(t)) map.set(t, { t, frets: [], len: 0 });
          const c = map.get(t); c.frets.push(e.d1 - 96); c.len = Math.max(c.len, e.t - t);
        }
      }
      if (!map.size) continue;
      const chords = [...map.values()].sort((a, b) => a.t - b.t);
      let changed = false;
      for (const lv of levels) {
        if (!want.includes(lv.key)) continue;
        if (ev.some(e => isOn(e) && e.d1 >= lv.midi && e.d1 <= lv.midi + 4)) continue;
        for (const c of reduceChords(chords, res, lv, drums)) {
          const len = c.len > 0 ? c.len : Math.max(1, res >> 4);
          for (const f of c.frets) {
            if (f === 7) continue;
            ev.push({ t: c.t, st: 0x90 | chan, d1: lv.midi + f, d2: 100, n: 2, pri: 1 });
            ev.push({ t: c.t + len, st: 0x80 | chan, d1: lv.midi + f, d2: 0, n: 2, pri: -1 });
          }
        }
        added.push(`${lv.key}:${inst}`); changed = true;
      }
      if (changed) {
        ev.forEach((e, i) => { e._i = i; });
        ev.sort((a, b) => a.t - b.t || (a.pri || 0) - (b.pri || 0) || a._i - b._i);
      }
    }
    return { added, data: added.length ? writeMidi(m) : null };
  }

  /* Adds the missing difficulties to a .sng. want: ['E','M','H']. Returns { bytes, added, format }. */
  function processSng(buf, want, allInst, knobs) {
    const levels = levelsFor(knobs);
    const src = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const sng = readSng(src);
    const chart = sng.files.find(f => /\.chart$/i.test(f.name));
    const mid = sng.files.find(f => /\.midi?$/i.test(f.name));
    let added = [], format = chart ? 'chart' : mid ? 'mid' : 'otro';
    if (chart) {
      const r = reduceChartText(utf8.decode(chart.data), want, allInst, levels);
      added = r.added; if (r.text) chart.data = enc.encode(r.text);
    } else if (mid) {
      const r = reduceMidi(mid.data, want, allInst, levels);
      added = r.added; if (r.data) mid.data = r.data;
    }
    return { bytes: added.length ? writeSng(sng) : src, added, format };
  }

  /* Difficulties per instrument actually present in a .sng: { guitar: ['E','M','H','X'], ... } */
  function sngDifficulties(buf) {
    const sng = buf.files ? buf : readSng(buf), out = {};
    const add = (inst, k) => { (out[inst] = out[inst] || new Set()).add(k); };
    const chart = sng.files.find(f => /\.chart$/i.test(f.name));
    const mid = sng.files.find(f => /\.midi?$/i.test(f.name));
    if (chart) {
      const text = utf8.decode(chart.data);
      const re = /\[(Easy|Medium|Hard|Expert)(Single|DoubleGuitar|DoubleRhythm|DoubleBass|Keyboard|Drums)\]\s*\{([^}]*)\}/g;
      let m;
      while ((m = re.exec(text))) if (/=\s*N\s/.test(m[3])) add(CHART_TRACKS[m[2]], { Easy: 'E', Medium: 'M', Hard: 'H', Expert: 'X' }[m[1]]);
    } else if (mid) {
      const latin = new TextDecoder('latin1');
      for (const ev of parseMidi(mid.data).tracks) {
        const nameEv = ev.find(e => e.meta === 3);
        const inst = MIDI_TRACKS[nameEv ? latin.decode(nameEv.data).trim() : ''];
        if (!inst) continue;
        for (const e of ev) {
          if (e.st === undefined || (e.st & 0xF0) !== 0x90 || !e.d2) continue;
          for (const [k, base] of [['E', 60], ['M', 72], ['H', 84], ['X', 96]]) if (e.d1 >= base && e.d1 <= base + 4) add(inst, k);
        }
      }
    }
    for (const k of Object.keys(out)) out[k] = ['E', 'M', 'H', 'X'].filter(x => out[k].has(x));
    return out;
  }

  /* ---------- Chorus Encore ---------- */
  const API = 'https://api.enchor.us/search', FILES = 'https://files.enchor.us/';
  const sleep = ms => new Promise(s => setTimeout(s, ms));

  async function encoreSearch(q, page) {
    for (let i = 0; i < 5; i++) {
      const r = await fetch(API, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ search: q, page: page || 1, instrument: null, difficulty: null, drumType: null, source: 'website' })
      });
      if (r.ok) return r.json();
      await sleep(2000 * (i + 1));
    }
    throw new Error('El buscador de Chorus Encore está ocupado, intenta de nuevo en un momento.');
  }

  // onProgress(loadedBytes, totalBytes) is optional
  async function fetchSng(md5, onProgress) {
    for (let i = 0; i < 4; i++) {
      const r = await fetch(FILES + md5 + '.sng');
      if (r.ok) {
        const total = +r.headers.get('content-length') || 0;
        if (!onProgress || !r.body || !r.body.getReader) return new Uint8Array(await r.arrayBuffer());
        const reader = r.body.getReader(), parts = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value); got += value.length; onProgress(got, total);
        }
        const out = new Uint8Array(got);
        let p = 0; for (const c of parts) { out.set(c, p); p += c.length; }
        return out;
      }
      await sleep(2000 * (i + 1));
    }
    throw new Error('No se pudo descargar la canción');
  }

  /* Parses only the header of a .sng (metadata + file index), so big files can be read in slices. */
  function readSngIndex(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (utf8.decode(u8.subarray(0, 6)) !== 'SNGPKG') throw new Error('No es un archivo .sng');
    let p = 10;
    const mask = u8.slice(p, p + 16); p += 16;
    p += 8;
    const mcount = Number(dv.getBigUint64(p, true)); p += 8;
    const meta = {};
    for (let i = 0; i < mcount; i++) {
      const kl = dv.getInt32(p, true); p += 4; const k = utf8.decode(u8.subarray(p, p + kl)); p += kl;
      const vl = dv.getInt32(p, true); p += 4; meta[k] = utf8.decode(u8.subarray(p, p + vl)); p += vl;
    }
    p += 8;
    const fcount = Number(dv.getBigUint64(p, true)); p += 8;
    const index = [];
    for (let i = 0; i < fcount; i++) {
      const nl = u8[p++]; const name = utf8.decode(u8.subarray(p, p + nl)); p += nl;
      const len = Number(dv.getBigUint64(p, true)); p += 8;
      const off = Number(dv.getBigUint64(p, true)); p += 8;
      index.push({ name, len, off });
    }
    return { mask, meta, index };
  }

  /* ---------- notes on a timeline (for the preview player) ---------- */
  // tempo: [{ tick, uspq }] sorted; returns tick -> seconds
  function tempoMap(tempo, res) {
    const segs = []; let sec = 0;
    const list = tempo.length && tempo[0].tick === 0 ? tempo : [{ tick: 0, uspq: 500000 }, ...tempo];
    for (let i = 0; i < list.length; i++) {
      segs.push({ tick: list[i].tick, sec, uspq: list[i].uspq });
      if (i + 1 < list.length) sec += (list[i + 1].tick - list[i].tick) / res * list[i].uspq / 1e6;
    }
    return tick => {
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].tick <= tick) lo = mid; else hi = mid - 1; }
      const s = segs[lo];
      return s.sec + (tick - s.tick) / res * s.uspq / 1e6;
    };
  }

  const inPhrase = (phrases, t) => phrases.some(([a, b]) => t >= a && t < b);

  function notesFromChart(text) {
    const secs = {}; let cur = null;
    for (const l of text.replace(/^﻿/, '').split(/\r?\n/)) {
      const m = l.match(/^\s*\[(.+)\]\s*$/);
      if (m) { cur = secs[m[1]] = []; continue; }
      if (cur && !/^\s*[{}]\s*$/.test(l) && l.trim()) cur.push(l.trim());
    }
    let res = 192, offset = 0;
    for (const l of secs.Song || []) {
      let m = l.match(/^Resolution\s*=\s*(\d+)/); if (m) res = +m[1];
      m = l.match(/^Offset\s*=\s*([-\d.]+)/); if (m) offset = parseFloat(m[1]) || 0;
    }
    const tempo = [];
    for (const l of secs.SyncTrack || []) { const m = l.match(/^(\d+)\s*=\s*B\s+(\d+)/); if (m && +m[2] > 0) tempo.push({ tick: +m[1], uspq: 6e10 / +m[2] }); }
    tempo.sort((a, b) => a.tick - b.tick);
    const toSec = tempoMap(tempo, res);
    const tracks = {};
    for (const [name, lines] of Object.entries(secs)) {
      const m = name.match(/^(Easy|Medium|Hard|Expert)(Single|DoubleGuitar|DoubleRhythm|DoubleBass|Keyboard|Drums)$/);
      if (!m) continue;
      const inst = CHART_TRACKS[m[2]], diff = { Easy: 'E', Medium: 'M', Hard: 'H', Expert: 'X' }[m[1]];
      if (m[2] === 'DoubleGuitar' && tracks.guitar) continue;
      const drums = inst === 'drums', sp = [], byTick = new Map();
      for (const l of lines) {
        const n = l.match(/^(\d+)\s*=\s*([NS])\s+(\d+)\s+(\d+)/);
        if (!n) continue;
        const t = +n[1], a = +n[3], len = +n[4];
        if (n[2] === 'S') { if (a === 2) sp.push([t, t + len]); continue; }
        let lane;
        if (drums) { if (a > 5) continue; lane = a; }
        else { if (a === 7) lane = -1; else if (a <= 4) lane = a; else continue; }
        if (!byTick.has(t)) byTick.set(t, { tick: t, lanes: [], len: 0 });
        const c = byTick.get(t); c.lanes.push(lane); c.len = Math.max(c.len, len);
      }
      if (!byTick.size) continue;
      const notes = [...byTick.values()].sort((a, b) => a.tick - b.tick).map(c => ({
        t: toSec(c.tick) + offset,
        end: c.len >= res / 3 && !drums ? toSec(c.tick + c.len) + offset : 0,
        lanes: c.lanes, sp: inPhrase(sp, c.tick),
      }));
      (tracks[inst] = tracks[inst] || {})[diff] = notes;
    }
    return tracks;
  }

  function notesFromMidi(u8) {
    const m = parseMidi(u8), res = m.div, latin = new TextDecoder('latin1');
    const tempo = [];
    for (const ev of m.tracks) for (const e of ev) if (e.meta === 0x51 && e.data.length === 3) tempo.push({ tick: e.t, uspq: (e.data[0] << 16) | (e.data[1] << 8) | e.data[2] });
    tempo.sort((a, b) => a.tick - b.tick);
    const toSec = tempoMap(tempo, res);
    const tracks = {};
    for (const ev of m.tracks) {
      const nameEv = ev.find(e => e.meta === 3);
      const tname = nameEv ? latin.decode(nameEv.data).trim() : '';
      const inst = MIDI_TRACKS[tname];
      if (!inst || (tname === 'PART GUITAR COOP' && tracks.guitar)) continue;
      const drums = inst === 'drums';
      const open = new Map(), raw = [], sp = [];
      for (const e of ev) {
        if (e.st === undefined) continue;
        const hi = e.st & 0xF0, on = hi === 0x90 && e.d2 > 0, off = hi === 0x80 || (hi === 0x90 && e.d2 === 0);
        if (on) open.set(e.d1, e.t);
        else if (off && open.has(e.d1)) { const t0 = open.get(e.d1); open.delete(e.d1); raw.push([e.d1, t0, e.t]); }
      }
      for (const [n, a, b] of raw) if (n === 116) sp.push([a, b]);
      for (const [diff, base] of [['E', 60], ['M', 72], ['H', 84], ['X', 96]]) {
        const byTick = new Map();
        for (const [n, a, b] of raw) {
          if (n < base || n > base + 4) continue;
          if (!byTick.has(a)) byTick.set(a, { tick: a, lanes: [], len: 0 });
          const c = byTick.get(a); c.lanes.push(n - base); c.len = Math.max(c.len, b - a);
        }
        if (!byTick.size) continue;
        (tracks[inst] = tracks[inst] || {})[diff] = [...byTick.values()].sort((x, y) => x.tick - y.tick).map(c => ({
          t: toSec(c.tick),
          end: !drums && c.len >= res / 3 ? toSec(c.tick + c.len) : 0,
          lanes: c.lanes, sp: inPhrase(sp, c.tick),
        }));
      }
    }
    return tracks;
  }

  /* Everything the preview needs from a .sng: notes per instrument/level (in seconds) and the audio stems. */
  function songTimeline(buf) {
    const sng = buf.files ? buf : readSng(buf);
    const meta = Object.fromEntries(sng.meta);
    const chart = sng.files.find(f => /\.chart$/i.test(f.name));
    const mid = sng.files.find(f => /\.midi?$/i.test(f.name));
    const tracks = chart ? notesFromChart(utf8.decode(chart.data)) : mid ? notesFromMidi(mid.data) : {};
    const delay = (parseFloat(meta.delay) || 0) / 1000;
    if (delay) for (const lv of Object.values(tracks)) for (const notes of Object.values(lv)) for (const n of notes) { n.t += delay; if (n.end) n.end += delay; }
    const audio = sng.files.filter(f => /\.(ogg|opus|mp3|wav)$/i.test(f.name) && !/^preview\./i.test(f.name));
    const image = sng.files.find(f => /^album\.(jpe?g|png)$/i.test(f.name));
    const bgImage = sng.files.find(f => /^background\.(jpe?g|png)$/i.test(f.name));
    const bgVideo = sng.files.find(f => /^video\.(mp4|webm|ogv)$/i.test(f.name));
    // lyric times, with the same delay and offset as the notes
    let lyrics = [];
    const lclock = (() => {
      const text = chart ? utf8.decode(chart.data) : '';
      const res = chart ? +(text.match(/Resolution\s*=\s*(\d+)/) || [0, 192])[1] : (mid ? parseMidi(mid.data).div : 192);
      const off = chart ? parseFloat((text.match(/Offset\s*=\s*([-\d.]+)/) || [0, 0])[1]) || 0 : 0;
      const tempo = [];
      if (chart) { for (const b of text.matchAll(/^\s*(\d+)\s*=\s*B\s+(\d+)/gm)) if (+b[2] > 0) tempo.push({ tick: +b[1], uspq: 6e10 / +b[2] }); }
      else if (mid) { for (const ev of parseMidi(mid.data).tracks) for (const e of ev) if (e.meta === 0x51 && e.data.length === 3) tempo.push({ tick: e.t, uspq: (e.data[0] << 16) | (e.data[1] << 8) | e.data[2] }); }
      tempo.sort((a, b) => a.tick - b.tick);
      const f = tempoMap(tempo, res);
      return tick => f(tick) + off + delay;
    })();
    if (chart) lyrics = lyricsFromChart(utf8.decode(chart.data), lclock);
    else if (mid) lyrics = lyricsFromMidi(mid.data, lclock);
    return { meta, tracks, audio, image, bgImage, bgVideo, lyrics };
  }

  /* ---------- seconds <-> ticks for an existing chart ---------- */
  function songClock(sng) {
    const meta = Object.fromEntries(sng.meta);
    const delay = (parseFloat(meta.delay) || 0) / 1000;
    const chart = sng.files.find(f => /\.chart$/i.test(f.name));
    const mid = sng.files.find(f => /\.midi?$/i.test(f.name));
    let res = 192, offset = delay, tempo = [];
    if (chart) {
      const text = utf8.decode(chart.data);
      let m = text.match(/Resolution\s*=\s*(\d+)/); if (m) res = +m[1];
      m = text.match(/Offset\s*=\s*([-\d.]+)/); if (m) offset += parseFloat(m[1]) || 0;
      for (const b of text.matchAll(/^\s*(\d+)\s*=\s*B\s+(\d+)/gm)) if (+b[2] > 0) tempo.push({ tick: +b[1], uspq: 6e10 / +b[2] });
    } else if (mid) {
      const p = parseMidi(mid.data); res = p.div;
      for (const ev of p.tracks) for (const e of ev) if (e.meta === 0x51 && e.data.length === 3) tempo.push({ tick: e.t, uspq: (e.data[0] << 16) | (e.data[1] << 8) | e.data[2] });
    }
    tempo.sort((a, b) => a.tick - b.tick);
    const list = tempo.length && tempo[0].tick === 0 ? tempo : [{ tick: 0, uspq: 500000 }, ...tempo];
    const segs = []; let sec = 0;
    list.forEach((s, i) => {
      segs.push({ tick: s.tick, sec, uspq: s.uspq });
      if (i + 1 < list.length) sec += (list[i + 1].tick - s.tick) / res * s.uspq / 1e6;
    });
    const toTick = seconds => {
      const t = seconds - offset;
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].sec <= t) lo = m; else hi = m - 1; }
      return Math.max(0, Math.round(segs[lo].tick + (t - segs[lo].sec) * 1e6 / segs[lo].uspq * res));
    };
    return { res, toTick };
  }

  /* ---------- lyrics ---------- */
  const latinDecoder = () => new TextDecoder('latin1');
  function vocalsTrack(m) {
    return m.tracks.find(ev => { const n = ev.find(e => e.meta === 3); return n && latinDecoder().decode(n.data).trim() === 'PART VOCALS'; });
  }
  const isLyricEvent = e => (e.meta === 5 || e.meta === 1) && e.data.length && e.data[0] !== 0x5B;   // skips [events]

  function hasLyrics(sng) {
    const chart = sng.files.find(f => /\.chart$/i.test(f.name));
    if (chart) return /=\s*E\s+"lyric /.test(utf8.decode(chart.data));
    const mid = sng.files.find(f => /\.midi?$/i.test(f.name));
    if (!mid) return false;
    const v = vocalsTrack(parseMidi(mid.data));
    return !!v && v.some(isLyricEvent);
  }

  // "[mm:ss.xx] text" lines -> [{ t, text }]
  function parseLrc(text) {
    const out = [];
    for (const line of String(text).split(/\r?\n/)) {
      const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      if (!tags.length) continue;
      const body = line.replace(/\[[^\]]*\]/g, '').trim();
      for (const t of tags) out.push({ t: +t[1] * 60 + parseFloat(t[2]), text: body });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  // LRCLIB times whole lines; words are spread inside each line in proportion to their length
  function lrcToPhrases(lines, duration) {
    const phrases = [];
    lines.forEach((l, i) => {
      const words = l.text.split(/\s+/)
        .map(w => w.replace(/["\\_§/%+#^*$<>]/g, '').replace(/-+/g, '=').replace(/^=+|=+$/g, ''))
        .filter(Boolean);
      if (!words.length) return;
      const next = i + 1 < lines.length ? lines[i + 1].t : (duration || l.t + 8);
      const chars = words.reduce((s, w) => s + w.length + 1, 0);
      const end = Math.max(l.t + 0.3, Math.min(next - 0.05, l.t + Math.max(1, chars * 0.1)));
      let used = 0;
      const timed = words.map(w => { const t = l.t + (end - l.t) * used / chars; used += w.length + 1; return { t, text: w }; });
      phrases.push({ t: l.t, end, words: timed });
    });
    return phrases;
  }

  async function findLyrics({ artist, name, duration }) {
    const clean = s => String(s || '').replace(/\(.*?\)|\[.*?\]/g, '').trim();
    const url = 'https://lrclib.net/api/search?artist_name=' + encodeURIComponent(clean(artist)) + '&track_name=' + encodeURIComponent(clean(name));
    let r = null;
    for (let i = 0; i < 3; i++) {   // a busy server is not the same as "no lyrics"
      r = await fetch(url);
      if (r.ok || (r.status !== 429 && r.status < 500)) break;
      await sleep(2000 * (i + 1));
    }
    if (!r.ok) return null;
    const list = await r.json();
    const key = s => norm(clean(s)).replace(/[^a-z0-9]/g, '');
    const a = key(artist), n = key(name);
    const hits = (Array.isArray(list) ? list : []).filter(x => {
      if (!x.syncedLyrics || x.instrumental) return false;
      const xa = key(x.artistName), xn = key(x.trackName);
      if (!(xa.includes(a) || a.includes(xa)) || !(xn.includes(n) || n.includes(xn))) return false;
      // another length usually means another recording, and the lyrics would run out of sync
      return !duration || !x.duration || Math.abs(x.duration - duration) <= 5;
    }).sort((p, q) => Math.abs((p.duration || 0) - (duration || 0)) - Math.abs((q.duration || 0) - (duration || 0)));
    return hits.length ? parseLrc(hits[0].syncedLyrics) : null;
  }

  // keeps what the section already has and merges the new lines in tick order
  function mergeChartEvents(text, lines) {
    const re = /\[Events\]\s*\{([\s\S]*?)\}/;
    const m = text.match(re);
    const old = m ? m[1].split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
    const all = [...old, ...lines].map((l, i) => [parseInt(l, 10), i, l]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const section = `[Events]\r\n{\r\n${all.map(x => '  ' + x[2]).join('\r\n')}\r\n}`;
    if (m) return text.replace(re, () => section);
    const at = text.search(/\[(Easy|Medium|Hard|Expert)/);
    return at < 0 ? text + section + '\r\n' : text.slice(0, at) + section + '\r\n' + text.slice(at);
  }

  /* Adds timed lyrics to a chart without them. phrases: [{ t, end, words: [{ t, text }] }] in seconds. */
  function addLyrics(sng, phrases) {
    const clock = songClock(sng);
    const chart = sng.files.find(f => /\.chart$/i.test(f.name));
    const mid = sng.files.find(f => /\.midi?$/i.test(f.name));
    if (chart) {
      const lines = [];
      for (const p of phrases) {
        lines.push(`${clock.toTick(p.t)} = E "phrase_start"`);
        for (const w of p.words) lines.push(`${clock.toTick(w.t)} = E "lyric ${w.text}"`);
        lines.push(`${clock.toTick(p.end)} = E "phrase_end"`);
      }
      chart.data = enc.encode(mergeChartEvents(utf8.decode(chart.data).replace(/^\uFEFF/, ''), lines));
    } else if (mid) {
      const m = parseMidi(mid.data);
      let ev = vocalsTrack(m);
      if (!ev) { ev = [{ t: 0, meta: 3, data: enc.encode('PART VOCALS') }]; m.tracks.push(ev); }
      for (const p of phrases) {
        const a = clock.toTick(p.t), b = Math.max(a + 1, clock.toTick(p.end));
        ev.push({ t: a, st: 0x90, d1: 105, d2: 100, n: 2, pri: 1 }, { t: b, st: 0x80, d1: 105, d2: 0, n: 2, pri: -1 });
        for (const w of p.words) ev.push({ t: clock.toTick(w.t), meta: 5, data: enc.encode(w.text) });
      }
      ev.forEach((e, i) => { e._i = i; });
      ev.sort((x, y) => x.t - y.t || (x.pri || 0) - (y.pri || 0) || x._i - y._i);
      mid.data = writeMidi(m);
    } else return false;
    return true;
  }

  function lyricsFromChart(text, toSec) {
    const phrases = []; let cur = null;
    for (const m of text.matchAll(/^\s*(\d+)\s*=\s*E\s+"(phrase_start|phrase_end|lyric (.*))"\s*$/gm)) {
      const t = toSec(+m[1]);
      if (m[2] === 'phrase_start') { cur = { t, end: t, words: [] }; phrases.push(cur); }
      else if (m[2] === 'phrase_end') { if (cur) cur.end = t; cur = null; }
      else { if (!cur) { cur = { t, end: t, words: [] }; phrases.push(cur); } cur.words.push({ t, text: m[3] }); cur.end = Math.max(cur.end, t + 0.4); }
    }
    return phrases.filter(p => p.words.length);
  }

  function lyricsFromMidi(u8, toSec) {
    const m = parseMidi(u8), ev = vocalsTrack(m);
    if (!ev) return [];
    const spans = []; let open = null;
    for (const e of ev) {
      if (e.st === undefined || e.d1 !== 105) continue;
      const on = (e.st & 0xF0) === 0x90 && e.d2 > 0;
      if (on) open = e.t; else if (open !== null) { spans.push([open, e.t]); open = null; }
    }
    const phrases = spans.map(([a, b]) => ({ t: toSec(a), end: toSec(b), a, b, words: [] }));
    for (const e of ev) {
      if (!isLyricEvent(e)) continue;
      const p = phrases.find(x => e.t >= x.a && e.t < x.b);
      if (p) p.words.push({ t: toSec(e.t), text: utf8.decode(e.data) });
    }
    return phrases.filter(p => p.words.length);
  }

  /* ---------- drum track from detected hits ---------- */
  function hasDrums(sng) { return !!sngDifficulties(sng).drums; }

  /* hits: [{ t, lane }] in seconds; lane 0 kick, 1 red, 2 yellow, 3 blue, 4 green. Snapped to 16ths of the song's own tempo map. */
  function addDrumTrack(sng, hits) {
    const clock = songClock(sng), grid = clock.res / 4, byTick = new Map();
    for (const h of hits) {
      // hi-hats go on 8ths, as charters usually simplify them; the rest on 16ths
      const step = h.lane === 2 ? grid * 2 : grid;
      const tick = Math.round(clock.toTick(h.t) / step) * step;
      if (!byTick.has(tick)) byTick.set(tick, new Set());
      byTick.get(tick).add(h.lane);
    }
    const ticks = [...byTick.keys()].sort((a, b) => a - b);
    const chart = sng.files.find(f => /\.chart$/i.test(f.name));
    const mid = sng.files.find(f => /\.midi?$/i.test(f.name));
    if (chart) {
      const lines = [];
      for (const t of ticks) for (const l of [...byTick.get(t)].sort()) {
        lines.push(`  ${t} = N ${l} 0`);
        if (l === 2 || l === 4) lines.push(`  ${t} = N ${64 + l} 0`);   // yellow and green are cymbals
      }
      chart.data = enc.encode(utf8.decode(chart.data).replace(/\s*$/, '\r\n') + `[ExpertDrums]\r\n{\r\n${lines.join('\r\n')}\r\n}\r\n`);
    } else if (mid) {
      const m = parseMidi(mid.data), ev = [{ t: 0, meta: 3, data: enc.encode('PART DRUMS') }], len = Math.max(1, clock.res >> 4);
      for (const t of ticks) for (const l of byTick.get(t)) {
        ev.push({ t, st: 0x90, d1: 96 + l, d2: 100, n: 2, pri: 1 }, { t: t + len, st: 0x80, d1: 96 + l, d2: 0, n: 2, pri: -1 });
      }
      ev.forEach((e, i) => { e._i = i; });
      ev.sort((x, y) => x.t - y.t || (x.pri || 0) - (y.pri || 0) || x._i - y._i);
      m.tracks.push(ev);
      mid.data = writeMidi(m);
    } else return false;
    const d = sng.meta.find(x => x[0] === 'diff_drums');
    if (d) { if (d[1] === '-1') d[1] = '2'; } else sng.meta.push(['diff_drums', '2']);
    return true;
  }

  /* ---------- custom background ---------- */
  const IMAGE_EXT = /\.(png|jpe?g)$/i, VIDEO_EXT = /\.(mp4|avi|webm|vp8|ogv|mpeg)$/i;
  /* media: { name, data }. The .sng format only registers background.png/jpg/jpeg and video.mp4/avi/webm/vp8/ogv/mpeg. */
  function setBackground(sng, media) {
    const ext = (media.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const video = VIDEO_EXT.test(ext);
    if (!video && !IMAGE_EXT.test(ext)) throw new Error('Formato de fondo no válido. Usa JPG, PNG, MP4, WEBM, AVI, OGV o MPEG.');
    const base = video ? 'video' : 'background';
    sng.files = sng.files.filter(f => !new RegExp(`^${base}\\.`, 'i').test(f.name));
    sng.files.push({ name: base + ext, data: media.data });
    return sng;
  }

  /* ---------- export as a song folder (.zip) for Moonscraper / Clone Hero ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  // files: [{ name, data }] -> zip bytes (stored, no compression: audio is already compressed)
  function makeZip(files) {
    const parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + n;
    }
    const cdLen = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  // a .sng becomes a classic song folder: song.ini + chart + audio + art, inside "Artist - Name/"
  function sngToZip(buf) {
    const sng = buf.files ? buf : readSng(buf);
    const meta = Object.fromEntries(sng.meta);
    const ini = '[song]\r\n' + Object.entries(meta).map(([k, v]) => `${k} = ${v}`).join('\r\n') + '\r\n';
    const folder = fileName({ artist: meta.artist || 'Desconocido', name: meta.name || 'Cancion' }).replace(/\.sng$/, '');
    const files = [{ name: `${folder}/song.ini`, data: enc.encode(ini) }, ...sng.files.map(f => ({ name: `${folder}/${f.name}`, data: f.data }))];
    return { folder, bytes: makeZip(files) };
  }

  /* ---------- result helpers ---------- */
  const INST_LABEL = { guitar: 'Guitarra', bass: 'Bajo', rhythm: 'Rítmica', keys: 'Teclado', drums: 'Batería' };
  const LEVEL_LABEL = { E: 'Fácil', M: 'Medio', H: 'Difícil', X: 'Experto' };
  const OFFICIAL = /Harmonix|Neversoft|Vicarious|Budcat|FreeStyleGames|Beenox/i;
  const JUNK = /Prototype|\bDemo\b|Full Album|Medley|Mashup/i;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const titleKey = s => norm(String(s).replace(/\(.*?\)|\[.*?\]/g, '')).replace(/[^a-z0-9]/g, '');

  function nativeDiffs(s) {
    const out = {};
    for (const n of (s.notesData && s.notesData.noteCounts) || []) {
      if (!INST_LABEL[n.instrument]) continue;
      (out[n.instrument] = out[n.instrument] || new Set()).add({ easy: 'E', medium: 'M', hard: 'H', expert: 'X' }[n.difficulty]);
    }
    return out;
  }
  // true when the guitar already has every wanted level
  const hasNative = (s, want) => { const g = nativeDiffs(s).guitar; return !!g && want.every(k => g.has(k)); };
  // true when the wanted levels exist or can be generated (the guitar has Expert)
  const canFill = (s, want) => { const g = nativeDiffs(s).guitar; return !!g && (g.has('X') || want.every(k => g.has(k))); };

  /* Keeps the best version of each song (native levels > official chart > studio > more instruments). */
  function pickBest(items, want) {
    const groups = new Map();
    for (const s of items) {
      if (s.driveChartIsPack || JUNK.test(s.name) || !canFill(s, want)) continue;
      const k = norm(s.artist).replace(/[^a-z0-9]/g, '') + '|' + titleKey(s.name);
      (groups.get(k) || groups.set(k, []).get(k)).push(s);
    }
    const score = s => [hasNative(s, want) ? 1 : 0, OFFICIAL.test(s.charter || '') ? 1 : 0, /live|en vivo|directo/i.test(s.name) ? 0 : 1, (s.notesData && s.notesData.instruments || []).length];
    const cmp = (a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };
    return [...groups.values()].map(g => g.sort(cmp)[0]);
  }

  /* Searches by free text, artist or genre and returns up to `limit` songs that meet `want`. */
  async function findSongs({ query, artist, genre, want = ['E', 'M', 'H'], limit = 20, onlyNative = false, maxPages = 10 }) {
    const q = query || artist || genre;
    if (!q) throw new Error('Falta qué buscar');
    const seen = new Map();
    for (let page = 1; page <= maxPages; page++) {
      const r = await encoreSearch(q, page);
      for (const s of r.data || []) seen.set(s.md5, s);
      let list = [...seen.values()];
      if (artist) list = list.filter(s => norm(s.artist).replace(/[^a-z0-9]/g, '').includes(norm(artist).replace(/[^a-z0-9]/g, '').replace(/^los/, '')));
      if (genre) list = list.filter(s => norm(s.genre).includes(norm(genre)));
      let best = pickBest(list, want);
      if (onlyNative) best = best.filter(s => hasNative(s, want));
      // look a few pages ahead so songs with native levels can be ranked first
      if ((best.length >= limit && page >= 3) || (r.data || []).length < 10) {
        best.sort((a, b) => (hasNative(b, want) - hasNative(a, want)));
        return best.slice(0, limit);
      }
    }
    return pickBest([...seen.values()], want).filter(s => !onlyNative || hasNative(s, want)).slice(0, limit);
  }

  const fileName = s => `${s.artist} - ${s.name}`.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150) + '.sng';

  function summarize(added) {
    const by = {};
    for (const a of added) { const [k, inst] = a.split(':'); (by[inst] = by[inst] || []).push(LEVEL_LABEL[k]); }
    return Object.entries(by).map(([i, ks]) => `${INST_LABEL[i]} (${ks.join(', ')})`).join('; ');
  }

  const api = {
    readSng, writeSng, readSngIndex, xorData, parseMidi, writeMidi, reduceChartText, reduceMidi, processSng, sngDifficulties, songTimeline,
    levelsFor, DEFAULT_KNOBS, makeZip, sngToZip,
    songClock, hasLyrics, parseLrc, lrcToPhrases, findLyrics, addLyrics, hasDrums, addDrumTrack, setBackground,
    encoreSearch, fetchSng, findSongs, pickBest, nativeDiffs, hasNative, canFill, fileName, summarize,
    INST_LABEL, LEVEL_LABEL, FILES,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CHB = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
