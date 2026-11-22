// ======================================
// == AGRUPAR OPCIONES DE SONIDO (MÓVIL) ==
// ======================================
// Con "Agrupar opciones de sonido" activado (Ajustes > Preferencias, por defecto sí; solo en el móvil): debajo del RDS se ve uno de los tres paneles
// (visualizador, ecualizador o volúmenes) y se pasa al de al lado deslizando a izquierda o derecha, sin dar la vuelta (del 1 no se va al 3).
// Debajo, tres puntos marcan en cuál se está. El deslizamiento es el desplazamiento nativo con imán (scroll-snap en styles.css); aquí solo
// se guarda el ajuste, se pone la clase "group" en el <html> y se pintan los puntos. En PC, o con el ajuste apagado, los paneles van como siempre.

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

function apply() {
  document.documentElement.classList.toggle('group', on);
  box.scrollLeft = 0;   // al activarlo, el primero (el visualizador)
  paintDots();
}

let raf = 0;
box.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintDots(); }); }, { passive: true });
// al girar el móvil o cambiar el ancho, se queda en el mismo panel
if (window.ResizeObserver) new ResizeObserver(() => { box.scrollLeft = shown * step(); }).observe(box);
apply();
