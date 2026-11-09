// =====================
// == SONIDOS LOCALES ==
// =====================
// Sonidos locales: descarga, caché del navegador, decodificación y duración audible.

import { effectiveDuration, finalHit, soundName } from './utils.js';
import { S, HIT_DB, SILENCE_DB, SOUND_CACHE } from './state.js';
import { log } from './ui.js';

// ===============================
// == SONIDOS QUE USA LA APLICACIÓN ==
// ===============================
// Van en el código (no en los ajustes). Los archivos están en sounds/ (extensión .mp3 por defecto). "weight": peso del sorteo (1 si falta);
// "hit": "auto" = el golpe final se detecta solo, o los segundos hasta él. Si cambia un archivo, subir SOUNDS_VERSION para saltarse la caché del navegador.
export const SOUNDS_BASE = 'sounds/';
export const SOUNDS_VERSION = 2;

// Imagen de fondo de la notificación del reproductor (también en el código; si se cambia el archivo, subir SOUNDS_VERSION)
export const ARTWORK_URL = new URL('img/fondo1.jpg', document.baseURI).href + '?v=' + SOUNDS_VERSION;

const TO_NEWS = [   // de música a noticias: se sortea uno por cada emisión
  { file: 'desco_ini_gen', weight: 6, hit: 'auto' },
  { file: 'radio_madrid', weight: 3, hit: 'auto' },
  { file: 'cortinilla_conversacion', weight: 1, hit: 'auto' },
];
const FROM_NEWS_DEFAULT = [   // de noticias a música
  { file: 'desco_fin_hxh', hit: 'auto' },
];
const FROM_NEWS_BY_NAME = {   // de noticias a una emisora concreta (por su nombre)
  'LOS40': [{ file: 'los40_a', hit: 'auto' }, { file: 'los40_b', hit: 'auto' }],
  'LOS40 CLASSIC': [{ file: 'los40c_a', hit: 'auto' }],
};

// Archivo -> { src (URL completa con la versión), weight, hit }
const withUrl = list => list.map(o => {
  const url = new URL(SOUNDS_BASE + o.file + (/\.[a-z0-9]+$/i.test(o.file) ? '' : '.mp3'), document.baseURI).href;
  return { src: url + '?v=' + SOUNDS_VERSION, weight: o.weight > 0 ? o.weight : 1, hit: o.hit };
});
export const SOUNDS_TO_NEWS = withUrl(TO_NEWS);
export const SOUNDS_FROM_NEWS_DEFAULT = withUrl(FROM_NEWS_DEFAULT);
export const SOUNDS_FROM_NEWS_BY_NAME = Object.fromEntries(Object.entries(FROM_NEWS_BY_NAME).map(([name, list]) => [name, withUrl(list)]));

export const soundBuffers = new Map();
// Duración audible de un sonido (hasta el último instante por encima de SILENCE_DB)
const effDur = buf => effectiveDuration(buf, SILENCE_DB);

// Instante del sonido que debe coincidir con la radio a tope: su "hit" (número de segundos o "auto") o, si no tiene, su final audible
export const jingleHit = (j, buf) => {
  if (!buf) return 0;
  if (j && j.hit === 'auto') return finalHit(buf, HIT_DB);
  if (j && typeof j.hit === 'number') return Math.min(j.hit, buf.duration);
  return effDur(buf);
};

// Todos los sonidos de la aplicación (sin repetidos)
const allSoundSrcs = () => [...new Set([
  ...SOUNDS_TO_NEWS.map(x => x.src),
  ...SOUNDS_FROM_NEWS_DEFAULT.map(x => x.src),
  ...Object.values(SOUNDS_FROM_NEWS_BY_NAME).flat().map(x => x.src),
])];

// Devuelve los bytes de un sonido: de la caché del navegador si ya está, y si no lo descarga y lo guarda ahí.
// (Si el navegador no ofrece caché, p. ej. fuera de https, se descarga cada vez.)
export async function getSoundData(url, onlyEnsureCached = false) {
  let cache = null;
  try {
    cache = await caches.open(SOUND_CACHE);
    const hit = await cache.match(url);
    if (hit) return onlyEnsureCached ? null : await hit.arrayBuffer();
  } catch (_) { cache = null; }
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  if (cache) { try { await cache.put(url, res.clone()); } catch (_) {} }
  return onlyEnsureCached ? null : await res.arrayBuffer();
}

// Descarga los sonidos a la caché (sin decodificarlos) para que luego no haya que bajarlos
export function prefetchSounds() {
  allSoundSrcs().forEach(src => { getSoundData(src, true).catch(() => {}); });
}

// Decodifica los sonidos (necesita el contexto de audio, que se crea al pulsar Reproducir)
export async function loadSounds() {
  soundBuffers.clear();
  const srcs = allSoundSrcs();
  let ok = 0, failed = 0;
  await Promise.all(srcs.map(async src => {
    try {
      soundBuffers.set(src, await S.audioCtx.decodeAudioData(await getSoundData(src)));
      ok++;
    } catch (err) {
      failed++;
      const hint = err && err.name === 'TypeError' ? ' (descarga bloqueada: CORS o sin red)' : '';
      log('No se pudo cargar ' + soundName(src) + ': ' + ((err && err.name) || 'Error') + ' - ' + (err && err.message) + hint);
    }
  }));
  if (srcs.length) log('Sonidos de transición cargados: ' + ok + '/' + srcs.length);
  if (failed) log('Sin sonido cargado solo habrá fundidos');
}
