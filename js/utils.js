// ===================================
// == UTILIDADES PURAS (SIN ESTADO) ==
// ===================================

export const pad = n => String(n).padStart(2, '0');

// Hora de Madrid de un instante (ms): las franjas de noticias y el reloj de la pantalla van siempre por ella, esté el dispositivo donde esté
const MADRID_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' });
function madridHms(ms) {
  const p = {};
  for (const x of MADRID_FMT.formatToParts(ms)) p[x.type] = Number(x.value);
  return [p.hour, p.minute, p.second];
}
export const madridClock = ms => madridHms(ms).map(pad).join(':');
export function madridSeconds(ms) {   // segundos desde medianoche (con decimales)
  const [h, m, s] = madridHms(ms);
  return h * 3600 + m * 60 + s + (((ms % 1000) + 1000) % 1000) / 1000;
}

// "hh:mm:ss" (o "hh:mm") -> segundos desde medianoche
export const toSeconds = hms => {
  const [h, m, s = 0] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

// Texto -> número (admite coma decimal y signo negativo); null si no es un número
export const parseNumber = v => {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).trim().replace(',', '.'));
  return isFinite(n) ? n : null;
};

// Frecuencia para mostrar: un decimal (100.5, 89.0) o dos si hace falta (98.45). Solo lo usa Proxy
export const fmtFreq = f => (Math.abs(f * 10 - Math.round(f * 10)) < 1e-6 ? f.toFixed(1) : f.toFixed(2));

// (Solo lo usa Proxy) Primer fotograma MPEG de audio (MP3) que se pueda confirmar en los bytes b: { layer, kbps, rate, ch }, con ch 0 estéreo, 1 joint stereo,
// 2 doble canal y 3 mono. Un fotograma solo vale si justo detrás empieza otro compatible. null si no lo hay o faltan bytes para confirmarlo
const MPEG_KBPS = {
  1: { 1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], 2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] },
  2: { 1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], 3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] },
};
const MPEG_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };   // por versión: 3 = MPEG 1, 2 = MPEG 2, 0 = MPEG 2.5
function mpegHeader(b, i) {
  if (b[i] !== 0xFF || (b[i + 1] & 0xE0) !== 0xE0) return null;
  const ver = (b[i + 1] >> 3) & 3, layer = 4 - ((b[i + 1] >> 1) & 3), kbpsIdx = b[i + 2] >> 4, rateIdx = (b[i + 2] >> 2) & 3;
  if (ver === 1 || layer === 4 || kbpsIdx === 0 || kbpsIdx === 15 || rateIdx === 3) return null;
  const kbps = MPEG_KBPS[ver === 3 ? 1 : 2][layer][kbpsIdx], rate = MPEG_RATES[ver][rateIdx], padding = (b[i + 2] >> 1) & 1;
  const len = layer === 1 ? (Math.floor(12000 * kbps / rate) + padding) * 4 : Math.floor((layer === 3 && ver !== 3 ? 72000 : 144000) * kbps / rate) + padding;
  return { layer, kbps, rate, ch: b[i + 3] >> 6, len, key: ver + '-' + layer + '-' + rateIdx };
}
export function mp3Info(b) {
  for (let i = 0; i + 4 <= b.length; i++) {
    const h = mpegHeader(b, i);
    if (!h) continue;
    const next = i + h.len;
    if (next + 4 > b.length) return null;   // faltan bytes para comprobar el fotograma siguiente
    const n = mpegHeader(b, next);
    if (n && n.key === h.key) return { layer: h.layer, kbps: h.kbps, rate: h.rate, ch: h.ch };
  }
  return null;
}

// Elige un elemento de la lista con probabilidad proporcional a su "weight" (null si la lista está vacía)
export function pickWeighted(list) {
  if (!list || !list.length) return null;
  const total = list.reduce((a, x) => a + (x.weight || 1), 0);
  let r = Math.random() * total;
  for (const x of list) { r -= (x.weight || 1); if (r < 0) return x; }
  return list[list.length - 1];
}

// Nombre corto de un sonido a partir de su URL (sin ruta, sin ?versión y sin extensión)
export const soundName = src => src.split('?')[0].split('/').pop().replace(/\.[a-z0-9]+$/i, '');

// Nombre de emisora para buscar su cortinilla: igual "Los 40", "LOS40" o "los 40" (sin mayúsculas, tildes ni espacios);
// "Classic" y "Los 40 Classic" (se escriba como se escriba) son la misma
export function soundKey(name) {
  const n = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return n === 'los40classic' ? 'classic' : n;
}

// Instante del "golpe final" de un sonido: la última vez que su nivel está a menos de dbBelowPeak dB de su máximo
// (después viene la cola que se va apagando). Se usa con "hit": "auto" en los ajustes.
const hitCache = new WeakMap();   // el modo boletines lo pregunta cada segundo por cada franja: se calcula una vez por sonido
export function finalHit(buf, dbBelowPeak) {
  if (!buf || !buf.getChannelData) return buf ? buf.duration : 0;
  const hit = hitCache.get(buf);
  if (hit && hit.db === dbBelowPeak) return hit.t;
  const t = computeFinalHit(buf, dbBelowPeak);
  hitCache.set(buf, { db: dbBelowPeak, t });
  return t;
}
function computeFinalHit(buf, dbBelowPeak) {
  const win = Math.max(1, Math.floor(buf.sampleRate * 0.02));
  const n = Math.floor(buf.length / win);
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const rms = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const ch of chans) for (let k = i * win; k < (i + 1) * win; k++) sum += ch[k] * ch[k];
    rms[i] = Math.sqrt(sum / (win * chans.length));
    if (rms[i] > peak) peak = rms[i];
  }
  const thr = peak * Math.pow(10, -dbBelowPeak / 20);
  for (let i = n - 1; i >= 0; i--) if (rms[i] > thr) return (i + 1) * win / buf.sampleRate;
  return buf.duration;
}

// Duración "audible" de un sonido: hasta el último tramo de 50 ms por encima de silenceDb (ignora el silencio y la cola final)
const effCache = new WeakMap();
export function effectiveDuration(buf, silenceDb) {
  if (!buf) return 0;
  if (effCache.has(buf)) return effCache.get(buf);
  let d = buf.duration;
  if (buf.getChannelData) {
    const thr = Math.pow(10, silenceDb / 20);
    const win = Math.max(1, Math.floor(buf.sampleRate * 0.05));
    const chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    for (let i = Math.floor(buf.length / win) - 1; i >= 0; i--) {
      let sum = 0;
      for (const ch of chans) for (let k = i * win; k < (i + 1) * win; k++) sum += ch[k] * ch[k];
      if (Math.sqrt(sum / (win * chans.length)) > thr) { d = Math.min(buf.duration, (i + 1) * win / buf.sampleRate); break; }
    }
  }
  effCache.set(buf, d);
  return d;
}

// (Solo lo usa Neo) Nombre de una emisora (cada URL de una cadena). Es genérico si no dice nada de la señal: vacío, el formato (MP3) o "Señal central" / "Señal web" / "Directo".
// En títulos se prefiere el nombre de la emisora que suena (Radio Madrid) al de la cadena (Cadena SER); si es genérico, o la cadena tiene una sola emisora, se usa el de la cadena.
const GENERIC_LABEL = /^(se[ñn]al central|se[ñn]al web|directo|mp3|aac|hls|stream)$/i;
const emisoraLabel = u => (u && u.label ? String(u.label).trim() : '');
const isGenericLabel = u => !emisoraLabel(u) || GENERIC_LABEL.test(emisoraLabel(u));
export function emisoraName(st, vi, short = false) {
  if (!st) return '';
  const u = st.urls[vi];
  // con una sola emisora, el nombre de la cadena (el de dentro no importa); con varias, el de la que suena, salvo que sea genérico
  return st.urls.length === 1 || isGenericLabel(u) ? (short && st.short) || st.name : emisoraLabel(u);
}
// Texto ligero bajo el nombre de la cadena en su botón: solo en la elegida y si tiene varias emisoras ("10 emisoras"); en las demás, nada
export const emisoraSub = (st, active) => (active && st && st.urls.length > 1 ? st.urls.length + ' emisoras' : '');
