// ===========
// == ANCLA ==
// ===========
// En Android, la notificación del reproductor y el permiso para seguir sonando con la pantalla apagada dependen de que haya un <audio> sonando.
// El audio de la radio se vacía o cambia de <audio> en varios momentos (al reconectar, al reanudar tras una pausa, al cambiar de emisora en pausa o
// de servidor): en esos huecos no suena nada y Chrome retira la notificación (y, sin ella, volver a sonar en segundo plano no es fiable). El ancla
// es un <audio> en silencio y en bucle que dura toda la sesión de escucha: suena de Reproducir a Detener, se pausa con la pausa de la notificación
// y solo se vacía al detener. Cuándo se enciende lo decide cada app (Neo: player.js; Proxy: connection.js). Solo en Android; en el resto no hace nada.

import { log } from './ui.js';

export const anchorOk = /Android/i.test(navigator.userAgent);

const SECONDS = 12;   // Chrome no muestra la notificación con audios de menos de 5 s
const RATE = 8000;

let el = null, url = '';
let state = 'off';     // 'on' (sonando), 'paused' (pausa nuestra: la notificación se queda) u 'off' (sin sesión: sin notificación)
let blocked = false;   // el navegador no dejó arrancarla (faltaba un gesto): se reintenta al tocar la página

// WAV en silencio (8 bits, mono), hecho aquí para no descargar nada
function silentWav() {
  const n = SECONDS * RATE, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
  const txt = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  txt(0, 'RIFF'); v.setUint32(4, 36 + n, true); txt(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  txt(36, 'data'); v.setUint32(40, n, true);
  b.fill(128, 44);   // en 8 bits el silencio es 128
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

function start() {
  if (!el) {
    el = document.createElement('audio');
    el.loop = true;
    el.setAttribute('playsinline', '');
    document.body.appendChild(el);
    el.addEventListener('pause', () => { if (state === 'on') log('La sesión de audio se ha pausado desde fuera (otra app o el sistema)'); });
    el.addEventListener('error', () => { if (el.error) log('Ancla de audio: error ' + el.error.code); });
  }
  if (!el.getAttribute('src')) el.src = url || (url = silentWav());
  const p = el.play();
  if (p && p.catch) p.catch(err => {
    if (state !== 'on' || (err && err.name === 'AbortError')) return;
    blocked = !!err && err.name === 'NotAllowedError';
    log('No se pudo iniciar el ancla de audio: ' + ((err && err.message) || err));
  });
  // es un directo: sin duración, para que la notificación no pinte la barra de progreso del bucle
  try { navigator.mediaSession.setPositionState({ duration: Infinity, playbackRate: 1, position: 0 }); } catch (_) {}
}

export function setAnchor(next) {
  if (!anchorOk || next === state) return;
  state = next;
  blocked = false;
  if (next === 'on') { start(); return; }
  if (!el) return;
  try { el.pause(); } catch (_) {}
  if (next === 'off') { el.removeAttribute('src'); try { el.load(); } catch (_) {} }   // sin fuente, la notificación desaparece
}

// Si debería sonar y está parada (la pausó otra app o el sistema), se reanuda: al volver a la página o con el play de la notificación
export function wakeAnchor() {
  if (state === 'on' && el && el.paused) start();
}

document.addEventListener('pointerdown', () => { if (blocked) { blocked = false; wakeAnchor(); } }, true);
