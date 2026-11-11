// ===============
// == GRABACIÓN ==
// ===============
// Botón de grabar del panel de la emisora. Se graba lo que sale del ecualizador (normalizado y ecualizado, sin el volumen), así que la grabación
// sigue sin cortes aunque se cambie de emisora o entren los boletines: todo pasa por ese punto (ver audio.js).
// El audio va a un worklet (rec-worklet.js) → worker (rec-worker.js) que lo pasa a MP3 de bitrate variable y lo guarda por trozos de un segundo
// en IndexedDB. Al parar se juntan los trozos con la cabecera del MP3 (duración e índice para saltar) y se descarga como
// aaaa-mm-dd_hh-mm-ss_record.mp3. Si la página se cierra o se cuelga a mitad, al volver a abrirla se ofrece descargar lo grabado.
// Solo con la salida Web Audio: con la nativa no hay de dónde sacar el audio y el botón no se muestra.
// Las emisoras en modo degradado (sin CORS) no se pueden grabar: mientras se graba no se pueden poner (ver stations.js).

import { S, clockNow } from './state.js';
import { getOutMode, getRecTap } from './audio.js';
import { log, openDialog, closeDialog, toast } from './ui.js';
import { getMain, stopAll } from './player.js';

const DB_NAME = 'rn_rec';
const LOCK_PREFIX = 'rn-rec-';        // mientras se graba, la pestaña tiene este candado: otra pestaña no la confunde con una grabación abandonada
const STALE_MS = 15000;               // sin candados en el navegador: una grabación sin trozos nuevos desde hace esto se da por abandonada

const recBtn = document.getElementById('recBtn');
const recTime = document.getElementById('recTime');
const askDlg = document.getElementById('askDlg');
const askTitle = document.getElementById('askTitle');
const askText = document.getElementById('askText');
const askYes = document.getElementById('askYes');
const askNo = document.getElementById('askNo');

const supported = typeof AudioWorkletNode !== 'undefined' && typeof Worker !== 'undefined' && typeof indexedDB !== 'undefined';

let rec = null;   // grabación en curso: { id, name, start, worker, node, sink, unlock, stopping }
let timer = 0;

// ==================
// == INDEXEDDB ==
// ==================
function openDb() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('recs')) d.createObjectStore('recs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: ['id', 'seq'] });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
const reqP = rq => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
async function listRecs() {
  const db = await openDb();
  try { return await reqP(db.transaction('recs').objectStore('recs').getAll()); } finally { db.close(); }
}
async function readRec(id) {
  const db = await openDb();
  try {
    const tx = db.transaction(['recs', 'chunks']);
    const meta = await reqP(tx.objectStore('recs').get(id));
    const chunks = await reqP(tx.objectStore('chunks').getAll(IDBKeyRange.bound([id, 0], [id, Infinity])));
    return { meta, chunks: chunks.sort((a, b) => a.seq - b.seq).map(c => c.data) };
  } finally { db.close(); }
}
async function deleteRec(id) {
  const db = await openDb();
  try {
    const tx = db.transaction(['recs', 'chunks'], 'readwrite');
    tx.objectStore('recs').delete(id);
    tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });
  } finally { db.close(); }
}

// ===============================
// == CABECERA DEL MP3 (XING) ==
// ===============================
// LAME, usado por trozos, no escribe la cabecera de bitrate variable: sin ella los reproductores calculan mal la duración y saltan mal.
// Se añade al principio una trama vacía con la etiqueta "Xing": número de tramas, tamaño y un índice de 100 posiciones (meta.marks
// guarda dónde empieza cada 64ª trama).
const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SR = [44100, 48000, 32000];
function xingFrame(meta) {
  const h = meta.hdr;
  if (!h || !meta.frames) return new Uint8Array(0);
  const ver = (h[1] >> 3) & 3, mpeg1 = ver === 3;
  const sr = SR[(h[2] >> 2) & 3] / (mpeg1 ? 1 : ver === 2 ? 2 : 4);
  const mono = (h[3] >> 6) === 3;
  const side = mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
  const need = 4 + side + 120;   // cabecera + información lateral + "Xing", banderas, tramas, bytes y el índice
  const table = mpeg1 ? BR1 : BR2;
  let bri = 1, size = 0;
  for (; bri < 15; bri++) { size = Math.floor((mpeg1 ? 144000 : 72000) * table[bri] / sr); if (size >= need) break; }
  const f = new Uint8Array(size);
  f[0] = 0xff;
  f[1] = h[1] | 1;                                 // sin CRC
  f[2] = (bri << 4) | (h[2] & 0x0c);              // misma frecuencia, sin relleno
  f[3] = h[3];
  const dv = new DataView(f.buffer);
  let o = 4 + side;
  f.set([0x58, 0x69, 0x6e, 0x67], o);             // "Xing"
  dv.setUint32(o + 4, 7);                          // hay tramas, bytes e índice
  dv.setUint32(o + 8, meta.frames);
  const total = size + meta.bytes;
  dv.setUint32(o + 12, total);
  const posOfFrame = k => {                        // posición aproximada de la trama k (entre dos marcas, a partes iguales)
    const m = meta.marks, j = Math.min(m.length - 1, Math.floor(k / 64));
    const a = m[j], b = j + 1 < m.length ? m[j + 1] : meta.bytes, span = j + 1 < m.length ? 64 : Math.max(1, meta.frames - j * 64);
    return a + (b - a) * Math.min(1, (k - j * 64) / span);
  };
  for (let i = 0; i < 100; i++) f[o + 16 + i] = Math.min(255, Math.floor((size + posOfFrame(Math.floor(i / 100 * meta.frames))) / total * 256));
  return f;
}

// ==================
// == DESCARGA ==
// ==================
async function saveRec(id) {
  const { meta, chunks } = await readRec(id);
  if (!meta || !chunks.length) { await deleteRec(id); return false; }
  const blob = new Blob([xingFrame(meta), ...chunks], { type: 'audio/mpeg' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = meta.name + '.mp3';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 120000);
  log('Grabación guardada: ' + a.download + ' (' + fmtDur(meta.dur) + ', ' + (blob.size / 1048576).toFixed(1) + ' MB)');
  await deleteRec(id);
  return true;
}

const pad = n => String(n).padStart(2, '0');
function fileName(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds()) + '_record';
}
function fmtDur(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(s % 60);
}

// ==================
// == GRABAR ==
// ==================
export const isRecording = () => !!rec;

async function start() {
  const tap = getRecTap();
  if (rec || !tap || !S.audioCtx) return;
  const ac = S.audioCtx;
  const d = new Date(clockNow());
  const id = d.getTime() + '-' + Math.random().toString(36).slice(2, 7);
  const r = rec = { id, name: fileName(d), start: Date.now(), worker: null, node: null, sink: null, unlock: null, stopping: null };
  S.recording = true;
  refreshRecBtn();
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});   // que el navegador no borre los trozos por falta de espacio
    if (navigator.locks) {
      await new Promise(got => navigator.locks.request(LOCK_PREFIX + id, () => { got(); return new Promise(rel => { r.unlock = rel; }); }));
    }
    if (!ac.__rnRec) { await ac.audioWorklet.addModule(new URL('./rec-worklet.js', import.meta.url)); ac.__rnRec = true; }
    if (rec !== r) return;
    const worker = r.worker = new Worker(new URL('./rec-worker.js', import.meta.url));
    const ch = new MessageChannel();
    const ready = new Promise((res, rej) => {
      worker.onmessage = e => {
        const m = e.data || {};
        if (m.ready) { r.ready = true; res(); }
        else if (m.error) { if (r.ready) onWorkerError(r, m.error); else rej(new Error(m.error)); }
        else if (m.done && r.done) r.done();
      };
      worker.onerror = e => { const msg = (e && e.message) || 'Error del grabador'; if (r.ready) onWorkerError(r, msg); else rej(new Error(msg)); };
    });
    worker.postMessage({ cmd: 'start', id, name: r.name, start: r.start, sampleRate: ac.sampleRate, port: ch.port2 }, [ch.port2]);
    await ready;
    if (rec !== r) return;
    // el worklet tiene que estar enganchado a la salida para que el navegador lo haga funcionar: va a ella con volumen 0
    const node = r.node = new AudioWorkletNode(ac, 'rn-rec-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    const sink = r.sink = ac.createGain();
    sink.gain.value = 0;
    node.port.postMessage({ port: ch.port1 }, [ch.port1]);
    tap.connect(node);
    node.connect(sink);
    sink.connect(ac.destination);
    r.start = Date.now();
    log('Grabando: ' + r.name + '.mp3');
    timer = setInterval(refreshRecBtn, 500);
    refreshRecBtn();
  } catch (err) {
    log('No se pudo empezar a grabar: ' + err.message);
    toast('No se pudo empezar a grabar');
    cleanup(r);
    deleteRec(id).catch(() => {});
  }
}

function cleanup(r) {
  try { if (r.node) { r.node.disconnect(); const t = getRecTap(); if (t) try { t.disconnect(r.node); } catch (_) {} } } catch (_) {}
  try { if (r.sink) r.sink.disconnect(); } catch (_) {}
  if (r.worker) r.worker.terminate();
  if (r.unlock) r.unlock();
  if (rec === r) {
    rec = null;
    S.recording = false;
    clearInterval(timer);
    timer = 0;
    refreshRecBtn();
    import('./stations.js').then(m => m.refreshStations()).catch(() => {});   // las emisoras vetadas vuelven a poder ponerse
  }
}

// El worker no puede seguir (sin espacio, error): se guarda lo que haya
function onWorkerError(r, msg) {
  if (rec !== r || r.stopping) return;
  log('Grabación interrumpida: ' + msg);
  toast('Grabación interrumpida: ' + msg, 5000);
  r.stopping = (async () => {
    cleanup(r);
    try { await saveRec(r.id); } catch (err) { log('No se pudo guardar la grabación: ' + err.message); }
  })();
}

// Parar: el worklet manda lo que le queda, el worker cierra el MP3 y se descarga
export function stopRecording() {
  const r = rec;
  if (!r) return Promise.resolve();
  if (r.stopping) return r.stopping;
  r.stopping = (async () => {
    recBtn.disabled = true;
    if (r.node && r.worker) {
      await new Promise(res => {
        r.done = res;
        r.node.port.postMessage({ stop: true });
        setTimeout(res, 5000);   // si algo se queda colgado, se guarda lo que ya esté escrito
      });
    }
    cleanup(r);
    try { await saveRec(r.id); } catch (err) { log('No se pudo guardar la grabación: ' + err.message); toast('No se pudo guardar la grabación'); }
  })();
  return r.stopping;
}

// ==================
// == BOTÓN ==
// ==================
// Solo se puede empezar con una emisora sonando de verdad (y que no vaya en modo degradado)
export function refreshRecBtn() {
  if (!recBtn) return;
  const show = supported && getOutMode() !== 'nativa';
  recBtn.hidden = !show;
  if (!show) return;
  const on = !!rec;
  recBtn.classList.toggle('on', on);
  const main = getMain();
  const canStart = !!S.audioCtx && !!main && main.state === 'playing' && !S.degraded && S.session !== 'off' && !S.held;
  recBtn.disabled = on ? !!rec.stopping : !canStart;
  const label = on ? 'Parar la grabación' : S.degraded && main ? 'Esta emisora no se puede grabar' : 'Grabar';
  if (recBtn.title !== label) { recBtn.title = label; recBtn.setAttribute('aria-label', label); }
  const t = on ? fmtDur((Date.now() - rec.start) / 1000) : '';
  if (recTime.textContent !== t) recTime.textContent = t;
}

recBtn.addEventListener('click', () => { if (rec) stopRecording(); else start(); });

// ==================
// == PREGUNTAS ==
// ==================
// Ventana pequeña con dos botones; resuelve true con el primero, false con el segundo y null si se cierra con Escape
function ask(title, text, yes, no) {
  return new Promise(res => {
    askTitle.textContent = title;
    askText.textContent = text;
    askYes.textContent = yes;
    askNo.textContent = no;
    const done = v => { askYes.onclick = askNo.onclick = askDlg.oncancel = null; closeDialog(askDlg); res(v); };
    askYes.onclick = () => done(true);
    askNo.onclick = () => done(false);
    askDlg.oncancel = e => { e.preventDefault(); done(null); };
    openDialog(askDlg);
    askNo.focus();
  });
}

// Detener (botón, pantalla completa, notificación): con una grabación en curso se pregunta antes
let asking = false;
export async function requestStop() {
  if (!rec) { stopAll(); return; }
  if (asking) return;
  asking = true;
  const ok = await ask('Grabación en curso', 'Si detienes la radio, la grabación se parará y se descargará.', 'Parar la grabación', 'Cancelar');
  asking = false;
  if (!ok) return;
  await stopRecording();
  stopAll();
}

// Cerrar o recargar la página grabando: el navegador pregunta (si se cierra igualmente, lo grabado se recupera al volver)
window.addEventListener('beforeunload', e => { if (rec) { e.preventDefault(); e.returnValue = ''; } });

// ==================================
// == GRABACIONES SIN TERMINAR ==
// ==================================
// Al abrir la página: si quedó alguna grabación a medias (la página se cerró o se colgó grabando), se ofrece descargarla o descartarla
async function orphans() {
  const all = await listRecs();
  if (!all.length) return [];
  let held = null;
  if (navigator.locks && navigator.locks.query) {
    try { held = new Set((await navigator.locks.query()).held.map(l => l.name)); } catch (_) {}
  }
  return all.filter(m => (!rec || m.id !== rec.id) && (held ? !held.has(LOCK_PREFIX + m.id) : Date.now() - (m.t || 0) > STALE_MS));
}
export async function checkUnfinished() {
  if (!supported) return;
  let list = [];
  try { list = await orphans(); } catch (_) { return; }
  for (const m of list) {
    const d = new Date(m.start);
    const when = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' a las ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    const keep = await ask('Grabación sin terminar', 'Hay una grabación del ' + when + ' (' + fmtDur(m.dur) + ') que no se llegó a guardar.', 'Descargar', 'Descartar');
    if (keep === null) continue;   // cerrada sin elegir: se vuelve a preguntar la próxima vez
    try {
      if (keep) await saveRec(m.id); else { await deleteRec(m.id); log('Grabación sin terminar descartada: ' + m.name); }
    } catch (err) { log('No se pudo recuperar la grabación: ' + err.message); }
  }
}
