'use strict';
const { processSng, findSongs, nativeDiffs, fileName, summarize, INST_LABEL, FILES } = CHB;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const want = () => [['E', '#needE'], ['M', '#needM'], ['H', '#needH']].filter(([, s]) => $(s).checked).map(([k]) => k);
const store = {
  get(k, d) { try { const v = localStorage.getItem('chb-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('chb-' + k, JSON.stringify(v)); } catch { } },
};

/* ---------- folder handling ---------- */
let dirHandle = null;
const canPickDir = 'showDirectoryPicker' in window;

function idb() {
  return new Promise((ok, ko) => { const r = indexedDB.open('ch-buscador', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
}
async function kv(key, val) {
  try {
    const db = await idb();
    return await new Promise((ok, ko) => {
      const tx = db.transaction('kv', val === undefined ? 'readonly' : 'readwrite'), st = tx.objectStore('kv');
      const r = val === undefined ? st.get(key) : st.put(val, key);
      r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
    });
  } catch { return undefined; }
}
async function ensurePermission() {
  if (!dirHandle) return false;
  const o = { mode: 'readwrite' };
  if ((await dirHandle.queryPermission(o)) === 'granted') return true;
  return (await dirHandle.requestPermission(o)) === 'granted';
}
function showFolder() {
  $('#folderLabel').innerHTML = dirHandle
    ? `Carpeta de destino: <b>${esc(dirHandle.name)}</b>`
    : canPickDir ? 'Carpeta de destino: <b>ninguna</b> (las canciones se bajarán como descargas normales)'
                 : 'Tu navegador no permite elegir carpeta: las canciones se bajarán como descargas normales. Usa Chrome o Edge para guardarlas directo en Songs.';
}
async function pickFolder() {
  if (!canPickDir) { alert('Tu navegador no permite elegir carpetas. Usa Chrome o Edge.'); return false; }
  try { dirHandle = await window.showDirectoryPicker({ id: 'ch-songs', mode: 'readwrite' }); await kv('dir', dirHandle); showFolder(); return true; }
  catch { return false; }
}
async function saveSong(name, bytes) {
  if (dirHandle && await ensurePermission()) {
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(bytes); await w.close();
    return 'guardada en ' + dirHandle.name;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes])); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'descargada';
}

/* ---------- download + generation ---------- */
// knobs for the generated levels, shared by the preview, downloads and the library fixer
let knobs = { ...CHB.DEFAULT_KNOBS };
function setKnobs(k) {
  knobs = { ...CHB.DEFAULT_KNOBS, ...k };
  savePrefs(); showKnobs();
}
function showKnobs() {
  const d = ['muchas menos', 'menos', 'normal', 'más', 'muchas más'][knobs.density + 2];
  const custom = JSON.stringify(knobs) !== JSON.stringify(CHB.DEFAULT_KNOBS);
  $('#knobsInfo').innerHTML = `🎛 Niveles creados: <b>${d}</b> notas · acordes <b>${knobs.chords ? 'sí' : 'no'}</b> · naranja en Medio <b>${knobs.orangeMedium ? 'sí' : 'no'}</b>`
    + (custom ? ' <button class="ghost chip" id="knobsReset">Restablecer</button>' : ' <span class="sub">(ajústalos desde ▶ Ver)</span>');
  const r = $('#knobsReset'); if (r) r.onclick = () => setKnobs(CHB.DEFAULT_KNOBS);
}
function savePrefs() { kv('prefs', { w: want(), all: $('#allInst').checked, knobs }); }

// the original file is cached, so the preview, the knobs and the download share one fetch
const raws = new Map();
function getRaw(s, onProgress) {
  if (!raws.has(s.md5)) {
    const job = CHB.fetchSng(s.md5, onProgress);
    job.catch(() => raws.delete(s.md5));
    raws.set(s.md5, job);
    while (raws.size > 3) raws.delete(raws.keys().next().value);
  }
  return raws.get(s.md5);
}
const prepare = (s, onProgress) => getRaw(s, onProgress).then(buf => processSng(buf, want(), $('#allInst').checked, knobs));

async function exportSong(s, getBytes = () => prepare(s)) {
  try {
    FX.toast('Preparando carpeta para Moonscraper…', 2000);
    const { bytes } = await getBytes();
    const { folder, bytes: zip } = CHB.sngToZip(bytes);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' })); a.download = folder + '.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    FX.toast(`<b>✏️ Lista para editar</b><br><small>Descomprime <b>${esc(folder)}.zip</b> y abre <b>notes.chart</b> (o notes.mid) en Moonscraper. Si la pones en tu carpeta Songs, Clone Hero también la lee.</small>`, 9000);
  } catch (e) { FX.toast('✖ ' + esc(e.message)); }
}

/* ---------- download queue ---------- */
const queue = { jobs: [], done: 0, ok: 0, fail: 0, running: false, cur: 0 };
function enqueue(songs) {
  const fresh = songs.filter(s => !queue.jobs.some(j => j.s.md5 === s.md5 && !j.finished));
  for (const s of fresh) queue.jobs.push({ s });
  if (!fresh.length) return;
  for (const s of fresh) setStatus(s.md5, 'En cola…');
  FX.pick();
  runQueue();
}
async function runQueue() {
  if (queue.running) return;
  queue.running = true; showQueue();
  if (dirHandle) await ensurePermission();
  for (let j; (j = queue.jobs.find(x => !x.finished));) {
    const s = j.s; queue.cur = 0; showQueue(s);
    try {
      setStatus(s.md5, 'Descargando…');
      const { bytes, added } = await prepare(s, (a, b) => { queue.cur = b ? a / b : 0; showQueue(s); });
      const where = await saveSong(fileName(s), bytes);
      const g = CHB.sngDifficulties(bytes).guitar || [];
      const ok = want().every(k => g.includes(k));
      const gen = added.length ? `se creó: ${summarize(added)}` : 'ya traía lo necesario';
      setStatus(s.md5, `✔ ${where} · ${gen}${ok ? '' : ' · ⚠ no se pudo completar la guitarra'}`, ok ? 'ok' : 'err');
      queue.ok++;
    } catch (e) { setStatus(s.md5, '✖ ' + e.message, 'err'); queue.fail++; }
    j.finished = true; queue.done++;
  }
  queue.running = false; showQueue();
  const n = queue.ok, f = queue.fail;
  if (n) { FX.sparks(); FX.strum(); FX.toast(`<b>¡Rock on! 🤘</b> ${n} ${n === 1 ? 'canción lista' : 'canciones listas'}${f ? ` · ${f} con error` : ''}<br><small>En Clone Hero: Settings → General → Scan Songs</small>`, 6000); }
  else if (f) FX.toast(`No se pudo descargar ${f === 1 ? 'la canción' : f + ' canciones'}.`);
  setTimeout(() => { if (!queue.running) { queue.jobs = []; queue.done = queue.ok = queue.fail = 0; showQueue(); } }, 4000);
}
function showQueue(cur) {
  const box = $('#queue'), total = queue.jobs.length;
  box.classList.toggle('hidden', !total);
  if (!total) return;
  const frac = (queue.done + (queue.running ? queue.cur : 0)) / total;
  $('#qText').innerHTML = queue.running
    ? `Descargando <b>${queue.done + 1} de ${total}</b>${cur ? ' · ' + esc(cur.artist) + ' – ' + esc(cur.name) : ''}`
    : `<b>Listo:</b> ${queue.ok} de ${total} canciones`;
  $('#qBar').style.width = (frac * 100).toFixed(1) + '%';
}

/* ---------- search results ---------- */
let state = { args: null, limit: 20, items: [], sel: new Set(), done: false };
const statusOf = {};
const flames = s => {
  const d = s.diff_guitar >= 0 ? s.diff_guitar : s.diff_band;
  if (!(d >= 0)) return '';
  const n = Math.min(6, Math.max(0, d));
  const label = ['muy fácil', 'fácil', 'fácil', 'media', 'difícil', 'muy difícil', 'brutal'][n];
  return `<span class="flames" title="Intensidad ${n} de 6: ${label}">${'<i class="on">🔥</i>'.repeat(n)}${'<i>🔥</i>'.repeat(6 - n)}</span>`;
};

function songCard(s) {
  const w = want(), all = $('#allInst').checked;
  const nd = nativeDiffs(s);
  const badges = Object.entries(nd).map(([inst, set]) => {
    const gen = set.has('X') && (inst === 'guitar' || all);
    const ds = ['E', 'M', 'H', 'X'].map(k => {
      const cls = set.has(k) ? 'n' : (gen && w.includes(k) ? 'g' : '');
      const tip = { E: 'Fácil', M: 'Medio', H: 'Difícil', X: 'Experto' }[k] + (cls === 'n' ? ': original' : cls === 'g' ? ': se crea al descargar' : ': no disponible');
      return `<i class="d ${cls} lv-${k}" title="${tip}">${{ E: 'F', M: 'M', H: 'D', X: 'X' }[k]}</i>`;
    }).join('');
    return `<span class="inst"><span>${INST_LABEL[inst]}</span>${ds}</span>`;
  }).join('');
  const mins = s.song_length ? `${Math.floor(s.song_length / 60000)}:${String(Math.floor(s.song_length / 1000) % 60).padStart(2, '0')}` : '';
  const art = s.albumArtMd5 ? `style="background-image:url('${FILES}${s.albumArtMd5}.jpg')"` : '';
  const st = statusOf[s.md5] || {};
  const meta = [s.genre && esc(s.genre), mins, s.charter && 'chart de ' + esc(s.charter)].filter(Boolean).join(' · ');
  return `<div class="song ${state.sel.has(s.md5) ? 'sel' : ''}" data-md5="${s.md5}">
    <button class="art play" ${art} title="Vista previa"><span>▶</span></button>
    <div class="info"><div class="title">${esc(s.name)}</div>
      <div class="meta"><span class="artist">${esc(s.artist)}</span>${meta ? ' · ' + meta : ''}</div>
      <div class="badges">${flames(s)}${badges}</div></div>
    <div class="actions">
      <label class="chk"><input type="checkbox" class="pick" ${state.sel.has(s.md5) ? 'checked' : ''}> elegir</label>
      <div class="row" style="gap:6px"><button class="pv-btn" title="Vista previa">▶ Ver</button><button class="dl">Descargar</button></div>
      <div class="status ${st.cls || ''}" id="st-${s.md5}">${esc(st.text || '')}</div>
    </div></div>`;
}

function render() {
  const box = $('#results');
  if (!state.items.length) box.innerHTML = state.args ? '<div class="empty">No encontré canciones que cumplan con lo que pides.</div>' : '';
  else box.innerHTML = state.items.map(songCard).join('');
  $('#moreBtn').classList.toggle('hidden', !state.args || state.done);
  $('#shareSearch').classList.toggle('hidden', !state.args);
  $('#resultsHead').classList.toggle('hidden', !state.items.length);
  $('#resultsCount').textContent = state.items.length ? `${state.items.length} canciones` : '';
  $('#batchBar').classList.toggle('hidden', !state.sel.size);
  $('#selCount').textContent = `${state.sel.size} seleccionada(s)`;
}

function setStatus(md5, text, cls) {
  statusOf[md5] = { text, cls };
  for (const el of document.querySelectorAll(`[id="st-${md5}"]`)) { el.textContent = text; el.className = 'status ' + (cls || ''); }
}

async function doSearch(args, limit, push = true) {
  const more = args === state.args && state.items.length;
  tab('search');
  if (more) $('#moreBtn').disabled = true;
  else $('#results').innerHTML = '<div class="empty loading">Buscando…</div>';
  const text = args.query || args.artist || args.genre;
  rememberSearch(text);
  if (push) setUrl({ q: text, por: Object.keys(args)[0] });
  try {
    const items = await findSongs({ ...args, want: want(), limit, onlyNative: $('#filter').value === 'native' });
    state = { args, limit, items, sel: more ? state.sel : new Set(), done: items.length < limit };
  } catch (e) { $('#results').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  finally { $('#moreBtn').disabled = false; }
  render();
}

function openPreview(s) {
  setBackdrop(s);
  Preview.open({
    song: s,
    fetchBytes: onProgress => prepare(s, onProgress),
    regenerate: k => { setKnobs(k); return prepare(s); },
    knobs,
    onDownload: () => enqueue([s]),
    onExport: () => exportSong(s),
    preferDiff: want().includes('M') ? 'M' : want()[0],
  });
}

/* ---------- packs ---------- */
const packSongs = p => p.songs.map(x => ({ md5: x.m, artist: x.a, name: x.n }));
function renderPacks() {
  $('#packGrid').innerHTML = PACKS.map(p => `
    <button class="pack" data-pack="${p.id}" style="--c1:${p.colors[0]};--c2:${p.colors[1]}">
      <span class="pack-emoji">${p.emoji}</span>
      <span class="pack-title">${esc(p.title)}</span>
      <span class="pack-desc">${esc(p.desc)}</span>
      <span class="pack-count">${p.songs.length} canciones</span>
    </button>`).join('');
}
function openPack(id, push = true) {
  const p = PACKS.find(x => x.id === id);
  if (!p) return;
  tab('packs');
  if (push) setUrl({ pack: id });
  const songs = packSongs(p);
  $('#packGrid').classList.add('hidden');
  $('#packDetail').classList.remove('hidden');
  $('#packDetail').style.setProperty('--c1', p.colors[0]); $('#packDetail').style.setProperty('--c2', p.colors[1]);
  $('#packHead').innerHTML = `<span class="pack-emoji">${p.emoji}</span><div><h2>${esc(p.title)}</h2><p class="sub">${esc(p.desc)} · ${songs.length} canciones</p></div>`;
  $('#packList').innerHTML = songs.map((s, i) => `
    <div class="prow" data-md5="${s.md5}">
      <span class="pn">${i + 1}</span>
      <span class="pt"><b>${esc(s.name)}</b><small>${esc(s.artist)}</small></span>
      <button class="pv-btn" title="Vista previa">▶</button>
      <div class="status ${statusOf[s.md5]?.cls || ''}" id="st-${s.md5}">${esc(statusOf[s.md5]?.text || '')}</div>
    </div>`).join('');
  $('#packDl').onclick = () => enqueue(songs);
  $('#packShare').onclick = () => share({ pack: id }, `Pack ${p.title} para Clone Hero`);
}
function closePack() { $('#packGrid').classList.remove('hidden'); $('#packDetail').classList.add('hidden'); setUrl({}); }

/* ---------- suggestions, recent searches, sharing ---------- */
const POPULAR = ['Metallica', 'Soda Stereo', 'Queen', 'AC/DC', 'Nirvana', "Guns N' Roses", 'Los Prisioneros', 'Mägo de Oz', 'Red Hot Chili Peppers', 'Selena'];
function rememberSearch(t) {
  if (!t) return;
  const r = store.get('recent', []).filter(x => x.toLowerCase() !== t.toLowerCase());
  r.unshift(t); store.set('recent', r.slice(0, 8)); renderSuggestions();
}
function renderSuggestions() {
  const recent = store.get('recent', []);
  $('#sugs').innerHTML = [...recent, ...POPULAR.filter(p => !recent.includes(p))].map(x => `<option value="${esc(x)}">`).join('');
  $('#chips').innerHTML = (recent.length ? `<span class="chips-l">Recientes:</span>${recent.slice(0, 4).map(x => `<button class="chip" data-q="${esc(x)}">${esc(x)}</button>`).join('')}` : '')
    + `<span class="chips-l">Populares:</span>${POPULAR.slice(0, 7).map(x => `<button class="chip hot" data-q="${esc(x)}">${esc(x)}</button>`).join('')}`;
}
function setUrl(params) {
  const u = new URL(location.href);
  u.search = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  try { history.replaceState(null, '', u); } catch { }
}
async function share(params, title) {
  const u = new URL(location.href);
  u.search = new URLSearchParams(params).toString();
  const url = u.toString();
  if (location.protocol === 'file:') { FX.toast('Para compartir enlaces, publica la web (por ejemplo en GitHub Pages).'); return; }
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title, url });
    else { await navigator.clipboard.writeText(url); FX.toast('🔗 Enlace copiado. ¡Pásaselo a quien quieras!'); }
  } catch { prompt('Copia este enlace:', url); }
}

/* ---------- backdrop from album art ---------- */
let bdTimer = 0;
function setBackdrop(s) {
  clearTimeout(bdTimer);
  bdTimer = setTimeout(() => {
    const url = s && s.albumArtMd5 ? `url('${FILES}${s.albumArtMd5}.jpg')` : 'none';
    document.body.style.setProperty('--bgart', url);
    document.body.classList.toggle('has-art', url !== 'none');
  }, 120);
}

/* ---------- library: fix and stats ---------- */
async function* walk(dir, path = '') {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'directory') yield* walk(h, path + name + '/');
    else if (/\.sng$/i.test(name)) yield { dir, name, h, path: path + name };
  }
}
async function fixLibrary() {
  const log = $('#libLog'); const say = t => { log.textContent += t + '\n'; log.scrollTop = log.scrollHeight; };
  if (!dirHandle && !(await pickFolder())) return;
  if (!(await ensurePermission())) { say('Sin permiso para la carpeta.'); return; }
  log.classList.remove('hidden'); log.textContent = ''; $('#fixLib').disabled = true;
  let n = 0, fixed = 0;
  for await (const f of walk(dirHandle)) {
    n++;
    try {
      const buf = new Uint8Array(await (await f.h.getFile()).arrayBuffer());
      const { bytes, added } = processSng(buf, want(), $('#allInst').checked, knobs);
      if (!added.length) { say(`OK         ${f.path}`); continue; }
      const bk = await f.dir.getFileHandle(f.name + '.original', { create: true });
      let w = await bk.createWritable(); await w.write(buf); await w.close();
      w = await f.h.createWritable(); await w.write(bytes); await w.close();
      fixed++; say(`ARREGLADA  ${f.path} → ${summarize(added)}`);
    } catch (e) { say(`ERROR      ${f.path}: ${e.message}`); }
  }
  say(`\nListo: ${n} canciones revisadas, ${fixed} arregladas. En Clone Hero dale a "Scan Songs".`);
  $('#fixLib').disabled = false;
  if (fixed) { FX.sparks(); FX.strum(); }
}

// reads only the header and the chart of each .sng, so big libraries are fast
async function readLite(file) {
  const head = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
  const { mask, meta, index } = CHB.readSngIndex(head);
  const chart = index.find(f => /\.(chart|midi?)$/i.test(f.name));
  if (!chart) return { meta, diffs: {} };
  const raw = new Uint8Array(await file.slice(chart.off, chart.off + chart.len).arrayBuffer());
  const diffs = CHB.sngDifficulties({ meta: [], files: [{ name: chart.name, data: CHB.xorData(raw, mask) }] });
  return { meta, diffs };
}
async function libraryStats() {
  if (!dirHandle && !(await pickFolder())) return;
  if (!(await ensurePermission())) return;
  const out = $('#stats'); out.classList.remove('hidden');
  out.innerHTML = '<div class="empty loading">Revisando tu biblioteca…</div>';
  $('#statsLib').disabled = true;
  const rows = []; let bytes = 0, n = 0;
  for await (const f of walk(dirHandle)) {
    try {
      const file = await f.h.getFile(); bytes += file.size;
      const { meta, diffs } = await readLite(file);
      rows.push({ path: f.path, artist: meta.artist || '¿?', name: meta.name || f.name, genre: meta.genre || 'Sin género', g: diffs.guitar || [], insts: Object.keys(diffs) });
    } catch { rows.push({ path: f.path, artist: '¿?', name: f.name, genre: 'Sin género', g: [], insts: [], bad: true }); }
    if (++n % 20 === 0) out.innerHTML = `<div class="empty loading">Revisando tu biblioteca… ${n} canciones</div>`;
  }
  $('#statsLib').disabled = false;
  if (!rows.length) { out.innerHTML = '<div class="empty">No encontré canciones .sng en esa carpeta.</div>'; return; }
  const w = want();
  const full = rows.filter(r => w.every(k => r.g.includes(k)));
  const fixable = rows.filter(r => !w.every(k => r.g.includes(k)) && r.g.includes('X'));
  const count = key => Object.entries(rows.reduce((m, r) => (m[r[key]] = (m[r[key]] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]);
  const bars = (list, max) => list.slice(0, 8).map(([k, v]) => `<div class="bar-row"><span>${esc(k)}</span><div><i style="width:${(v / max * 100).toFixed(1)}%"></i></div><b>${v}</b></div>`).join('');
  const artists = count('artist'), genres = count('genre');
  const pct = Math.round(full.length / rows.length * 100);
  const lv = w.map(k => ({ E: 'Fácil', M: 'Medio', H: 'Difícil' }[k])).join(', ');
  out.innerHTML = `
    <div class="tiles">
      <div class="tile"><b>${rows.length}</b><span>canciones</span></div>
      <div class="tile"><b>${pct}%</b><span>tienen ${esc(lv)}</span></div>
      <div class="tile"><b>${fixable.length}</b><span>se pueden arreglar</span></div>
      <div class="tile"><b>${(bytes / 1073741824).toFixed(2)} GB</b><span>en disco</span></div>
    </div>
    <div class="meter"><i style="width:${pct}%"></i></div>
    <div class="cols">
      <div><h3>Artistas con más canciones</h3>${bars(artists, artists[0][1])}</div>
      <div><h3>Géneros</h3>${bars(genres, genres[0][1])}</div>
    </div>
    ${fixable.length ? `<h3>Les faltan niveles (${fixable.length})</h3><div class="missing">${fixable.slice(0, 60).map(r => `<div><b>${esc(r.name)}</b> <small>${esc(r.artist)}</small> <span>${['E', 'M', 'H'].map(k => `<i class="d lv-${k} ${r.g.includes(k) ? 'n' : ''}">${{ E: 'F', M: 'M', H: 'D' }[k]}</i>`).join('')}</span></div>`).join('')}${fixable.length > 60 ? `<div class="sub">… y ${fixable.length - 60} más</div>` : ''}</div>
      <p class="sub">Usa <b>Revisar y arreglar</b> para crearles los niveles que faltan.</p>` : '<p class="sub">🤘 Todas tus canciones tienen los niveles que pediste.</p>'}`;
}

/* ---------- create a chart from an audio file (experimental) ---------- */
let acFile = null, created = null;
function pickAudio(file) {
  if (!file) return;
  acFile = file;
  $('#drop').classList.add('has');
  $('#dropText').textContent = file.name;
  const base = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  const [a, ...rest] = base.split(' - ');
  if (rest.length) { $('#acArtist').value = a.trim(); $('#acName').value = rest.join(' - ').trim(); }
  else { $('#acName').value = base.trim(); }
  $('#acGo').disabled = false;
}
const createdLevels = () => processSng(created.bytes, want(), true, knobs);
async function createFromAudio() {
  if (!acFile) return;
  const artist = $('#acArtist').value.trim() || 'Desconocido', name = $('#acName').value.trim() || 'Mi canción';
  $('#acGo').disabled = true; $('#acProg').classList.remove('hidden'); $('#acResult').classList.add('hidden');
  const t0 = performance.now();
  try {
    const r = await AutoChart.create(acFile, {
      name, artist, sensitivity: +$('#acSens').value,
      onProgress: (text, f) => { $('#acProgText').textContent = text; $('#acProgBar').style.width = (f * 100).toFixed(0) + '%'; },
    });
    created = { ...r, song: { md5: 'local-' + Date.now(), artist, name } };
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    $('#acTitle').textContent = `${artist} – ${name}`;
    $('#acTiles').innerHTML = `
      <div class="tile"><b>${Math.round(r.bpm)}</b><span>BPM detectados</span></div>
      <div class="tile"><b>${r.notes}</b><span>notas en Experto</span></div>
      <div class="tile"><b>${(r.notes / r.duration).toFixed(1)}</b><span>notas por segundo</span></div>
      <div class="tile"><b>${secs} s</b><span>en crearlo</span></div>`;
    $('#acResult').classList.remove('hidden');
    FX.sparks(60); FX.strum();
  } catch (e) {
    $('#acProgText').textContent = '✖ ' + (e.message || 'No se pudo leer ese audio. Prueba con un MP3 u OGG.');
  } finally { $('#acGo').disabled = false; }
}
function previewCreated() {
  if (!created) return;
  Preview.open({
    song: created.song,
    fetchBytes: async () => createdLevels(),
    regenerate: async k => { setKnobs(k); return createdLevels(); },
    knobs,
    onDownload: saveCreated,
    onExport: () => exportSong(created.song, async () => createdLevels()),
    preferDiff: want().includes('M') ? 'M' : want()[0],
  });
}
async function saveCreated() {
  if (!created) return;
  try {
    const where = await saveSong(fileName(created.song), createdLevels().bytes);
    FX.sparks(); FX.strum();
    FX.toast(`<b>¡Rock on! 🤘</b> ${esc(created.song.name)} ${esc(where)}<br><small>En Clone Hero: Settings → General → Scan Songs</small>`, 6000);
  } catch (e) { FX.toast('✖ ' + esc(e.message)); }
}

/* ---------- tabs ---------- */
function tab(name) {
  for (const t of ['search', 'packs', 'lib', 'audio']) {
    $('#view-' + t).classList.toggle('hidden', t !== name);
    $('#tab-' + t).classList.toggle('on', t === name);
  }
}

/* ---------- events ---------- */
$('#pickFolder').onclick = pickFolder;
$('#searchForm').onsubmit = e => {
  e.preventDefault();
  const q = $('#q').value.trim(); if (!q) return;
  FX.pick();
  doSearch({ [$('#mode').value]: q }, +$('#limit').value);
};
$('#chips').onclick = e => { const q = e.target.dataset.q; if (!q) return; $('#q').value = q; $('#searchForm').requestSubmit(); };
$('#moreBtn').onclick = () => doSearch(state.args, state.limit + 20, false);
$('#filter').onchange = () => { if (state.args) doSearch({ ...state.args }, state.limit, false); };
$('#shareSearch').onclick = () => { const a = state.args; const [por, q] = Object.entries(a)[0]; share({ q, por }, `Canciones de ${q} para Clone Hero`); };
for (const id of ['#needE', '#needM', '#needH', '#allInst']) $(id).onchange = () => { render(); savePrefs(); };

$('#results').onclick = e => {
  const card = e.target.closest('.song'); if (!card) return;
  const s = state.items.find(x => x.md5 === card.dataset.md5);
  if (e.target.closest('.dl')) enqueue([s]);
  if (e.target.closest('.play, .pv-btn')) openPreview(s);
  if (e.target.classList.contains('pick')) { e.target.checked ? state.sel.add(s.md5) : state.sel.delete(s.md5); render(); }
};
$('#results').addEventListener('mouseover', e => {
  const card = e.target.closest('.song'); if (!card) return;
  setBackdrop(state.items.find(x => x.md5 === card.dataset.md5));
});
$('#dlSel').onclick = () => { enqueue(state.items.filter(s => state.sel.has(s.md5))); state.sel.clear(); render(); };

$('#packGrid').onclick = e => { const b = e.target.closest('.pack'); if (b) { FX.pick(); openPack(b.dataset.pack); } };
$('#packBack').onclick = closePack;
$('#packList').onclick = e => {
  const row = e.target.closest('.prow'); if (!row || !e.target.closest('.pv-btn')) return;
  const p = PACKS.find(x => x.songs.some(s => s.m === row.dataset.md5));
  const s = p && packSongs(p).find(x => x.md5 === row.dataset.md5);
  if (s) openPreview(s);
};

$('#tab-search').onclick = () => { tab('search'); };
$('#tab-packs').onclick = () => { tab('packs'); };
$('#tab-lib').onclick = () => tab('lib');
$('#tab-audio').onclick = () => tab('audio');
$('#audioFile').onchange = e => pickAudio(e.target.files[0]);
$('#drop').addEventListener('dragover', e => { e.preventDefault(); $('#drop').classList.add('over'); });
$('#drop').addEventListener('dragleave', () => $('#drop').classList.remove('over'));
$('#drop').addEventListener('drop', e => { e.preventDefault(); $('#drop').classList.remove('over'); pickAudio(e.dataTransfer.files[0]); });
$('#acGo').onclick = createFromAudio;
$('#acPreview').onclick = previewCreated;
$('#acDl').onclick = saveCreated;
$('#acEdit').onclick = () => created && exportSong(created.song, async () => createdLevels());
$('#fixLib').onclick = fixLibrary;
$('#statsLib').onclick = libraryStats;
$('#soundBtn').onclick = () => {
  FX.setSound(!FX.soundOn);
  $('#soundBtn').classList.toggle('on', FX.soundOn);
  $('#soundBtn').textContent = FX.soundOn ? '🔊 Sonido' : '🔇 Sonido';
  if (FX.soundOn) FX.strum();
};

/* ---------- start ---------- */
(async () => {
  const d = await kv('dir'); if (d) dirHandle = d;
  const p = await kv('prefs');
  if (p) { $('#needE').checked = p.w.includes('E'); $('#needM').checked = p.w.includes('M'); $('#needH').checked = p.w.includes('H'); $('#allInst').checked = p.all; }
  if (p && p.knobs) knobs = { ...CHB.DEFAULT_KNOBS, ...p.knobs };
  showKnobs();
  $('#soundBtn').classList.toggle('on', FX.soundOn);
  $('#soundBtn').textContent = FX.soundOn ? '🔊 Sonido' : '🔇 Sonido';
  showFolder(); renderPacks(); renderSuggestions(); render();
  const qs = new URLSearchParams(location.search);
  if (qs.get('pack')) openPack(qs.get('pack'), false);
  else if (qs.get('q')) {
    const por = ['query', 'artist', 'genre'].includes(qs.get('por')) ? qs.get('por') : 'query';
    $('#q').value = qs.get('q'); $('#mode').value = por;
    doSearch({ [por]: qs.get('q') }, +$('#limit').value, false);
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
