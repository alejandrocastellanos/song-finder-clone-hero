#!/usr/bin/env node
/* Prueba de calidad de los niveles creados (Difícil, Medio, Fácil).
   Toma 30 charts oficiales de Harmonix (Rock Band) de Chorus Encore, les borra sus Difícil, Medio y Fácil,
   los vuelve a crear con el motor (core/chb-core.js) y los compara con los hechos a mano.

     node cli/prueba-calidad.js            tabla de resultados; termina con error si algo baja del mínimo
     node cli/prueba-calidad.js --json     lo mismo en JSON

   Córrelo antes de publicar cualquier cambio en la generación de niveles. Necesita internet y Node 18+.

   Cifras:
   - F: qué tanto coinciden las notas (en el tiempo, ±30 ms) con las del chart oficial. 1 = idénticas.
   - botón: de las notas que coinciden, cuántas tienen exactamente los mismos botones (o tambores).
   - notas: cuántas notas pone el motor por cada nota del chart oficial (1.00 = la misma cantidad). */
'use strict';
const CHB = require('../core/chb-core.js');

const SONGS = [
  ['1d7d183cdd121bdd986fed36f2105d5c', 'Ramones - Blitzkrieg Bop'], ['e05bb846827adbf7fce960a1c8da0b68', 'Foo Fighters - Learn to Fly'],
  ['90c8f352caa02c226eaab5a82a271b95', 'Nirvana - Smells Like Teen Spirit'], ['cab3aea9703a4e3a1ec9a0d629d34417', 'The Police - Message in a Bottle'],
  ['1c670499c68fc091e32bfcb6f0bc661a', 'Metallica - Enter Sandman'], ['7dba732716406336f1a40d89ea794af8', 'The Clash - Should I Stay or Should I Go'],
  ['e1cd0a479465c913bfbdc12f77bef5b7', 'Soundgarden - Black Hole Sun'], ['6b2ba72c588554868b1460b5f9352a2d', "Bon Jovi - Livin' on a Prayer"],
  ['31052418e1e22ee0569a63a3502ab513', 'The White Stripes - Seven Nation Army'], ['b195bf59cd3f6dd437b24f8391091812', 'OK Go - Here It Goes Again'],
  ['5f17a29f9c327655a5732c6609e6d582', 'The Killers - Mr. Brightside'], ['da4934a73bc718405a126d25d7138b22', 'Nirvana - In Bloom'],
  ['2694374556538cc5368ff0d00ff6391f', 'Muse - Hysteria'], ['c56aa13f1510ea8d50b0d7961207f3a7', 'Deep Purple - Highway Star'],
  ['bdfd5e8c157fbe4674dde043019a9906', 'Blur - Song 2'], ['b8d864337ef40c442a7b390edfc3aec0', 'The Smashing Pumpkins - Today'],
  ['dd93ea53e592d590d51ec8e62f0a30f6', 'Bon Jovi - Wanted Dead or Alive'], ['42bd7fb2fe173933cc6348e032c02566', "Weezer - Say It Ain't So"],
  ['8bea87155d33434e519e8aabe2b73807', 'Sweet - Ballroom Blitz'], ['0e2433409093562fbc01b8351c7cc5c1', 'Survivor - Eye of the Tiger'],
  ['46f5796d784785a912ea11b1fae3f752', 'Billy Idol - Rebel Yell'], ['9c48d83f7f473a41553d86662eeda902', 'Lynyrd Skynyrd - Gimme Three Steps'],
  ['71351fff5d832e0efe2c32ce1ad2c1ba', 'Iron Maiden - Run to the Hills'], ['4c8f3677af6bab5f3ef616dc9576f91e', 'Yeah Yeah Yeahs - Maps'],
  ['c604bdcf962898eb14fc91103785e5e7', 'The All-American Rejects - Dirty Little Secret'], ['298207f547cea6794db62cdaea5005d1', 'KISS - Detroit Rock City'],
  ['41b2c5b5f1bcef8be95e0173c9297305', 'David Bowie - Suffragette City'], ['c7ec949d9057fd6fa72d2e29e0583182', 'Beastie Boys - Sabotage'],
  ['df4ae1440ea1f2ae4144af43f3abee2d', 'Modest Mouse - Float On'], ['a57effe7caf6d1daa49c21d4758d49e9', 'The Strokes - Reptilia'],
];

// Measured on 2026-11-21 over these 30 songs (F / botón), minus 0.03: a change that goes below is a step back.
const FLOOR = {
  'guitar H': [0.84, 0.80], 'guitar M': [0.77, 0.44], 'guitar E': [0.69, 0.58],
  'bass H': [0.87, 0.86], 'bass M': [0.81, 0.63], 'bass E': [0.76, 0.73],
  'drums H': [0.90, 0.78], 'drums M': [0.90, 0.70], 'drums E': [0.71, 0.59],
};
const INST = { 'PART GUITAR': 'guitar', 'PART BASS': 'bass', 'PART DRUMS': 'drums' };
const LEVEL = { H: 84, M: 72, E: 60, X: 96 };

function tempoMap(tempo, res) {
  const list = tempo.length && tempo[0].tick === 0 ? tempo : [{ tick: 0, uspq: 500000 }, ...tempo], segs = [];
  let sec = 0;
  list.forEach((s, i) => { segs.push({ tick: s.tick, sec, uspq: s.uspq }); if (i + 1 < list.length) sec += (list[i + 1].tick - s.tick) / res * s.uspq / 1e6; });
  return tick => { let lo = 0, hi = segs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].tick <= tick) lo = m; else hi = m - 1; } const s = segs[lo]; return s.sec + (tick - s.tick) / res * s.uspq / 1e6; };
}
const trackName = ev => { const n = ev.find(e => e.meta === 3); return n ? new TextDecoder('latin1').decode(n.data).trim() : ''; };
const isNote = e => e.st !== undefined && ((e.st & 0xF0) === 0x90 || (e.st & 0xF0) === 0x80);

// notes per instrument and level: { guitar: { X: [{ t, frets }], H: [...] }, ... }, plus the clock
function readLevels(u8) {
  const m = CHB.parseMidi(u8), res = m.div, tempo = [];
  for (const ev of m.tracks) for (const e of ev) if (e.meta === 0x51 && e.data.length === 3) tempo.push({ tick: e.t, uspq: (e.data[0] << 16) | (e.data[1] << 8) | e.data[2] });
  tempo.sort((a, b) => a.tick - b.tick);
  const out = {};
  for (const ev of m.tracks) {
    const inst = INST[trackName(ev)]; if (!inst) continue;
    out[inst] = {};
    for (const [k, base] of Object.entries(LEVEL)) {
      const at = new Map();
      for (const e of ev) if (isNote(e) && (e.st & 0xF0) === 0x90 && e.d2 > 0 && e.d1 >= base && e.d1 <= base + 4) { if (!at.has(e.t)) at.set(e.t, { t: e.t, frets: [] }); at.get(e.t).frets.push(e.d1 - base); }
      out[inst][k] = [...at.values()].sort((a, b) => a.t - b.t);
    }
  }
  return { levels: out, toSec: tempoMap(tempo, res) };
}

// the same .mid without its Hard/Medium/Easy notes, so the engine has to make them
function stripLevels(u8) {
  const m = CHB.parseMidi(u8);
  for (let i = 0; i < m.tracks.length; i++) if (INST[trackName(m.tracks[i])]) m.tracks[i] = m.tracks[i].filter(e => !(isNote(e) && e.d1 >= 60 && e.d1 <= 88));
  return CHB.writeMidi(m);
}

function compare(ours, truth, toSec) {
  const tS = truth.map(c => toSec(c.t)), oS = ours.map(c => toSec(c.t));
  const near = t => { let lo = 0, hi = tS.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (tS[m] < t) lo = m + 1; else hi = m; } return lo && Math.abs(tS[lo - 1] - t) < Math.abs(tS[lo] - t) ? lo - 1 : lo; };
  let hit = 0, same = 0;
  ours.forEach((c, i) => { const j = near(oS[i]); if (Math.abs(tS[j] - oS[i]) <= 0.03) { hit++; if ([...new Set(c.frets)].sort().join() === [...new Set(truth[j].frets)].sort().join()) same++; } });
  const P = hit / ours.length, R = hit / truth.length;
  return { F: 2 * P * R / (P + R || 1), boton: same / (hit || 1), notas: ours.length / truth.length };
}

// one song: { 'guitar H': { F, boton, notas }, ... }
function evaluate(midBytes) {
  const truth = readLevels(midBytes);
  const made = CHB.reduceMidi(stripLevels(midBytes), ['E', 'M', 'H'], true);
  if (!made.data) return {};
  const ours = readLevels(made.data), out = {};
  for (const inst of Object.keys(truth.levels)) for (const k of ['H', 'M', 'E']) {
    const t = truth.levels[inst][k], o = ours.levels[inst] && ours.levels[inst][k];
    if (t && t.length && o && o.length && truth.levels[inst].X.length) out[`${inst} ${k}`] = compare(o, t, truth.toSec);
  }
  return out;
}

async function main() {
  const json = process.argv.includes('--json'), sums = {}, counts = {};
  for (const [md5, name] of SONGS) {
    try {
      const sng = CHB.readSng(await CHB.fetchSng(md5));
      const mid = sng.files.find(f => /\.mid$/i.test(f.name));
      if (!mid) { if (!json) console.log(`(sin .mid) ${name}`); continue; }
      const r = evaluate(mid.data);
      for (const [k, v] of Object.entries(r)) { sums[k] = sums[k] || { F: 0, boton: 0, notas: 0 }; for (const x in v) sums[k][x] += v[x]; counts[k] = (counts[k] || 0) + 1; }
      if (!json) console.log(`ok  ${name}`);
    } catch (e) { if (!json) console.log(`ERROR ${name}: ${e.message}`); }
  }
  const rows = Object.keys(FLOOR).filter(k => counts[k]).map(k => {
    const n = counts[k], F = sums[k].F / n, boton = sums[k].boton / n, notas = sums[k].notas / n;
    return { nivel: k, canciones: n, F: +F.toFixed(3), boton: +boton.toFixed(3), notas: +notas.toFixed(2), ok: F >= FLOOR[k][0] && boton >= FLOOR[k][1] };
  });
  if (json) console.log(JSON.stringify(rows, null, 2));
  else {
    const name = { guitar: 'Guitarra', bass: 'Bajo', drums: 'Batería' }, lvl = { H: 'Difícil', M: 'Medio', E: 'Fácil' };
    console.log('\nNivel              F      botón   notas   mínimo (F / botón)');
    for (const r of rows) { const [i, k] = r.nivel.split(' '); console.log(`${(name[i] + ' ' + lvl[k]).padEnd(18)} ${r.F.toFixed(2)}   ${r.boton.toFixed(2)}    ${r.notas.toFixed(2)}    ${FLOOR[r.nivel].join(' / ')}  ${r.ok ? 'OK' : '⚠ BAJÓ'}`); }
  }
  if (rows.length < Object.keys(FLOOR).length || rows.some(r => !r.ok)) { if (!json) console.log('\n⚠ La calidad bajó (o no se pudo medir todo). Revisa el cambio antes de publicarlo.'); process.exit(1); }
  if (!json) console.log('\nTodo en orden: los niveles creados siguen igual o mejor que lo medido.');
}

if (require.main === module) main().catch(e => { console.error('Error: ' + e.message); process.exit(1); });
module.exports = { evaluate, SONGS, FLOOR };
