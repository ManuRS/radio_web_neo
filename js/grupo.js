// ======================================
// == AGRUPAR OPCIONES DE SONIDO (MÓVIL) ==
// ======================================
// Con "Agrupar opciones de sonido" activado (Ajustes > Preferencias, por defecto sí; solo en el móvil): debajo del RDS se ve uno de los tres paneles
// (visualizador, ecualizador o volúmenes) y se pasa al de al lado deslizando a izquierda o derecha, sin dar la vuelta (del 1 no se va al 3).
// Debajo, tres puntos marcan en cuál se está. El deslizamiento es el desplazamiento nativo con imán (scroll-snap en styles.css), que llega
// hasta el borde de la pantalla; aquí se guarda el ajuste, se pone la clase "group" en el <html>, se pintan los puntos y, mientras se desliza,
// el panel que se va se apaga y encoge un poco (y el que llega, al revés). En PC, o con el ajuste apagado, los paneles van como siempre.

import { APP_ID } from './state.js';

const KEY = APP_ID + '_group';   // '0' = apagado; cualquier otra cosa (o nada) = encendido
const box = document.getElementById('sndGrp');
const dots = [...document.querySelectorAll('#sndDots i')];

let on = true;
try { on = localStorage.getItem(KEY) !== '0'; } catch (_) {}

export const groupOn = () => on;
export function setGroup(v) {
  on = !!v;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {}
  apply();
}

// Lo que hay que desplazar para pasar de un panel al siguiente (su ancho más el hueco); 0 si no están agrupados
const step = () => box.children[1].offsetLeft - box.children[0].offsetLeft;
// Panel que se ve (0, 1 o 2), según lo desplazado
const current = () => (step() > 0 ? Math.round(box.scrollLeft / step()) : 0);
let shown = 0;
function paintDots() {
  shown = Math.max(0, Math.min(dots.length - 1, current()));
  dots.forEach((d, i) => d.classList.toggle('on', i === shown));
}
// Cada panel, según lo lejos que está de su sitio (0 = a la vista, 1 = un panel entero fuera): opacidad y tamaño
const FADE = 0.65, SHRINK = 0.08;
function paintPanels() {
  const st = step(), kids = [...box.children];
  if (st <= 0) { kids.forEach(k => { k.style.opacity = k.style.transform = ''; }); return; }   // sin agrupar: como siempre
  const x0 = kids[0].offsetLeft;
  kids.forEach(k => {
    const d = Math.min(1, Math.abs((k.offsetLeft - x0 - box.scrollLeft) / st));
    k.style.opacity = d ? String(1 - FADE * d) : '';
    k.style.transform = d ? 'scale(' + (1 - SHRINK * d) + ')' : '';
  });
}
const paint = () => { paintDots(); paintPanels(); };

function apply() {
  document.documentElement.classList.toggle('group', on);
  box.scrollLeft = 0;   // al activarlo, el primero (el visualizador)
  paint();
}

let raf = 0;
box.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }, { passive: true });
// al girar el móvil o cambiar el ancho, se queda en el mismo panel
if (window.ResizeObserver) new ResizeObserver(() => { box.scrollLeft = shown * step(); paint(); }).observe(box);
// Deslizadores (volúmenes): agrupados, solo se mueven arrastrando la bola; si el dedo empieza en otro sitio del panel, barra incluida, se cambia
// de panel. El CSS les quita los toques (pointer-events) y aquí se arrastra a mano lo que empieza cerca de la bola (18 px de bola; 24 px de margen)
const HIT = 24, THUMB = 18;
const ranges = [...box.querySelectorAll('input[type="range"]')];
const span = el => { const r = el.getBoundingClientRect(); return { r, min: Number(el.min) || 0, max: Number(el.max) || 1 }; };
function thumbAt(x, y) {
  if (step() <= 0) return null;   // sin agrupar, los deslizadores van como siempre
  return ranges.find(el => {
    if (el.disabled) return false;
    const { r, min, max } = span(el);
    const tx = r.left + THUMB / 2 + (r.width - THUMB) * ((Number(el.value) - min) / (max - min || 1));
    return Math.abs(x - tx) <= HIT && Math.abs(y - (r.top + r.height / 2)) <= HIT;
  }) || null;
}
let drag = null, grabDx = 0;
function moveTo(x) {
  const { r, min, max } = span(drag);
  const f = Math.min(1, Math.max(0, (x - grabDx - r.left - THUMB / 2) / (r.width - THUMB)));
  drag.value = String(min + f * (max - min));
  drag.dispatchEvent(new Event('input', { bubbles: true }));
}
function start(x, y) {
  drag = thumbAt(x, y);
  if (!drag) return false;
  const { r, min, max } = span(drag);
  grabDx = x - (r.left + THUMB / 2 + (r.width - THUMB) * ((Number(drag.value) - min) / (max - min || 1)));   // sin salto: se arrastra desde donde se cogió
  return true;
}
function end() { if (drag) { drag.dispatchEvent(new Event('change', { bubbles: true })); drag = null; } }
box.addEventListener('touchstart', e => { if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
box.addEventListener('touchmove', e => { if (drag) { e.preventDefault(); moveTo(e.touches[0].clientX); } }, { passive: false });   // cogida la bola, no se desplaza
box.addEventListener('touchend', end);
box.addEventListener('touchcancel', end);
box.addEventListener('mousedown', e => {
  if (!start(e.clientX, e.clientY)) return;
  e.preventDefault();
  const mm = ev => moveTo(ev.clientX);
  const mu = () => { removeEventListener('mousemove', mm); removeEventListener('mouseup', mu); end(); };
  addEventListener('mousemove', mm);
  addEventListener('mouseup', mu);
});

apply();
