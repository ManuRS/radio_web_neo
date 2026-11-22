// ==================
// == NOTIFICACIÓN ==
// ==================
// Notificación del reproductor (título con el nombre de la emisora que suena, su imagen de fondo y los botones de pausa, anterior y siguiente).

import { S, APP_TITLE } from './state.js';
import { log } from './ui.js';
import { getSoundData } from './sounds.js';
import { anyPlaying } from './audio.js';
import { holdPlayback, isWaiting, isWaitPaused, pauseWaiting, play, resumePlayback, resumeWaiting, wake } from './player.js';
import { requestStop } from './recorder.js';
import { stepStation } from './stations.js';
import { emisoraName } from './utils.js';

let artworkUrl = '', artworkType = ''; // imagen de la notificación ya cargada (data URL)
let mediaTimer = null, mediaTitle = null; // título pendiente / aplicado en la notificación

// Título: nombre de la emisora que suena. Segunda línea: el nombre de la aplicación. Fondo: el elegido en Preferencias (ARTWORKS),
// guardado en la misma caché que los sonidos.
const mediaSessionOk = () => 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined';

function arrayBufferToDataUrl(ab, type) {
  const bytes = new Uint8Array(ab);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return 'data:' + type + ';base64,' + btoa(bin);
}

// Fondo de la notificación ("Fondo de notificación" en Preferencias, guardado en el navegador). Si se cambia un archivo, subir ARTWORK_VERSION
export const ARTWORKS = { piruli: 'img/piruli.jpg', diana: 'img/diana.jpg', transistor: 'img/transistor.webp' };
const ARTWORK_KEY = 'rn_fondo';
const ARTWORK_DEFAULT = 'piruli';
const ARTWORK_VERSION = 1;
function getArtwork() {
  try { const v = localStorage.getItem(ARTWORK_KEY); if (Object.hasOwn(ARTWORKS, v)) return v; } catch (_) {}
  return ARTWORK_DEFAULT;
}
export const artworkSrc = (id = getArtwork()) => new URL(ARTWORKS[id], document.baseURI).href + '?v=' + ARTWORK_VERSION;
const artSelect = document.getElementById('artSelect');
artSelect.value = getArtwork();
artSelect.addEventListener('change', () => {
  const id = artSelect.value;
  if (!Object.hasOwn(ARTWORKS, id)) return;
  try { localStorage.setItem(ARTWORK_KEY, id); } catch (_) {}
  log('Fondo de notificación: ' + artSelect.options[artSelect.selectedIndex].text);
  S.artwork = artworkSrc(id);
  loadArtwork();   // si suena, la notificación cambia al momento
});

export async function loadArtwork() {
  artworkUrl = '';
  mediaTitle = null;
  if (!S.artwork) return;
  try {
    const ab = await getSoundData(S.artwork);
    const ext = S.artwork.split('?')[0].split('.').pop().toLowerCase();
    artworkType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    artworkUrl = arrayBufferToDataUrl(ab, artworkType);   // data URL: no depende de la red ni de la caché al mostrarla
    scheduleMediaTitle();
  } catch (err) {
    log('No se pudo cargar la imagen de la notificación: ' + ((err && err.message) || err));
  }
}

const mediaArtist = () => APP_TITLE;

function applyMediaSession(title, artist) {
  if (!mediaSessionOk()) return;
  const meta = { title, artist };
  if (artworkUrl) meta.artwork = [{ src: artworkUrl, type: artworkType }];
  try { navigator.mediaSession.metadata = new MediaMetadata(meta); } catch (_) {}
}

// Solo se actualiza cuando cambia el título
export function scheduleMediaTitle() {
  if (!mediaSessionOk()) return;
  const waiting = isWaiting();   // a la espera de las noticias sin música: la notificación lo dice
  if (!waiting && (S.session === 'off' || !S.current || !anyPlaying())) return;
  const title = waiting ? 'Esperando noticias' : emisoraName(S.current, S.variant);   // la emisora que suena (Radio Madrid), no la cadena (Cadena SER)
  const artist = mediaArtist();
  const key = title + '\n' + artist;
  if (key === mediaTitle) return;
  mediaTitle = key;
  clearTimeout(mediaTimer);
  mediaTimer = setTimeout(() => applyMediaSession(title, artist), 100);
}

export function clearMediaSession() {
  clearTimeout(mediaTimer);
  mediaTitle = null;
  if (!mediaSessionOk()) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  } catch (_) {}
}

// Estado que muestra la notificación ('playing' o 'paused')
export function setPlaybackState(state) {
  if (!mediaSessionOk()) return;
  try { navigator.mediaSession.playbackState = state; } catch (_) {}
}

// Botones de la notificación: en una radio en directo, pausa = emisora retenida (la notificación se queda); el play vuelve a conectar en directo;
// anterior y siguiente cambian de emisora dentro de su grupo
if (mediaSessionOk()) {
  try {
    navigator.mediaSession.setActionHandler('pause', () => { if (isWaiting()) pauseWaiting(); else holdPlayback(); });
    navigator.mediaSession.setActionHandler('stop', () => requestStop());
    navigator.mediaSession.setActionHandler('play', () => { if (S.held) resumePlayback(); else if (isWaitPaused()) resumeWaiting(); else if (S.session === 'off') play(); else wake(); });   // wake: el audio lo pausó otra app o el sistema
    navigator.mediaSession.setActionHandler('previoustrack', () => stepStation(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => stepStation(1));
  } catch (_) {}
}
