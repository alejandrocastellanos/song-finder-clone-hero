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
  $('#pickFolder').classList.toggle('hidden', !canPickDir);
  if (canPickDir) {
    $('#folderLabel').innerHTML = dirHandle
      ? `Carpeta de destino: <b>${esc(dirHandle.name)}</b>`
      : 'Carpeta de destino: <b>ninguna</b> (te la pediré cuando descargues)';
    return;
  }
  // Firefox and Safari have no folder picker; Brave ships with it turned off
  $('#folderLabel').innerHTML = '<b>Guardado:</b> una canción baja a Descargas y varias bajan en archivos .zip; luego las pasas a tu carpeta Songs. '
    + (navigator.brave
      ? '<span class="sub">En Brave puedes guardar directo en Songs: abre <b>brave://flags/#file-system-access-api</b>, actívalo y reinicia el navegador.</span>'
      : '<span class="sub">Para guardarlas directo en Songs usa Chrome, Edge u Opera en computadora.</span>');
}
async function pickFolder() {
  if (!canPickDir) return false;
  try { dirHandle = await window.showDirectoryPicker({ id: 'ch-songs', mode: 'readwrite' }); await kv('dir', dirHandle); showFolder(); return true; }
  catch { return false; }
}
// Browsers let a page start one download by itself and silently block the next ones,
// so from the second on the person gets a link: a real click is never blocked.
let autoSaved = 0;
function deliver(name, blob) {
  const url = URL.createObjectURL(blob);
  if (autoSaved++) return { name, url };
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return null;
}
const saveLink = l => `<a class="save-link" href="${l.url}" download="${esc(l.name)}">💾 Guardar</a>`;

// returns { where, link }; with a link the file isn't saved until the person clicks it
async function saveSong(name, bytes) {
  if (dirHandle && await ensurePermission().catch(() => false)) {
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(bytes); await w.close();
    return { where: 'guardada en ' + dirHandle.name };
  }
  const link = deliver(name, new Blob([bytes]));
  return link ? { where: 'lista: pulsa Guardar', link } : { where: 'enviada a tu carpeta de Descargas' };
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
function savePrefs() { kv('prefs', { w: want(), all: $('#allInst').checked, knobs, lyrics: $('#addLyrics').checked, drums: $('#addDrums').checked }); }

/* ---------- extras: lyrics, drums and background ---------- */
const askedFor = {};        // md5 -> { lyrics, drums } requested from the preview for one song
const enrichedCache = new Map();
let bgMedia = null;         // { name, data } for all songs that have no image of their own
const songBg = {};          // md5 -> { name, data } chosen for one song

function extrasFlags(s) {
  const a = askedFor[s.md5] || {};
  return { lyrics: $('#addLyrics').checked || !!a.lyrics, drums: $('#addDrums').checked || !!a.drums };
}

// returns { bytes, extras: { lyrics: 'added'|'have'|'none', drums: 'added'|'stems'|'have'|'none' } }
async function enrichBytes(s, raw, flags, onStep = () => { }) {
  const extras = {};
  if (!flags.lyrics && !flags.drums) return { bytes: raw, extras };
  const sng = CHB.readSng(raw), meta = Object.fromEntries(sng.meta);
  let changed = false;
  if (flags.lyrics) {
    if (CHB.hasLyrics(sng)) extras.lyrics = 'have';
    else {
      onStep('Buscando la letra…');
      const duration = (+meta.song_length || s.song_length || 0) / 1000;
      const lines = await CHB.findLyrics({ artist: meta.artist || s.artist, name: meta.name || s.name, duration }).catch(() => null);
      const phrases = lines ? CHB.lrcToPhrases(lines, duration) : [];
      if (phrases.length && CHB.addLyrics(sng, phrases)) { extras.lyrics = 'added'; changed = true; } else extras.lyrics = 'none';
    }
  }
  if (flags.drums) {
    if (CHB.hasDrums(sng)) extras.drums = 'have';
    else {
      onStep('Creando la batería…');
      try { const r = await AutoChart.addDrums(sng); extras.drums = r.fromStems ? 'stems' : 'added'; changed = true; }
      catch { extras.drums = 'none'; }
    }
  }
  return { bytes: changed ? CHB.writeSng(sng) : raw, extras };
}

function enrichCached(s, raw, onStep) {
  const flags = extrasFlags(s), key = `${s.md5}|${+flags.lyrics}|${+flags.drums}`;
  if (!enrichedCache.has(key)) {
    const job = enrichBytes(s, raw, flags, onStep);
    job.catch(() => enrichedCache.delete(key));
    enrichedCache.set(key, job);
    while (enrichedCache.size > 3) enrichedCache.delete(enrichedCache.keys().next().value);
  }
  return enrichedCache.get(key);
}

async function prepareFrom(s, rawPromise, onStep) {
  const raw = await rawPromise;
  const { bytes: rich, extras } = await enrichCached(s, raw, onStep);
  const out = processSng(rich, want(), $('#allInst').checked, knobs);
  const added = [...out.added];
  if (extras.drums === 'added' || extras.drums === 'stems') added.push('X:drums');
  let bytes = out.bytes;
  const media = songBg[s.md5] || bgMedia;
  if (media) bytes = CHB.writeSng(CHB.setBackground(CHB.readSng(bytes), media));
  return { bytes, added, extras, hasLyrics: CHB.hasLyrics(CHB.readSng(bytes)) };
}

function extrasText(x) {
  const parts = [];
  if (x.lyrics === 'added') parts.push('letra agregada');
  if (x.lyrics === 'none') parts.push('no encontré la letra con tiempos');
  if (x.drums === 'added') parts.push('batería creada desde el audio');
  if (x.drums === 'stems') parts.push('batería creada desde su pista');
  if (x.drums === 'none') parts.push('no se pudo crear la batería');
  return parts.join(' · ');
}

// md5 given: the image is only for that song; otherwise it's the one for all songs without their own
async function chooseBackground(file, md5) {
  if (!file) return;
  if (!/\.(png|jpe?g|mp4|avi|webm|vp8|ogv|mpeg)$/i.test(file.name)) { FX.toast('Formato no válido. Usa JPG, PNG, MP4, WEBM, AVI, OGV o MPEG.'); return; }
  const media = { name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
  if (md5) { songBg[md5] = media; showSongBg(md5); } else { bgMedia = media; showBackground(); }
  if (file.size > 200 * 1048576) FX.toast('Ese video pesa mucho: se copia dentro de la canción.', 6000);
}
function showBackground() {
  $('#bgLabel').textContent = bgMedia ? bgMedia.name : 'ninguna (cada canción usa la suya)';
  $('#bgClear').classList.toggle('hidden', !bgMedia);
}
const bgButton = md5 => {
  if (songBg[md5]) return `<span class="song-bg" data-bg="${esc(md5)}"><button class="bg-btn on" title="Cambiar la imagen de esta canción">🖼 ${esc(songBg[md5].name.slice(0, 18))}</button><button class="bg-x" title="Quitar la imagen">✕</button></span>`;
  const info = infoLoaded[md5], has = info && (info.background || info.video);
  return `<span class="song-bg" data-bg="${esc(md5)}"><button class="bg-btn" title="${has ? 'Esta canción ya trae fondo; la tuya lo reemplaza' : 'Ponerle una imagen o video de fondo a esta canción'}">🖼 ${has ? 'Cambiar imagen' : 'Agregar imagen'}</button></span>`;
};
function showSongBg(md5) {
  for (const el of document.querySelectorAll(`[data-bg="${md5}"]`)) el.outerHTML = bgButton(md5);
  for (const el of document.querySelectorAll(`[data-info="${md5}"]`)) fillInfo(el);
}

/* ---------- what each song brings: read when its row comes into view ---------- */
const infoLoaded = {}, infoJobs = {}, infoWaiting = [];
let infoActive = 0;
function nextInfo() {
  while (infoActive < 4 && infoWaiting.length) {
    const md5 = infoWaiting.shift();
    infoActive++;
    CHB.peekSng(md5).then(i => { infoLoaded[md5] = i; }).catch(() => { infoLoaded[md5] = null; }).finally(() => {
      infoActive--; showSongBg(md5); nextInfo();
    });
  }
}
function fillInfo(el) {
  const md5 = el.dataset.info, i = infoLoaded[md5];
  if (i === undefined) { el.innerHTML = '<span class="ic wait">Revisando qué trae…</span>'; return; }
  if (i === null) { el.innerHTML = ''; return; }
  const chip = (state, text, tip) => `<span class="ic ${state}" title="${esc(tip)}">${text}</span>`;
  const lyr = $('#addLyrics').checked, drm = $('#addDrums').checked;
  el.innerHTML = [
    i.lyrics ? chip('si', '🎤 Con letra', 'Trae la letra') : chip(lyr ? 'add' : 'no', lyr ? '🎤 Sin letra: se buscará' : '🎤 Sin letra', lyr ? 'Al descargar se busca la letra' : 'No trae letra'),
    songBg[md5] ? chip('add', '🖼 Tu imagen', 'Se guarda con tu imagen') : i.background ? chip('si', '🖼 Con fondo', 'Trae imagen de fondo') : chip('no', '🖼 Sin fondo', 'No trae imagen de fondo'),
    i.video ? chip('si', '🎬 Con video', 'Trae video de fondo') : chip('no', '🎬 Sin video', 'No trae video de fondo'),
    i.album ? chip('si', '💿 Con portada', 'Trae portada del álbum') : chip('no', '💿 Sin portada', 'No trae portada del álbum'),
    i.drums ? chip('si', '🥁 Con batería', 'Trae batería') : chip(drm ? 'add' : 'no', drm ? '🥁 Sin batería: se creará' : '🥁 Sin batería', drm ? 'Al descargar se crea desde el audio' : 'No trae batería'),
  ].join('');
}
const infoObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    infoObserver.unobserve(e.target);
    const md5 = e.target.dataset.info;
    if (!/^[0-9a-f]{32}$/.test(md5) || infoLoaded[md5] !== undefined || infoJobs[md5]) continue;
    infoJobs[md5] = true; infoWaiting.push(md5); nextInfo();
  }
}, { rootMargin: '300px' }) : null;
// rows just rendered: draw what is known and ask for the rest when they are seen
function watchInfo(root) {
  for (const el of root.querySelectorAll('[data-info]')) { fillInfo(el); if (infoObserver) infoObserver.observe(el); }
}

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
const prepare = (s, onProgress, onStep) => prepareFrom(s, getRaw(s, onProgress), onStep);

async function exportSong(s, getBytes = () => prepare(s)) {
  try {
    FX.toast('Preparando carpeta para Moonscraper…', 2000);
    const { bytes } = await getBytes();
    const { folder, bytes: zip } = CHB.sngToZip(bytes);
    const link = deliver(folder + '.zip', new Blob([zip], { type: 'application/zip' }));
    FX.toast(`<b>✏️ Lista para editar</b>${link ? ' ' + saveLink(link) : ''}<br><small>Descomprime <b>${esc(folder)}.zip</b> y abre <b>notes.chart</b> (o notes.mid) en Moonscraper. Si la pones en tu carpeta Songs, Clone Hero también la lee.</small>`, link ? 60000 : 9000);
  } catch (e) { FX.toast('✖ ' + esc(e.message)); }
}

/* ---------- download queue ---------- */
const queue = { jobs: [], done: 0, ok: 0, fail: 0, running: false, cur: 0 };
// Where the browser can write to a folder, it's asked for right away and then remembered.
// Must run straight from a click: browsers only open the picker from a user gesture.
async function folderReady() {
  if (!canPickDir) return true;
  if (dirHandle && await ensurePermission().catch(() => false)) return true;
  if (await pickFolder()) return true;
  FX.toast('Descarga cancelada: no elegiste una carpeta.', 3500);
  return false;
}

// must be called straight from a click
async function enqueue(songs) {
  const fresh = songs.filter(s => !queue.jobs.some(j => j.s.md5 === s.md5 && !j.finished));
  if (!fresh.length) return;
  if (!(await folderReady())) return;
  for (const s of fresh) queue.jobs.push({ s });
  for (const s of fresh) setStatus(s.md5, 'En cola…');
  for (const s of fresh) Analytics.track('download_song', { song: `${s.artist} - ${s.name}` });
  FX.pick();
  runQueue();
}

// without a folder (Firefox, Safari) several songs go out as a few .zip files instead of one download each
const ZIP_EVERY = 10;
let zipBatch = [], zipPart = 0;
function flushZip() {
  if (!zipBatch.length) return;
  zipPart++;
  const zip = CHB.makeZip(zipBatch.map(x => ({ name: x.name, data: x.bytes })));
  const zipName = `CH Buscador - canciones ${zipPart}.zip`;
  const link = deliver(zipName, new Blob([zip], { type: 'application/zip' }));
  for (const x of zipBatch) setStatus(x.md5, `${link ? 'Lista en' : '✔ en'} "${zipName}" · ${x.gen}`, 'ok', link);
  if (link) FX.toast(`<b>${esc(zipName)}</b> está listo ${saveLink(link)}`, 120000);
  zipBatch = [];
}

async function runQueue() {
  if (queue.running) return;
  queue.running = true;
  clearTimeout(queue.timer);
  // songs from an earlier run don't belong to this one
  queue.jobs = queue.jobs.filter(j => !j.finished); queue.done = queue.ok = queue.fail = 0;
  showQueue();
  if (dirHandle) await ensurePermission().catch(() => false);
  const batch = !dirHandle && queue.jobs.length > 1;
  const links = [];
  for (let j; (j = queue.jobs.find(x => !x.finished));) {
    const s = j.s; queue.cur = 0; showQueue(s);
    try {
      setStatus(s.md5, 'Descargando…');
      const { bytes, added, extras, hasLyrics } = await prepare(s, (a, b) => { queue.cur = b ? a / b : 0; showQueue(s); }, t => setStatus(s.md5, t));
      const g = CHB.sngDifficulties(bytes).guitar || [];
      const ok = want().every(k => g.includes(k));
      const levels = added.filter(a => a !== 'X:drums');
      const gen = [levels.length ? `se creó: ${summarize(levels)}` : 'ya traía los niveles', extrasText(extras), extras.lyrics === 'added' || extras.lyrics === 'none' ? '' : (hasLyrics ? '🎤 con letra' : '🎤 sin letra')].filter(Boolean).join(' · ');
      if (batch) {
        zipBatch.push({ md5: s.md5, name: fileName(s), bytes, gen });
        setStatus(s.md5, 'Lista, esperando para empaquetar…');
        if (zipBatch.length >= ZIP_EVERY) flushZip();
      } else {
        const { where, link } = await saveSong(fileName(s), bytes);
        setStatus(s.md5, `${link ? '' : '✔ '}${where} · ${gen}${ok ? '' : ' · ⚠ no se pudo completar la guitarra'}`, ok ? 'ok' : 'err', link);
        if (link) { links.push({ s, link }); pendingSaves[link.url] = s; }
      }
      // a song waiting for its Guardar click counts when it's clicked
      if (!pendingSaves[statusOf[s.md5]?.link?.url]) Community.recordDownload(s);
      queue.ok++;
    } catch (e) { setStatus(s.md5, '✖ ' + e.message, 'err'); queue.fail++; }
    j.finished = true; queue.done++;
  }
  flushZip(); zipPart = 0;
  queue.running = false; showQueue();
  const n = queue.ok, f = queue.fail;
  const how = batch
    ? 'Descomprime los .zip dentro de tu carpeta Songs. Si el navegador pregunta, permite descargar varios archivos.<br>Luego en Clone Hero: Settings → General → Scan Songs'
    : 'En Clone Hero: Settings → General → Scan Songs';
  if (links.length) {
    // nothing is saved yet: say so, with the button at hand (also over the preview)
    FX.toast(links.map(x => `<b>${esc(x.s.name)}</b> está lista ${saveLink(x.link)}`).join('<br>'), 120000);
  } else if (n) { FX.sparks(); FX.strum(); FX.toast(`<b>¡Rock on! 🤘</b> ${n} ${n === 1 ? 'canción lista' : 'canciones listas'}${f ? ` · ${f} con error` : ''}<br><small>${how}</small>`, batch ? 10000 : 6000); }
  else if (f) FX.toast(`No se pudo descargar ${f === 1 ? 'la canción' : f + ' canciones'}.`);
  queue.timer = setTimeout(() => { if (!queue.running) { queue.jobs = []; queue.done = queue.ok = queue.fail = 0; showQueue(); } }, 4000);
}

// the Guardar link is what really saves the file: only now it counts, and the status can say so
const pendingSaves = {};
document.addEventListener('click', e => {
  const a = e.target.closest('.save-link'); if (!a) return;
  const url = a.getAttribute('href'), s = pendingSaves[url];
  // the same file can have its button in the list and in a notice
  for (const same of document.querySelectorAll('.save-link')) {
    if (same.getAttribute('href') !== url) continue;
    same.textContent = '✔ Guardado'; same.classList.add('done');
    const toast = same.closest('.toast');
    // once everything in the notice is saved, it fades away
    if (toast && !toast.querySelector('.save-link:not(.done)')) FX.dismiss(toast, 900);
  }
  if (s) { Community.recordDownload(s); delete pendingSaves[url]; setStatus(s.md5, '✔ enviada a tu carpeta de Descargas', 'ok'); FX.sparks(50); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
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
      <div class="badges">${flames(s)}${badges}</div><div class="info" data-info="${s.md5}"></div></div>
    <div class="actions">
      <label class="chk"><input type="checkbox" class="pick" ${state.sel.has(s.md5) ? 'checked' : ''}> elegir</label>
      <div class="row" style="gap:6px">${bgButton(s.md5)}<button class="pv-btn" title="Vista previa">▶ Ver</button><button class="dl">Descargar</button></div>
      <div class="status ${st.cls || ''}" id="st-${s.md5}">${statusHtml(s.md5)}</div>
    </div></div>`;
}

function render() {
  const box = $('#results');
  if (!state.items.length) box.innerHTML = state.args ? '<div class="empty">No encontré canciones que cumplan con lo que pides.</div>' : '';
  else box.innerHTML = state.items.map(songCard).join('');
  watchInfo(box);
  $('#moreBtn').classList.toggle('hidden', !state.args || state.done);
  $('#shareSearch').classList.toggle('hidden', !state.args);
  $('#resultsHead').classList.toggle('hidden', !state.items.length);
  $('#resultsCount').textContent = state.items.length ? `${state.items.length} canciones` : '';
  $('#batchBar').classList.toggle('hidden', !state.sel.size);
  $('#selCount').textContent = `${state.sel.size} seleccionada(s)`;
}

function statusHtml(md5) {
  const st = statusOf[md5] || {};
  return esc(st.text || '') + (st.link ? ' ' + saveLink(st.link) : '');
}
function setStatus(md5, text, cls, link) {
  statusOf[md5] = { text, cls, link };
  for (const el of document.querySelectorAll(`[id="st-${md5}"]`)) { el.innerHTML = statusHtml(md5); el.className = 'status ' + (cls || ''); }
}

async function doSearch(args, limit, push = true) {
  const more = args === state.args && state.items.length;
  tab('search');
  if (more) $('#moreBtn').disabled = true;
  else $('#results').innerHTML = '<div class="empty loading">Buscando…</div>';
  const text = args.query || args.artist || args.genre;
  rememberSearch(text);
  if (push) { setUrl({ q: text, por: Object.keys(args)[0] }); Analytics.track('search', { search_term: text }); }
  try {
    const items = await findSongs({ ...args, want: want(), limit, onlyNative: $('#filter').value === 'native' });
    state = { args, limit, items, sel: more ? state.sel : new Set(), done: items.length < limit };
  } catch (e) { $('#results').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  finally { $('#moreBtn').disabled = false; }
  render();
}

function openPreview(s) {
  setBackdrop(s);
  Analytics.track('preview', { song: `${s.artist} - ${s.name}` });
  Preview.open({
    song: s,
    fetchBytes: onProgress => prepare(s, onProgress),
    regenerate: k => { setKnobs(k); return prepare(s); },
    knobs,
    extra: (kind, onStep) => { (askedFor[s.md5] = askedFor[s.md5] || {})[kind] = true; return prepare(s, undefined, onStep); },
    background: async file => { await chooseBackground(file, s.md5); return prepare(s); },
    rating: Community.canRate(s.md5) ? { summary: () => Community.summary(s.md5), mine: level => Community.myVote(s.md5, level), rate: (level, stars) => Community.rate(s.md5, level, stars) } : null,
    onDownload: () => enqueue([s]),
    onExport: () => exportSong(s),
    preferDiff: want().includes('M') ? 'M' : want()[0],
  });
}

/* ---------- community: counter and most downloaded (this week / all time) ---------- */
let topSongs = [], topPeriod = 'week';
async function loadCommunity() {
  const n = await Community.total();
  if (n > 0) {
    $('#counter').innerHTML = `🎸 <b>${Number(n).toLocaleString('es')}</b> ${n === 1 ? 'canción descargada' : 'canciones descargadas'}`;
    $('#counter').classList.remove('hidden');
  }
}
async function loadTop(period = topPeriod) {
  topPeriod = period;
  $('#topPeriodWeek').classList.toggle('on', period === 'week');
  $('#topPeriodAll').classList.toggle('on', period === 'all');
  $('#topList').innerHTML = '<div class="empty loading">Cargando…</div>';
  const list = await Community.top(25, period);
  if (period !== topPeriod) return;   // the other tab was chosen meanwhile
  topSongs = (list || []).map(x => ({ md5: x.md5, artist: x.artist, name: x.name, downloads: x.downloads }));
  if (!topSongs.length) {
    $('#topList').innerHTML = `<div class="empty">${period === 'week' ? 'Todavía no hay descargas esta semana. ¡Sé la primera persona!' : 'Todavía no hay datos del histórico.'}</div>`;
    return;
  }
  $('#topList').innerHTML = topSongs.map((s, i) => `
    <div class="prow" data-md5="${esc(s.md5)}">
      <span class="pn">${i + 1}</span>
      <span class="pt"><b>${esc(s.name)}</b><small>${esc(s.artist)} · ${Number(s.downloads).toLocaleString('es')} ${s.downloads === 1 ? 'descarga' : 'descargas'}</small><span class="info" data-info="${esc(s.md5)}"></span></span>
      <span class="row" style="gap:6px">${bgButton(s.md5)}<button class="pv-btn" title="Vista previa">▶</button><button class="dl">Descargar</button></span>
      <div class="status ${statusOf[s.md5]?.cls || ''}" id="st-${esc(s.md5)}">${statusHtml(s.md5)}</div>
    </div>`).join('');
  watchInfo($('#topList'));
}

/* ---------- packs ---------- */
const packSongs = p => p.songs.map(x => ({ md5: x.m, artist: x.a, name: x.n }));
function renderPacks() {
  const groups = [...new Set(PACKS.map(p => p.group || 'Listas especiales'))];
  $('#packGrid').innerHTML = groups.map(g => `
    <h2 class="pack-group">${esc(g)}</h2>
    <div class="packs">${PACKS.filter(p => (p.group || 'Listas especiales') === g).map(p => `
      <button class="pack" data-pack="${p.id}" style="--c1:${p.colors[0]};--c2:${p.colors[1]}">
        <span class="pack-emoji">${p.emoji}</span>
        <span class="pack-title">${esc(p.title)}</span>
        <span class="pack-desc">${esc(p.desc)}</span>
        <span class="pack-count">${p.songs.length} canciones</span>
      </button>`).join('')}</div>`).join('');
}
function openPack(id, push = true) {
  const p = PACKS.find(x => x.id === id);
  if (!p) return;
  tab('packs');
  if (push) setUrl({ pack: id });
  Analytics.track('pack_open', { pack: id });
  const songs = packSongs(p);
  $('#packGrid').classList.add('hidden');
  $('#packDetail').classList.remove('hidden');
  $('#packDetail').style.setProperty('--c1', p.colors[0]); $('#packDetail').style.setProperty('--c2', p.colors[1]);
  $('#packHead').innerHTML = `<span class="pack-emoji">${p.emoji}</span><div><h2>${esc(p.title)}</h2><p class="sub">${esc(p.desc)} · ${songs.length} canciones</p></div>`;
  $('#packList').innerHTML = songs.map((s, i) => `
    <div class="prow" data-md5="${s.md5}">
      <span class="pn">${i + 1}</span>
      <span class="pt"><b>${esc(s.name)}</b><small>${esc(s.artist)}</small><span class="info" data-info="${s.md5}"></span></span>
      <span class="row" style="gap:6px">${bgButton(s.md5)}<button class="pv-btn" title="Vista previa">▶</button></span>
      <div class="status ${statusOf[s.md5]?.cls || ''}" id="st-${s.md5}">${statusHtml(s.md5)}</div>
    </div>`).join('');
  watchInfo($('#packList'));
  $('#packDl').onclick = () => { Analytics.track('pack_download', { pack: id }); enqueue(songs); };
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
// the same library, read from a writable folder (Chrome, Edge) or from a read-only folder selection (Firefox, Safari)
async function* libraryEntries(files) {
  if (files) {
    for (const file of files) if (/\.sng$/i.test(file.name)) yield { path: file.webkitRelativePath || file.name, name: file.name, getFile: async () => file };
    return;
  }
  for await (const f of walk(dirHandle)) yield { path: f.path, name: f.name, getFile: () => f.h.getFile(), dir: f.dir, h: f.h };
}
async function fixLibrary(files) {
  const log = $('#libLog'); const say = t => { log.textContent += t + '\n'; log.scrollTop = log.scrollHeight; };
  if (!files) {
    if (!dirHandle && !(await pickFolder())) return;
    if (!(await ensurePermission())) { say('Sin permiso para la carpeta.'); return; }
  }
  log.classList.remove('hidden'); log.textContent = ''; $('#fixLib').disabled = true;
  let n = 0, fixed = 0;
  for await (const f of libraryEntries(files)) {
    n++;
    try {
      const buf = new Uint8Array(await (await f.getFile()).arrayBuffer());
      const { bytes: rich, extras } = await enrichBytes({ md5: f.path, artist: '', name: '' }, buf, { lyrics: $('#addLyrics').checked, drums: $('#addDrums').checked }, t => say(`           ${f.path}: ${t}`));
      const { bytes, added } = processSng(rich, want(), $('#allInst').checked, knobs);
      const note = [added.length ? summarize(added) : '', extrasText(extras)].filter(Boolean).join(' · ');
      if (bytes === buf) { say(`OK         ${f.path}${note ? ' → ' + note : ''}`); continue; }
      if (f.h) {
        const bk = await f.dir.getFileHandle(f.name + '.original', { create: true });
        let w = await bk.createWritable(); await w.write(buf); await w.close();
        w = await f.h.createWritable(); await w.write(bytes); await w.close();
      } else {
        zipBatch.push({ md5: 'lib-' + n, name: f.path, bytes, gen: note });
        if (zipBatch.length >= ZIP_EVERY) flushZip();
      }
      fixed++; say(`ARREGLADA  ${f.path} → ${note}`);
    } catch (e) { say(`ERROR      ${f.path}: ${e.message}`); }
  }
  if (files) { flushZip(); zipPart = 0; }
  say(`\nListo: ${n} canciones revisadas, ${fixed} arregladas. ${files && fixed ? 'Descomprime los .zip sobre tu carpeta Songs para reemplazarlas. ' : ''}En Clone Hero dale a "Scan Songs".`);
  $('#fixLib').disabled = false;
  if (fixed) { FX.sparks(); FX.strum(); }
}
// picks the library the right way for this browser, straight from the click
function runLibrary(action) {
  if (canPickDir) return action === 'fix' ? fixLibrary() : libraryStats();
  $('#libInput').dataset.action = action; $('#libInput').value = ''; $('#libInput').click();
}

// reads only the header and the chart of each .sng, so big libraries are fast
async function readLite(file) {
  const head = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
  const { mask, meta, index } = CHB.readSngIndex(head);
  const chart = index.find(f => /\.(chart|midi?)$/i.test(f.name));
  if (!chart) return { meta, diffs: {} };
  const raw = new Uint8Array(await file.slice(chart.off, chart.off + chart.len).arrayBuffer());
  const mini = { meta: [], files: [{ name: chart.name, data: CHB.xorData(raw, mask) }] };
  return { meta, diffs: CHB.sngDifficulties(mini), lyrics: CHB.hasLyrics(mini) };
}
async function libraryStats(files) {
  if (!files) {
    if (!dirHandle && !(await pickFolder())) return;
    if (!(await ensurePermission())) return;
  }
  const out = $('#stats'); out.classList.remove('hidden');
  out.innerHTML = '<div class="empty loading">Revisando tu biblioteca…</div>';
  $('#statsLib').disabled = true;
  const rows = []; let bytes = 0, n = 0;
  for await (const f of libraryEntries(files)) {
    try {
      const file = await f.getFile(); bytes += file.size;
      const { meta, diffs, lyrics } = await readLite(file);
      rows.push({ path: f.path, artist: meta.artist || '¿?', name: meta.name || f.name, genre: meta.genre || 'Sin género', g: diffs.guitar || [], insts: Object.keys(diffs), lyrics: !!lyrics });
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
      <div class="tile"><b>${rows.filter(r => r.lyrics).length}</b><span>🎤 tienen letra</span></div>
      <div class="tile"><b>${rows.filter(r => r.insts.includes('drums')).length}</b><span>🥁 tienen batería</span></div>
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
const createdLevels = onStep => prepareFrom(created.song, Promise.resolve(created.bytes), onStep);
async function createFromAudio() {
  if (!acFile) return;
  const artist = $('#acArtist').value.trim() || 'Desconocido', name = $('#acName').value.trim() || 'Mi canción';
  $('#acGo').disabled = true; $('#acProg').classList.remove('hidden'); $('#acResult').classList.add('hidden');
  const t0 = performance.now();
  try {
    const r = await AutoChart.create(acFile, {
      name, artist, sensitivity: +$('#acSens').value, drums: $('#acDrums').checked,
      onProgress: (text, f) => { $('#acProgText').textContent = text; $('#acProgBar').style.width = (f * 100).toFixed(0) + '%'; },
    });
    Analytics.track('chart_from_audio', { song: `${artist} - ${name}` });
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
    fetchBytes: () => createdLevels(),
    regenerate: k => { setKnobs(k); return createdLevels(); },
    knobs,
    extra: (kind, onStep) => { (askedFor[created.song.md5] = askedFor[created.song.md5] || {})[kind] = true; return createdLevels(onStep); },
    background: async file => { await chooseBackground(file, created.song.md5); return createdLevels(); },
    onDownload: saveCreated,
    onExport: () => exportSong(created.song, () => createdLevels()),
    preferDiff: want().includes('M') ? 'M' : want()[0],
  });
}
async function saveCreated() {
  if (!created || !(await folderReady())) return;
  try {
    const { where, link } = await saveSong(fileName(created.song), (await createdLevels()).bytes);
    if (link) { FX.toast(`<b>${esc(created.song.name)}</b> está lista ${saveLink(link)}`, 120000); return; }
    FX.sparks(); FX.strum();
    FX.toast(`<b>¡Rock on! 🤘</b> ${esc(created.song.name)} ${esc(where)}<br><small>En Clone Hero: Settings → General → Scan Songs</small>`, 6000);
  } catch (e) { FX.toast('✖ ' + esc(e.message)); }
}

/* ---------- tabs ---------- */
function tab(name) {
  for (const t of ['search', 'top', 'packs', 'lib', 'audio']) {
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
for (const id of ['#needE', '#needM', '#needH', '#allInst', '#addLyrics', '#addDrums']) $(id).onchange = () => { render(); for (const el of document.querySelectorAll('[data-info]')) fillInfo(el); savePrefs(); };
// the image button of any song row shares one file picker
let bgTarget = null;
document.addEventListener('click', e => {
  const box = e.target.closest('.song-bg'); if (!box) return;
  const md5 = box.dataset.bg;
  if (e.target.closest('.bg-x')) { delete songBg[md5]; showSongBg(md5); return; }
  if (e.target.closest('.bg-btn')) { bgTarget = md5; $('#songBgFile').click(); }
});
$('#songBgFile').onchange = e => { chooseBackground(e.target.files[0], bgTarget); e.target.value = ''; };
$('#bgFile').onchange = e => { chooseBackground(e.target.files[0]); e.target.value = ''; };
$('#bgClear').onclick = () => { bgMedia = null; showBackground(); };
$('#libInput').onchange = e => {
  const files = [...e.target.files];
  if (e.target.dataset.action === 'fix') fixLibrary(files); else libraryStats(files);
};

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
$('#topList').onclick = e => {
  const row = e.target.closest('.prow'); if (!row) return;
  const s = topSongs.find(x => x.md5 === row.dataset.md5); if (!s) return;
  if (e.target.closest('.dl')) enqueue([s]);
  if (e.target.closest('.pv-btn')) openPreview(s);
};
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
$('#tab-top').onclick = () => { tab('top'); loadTop(); };
$('#topPeriodWeek').onclick = () => loadTop('week');
$('#topPeriodAll').onclick = () => loadTop('all');
$('#audioFile').onchange = e => pickAudio(e.target.files[0]);
$('#drop').addEventListener('dragover', e => { e.preventDefault(); $('#drop').classList.add('over'); });
$('#drop').addEventListener('dragleave', () => $('#drop').classList.remove('over'));
$('#drop').addEventListener('drop', e => { e.preventDefault(); $('#drop').classList.remove('over'); pickAudio(e.dataTransfer.files[0]); });
$('#acGo').onclick = createFromAudio;
$('#acPreview').onclick = previewCreated;
$('#acDl').onclick = saveCreated;
$('#acEdit').onclick = () => created && exportSong(created.song, async () => createdLevels());
$('#fixLib').onclick = () => runLibrary('fix');
$('#statsLib').onclick = () => runLibrary('stats');
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
  if (p && p.lyrics !== undefined) $('#addLyrics').checked = p.lyrics;
  if (p && p.drums !== undefined) $('#addDrums').checked = p.drums;
  showKnobs(); showBackground(); Analytics.init(); loadCommunity();
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
