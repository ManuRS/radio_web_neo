// =========================================
// == GRABACIÓN: CODIFICADOR MP3 (WORKER) ==
// =========================================
// Recibe el audio del worklet (rec-worklet.js), lo pasa a MP3 con LAME (bitrate variable: en cada momento usa solo lo que hace falta)
// y lo va guardando por trozos de un segundo en IndexedDB. Así, si la página se cierra o se cuelga, lo grabado hasta ese segundo
// se puede recuperar al volver (ver recorder.js). Con cada trozo se guardan también las cuentas que hacen falta para la cabecera
// del MP3 (número de tramas e índice para saltar), que se escribe al terminar.

importScripts('../vendor/wasm-media-encoder.min.js');

const VBR_QUALITY = 4;   // LAME -V4: suficiente para streams de radio (no traen más calidad); el bitrate sube y baja según lo que suena
const MARK_EVERY = 64;   // cada cuántas tramas se apunta su posición en bytes (para el índice de la cabecera)
const DB_NAME = 'rn_rec';

let enc = null, db = null, meta = null;
let pend = [], pendSamples = 0, carry = new Uint8Array(0), ending = false, failed = false;
let writing = Promise.resolve();

// ---- IndexedDB (la misma base que usa recorder.js) ----
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
function put(chunk, m) {
  return new Promise((res, rej) => {
    const tx = db.transaction(['recs', 'chunks'], 'readwrite');
    if (chunk) tx.objectStore('chunks').put(chunk);
    tx.objectStore('recs').put(m);
    tx.oncomplete = () => res();
    tx.onerror = tx.onabort = () => rej(tx.error || new Error('IndexedDB'));
  });
}

// ---- Tramas MP3: se cuentan y se apunta dónde empieza cada MARK_EVERY ----
const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SR = [44100, 48000, 32000];
function frameSize(b, i) {
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0;
  const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3;
  const bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
  if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) return 0;
  const sr = SR[sri] / (ver === 3 ? 1 : ver === 2 ? 2 : 4);
  return ver === 3 ? Math.floor(144000 * BR1[bri] / sr) + pad : Math.floor(72000 * BR2[bri] / sr) + pad;
}
function count(bytes) {
  const b = new Uint8Array(carry.length + bytes.length);
  b.set(carry);
  b.set(bytes, carry.length);
  const base = meta.bytes - carry.length;   // posición (en el archivo) del primer byte de b
  let i = 0;
  while (i + 4 <= b.length) {
    const n = frameSize(b, i);
    if (!n) { i++; continue; }   // no debería pasar: LAME solo saca tramas enteras
    if (i + n > b.length) break;
    if (!meta.hdr) meta.hdr = [b[i], b[i + 1], b[i + 2], b[i + 3]];
    if (meta.frames % MARK_EVERY === 0) meta.marks.push(base + i);
    meta.frames++;
    i += n;
  }
  carry = b.slice(i);
}

// ---- Guardar un trozo ----
function flush() {
  if (!pend.length) return writing;
  const len = pend.reduce((a, x) => a + x.length, 0);
  const data = new Uint8Array(len);
  let o = 0;
  for (const x of pend) { data.set(x, o); o += x.length; }
  pend = [];
  pendSamples = 0;
  meta.bytes += len;
  count(data);
  meta.seq++;
  meta.t = Date.now();
  meta.dur = meta.samples / meta.sr;
  const chunk = { id: meta.id, seq: meta.seq, data: new Blob([data], { type: 'audio/mpeg' }) };
  const snap = JSON.parse(JSON.stringify(meta));   // el trozo y las cuentas hasta él se guardan juntos (misma transacción)
  writing = writing.then(() => put(chunk, snap)).catch(fail);
  return writing;
}

function fail(err) {
  if (failed) return;
  failed = true;
  postMessage({ error: (err && (err.name === 'QuotaExceededError' ? 'No queda espacio para seguir grabando' : err.message)) || 'Error al guardar la grabación' });
}

function onPcm(e) {
  const m = e.data || {};
  if (failed) return;
  try {
    if (m.l) {
      const out = enc.encode([m.l, m.r]);
      if (out.length) pend.push(out.slice());   // la librería reutiliza su búfer: se copia
      pendSamples += m.l.length;
      meta.samples += m.l.length;
      if (pendSamples >= meta.sr) flush();   // un trozo por segundo de audio
    } else if (m.end && !ending) {
      ending = true;
      const out = enc.finalize();
      if (out.length) pend.push(out.slice());
      flush().then(() => { if (!failed) postMessage({ done: true }); });
    }
  } catch (err) { fail(err); }
}

onmessage = async e => {
  const m = e.data || {};
  if (m.cmd !== 'start') return;
  try {
    const wasm = await fetch('../vendor/mp3.wasm').then(r => { if (!r.ok) throw new Error('No se pudo cargar el codificador MP3'); return r.arrayBuffer(); });
    enc = await WasmMediaEncoder.createEncoder('audio/mpeg', wasm);
    enc.configure({ channels: 2, sampleRate: m.sampleRate, vbrQuality: VBR_QUALITY });
    db = await openDb();
    meta = { id: m.id, name: m.name, start: m.start, sr: m.sampleRate, seq: 0, bytes: 0, frames: 0, samples: 0, dur: 0, marks: [], hdr: null, t: Date.now() };
    await put(null, meta);
    m.port.onmessage = onPcm;
    postMessage({ ready: true });
  } catch (err) {
    failed = true;
    postMessage({ error: err.message || 'No se pudo empezar a grabar' });
  }
};
