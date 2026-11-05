#!/usr/bin/env node
/* CH Buscador CLI: the same engine as the web app, for agents and terminals. Node 18+. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const CHB = require('../core/chb-core.js');

const LAST = path.join(os.tmpdir(), 'chb-ultima-busqueda.json');
const LEVEL_IN = { facil: 'E', fácil: 'E', easy: 'E', e: 'E', medio: 'M', medium: 'M', m: 'M', dificil: 'H', difícil: 'H', hard: 'H', h: 'H' };

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2), next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[k] = true; else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function levels(v) {
  if (!v || v === true) return ['E', 'M', 'H'];
  const ks = String(v).split(',').map(s => LEVEL_IN[s.trim().toLowerCase()]).filter(Boolean);
  if (!ks.length) throw new Error('Niveles no válidos. Usa: facil,medio,dificil');
  return [...new Set(ks)];
}

// --densidad -2..2 (o muchas-menos, menos, normal, mas, muchas-mas), --sin-acordes, --naranja-medio
function knobs(o) {
  const words = { 'muchas-menos': -2, menos: -1, normal: 0, mas: 1, 'más': 1, 'muchas-mas': 2, 'muchas-más': 2 };
  let d = o.densidad === undefined || o.densidad === true ? 0 : (words[String(o.densidad).toLowerCase()] ?? parseInt(o.densidad, 10));
  if (!Number.isFinite(d) || d < -2 || d > 2) throw new Error('--densidad va de -2 (menos notas) a 2 (más notas)');
  return { density: d, chords: !o['sin-acordes'], orangeMedium: !!o['naranja-medio'] };
}

const lvText = ks => ks.map(k => CHB.LEVEL_LABEL[k]).join(', ');
const minutes = ms => ms ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : '?';

function describe(s, want) {
  const nd = CHB.nativeDiffs(s);
  const g = nd.guitar || new Set();
  const status = want.every(k => g.has(k)) ? 'originales' : 'se generan';
  const inst = Object.keys(nd).map(i => CHB.INST_LABEL[i]).join(', ');
  return { artista: s.artist, cancion: s.name, genero: s.genre || '', duracion: minutes(s.song_length), charter: s.charter || '', instrumentos: inst, dificultades: status, md5: s.md5 };
}

async function cmdBuscar(o) {
  const want = levels(o.niveles);
  const limit = Math.max(1, Math.min(200, parseInt(o.cantidad || '20', 10)));
  const q = { artist: o.artista, genre: o.genero, query: o.texto || o._.slice(1).join(' ') || undefined };
  if (!q.artist && !q.genre && !q.query) throw new Error('Indica qué buscar: --artista, --genero o --texto');
  const items = await CHB.findSongs({ ...q, want, limit, onlyNative: !!o['solo-originales'] });
  const rows = items.map((s, i) => ({ n: i + 1, ...describe(s, want) }));
  fs.writeFileSync(LAST, JSON.stringify({ want, items }, null, 0));
  if (o.json) { console.log(JSON.stringify({ niveles: lvText(want), resultados: rows }, null, 2)); return; }
  if (!rows.length) { console.log('No encontré canciones que cumplan con lo pedido.'); return; }
  console.log(`Encontré ${rows.length} canciones (niveles: ${lvText(want)}):\n`);
  for (const r of rows) console.log(`${String(r.n).padStart(3)}. ${r.artista} - ${r.cancion}  [${r.duracion}]  ${r.instrumentos}  · dificultades ${r.dificultades}`);
  console.log(`\nPara descargar: node cli/chb.js descargar --numeros 1,2,3 --carpeta "RUTA"   (o --todas)`);
}

function pickFromLast(o) {
  if (!fs.existsSync(LAST)) throw new Error('Primero haz una búsqueda con "buscar".');
  const last = JSON.parse(fs.readFileSync(LAST, 'utf8'));
  if (o.todas) return { last, items: last.items };
  if (!o.numeros) throw new Error('Indica --numeros 1,2,3 o --todas');
  const nums = String(o.numeros).split(',').flatMap(x => {
    const [a, b] = x.split('-').map(n => parseInt(n, 10));
    return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
  });
  return { last, items: nums.map(n => last.items[n - 1]).filter(Boolean) };
}

async function cmdDescargar(o) {
  if (!o.carpeta || o.carpeta === true) throw new Error('Indica la carpeta de destino con --carpeta "RUTA"');
  const dir = path.resolve(o.carpeta);
  fs.mkdirSync(dir, { recursive: true });
  const { last, items } = pickFromLast(o);
  const want = o.niveles ? levels(o.niveles) : last.want;
  const k = knobs(o);
  const media = o.fondo && o.fondo !== true ? { name: path.basename(o.fondo), data: new Uint8Array(fs.readFileSync(o.fondo)) } : null;
  const allInst = !o['solo-guitarra'];
  const report = [];
  for (const s of items) {
    const name = CHB.fileName(s);
    try {
      process.stdout.write(`Descargando ${s.artist} - ${s.name}… `);
      const buf = await CHB.fetchSng(s.md5);
      let source = buf, lyricNote = '';
      if (o.letra) {
        const sng = CHB.readSng(buf), meta = Object.fromEntries(sng.meta);
        if (CHB.hasLyrics(sng)) lyricNote = ' · ya traía letra';
        else {
          const seconds = (+meta.song_length || s.song_length || 0) / 1000;
          const lines = await CHB.findLyrics({ artist: meta.artist || s.artist, name: meta.name || s.name, duration: seconds }).catch(() => null);
          const phrases = lines ? CHB.lrcToPhrases(lines, seconds) : [];
          if (phrases.length && CHB.addLyrics(sng, phrases)) { source = CHB.writeSng(sng); lyricNote = ' · letra agregada'; } else lyricNote = ' · no encontré la letra con tiempos';
        }
      }
      const done = CHB.processSng(source, want, allInst, k), added = done.added;
      const bytes = media ? CHB.writeSng(CHB.setBackground(CHB.readSng(done.bytes), media)) : done.bytes;
      if (o.editable) {
        // classic song folder (song.ini + chart + audio) that Moonscraper and Clone Hero can open
        const sng = CHB.readSng(bytes), meta = Object.fromEntries(sng.meta);
        const folder = path.join(dir, name.replace(/\.sng$/, ''));
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'song.ini'), '[song]\r\n' + Object.entries(meta).map(([a, b]) => `${a} = ${b}`).join('\r\n') + '\r\n');
        for (const f of sng.files) fs.writeFileSync(path.join(folder, f.name), f.data);
        console.log(`OK carpeta editable (${added.length ? 'creé ' + CHB.summarize(added) : 'ya traía lo necesario'})`);
        report.push({ cancion: `${s.artist} - ${s.name}`, carpeta: folder, ok: true, generado: added });
        continue;
      }
      fs.writeFileSync(path.join(dir, name), bytes);
      const g = (CHB.sngDifficulties(bytes).guitar || []);
      const ok = want.every(k => g.includes(k));
      const msg = (added.length ? `generé ${CHB.summarize(added)}` : 'ya traía los niveles') + lyricNote;
      console.log(ok ? `OK (${msg})` : `ATENCIÓN: no se pudo completar la guitarra (${msg})`);
      report.push({ cancion: `${s.artist} - ${s.name}`, archivo: name, ok, generado: added });
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      report.push({ cancion: `${s.artist} - ${s.name}`, ok: false, error: e.message });
    }
  }
  const okN = report.filter(r => r.ok).length;
  console.log(`\nListo: ${okN} de ${report.length} canciones guardadas en ${dir}`);
  console.log('En Clone Hero ve a Settings > General > Scan Songs (agrega la carpeta en Song Folders si no está).');
  if (o.json) console.log(JSON.stringify(report, null, 2));
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.sng$/i.test(e.name)) out.push(p);
  }
  return out;
}

async function cmdArreglar(o) {
  if (!o.carpeta || o.carpeta === true) throw new Error('Indica la carpeta con --carpeta "RUTA"');
  const want = levels(o.niveles), allInst = !o['solo-guitarra'], k = knobs(o);
  const files = walk(path.resolve(o.carpeta));
  let fixed = 0;
  for (const f of files) {
    try {
      const buf = fs.readFileSync(f);
      const { bytes, added } = CHB.processSng(new Uint8Array(buf), want, allInst, k);
      if (!added.length) continue;
      if (!fs.existsSync(f + '.original')) fs.copyFileSync(f, f + '.original');
      fs.writeFileSync(f, bytes);
      fixed++;
      console.log(`ARREGLADA ${path.relative(o.carpeta, f)} → ${CHB.summarize(added)}`);
    } catch (e) { console.log(`ERROR ${f}: ${e.message}`); }
  }
  console.log(`\nListo: ${files.length} canciones revisadas, ${fixed} arregladas (copia del original en *.sng.original).`);
}

function cmdCarpetas() {
  const home = os.homedir();
  const docs = [path.join(home, 'Documents'), path.join(home, 'Documentos'), path.join(home, 'OneDrive', 'Documents'), path.join(home, 'OneDrive', 'Documentos')];
  const cands = [...docs.map(d => path.join(d, 'Clone Hero', 'Songs')), path.join(home, 'Clone Hero', 'Songs'), path.join(home, '.clonehero', 'Songs')];
  const found = cands.filter(p => fs.existsSync(p));
  console.log(JSON.stringify({ encontradas: found, sugerida: found[0] || cands[0] }, null, 2));
}

function help() {
  console.log(`CH Buscador - canciones para Clone Hero con Fácil, Medio y Difícil

  node cli/chb.js buscar --artista "Soda Stereo" [--niveles facil,medio,dificil] [--cantidad 20] [--solo-originales] [--json]
  node cli/chb.js buscar --genero "Cumbia" ...
  node cli/chb.js buscar --texto "Free Bird" ...
  node cli/chb.js descargar --numeros 1,3,5-8 --carpeta "RUTA"   (o --todas) [--solo-guitarra] [--editable]
  node cli/chb.js arreglar --carpeta "RUTA"     agrega dificultades faltantes a una biblioteca existente

  Ajustes de los niveles creados (descargar y arreglar):
    --densidad -2..2      menos notas (-2) o más notas (2); también: muchas-menos, menos, normal, mas, muchas-mas
    --sin-acordes         solo notas sueltas en Medio y Difícil
    --naranja-medio       permite el botón naranja en Medio
    --editable            guarda una carpeta (song.ini + chart + audio) para abrirla en Moonscraper
    --letra               si la canción no trae letra, la busca en LRCLIB y la agrega con tiempos
    --fondo "ARCHIVO"     pone esta imagen (png, jpg) o video (mp4, webm, avi, ogv, mpeg) de fondo

  Crear la batería desde el audio solo está en la web, porque necesita decodificar el audio del navegador.
  node cli/chb.js carpetas                      muestra dónde suele estar la carpeta Songs`);
}

(async () => {
  const o = args(process.argv.slice(2));
  const cmd = o._[0];
  try {
    if (cmd === 'buscar') await cmdBuscar(o);
    else if (cmd === 'descargar') await cmdDescargar(o);
    else if (cmd === 'arreglar') await cmdArreglar(o);
    else if (cmd === 'carpetas') cmdCarpetas();
    else help();
  } catch (e) { console.error('Error: ' + e.message); process.exit(1); }
})();
