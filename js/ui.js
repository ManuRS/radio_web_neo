// ==============
// == INTERFAZ ==
// ==============
// Registro de eventos (ventana), estado de conexión, botones y maquetación de la página.

import { clockNow } from './state.js';
import { copyBtn, dot, logBox, statusBox, stop, toastEl, toggle } from './dom.js';
import { viz } from './audio.js';

// ===================================
// == REGISTRO Y ESTADO DE CONEXIÓN ==
// ===================================

const LOG_MAX_CHARS = 30000;   // las líneas más antiguas se descartan: cada línea nueva reescribe todo el texto

export function log(message) {
  const time = new Date(clockNow()).toLocaleTimeString();
  logBox.value = (`[${time}] ${message}\n` + logBox.value).slice(0, LOG_MAX_CHARS);
}

// Cambia el texto de un elemento solo si es distinto (refreshStations se llama con cada cambio de estado)
export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// Estado de la reproducción: el punto junto a la hora (verde = suena) y, al pasar el ratón, el texto (Desconectado, Conectando…, En directo, Noticias…)
export function setStatus(message, state = '') {
  statusBox.title = message;
  dot.className = 'dot' + (state ? ' ' + state : '');
}

// connected: hay una sesión de escucha. canPlay: aun así se puede pulsar Reproducir (por ejemplo, durante unas noticias sin música debajo)
export function updateButtons(connected, canPlay = false) {
  toggle.disabled = connected && !canPlay;
  stop.disabled = !connected;
}

// ===========================
// == COLOR DE ÉNFASIS (CSS) ==
// ===========================
// El verde por defecto vive en styles.css (--accent). Con un color en los ajustes se sustituye en la página y en las barras;
// vacío = vuelve al verde por defecto. Los demás tonos (texto sobre el color, fondos suaves) los deriva el CSS de --accent.

export function applyAccent(hex) {
  const root = document.documentElement;
  if (hex) root.style.setProperty('--accent', hex); else root.style.removeProperty('--accent');
  viz.setAccent(hex);
  if (!viz.looping) viz.draw();
}

// ===============================================
// == VENTANAS (DIALOG) ==
// ===============================================
// La ventana de ajustes y registro se abre pulsando el punto y la hora de la cabecera (ver settings.js) y se cierra con la cruz, pulsando fuera o con Escape.

// Abre y cierra las ventanas (dialog) de la página; sin soporte de dialog, con el atributo open
export function openDialog(dlg) {
  if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
}
export function closeDialog(dlg) {
  if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
}


// ======================================
// == REGISTRO: COPIAR AL PORTAPAPELES ==
// ======================================

copyBtn.addEventListener('click', async () => {
  const text = logBox.value;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
  copyBtn.textContent = ok ? 'Copiado ✓' : 'No se pudo';
  setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 1500);
});

// =================
// == MAQUETACIÓN ==
// =================
// La página es siempre una columna pegada arriba con el mismo fondo en toda la pantalla (ver styles.css).
// Aquí solo se redibujan las barras cuando cambia el tamaño (abrir o cerrar el registro o las emisoras, girar el móvil...).

const mainEl = document.querySelector('main');

export function layoutCheck() {
  if (!viz.looping) viz.draw();
}

if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layoutCheck).observe(mainEl);

// Zona de abajo con scroll propio: cuanto más sube, más ancho el desvanecido bajo el espectro (ver .scroller en styles.css)
const scroller = document.querySelector('.scroller');
scroller.addEventListener('scroll', () => scroller.style.setProperty('--fade', Math.min(96, scroller.scrollTop * 2.4) + 'px'), { passive: true });

window.addEventListener('resize', layoutCheck);

// Aviso breve abajo (resultado de editar emisoras desde la rejilla, mensajes sin ventana abierta...)
let toastTimer = 0;
export function toast(msg, ms = 3500) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}
