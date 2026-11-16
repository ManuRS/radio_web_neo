// ===========================
// == LUZ DE FONDO (PC) ==
// ===========================
// En pantallas grandes, con "Color de fondo" activado (Ajustes > General, por defecto sí): una luz desde abajo que se mueve con el sonido.
// Son las barras del ecualizador (viz.levels) en el color de énfasis, dibujadas en un lienzo pequeño que el CSS estira y difumina mucho
// (#bgGlow en styles.css), así que no se distinguen las barras. Se suavizan en el tiempo y entre vecinas para que no haya cortes bruscos.

import { APP_ID } from './state.js';
import { viz } from './audio.js';
import { desk } from './dom.js';

const canvas = document.getElementById('bgGlow');
const ctx = canvas.getContext('2d');
const KEY = APP_ID + '_bgglow';   // '0' = apagada; cualquier otra cosa (o nada) = encendida
const W = 144, H = 72;     // tamaño real del lienzo (se estira a toda la pantalla)
const RISE = 0.22, FALL = 0.05;   // lo que se acerca cada fotograma al nivel nuevo al subir y al bajar
const IDLE_MS = 400;       // sin sonido, cada cuánto se mira si vuelve
canvas.width = W; canvas.height = H;

let on = true;
try { on = localStorage.getItem(KEY) !== '0'; } catch (_) {}
let lv = [], raf = 0, idleTimer = 0, drawn = false;

export const glowOn = () => on;
export function setGlow(v) {
  on = !!v;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {}
  kick();
}

const active = () => on && desk.matches && !document.hidden;

function draw(accent) {
  ctx.clearRect(0, 0, W, H);
  const n = lv.length, bw = W / n;
  for (let i = 0; i < n; i++) {
    const h = lv[i] * H;
    if (h < 0.5) continue;
    const g = ctx.createLinearGradient(0, H, 0, H - h);
    g.addColorStop(0, accent);
    g.addColorStop(1, accent + '00');
    ctx.fillStyle = g;
    ctx.fillRect(i * bw + bw * 0.2, H - h, bw * 0.6, h);
  }
}

function frame() {
  raf = 0;
  if (!active()) { stop(); return; }
  const src = viz.levels, n = src.length;
  if (lv.length !== n) lv = new Array(n).fill(0);
  let any = false;
  for (let i = 0; i < n; i++) {
    const t = 0.25 * (src[Math.max(0, i - 1)] + src[Math.min(n - 1, i + 1)]) + 0.5 * src[i];   // cada barra, un poco mezclada con las de al lado
    lv[i] += (t - lv[i]) * (t > lv[i] ? RISE : FALL);
    if (lv[i] > 0.004) any = true; else lv[i] = 0;
  }
  if (any || drawn) draw(viz.accent);
  drawn = any;
  if (any || viz.looping) raf = requestAnimationFrame(frame);
  else idleTimer = setTimeout(kick, IDLE_MS);   // en silencio no se dibuja: se vuelve a mirar de vez en cuando
}

function stop() {
  cancelAnimationFrame(raf); raf = 0;
  clearTimeout(idleTimer);
  lv.fill(0);
  if (drawn) { ctx.clearRect(0, 0, W, H); drawn = false; }
  canvas.hidden = !(on && desk.matches);
}

function kick() {
  clearTimeout(idleTimer);
  canvas.hidden = !(on && desk.matches);
  if (!active()) { stop(); return; }
  if (!raf) raf = requestAnimationFrame(frame);
}

desk.addEventListener('change', kick);
document.addEventListener('visibilitychange', kick);
kick();
