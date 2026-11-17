// ==============
// == INTERFAZ ==
// ==============
// Registro de eventos (ventana), estado de conexión, botones y maquetación de la página.

import { clockNow } from './state.js';
import { copyBtn, desk, dot, logBox, playBtn, statusBox, stop, toastEl, toggle } from './dom.js';
import { viz } from './audio.js';

// ==================
// == DESLIZADORES ==
// ==================
// El relleno de color de cada deslizador lo marca --r (0-1); se actualiza al moverlo y cuando otro código cambia su valor.
export function paintRange(el) {
  const min = Number(el.min) || 0, max = Number(el.max) || 100;
  el.style.setProperty('--r', String(Math.min(1, Math.max(0, (Number(el.value) - min) / (max - min || 1)))));
}
document.addEventListener('input', e => { if (e.target.type === 'range') paintRange(e.target); }, true);
document.querySelectorAll('input[type="range"]').forEach(paintRange);

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
  setPlayBtn(connected);
}

// El botón único de la cabecera: con sesión de escucha es Detener y sin ella, Reproducir (como el de la pantalla completa). Al cambiar, se lanza el efecto (clase "swap")
function setPlayBtn(connected) {
  const state = connected ? 'stop' : 'play';
  if (playBtn.dataset.state === state) return;
  playBtn.dataset.state = state;
  playBtn.setAttribute('aria-label', connected ? 'Detener' : 'Reproducir');
  playBtn.classList.remove('swap');
  void playBtn.offsetWidth;   // reinicia la animación si se cambia otra vez antes de que acabe
  playBtn.classList.add('swap');
}
playBtn.addEventListener('animationend', () => playBtn.classList.remove('swap'));
playBtn.addEventListener('click', () => (stop.disabled ? toggle : stop).click());   // se pulsa el de siempre (oculto): grabando, Detener pregunta antes (ver recorder.js)

// Ancho de cada texto del botón, para que el hueco crezca y encoja con el cambio y el icono quede siempre junto al texto (se vuelve a medir al cargar la fuente)
function measurePlayBtn() {
  const w = el => { const r = document.createRange(); r.selectNodeContents(el); return Math.ceil(r.getBoundingClientRect().width) + 2; };
  const l1 = playBtn.querySelector('.l1'), l2 = playBtn.querySelector('.l2');
  playBtn.style.setProperty('--w1', w(l1) + 'px');
  playBtn.style.setProperty('--w2', w(l2) + 'px');
}
measurePlayBtn();
if (document.fonts) { document.fonts.ready.then(measurePlayBtn); document.fonts.addEventListener('loadingdone', measurePlayBtn); }

// ===========================
// == COLOR DE ÉNFASIS (CSS) ==
// ===========================
// El verde por defecto vive en styles.css (--accent). Con otro color (Ajustes > General: color por defecto o el de la emisora) se sustituye en la página y en las barras;
// vacío = vuelve al verde por defecto. Los demás tonos (texto sobre el color, fondos suaves) los deriva el CSS de --accent.

// Colores para las emisoras sin color propio en los ajustes (con "Color personalizado" activado): se elige uno de la lista al azar,
// siempre el mismo para cada emisora (sale de su nombre), para que no cambie cada vez que se sintoniza
const STATION_PALETTE = ['#38bdf8', '#f472b6', '#fbbf24', '#a78bfa', '#fb923c', '#34d399', '#22d3ee', '#a3e635', '#e879f9', '#facc15', '#60a5fa', '#2dd4bf'];
export function paletteColor(key) {
  let h = 2166136261;
  for (const ch of String(key)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return STATION_PALETTE[(h >>> 0) % STATION_PALETTE.length];
}

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

// ==========================================
// == PANTALLAS GRANDES (PC): DOS PANELES ==
// ==========================================
// Por encima de DESK_MQ (dom.js): dos paneles, la cabecera fija sin encogerse, las presintonías desplegadas y la luz de fondo

// Tamaño del panel de presintonías: pequeño (por defecto, igual que el panel 1) o grande. Se guarda en el navegador (rn_psmall)
const PSMALL_KEY = 'rn_psmall';
const paneSize = document.getElementById('paneSize');
function setPaneSmall(small) {
  document.documentElement.classList.toggle('psmall', small);
  paneSize.title = small ? 'Ampliar panel' : 'Reducir panel';
  paneSize.setAttribute('aria-label', (small ? 'Ampliar' : 'Reducir') + ' panel de presintonías');
}
try { setPaneSmall(localStorage.getItem(PSMALL_KEY) !== '0'); } catch (_) { setPaneSmall(true); }

// El reloj: en pantallas grandes va dentro de la barra, detrás de Reproducir y una separación; en las demás, en su píldora de la cabecera, como siempre
const hrow = statusBox.parentElement, sepClk = document.querySelector('.sepclk');
function placeClock() {
  if (desk.matches) sepClk.after(statusBox); else hrow.appendChild(statusBox);
}
placeClock();
desk.addEventListener('change', placeClock);

// Pie: en pantallas grandes la página no se desplaza; si no cabe entero bajo los paneles, pasa a una sola línea (clase "compact")
const footEl = document.querySelector('.foot');
function fitFoot() {
  footEl.classList.remove('compact');
  if (!desk.matches) return;
  const sc = footEl.parentElement, pad = parseFloat(getComputedStyle(sc).paddingBottom) || 0;
  const room = sc.getBoundingClientRect().bottom - pad - footEl.getBoundingClientRect().top;
  if (footEl.scrollHeight > room + 1) footEl.classList.add('compact');
}
if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(fitFoot); ro.observe(document.querySelector('.scroller')); ro.observe(document.querySelector('.panes')); }
desk.addEventListener('change', fitFoot);
if (document.fonts) document.fonts.ready.then(fitFoot);
let paneAnim = 0;
paneSize.addEventListener('click', () => {
  const small = !document.documentElement.classList.contains('psmall');
  document.documentElement.classList.add('pane-anim');   // la transición del ancho, solo al pulsar (no al cargar)
  clearTimeout(paneAnim);
  paneAnim = setTimeout(() => document.documentElement.classList.remove('pane-anim'), 450);
  setPaneSmall(small);
  try { localStorage.setItem(PSMALL_KEY, small ? '1' : '0'); } catch (_) {}
});

// Zona de abajo con scroll propio (ver .scroller en styles.css): pasa por debajo de la cabecera, que va fija encima, y se corta en su línea
const scroller = document.querySelector('.scroller');

// Cabecera que se encoge al deslizar (ver header en styles.css): --p va de 0 (grande) a 1 (encogida) según lo que se ha bajado
// con el scroll de la zona de abajo o, si la página es corta y hace scroll entera, el de la ventana. Con "reducir movimiento" salta de una a otra
const ctlBar = document.getElementById('ctlBar');
const HDR_DIST = 108;   // px de scroll hasta que queda del todo encogida: lo que mide de menos (así el contenido sube a la vez que baja la cabecera)
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let hdrP = -1;
// Botones de Reproducir/Detener y de Ajustes solo con el icono, a la derecha de la cabecera encogida: copian el estado de #playBtn / pulsan #settingsBtn
const miniPlay = document.createElement('button');
miniPlay.type = 'button'; miniPlay.className = 'mini'; miniPlay.inert = true;
miniPlay.innerHTML = '<span class="pi" aria-hidden="true"></span>';
const miniSet = document.createElement('button');
miniSet.type = 'button'; miniSet.className = 'mini mini-set'; miniSet.inert = true;
miniSet.setAttribute('aria-label', 'Ajustes');
miniSet.innerHTML = document.getElementById('settingsBtn').innerHTML;
document.querySelector('.hin').append(miniSet, miniPlay);
const syncMini = () => { miniPlay.dataset.state = playBtn.dataset.state || 'play'; miniPlay.setAttribute('aria-label', playBtn.getAttribute('aria-label') || 'Reproducir'); miniPlay.disabled = playBtn.disabled; };
new MutationObserver(syncMini).observe(playBtn, { attributes: true, attributeFilter: ['data-state', 'aria-label', 'disabled'] });
syncMini();
miniPlay.addEventListener('click', () => playBtn.click());
miniSet.addEventListener('click', () => document.getElementById('settingsBtn').click());
// Fases del scroll en el móvil: 0 cabecera grande; 1 cabecera encogida; 2 la tarjeta del RDS queda fija (sticky, ver .stack en styles.css) y las otras dos pasan por debajo, una y luego la otra;
// 3 solo queda el RDS y las presintonías; 4 el RDS se suelta y sube con todo. Aquí solo se calcula dónde empieza a verse el contenido (--e) y cuánto se desvanece (--fade)
const HF = 182, HMIN = 74, PIN_TOP = 86;   // alto de la cabecera grande y encogida, y dónde queda fijo el RDS (igual que .stack > .now en styles.css)
const rds = document.querySelector('.stack > .now');
let edgeV = -1, fadeV = -1;
function hdrUpdate() {
  const st = Math.max(scroller.scrollTop, window.scrollY);
  const rel = desk.matches ? 0 : Math.max(0, PIN_TOP - rds.getBoundingClientRect().top);   // lo que el RDS ya se ha soltado hacia arriba (0 mientras está fijo o sin bajar)
  let p = Math.min(1, Math.max(0, st / HDR_DIST));
  if (reduceMotion.matches) p = p > .5 ? 1 : 0;
  if (desk.matches) p = 0;   // en pantallas grandes la cabecera no se encoge
  p = Math.round(p * 100) / 100;
  const edge = Math.round(Math.max(HF - (HF - HMIN) * p, PIN_TOP - Math.min(rel, PIN_TOP - HMIN))), fade = Math.round(Math.min(rel, 40));
  if (edge !== edgeV) { edgeV = edge; document.documentElement.style.setProperty('--e', edge + 'px'); }
  if (fade !== fadeV) { fadeV = fade; document.documentElement.style.setProperty('--fade', fade + 'px'); }
  if (p === hdrP) return;
  hdrP = p;
  document.documentElement.style.setProperty('--p', p);
  ctlBar.inert = p > .5;
  miniPlay.inert = miniSet.inert = p <= .5;   // solo se pulsan con la cabecera encogida (con ella desplegada la barra de controles es la que se usa)
}
scroller.addEventListener('scroll', hdrUpdate, { passive: true });
window.addEventListener('scroll', hdrUpdate, { passive: true });
desk.addEventListener('change', hdrUpdate);

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
