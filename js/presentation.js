// =======================
// == MODO PRESENTACIÓN ==
// =======================
// Pantalla completa con un visualizador grande (botón en la esquina del visualizador de la página). Siete vistas, que se cambian tocando la pantalla
// (o con las flechas y el espacio), en este orden:
//   Espectro      barras grandes con reflejo, picos que caen, halo que late con los graves y partículas
//   Radial        las barras en círculo alrededor de la emisora; un botón alterna el giro y el estéreo (Sin Giro, Sin Giro ST, Con Giro, Con Giro ST)
//   Océano        una gran ola de puntos de luz que se levanta con cada golpe de graves (sin textos)
//   Vórtice       la forma de onda real en anillo con realimentación, que cambia de figura cada pocos golpes (sin textos)
//   Seda          cintas de luz finas, una por franja de frecuencias
//   Onda          cintas de malla de líneas finas que se retuercen y por las que viajan las frecuencias y los golpes
//   Onda de seda  las reglas de la Seda con la estética de la Onda
// Todas comparten una paleta de colores suaves que va cambiando de tono, más deprisa cuanto más rápido es el tempo. Lee los niveles del visualizador
// de la página (viz.levels) y, en el Vórtice, la forma de onda del analizador; no toca el audio. Con el ratón arriba a la izquierda aparece el control
// (reproducir, volúmenes y boletines) y abajo las emisoras; en pantallas táctiles, ambos al tocar. Son copias de los controles de la página, que se
// mantienen al día con ellos.
// Imagen en imagen: la vista elegida, en la ventana flotante del navegador (ver el apartado IMAGEN EN IMAGEN, al final).

import { S } from './state.js';
import {
  newsBox, newsToggle, newsVolume, newsVolValue, clockEl, presetsBox, stop, toggle, volume, volValue,
  presCanvas, presClock, presSpin, presClose, presCtl, presEl, presMode, presNews, presNewsSw, presNewsVol, presNewsVolValue, presOpen, presExpand,
  presPlay, presPs, presPsText, presQual, presStrip, presVol, presVolValue, presPipBtn, pipRow, pipToggle, presPipRow, presPip
} from './dom.js';
import { setText } from './ui.js';
import { viz } from './audio.js';
import { shownStation, shownVariant } from './stations.js';
import { emisoraName } from './utils.js';
import { mix, shade } from './viz.js';

const MODE_KEY = 'rn_pres';
const SPIN_KEY = 'rn_giro';   // Radial: '0' sin giro, '1' con giro; con una 's' detrás, en estéreo (ST)
const MODES = ['Espectro', 'Radial', 'Océano', 'Vórtice', 'Seda', 'Onda', 'Onda de seda'];   // (las reglas CSS por vista usan este orden: Radial = 1, Océano = 2, Vórtice = 3)
const [SPECTRUM, RADIAL, OCEAN, VORTEX, SILK_MODE, WAVE, SILK_WAVE] = MODES.map((_, i) => i);
const IDLE_MS = 4000;       // sin tocar nada, se esconden el botón de salir, el puntero y (en pantallas táctiles) los paneles
const TOP_ZONE = { w: 340, h: 230 };   // con el ratón en esta esquina (px) aparece el control
const BOTTOM_ZONE = 150;               // y con el ratón a esta distancia del borde inferior (px), las emisoras
const MAX_PIXELS = 2.6e6;   // tope de píxeles del canvas en pantallas grandes
const PEAK_HOLD_S = 0.35;   // tiempo que se queda cada pico arriba antes de caer
const N = viz.levels.length;
const WIDE = 15;            // bandas (de las 36) que cuentan para el bote del círculo del Radial: graves y medios bajos
const NARROW_PX = 600;      // por debajo de este ancho (móvil en vertical) el espectro lleva menos barras

const presCtx = presCanvas.getContext('2d');
let ctx = presCtx;   // lienzo en el que dibujan las vistas: el de la presentación o, para imagen en imagen, el de la ventana flotante
let mode = 0;
// Se guarda el nombre de la vista (antes, su número en el orden de entonces: 0 Espectro, 1 Radial, 2 Vórtice, 3 Seda)
try {
  const saved = localStorage.getItem(MODE_KEY), old = ['Espectro', 'Radial', 'Vórtice', 'Seda'];
  mode = Math.max(0, MODES.indexOf(/^\d+$/.test(saved || '') ? old[+saved] : saved));
} catch (_) {}
let fsUsed = false, open = false, raf = 0, last = 0, infoAt = 0, wake = null, idleTimer = 0, modeTimer = 0;

const TAU = Math.PI * 2;
const rgba = (hex, a) => 'rgba(' + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',') + ',' + a + ')';
const ease = l => Math.pow(l, 1.4);   // los niveles bajos se notan menos y los picos destacan más
const rounded = (x, y, w, h, r) => { if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
const follow = (x, t, dt, up, down = up) => x + (t - x) * Math.min(1, dt * (t > x ? up : down));   // x se acerca a t: a un ritmo si sube (up) y a otro si baja (down)
const tri = x => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);   // triángulo de periodo 1: 0 → 1 → 0, sin saltos

// ==============================
// == ANÁLISIS DE LOS NIVELES ==
// ==============================
const peaks = new Float32Array(N), hold = new Float32Array(N), fall = new Float32Array(N);
let bass = 0, bassAvg = 0, wide = 0, wideAvg = 0, punch = 0, energy = 0, pulse = 0, beatAt = 0, spin = 0, beatNow = false;
const parts = [];   // partículas: { x, y, v, r, a, ph }

function analyse(lv, dt, now) {
  let b = 0, e = 0;
  beatNow = false;
  for (let i = 0; i < N; i++) { e += lv[i]; if (i < 5) b += lv[i]; }
  b /= 5; e /= N;
  energy = follow(energy, e, dt, 6);
  bass = follow(bass, b, dt, 11.5);
  // golpe: los graves superan con claridad su nivel medio reciente
  const prevBeat = beatAt;
  if (b > bassAvg * 1.2 + 0.04 && b > 0.3 && now - beatAt > 170) { pulse = 1; beatAt = now; beatNow = true; }
  if (beatNow && prevBeat) tempoBeat(now - prevBeat, now);
  bassAvg = follow(bassAvg, b, dt, 1.5);
  // golpe suave para el círculo del Radial: subida de los graves (como antes) o de una banda más ancha (graves y medios bajos: cajas, voces, guitarras), que se recupera enseguida y
  // deprisa, así que salta muchas más veces que el golpe de graves
  let wv = 0;
  for (let i = 0; i < WIDE; i++) wv += lv[i];
  wv /= WIDE;
  wide = follow(wide, wv, dt, 14);
  punch = Math.min(1, Math.max(0, (b - bassAvg) * 4.6, (wide - wideAvg) * 3.4));   // el bombo pesa más que el resto de la banda
  wideAvg = follow(wideAvg, wide, dt, 2.2);
  pulse = Math.max(0, pulse - dt * 3.2);
  spin += dt * (0.25 + energy * 2.5);
  if (now - beatAt > 3000) tempo = follow(tempo, 0, dt, 0.2);   // sin golpes de graves, el tempo se olvida poco a poco
  movePalette(dt);
  trackPeaks(lv, peaks, hold, fall, dt);
}
// picos: suben con la barra, se quedan un momento y caen acelerando
function trackPeaks(lv, pk, hd, fl, dt) {
  for (let i = 0; i < N; i++) {
    if (lv[i] >= pk[i]) { pk[i] = lv[i]; hd[i] = PEAK_HOLD_S; fl[i] = 0; }
    else if (hd[i] > 0) hd[i] -= dt;
    else { fl[i] += dt * 2.4; pk[i] = Math.max(lv[i], pk[i] - fl[i] * dt); }
  }
}

function moveParticles(w, h, dt) {
  while (parts.length < 70) parts.push({ x: Math.random() * w, y: Math.random() * h, v: 0.4 + Math.random() * 0.9, r: 0.8 + Math.random() * 2, a: 0.15 + Math.random() * 0.5, ph: Math.random() * 600 });
  const speed = 14 + energy * 170;
  for (const p of parts) {
    p.y -= speed * p.v * dt;
    p.x += Math.sin((p.y + p.ph) * 0.012) * 12 * dt;
    if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
    if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
  }
}

function drawParticles(c) {
  ctx.fillStyle = c;
  const k = 0.35 + energy * 1.3;
  for (const p of parts) {
    ctx.globalAlpha = Math.min(1, p.a * k);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (1 + energy * 1.4), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function halo(w, h, cx, cy, radius, c, soft = 1) {   // soft < 1: la luz golpea menos (solo el brillo que late; el de reposo se queda)
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, rgba(c, 0.08 + (0.3 * bass + 0.22 * pulse) * soft));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ======================
// == PALETA COMPARTIDA ==
// ======================
// Todas las vistas comparten un tono que recorre despacio la rueda de colores (siempre suaves: poca saturación y luz alta, como los hilos de la Seda). Su velocidad sigue al tempo de la
// música: cada golpe de graves da un intervalo, del que sale un tempo suavizado (plegado a 72-165 pulsos por minuto para que no salten las octavas); cuanto más rápido va, más deprisa
// cambia el color. Cuando el tempo cambia de verdad (el tempo rápido se aparta del lento más de un 12%), el color acelera un rato y da un pequeño salto, que se reparte suavemente.
let palHue = 215, palVel = 6, palPush = 0, palBoost = 0, tempo = 0, tempoSlow = 0, tempoAt = 0;
const hslHex = (h, s, l) => {   // h en grados, s y l entre 0 y 1
  const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
};

function tempoBeat(ms, now) {
  if (ms > 2000) return;
  let bpm = 60000 / ms;
  while (bpm > 165) bpm /= 2;
  while (bpm < 72) bpm *= 2;
  tempo = tempo ? tempo + (bpm - tempo) * 0.18 : bpm;
  tempoSlow = tempoSlow ? tempoSlow + (bpm - tempoSlow) * 0.04 : bpm;
  if (Math.abs(tempo - tempoSlow) / tempoSlow > 0.12 && now - tempoAt > 4000) { tempoAt = now; palBoost = 1; palPush += 28; tempoSlow = tempo; }
}

function movePalette(dt) {
  const tn = Math.min(1, Math.max(0, (tempo - 70) / 95));   // 0 = lento, 1 = rápido
  palBoost = Math.max(0, palBoost - dt / 3.5);
  palVel = follow(palVel, (4 + 20 * tn + 10 * energy + 26 * palBoost) * 0.85, dt, 0.9);   // 0,85: un 15% más lento que el ritmo base
  const push = palPush * Math.min(1, dt * 1.6);   // (el salto por cambio de tempo no se escala)
  palPush -= push;
  palHue = (palHue + palVel * dt + push) % 360;
}
const palColor = () => hslHex(palHue, 0.62, 0.66);   // "#rrggbb" del color de las barras y el círculo
const pal = (dh, s, l, a) => 'hsla(' + ((palHue + dh + 360) % 360).toFixed(0) + ', ' + s + '%, ' + l + '%, ' + a + ')';   // para pintar con el tono compartido (dh = desplazamiento de tono)

// ====================
// == VISTA ESPECTRO ==
// ====================
// En pantallas estrechas el espectro usa un tercio de barras (más anchas), promediadas
const grpLv = new Float32Array(N / 3), grpPk = new Float32Array(N / 3);
function group(src, out) {
  const n = out.length, k = src.length / n;
  for (let i = 0; i < n; i++) { let t = 0; for (let j = 0; j < k; j++) t += src[i * k + j]; out[i] = t / k; }
  return out;
}
function drawSpectrum(w, h, c, levels) {
  const narrow = w < NARROW_PX, n = narrow ? N / 3 : N, lv = n === N ? levels : group(levels, grpLv), pk = n === N ? peaks : group(peaks, grpPk);
  const base = h * 0.8, maxH = h * (narrow ? 0.4 : 0.5), margin = w * 0.06, usable = w - margin * 2;
  const gap = usable / n * 0.28, bw = (usable - gap * (n - 1)) / n;
  halo(w, h, w / 2, base, Math.max(w, h) * (0.45 + 0.05 * pulse), c, 0.4);
  drawParticles(c);
  // brillo bajo las barras: las mismas, algo más anchas y casi transparentes
  ctx.fillStyle = rgba(c, 0.13 + 0.2 * pulse);
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const bh = Math.max(4, ease(lv[i]) * maxH); rounded(margin + i * (bw + gap) - 5, base - bh - 6, bw + 10, bh + 6, bw / 2 + 4); }
  ctx.fill();
  // barras
  const g = ctx.createLinearGradient(0, base, 0, base - maxH);
  g.addColorStop(0, shade(c, 0.55));
  g.addColorStop(0.55, c);
  g.addColorStop(1, mix(c, '#ffffff', 0.6));
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const bh = Math.max(4, ease(lv[i]) * maxH); rounded(margin + i * (bw + gap), base - bh, bw, bh, Math.min(6, bw / 2)); }
  ctx.fill();
  // reflejo que se apaga hacia abajo
  const rh = maxH * 0.42, r = ctx.createLinearGradient(0, base, 0, base + rh);
  r.addColorStop(0, rgba(c, 0.3));
  r.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = r;
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const bh = Math.max(4, ease(lv[i]) * maxH) * 0.42; rounded(margin + i * (bw + gap), base + 4, bw, bh, Math.min(6, bw / 2)); }
  ctx.fill();
  // picos
  ctx.fillStyle = mix(c, '#ffffff', 0.75);
  ctx.beginPath();
  for (let i = 0; i < n; i++) { if (pk[i] > 0.03) rounded(margin + i * (bw + gap), base - Math.max(4, ease(pk[i]) * maxH) - 9, bw, 3, 1.5); }
  ctx.fill();
}

// ==================
// == VISTA RADIAL ==
// ==================
// El botón de debajo del reloj pasa por cuatro modos: Sin Giro → Sin Giro ST → Con Giro → Con Giro ST.
// Giro: al pararlo, las barras siguen girando a su ritmo hasta volver a su posición de reposo (graves abajo), y ahí se quedan.
// ST (estéreo): el canal izquierdo a la izquierda y el derecho a la derecha, en vez del mismo en espejo. El segundo analizador que hace falta solo
// existe mientras se ve el Radial en ST (syncStereo); al salir se destruye.
let spinOn = true, stOn = false, barRot = 0, radSpin = 0, stLive = false;
try { const v = localStorage.getItem(SPIN_KEY) || '1'; spinOn = v[0] !== '0'; stOn = v.endsWith('s'); } catch (_) {}
const peaksL = new Float32Array(N), holdL = new Float32Array(N), fallL = new Float32Array(N);
const peaksR = new Float32Array(N), holdR = new Float32Array(N), fallR = new Float32Array(N);
function showSpin() { presSpin.textContent = (spinOn ? 'Con Giro' : 'Sin Giro') + (stOn ? ' ST' : ''); }
showSpin();
function syncStereo() {
  const on = (open || pipOn) && mode === RADIAL && stOn;
  if (on === stLive) return;
  stLive = on;
  if (on) { for (const a of [peaksL, peaksR]) a.set(peaks); for (const a of [holdL, holdR]) a.set(hold); for (const a of [fallL, fallR]) a.set(fall); }   // los picos parten de los de ahora
  viz.setStereo(on);
}
presSpin.addEventListener('click', e => {
  e.stopPropagation();   // no cambia de vista
  const k = ((spinOn ? 2 : 0) + (stOn ? 1 : 0) + 1) % 4;
  spinOn = k >= 2; stOn = k % 2 === 1;
  try { localStorage.setItem(SPIN_KEY, (spinOn ? '1' : '0') + (stOn ? 's' : '')); } catch (_) {}
  showSpin();
  syncStereo();
  presSpin.blur();   // que el teclado vuelva a cambiar de vista
});
function turnBars(dt) {
  const ds = Math.min(Math.max(0, (spin - radSpin) * 0.1), dt * 0.3);   // lo que girarían ahora (0,025-0,28 rad/s según la energía; el tope evita un salto al volver a esta vista)
  radSpin = spin;
  if (spinOn) { barRot = (barRot + ds) % TAU; return; }
  if (barRot === 0) return;
  const left = TAU - barRot;
  barRot += ds * Math.min(1, 0.3 + left / 0.12);   // sigue a su ritmo de siempre (no acelera) y solo frena un poco en el último tramo
  if (barRot >= TAU - 0.002) barRot = 0;
}

function drawRadial(w, h, c, lv, dt) {
  turnBars(dt);
  const cx = w / 2, cy = h / 2, m = Math.min(w, h), tall = h > w * 1.3, R = m * (tall ? 0.23 : 0.19), maxLen = m * (tall ? 0.24 : 0.26),   // en vertical, círculo más grande (sobra alto)
        lw = Math.max(3, 2 * Math.PI * R / (2 * N) * 0.55);
  halo(w, h, cx, cy, m * 0.62, c, 0.4);
  drawParticles(c);
  // círculo interior: reacciona a cada subida de los graves por encima de su nivel reciente (no a su nivel, que con música densa es alto siempre), así late con cada
  // golpe y entre golpes vuelve a quedarse en reposo, sin color de fondo permanente; en cada golpe fuerte suelta además una onda
  const kb = punch, rr = R * (1 + 0.5 * kb + 0.2 * pulse);   // recorrido amplio: en un golpe fuerte el círculo crece hasta un 70%
  if (kb > 0.02 || pulse > 0.02) {
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    core.addColorStop(0, rgba(c, 0.18 * kb + 0.1 * pulse));
    core.addColorStop(1, rgba(c, 0.4 * kb + 0.25 * pulse));
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill();
  }
  // oscurecimiento ligero y redondo detrás de los textos del centro, para que se lean sobre el color del círculo; no late (usa el radio fijo)
  const dk = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.04);
  dk.addColorStop(0, 'rgba(3, 5, 9, 0.5)');
  dk.addColorStop(0.65, 'rgba(3, 5, 9, 0.4)');
  dk.addColorStop(1, 'rgba(3, 5, 9, 0)');
  ctx.fillStyle = dk;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.04, 0, TAU); ctx.fill();
  if (pulse > 0.02) {
    ctx.strokeStyle = rgba(c, 0.5 * pulse);
    ctx.lineWidth = 2 + 4 * pulse;
    ctx.beginPath(); ctx.arc(cx, cy, rr * (1 + (1 - pulse) * 0.45), 0, TAU); ctx.stroke();
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(c, 0.14 + 0.2 * kb + 0.1 * pulse);
  ctx.lineWidth = lw * (2.4 + 1.0 * kb);
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
  ctx.strokeStyle = rgba(c, 0.55 + 0.35 * kb);
  ctx.lineWidth = 2 + 1.5 * kb;
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
  ctx.save();
  ctx.setLineDash([1, 15]);
  ctx.lineDashOffset = spin * 40;   // los puntos giran en sentido antihorario
  ctx.strokeStyle = rgba(c, 0.5);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, R + maxLen * 1.12, 0, TAU); ctx.stroke();
  ctx.restore();
  // barras en círculo: graves abajo, agudos arriba; iguales a izquierda y derecha o, en ST, cada canal en su lado (s = 1 derecha, s = -1 izquierda)
  const lvR = stLive ? viz.levelsR : lv, lvL = stLive ? viz.levelsL : lv, pkR = stLive ? peaksR : peaks, pkL = stLive ? peaksL : peaks;
  if (stLive) { trackPeaks(lvL, peaksL, holdL, fallL, dt); trackPeaks(lvR, peaksR, holdR, fallR, dt); }
  const sides = stLive ? [[1], [-1]] : [[1, -1]];   // en espejo, las dos mitades van en un solo trazo
  ctx.lineWidth = lw;
  const rot = barRot, dark = shade(c, 0.7);   // rot: giro de las barras en sentido horario (ver turnBars)
  for (let i = 0; i < N; i++) for (const side of sides) {
    const l = ease((side[0] === 1 ? lvR : lvL)[i]), len = 3 + l * maxLen, a = i / (N - 1) * Math.PI;   // las barras giran despacio en sentido horario (rot)
    ctx.strokeStyle = mix(dark, '#ffffff', l * 0.6);
    ctx.beginPath();
    for (const s of side) {
      const t = Math.PI / 2 - s * a + rot, cos = Math.cos(t), sin = Math.sin(t), r0 = R + (rr - R) * 0.3 + lw;   // las barras se apartan solo en parte, para no salirse de la pantalla
      ctx.moveTo(cx + cos * r0, cy + sin * r0);
      ctx.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
    }
    ctx.stroke();
  }
  // puntas de los picos
  ctx.fillStyle = mix(c, '#ffffff', 0.75);
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const a = i / (N - 1) * Math.PI;
    for (const s of [1, -1]) {
      const p = (s === 1 ? pkR : pkL)[i];
      if (p <= 0.03) continue;
      const d = rr + lw + 3 + ease(p) * maxLen + lw, t = Math.PI / 2 - s * a + rot;
      ctx.moveTo(cx + Math.cos(t) * d + lw / 3, cy + Math.sin(t) * d);
      ctx.arc(cx + Math.cos(t) * d, cy + Math.sin(t) * d, lw / 3, 0, TAU);
    }
  }
  ctx.fill();
}

// ===================
// == VISTA VÓRTICE ==
// ===================
// Cada fotograma parte del anterior, ampliado y girado un poco y algo más oscuro (así lo dibujado se aleja en espiral y deja estela), y sobre él se
// dibuja con luz sumada: un anillo con la forma de onda real, un bucle de fase (la señal frente a ella misma unos instantes después) y, con cada
// golpe (graves o medios bajos), rayos, un fogonazo de fondo y un empujón de la estela. El color es el de la paleta compartida; el giro se invierte de vez en cuando.
const RING = 256;   // puntos del anillo
let wave = new Float32Array(2048), env = 0.1, wgain = 3, dir = 1, beats = 0;
let vHit = 0, vHitAt = 0, vHitNow = false;   // golpe propio del Vórtice: salta con graves y medios bajos (punch), más a menudo que el golpe de graves
// Variedad: el anillo y el bucle de fase cambian de figura cada pocos golpes (6-11, y al menos 5 s), con un fundido de un segundo entre la figura vieja y la nueva.
// Figuras del anillo: 0 anillo, 1 simétrico (la onda repetida en espejo en 3-7 gajos), 2 doble (dos anillos que giran al revés), 3 pétalos, 4 espiral, 5 estrella.
// El bucle de fase (la señal frente a ella misma un poco después) cambia de retardo, tamaño y número de copias giradas (caleidoscopio).
const V_STYLES = 6;
const vNewLook = old => {
  let st;
  do st = Math.floor(Math.random() * V_STYLES); while (old && st === old.st);
  return { st, lobes: 3 + Math.floor(Math.random() * 5), copies: 1 + Math.floor(Math.random() * 4), delay: [3, 6, 12, 24][Math.floor(Math.random() * 4)], size: 0.14 + Math.random() * 0.08, mirror: Math.random() < 0.4 };
};
let vLook = { st: 0, lobes: 5, copies: 1, delay: 6, size: 0.17, mirror: false }, vOld = null, vFade = 1, vCount = 0, vNext = 8, vLookAt = 0;

function drawVortex(w, h, dt, dpr) {
  const m = Math.min(w, h), cx = w / 2, cy = h / 2, an = viz.analyser, cw = ctx.canvas.width, ch = ctx.canvas.height;
  // forma de onda con ganancia automática (siempre llena el anillo, suene fuerte o flojo)
  let mx = 0;
  if (an && !viz.synthetic) {
    if (wave.length !== an.fftSize) wave = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(wave);
    for (let i = 0; i < wave.length; i++) { const a = Math.abs(wave[i]); if (a > mx) mx = a; }
  } else if (viz.synthetic) {
    // emisora sin Web Audio: no hay forma de onda real, se dibuja una a partir de los niveles sintéticos de las barras
    const lv = viz.levels, t = spin * 3;
    for (let i = 0; i < wave.length; i++) {
      const v = 0.45 * (lv[2] * Math.sin(i * 0.05 + t) + lv[12] * Math.sin(i * 0.21 + t * 1.7) + lv[26] * Math.sin(i * 0.6 + t * 2.9));
      wave[i] = v;
      const a = Math.abs(v);
      if (a > mx) mx = a;
    }
  } else wave.fill(0);
  env = Math.max(mx, env - dt * 0.25);
  wgain = follow(wgain, Math.min(8, 0.9 / Math.max(env, 0.04)), dt, 3);
  if (beatNow) { beats++; if (beats % 7 === 0) dir = -dir; }
  // golpe del Vórtice: cada subida clara de graves o de la banda ancha (graves y medios bajos), con al menos 140 ms entre golpes; fuerza según lo que suba
  const nowMs = performance.now();
  vHitNow = false;
  if ((punch > 0.3 || beatNow) && nowMs - vHitAt > 140) { vHit = Math.max(vHit, Math.min(1, 0.45 + punch * 0.8 + (beatNow ? 0.3 : 0))); vHitAt = nowMs; vHitNow = true; }
  vHit = Math.max(0, vHit - dt * 3.2);
  // realimentación: el fotograma anterior, ampliado, girado y apagado un poco
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (drawn !== VORTEX) { ctx.fillStyle = '#030408'; ctx.fillRect(0, 0, cw, ch); }   // al entrar en esta vista se parte de fondo limpio
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(dir * dt * (0.08 + energy * 0.7 + pulse * 0.5 + vHit * 0.9));
  const zoom = 1 + dt * (0.3 + bass * 1.7 + pulse * 1.3 + vHit * 2.6);   // con cada golpe la estela se lanza hacia fuera
  ctx.scale(zoom, zoom);
  ctx.translate(-cw / 2, -ch / 2);
  ctx.drawImage(ctx.canvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(3, 4, 8, 0.11)';   // la estela se apaga antes: si se acumula mucho, los tonos que van pasando se mezclan en un gris blanquecino
  ctx.fillRect(0, 0, cw, ch);
  // luz nueva, sumada a lo que ya hay
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = ctx.lineCap = 'round';
  const R = m * (0.11 + 0.07 * bass + 0.05 * pulse + 0.06 * vHit), amp = m * (0.13 + 0.05 * vHit), step = Math.max(1, Math.floor(wave.length / RING)), light = 60 + pulse * 10 + vHit * 12, calm = Math.max(0, 1 - energy * 5);
  if (vHitNow && ++vCount >= vNext && nowMs - vLookAt > 5000) { vOld = vLook; vLook = vNewLook(vOld); vFade = 0; vCount = 0; vNext = 6 + Math.floor(Math.random() * 6); vLookAt = nowMs; }
  vFade = Math.min(1, vFade + dt);
  const g = wgain * amp, sample = k => wave[(((k % RING) + RING) % RING) * step] * g;
  const looks = vFade < 1 && vOld ? [[vOld, 1 - vFade], [vLook, vFade]] : [[vLook, 1]];
  const idle = a => calm * m * (0.012 * Math.sin(3 * a + spin * 2.2) + 0.007 * Math.sin(5 * a - spin * 3.1));   // en silencio el anillo sigue ondulando un poco
  const ring = (rot, fr) => {   // un anillo girado rot; fr(i, a) da el radio en cada punto
    ctx.beginPath();
    for (let i = 0; i <= RING; i++) {
      const a = i / RING * TAU + rot, r = fr(i, a);
      if (i) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.stroke();
  };
  for (const [lk, al] of looks) {
    ctx.globalAlpha = al;
    // anillo con la figura que toque
    ctx.strokeStyle = pal(0, 85, light, 1);
    ctx.lineWidth = 1.5 + bass * 3.5 + pulse * 3 + vHit * 4;
    const L = lk.lobes;
    if (lk.st === 0) ring(spin * 0.6, (i, a) => R + sample(i) + idle(a));
    else if (lk.st === 1) ring(spin * 0.6, i => { const t = tri(i / RING * L); return R + sample(Math.floor(t * RING / 2)) * 1.2 + idle(i / RING * TAU); });   // gajos en espejo
    else if (lk.st === 2) { ring(spin * 0.6, (i, a) => R * 0.72 + sample(i) * 0.7 + idle(a)); ring(-spin * 0.8, (i, a) => R * 1.32 + sample(i + RING / 2) * 0.9 + idle(a)); }
    else if (lk.st === 3) ring(spin * 0.4, (i, a) => R * 0.8 + Math.abs(Math.sin(L * a / 2)) * (R * (0.35 + 0.6 * energy + 0.4 * vHit) + Math.abs(sample(i)) * 1.3));   // pétalos
    else if (lk.st === 4) {   // espiral de dos vueltas
      ctx.beginPath();
      for (let i = 0; i <= RING * 2; i++) {
        const a = i / RING * TAU + spin * 0.7, r = R * 0.45 + i / (RING * 2) * R * 1.25 + sample(i) * 0.6;
        if (i) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.stroke();
    } else ring(spin * 0.5, (i, a) => R * (1 + 0.28 * Math.cos(L * a) * (0.35 + bass + 0.5 * vHit)) + sample(i) * 0.8 + idle(a));   // estrella
    // bucle de fase, con su retardo, tamaño y copias giradas
    const d = lk.delay + Math.floor(energy * 40), R2 = m * lk.size;
    ctx.lineWidth = 1.2 + energy * 3;
    for (let c = 0; c < lk.copies; c++) {
      const q = -spin * 0.9 + c * TAU / lk.copies, cq = Math.cos(q), sq = Math.sin(q), sy = lk.mirror && c % 2 ? -1 : 1;
      ctx.strokeStyle = pal(150 + c * 28, 80, 62, 1);
      ctx.beginPath();
      for (let i = 0; i < RING; i++) {
        const j = i * step, x = wave[j] * wgain, y = sy * wave[(j + d) % wave.length] * wgain, px = cx + (x * cq - y * sq) * R2, py = cy + (x * sq + y * cq) * R2;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  if (vHit > 0.02) {   // el fondo se enciende con cada golpe: un fogonazo redondo que se apaga enseguida
    const fl = ctx.createRadialGradient(cx, cy, R * 1.05, cx, cy, Math.max(w, h) * 0.75);   // empieza fuera del anillo: el centro sigue negro
    fl.addColorStop(0, pal(0, 80, 60, 0));
    fl.addColorStop(0.06, pal(0, 80, 60, (0.13 * vHit).toFixed(3)));
    fl.addColorStop(0.45, pal(30, 75, 50, (0.05 * vHit).toFixed(3)));
    fl.addColorStop(1, pal(30, 75, 50, 0));
    ctx.fillStyle = fl;
    ctx.fillRect(0, 0, w, h);
  }
  if (vHitNow) {
    ctx.lineWidth = 2 + bass * 4 + vHit * 2;
    for (let i = 0; i < 14 + Math.round(vHit * 14); i++) {
      const a = Math.random() * TAU, r0 = R * 1.1, r1 = R + m * (0.06 + Math.random() * (0.1 + 0.12 * vHit));
      ctx.strokeStyle = pal(Math.random() * 70, 75, 72, 1);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    }
    ctx.fillStyle = pal(0, 75, 64, 0.02);
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalCompositeOperation = 'source-over';
}

// =================
// == VISTA SEDA ==
// =================
// Sin barras ni destellos: cada cinta de luz representa una franja de frecuencias (graves abajo, agudos arriba) y ondula con su propio ritmo.
// El nivel de cada franja sube enseguida y se mantiene arriba un buen rato antes de bajar despacio, para que el movimiento sea calmado.
const SILK = 9;
const sk = new Float32Array(SILK);   // nivel suavizado de cada cinta
let skT = 0, skAvg = 0, stars = null;

// Cada cinta sigue a su franja como un muelle amortiguado: sube rápido (más reactiva) y baja a un ritmo propio y continuo, sin mesetas ni cortes; así
// responde a cada golpe pero el movimiento no da trompicones. Devuelve el nivel medio de las franjas.
function silkBands(k, dt) {
  const lv = viz.levels, per = N / SILK;
  let sum = 0;
  for (let j = 0; j < SILK; j++) {
    let v = 0;
    for (let i = 0; i < per; i++) v += lv[Math.floor(j * per) + i];
    k[j] = follow(k[j], v / per, dt, 14, 3.6);
    sum += k[j];
  }
  return sum / SILK;
}

function drawSilk(w, h, dt) {
  const mean = silkBands(sk, dt), kick = (sk[0] + sk[1]) / 2;   // kick: los graves, suavizados
  skAvg = follow(skAvg, mean, dt, 2.5);
  skT += dt * (0.22 + skAvg * 1.0);
  const hue = palHue, cy = h * 0.62, amp = Math.min(h * 0.17, w * 0.3);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#070a12');
  bg.addColorStop(1, 'hsl(' + hue.toFixed(0) + ', 40%, 7%)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const gl = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.6);
  gl.addColorStop(0, 'hsla(' + hue.toFixed(0) + ', 70%, 55%, ' + (0.03 + 0.11 * kick).toFixed(3) + ')');
  gl.addColorStop(1, 'hsla(' + hue.toFixed(0) + ', 70%, 55%, 0)');
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, w, h);
  if (!stars) { stars = []; for (let i = 0; i < 40; i++) stars.push({ x: Math.random(), y: Math.random() * 0.5, r: 0.6 + Math.random() * 1.2, ph: Math.random() * TAU }); }
  ctx.fillStyle = '#dbe6ff';
  for (const s of stars) {
    ctx.globalAlpha = 0.08 + 0.17 * (0.5 + 0.5 * Math.sin(skT * 0.7 + s.ph));
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = ctx.lineCap = 'round';
  const steps = Math.max(24, Math.round(w / 12));
  for (let j = 0; j < SILK; j++) {
    const f = j / (SILK - 1), a = Math.min(1, Math.pow(sk[j], 0.8) * 1.5), off = (0.5 - f) * amp * 1.3, k1 = 3 + f * 5, k2 = 8 + f * 9;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const u = i / steps, t = Math.pow(Math.sin(u * Math.PI), 1.2);
      const y = cy + t * (off + amp * (1 + 0.3 * kick + 0.08 * pulse) * (0.1 + 0.9 * a) * (0.75 * Math.sin(u * k1 + skT * 0.8 + j * 0.7) + 0.25 * Math.sin(u * k2 - skT * 1.1 + j * 1.1)));
      if (i) ctx.lineTo(u * w, y); else ctx.moveTo(0, y);
    }
    const hh = (hue + j * 5).toFixed(0), b = 0.175 + 0.55 * a;
    ctx.strokeStyle = 'hsla(' + hh + ', 70%, 65%, ' + (0.03 + 0.07 * a).toFixed(3) + ')';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = 'hsla(' + hh + ', 75%, 78%, ' + b.toFixed(3) + ')';
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ================
// == VISTA ONDA ==
// ================
// Luz de fondo de la Onda y la Onda de seda: un resplandor ancho y aplastado detrás de las cintas, con algo de luz siempre (lvl = 0) y más con los golpes
function glowBehind(w, h, cy, lvl) {
  ctx.save();
  ctx.translate(w / 2, cy);
  ctx.scale(1, 0.55);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.62);
  g.addColorStop(0, pal(0, 75, 58, (0.09 + 0.36 * lvl).toFixed(3)));
  g.addColorStop(0.5, pal(25, 70, 48, (0.035 + 0.15 * lvl).toFixed(3)));
  g.addColorStop(1, pal(25, 70, 48, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-w, -h * 2.5, w * 2, h * 5);
  ctx.restore();
}
const glowLevel = (lvl, hit, dt) => follow(lvl, hit, dt, 5, 1.6);   // la luz sube enseguida con el golpe y baja poco a poco
// Cintas de malla (como la imagen de referencia): cada cinta son muchas líneas finas tendidas entre dos bordes que ondulan por separado. Cuando los bordes se cruzan
// la cinta se retuerce y, donde se ve de canto, las líneas se juntan y dan más luz (eso hace el volumen). Cada borde es una suma de senos lentos que avanzan a velocidades
// distintas; su altura sigue al espectro, que cada cinta reparte a su manera y que se va desplazando despacio a lo largo de ella (onda interna: cada frecuencia viaja por la cinta), con normalización a medias. La altura mezcla dos respuestas: 2/3 la viva (sigue cada subida y crece con el golpe) y 1/3 una lenta que va acumulando las subidas
// (sin golpes), para que haya menos "pum pum" en las cintas. Sin topes ni potencias: las formas son siempre colinas y valles suaves. Las líneas suman luz; cada cinta tiene su tono dentro de la paleta compartida y pasa de
// un tono a otro de un borde al otro.
const WV_NS = 150;                    // muestras a lo ancho
const WV_L = 40;                      // líneas por cinta
const WV_RIB = [{ dh: -55, y: -0.015, k: 0.5, sv: 0.11 }, { dh: 35, y: 0.02, k: 0.5, sv: -0.15 }, { dh: 95, y: 0.004, k: 1, sv: 0.09 }, { dh: -10, y: 0.03, k: 0.75, sv: -0.2 }];   // k: cuántas veces recorre el espectro a lo ancho; sv: velocidad con que las frecuencias se desplazan por la cinta (ciclos/s)
const wvB = new Float32Array(N);      // nivel suavizado de cada barra (respuesta lenta)
const wvF = new Float32Array(N);      // lo mismo con respuesta rápida
const wvPk = new Float32Array(N).fill(0.25);   // máximo reciente de cada barra (para normalizar)
const wvS = new Float32Array(N), wvQ = new Float32Array(N);   // niveles normalizados lento y rápido
const wvAc = new Float32Array(N), wvPa = new Float32Array(N).fill(0.25), wvT = new Float32Array(N);   // respuesta acumulada (muy lenta, sin golpes): nivel, su máximo reciente y normalizado
const wvEs = new Float32Array(WV_NS + 1), wvEf = new Float32Array(WV_NS + 1), wvEa = new Float32Array(WV_NS + 1);   // espectro a lo ancho de la cinta que se dibuja: lento, rápido y acumulado
const wvA = new Float32Array(WV_NS + 1), wvBo = new Float32Array(WV_NS + 1), wvBe = new Float32Array(WV_NS + 1);   // borde A, borde B y barriga de la cinta que se dibuja
const wvPul = [];   // golpes viajeros: { f: frecuencia (0 graves … 1 agudos), a: fuerza, age: edad (s), u: posición de salida en cada cinta }
const wvOn = new Float32Array(6);   // espera mínima entre golpes de cada grupo de frecuencias
let wvE = 0, wvK = 0, wvL = 0;         // energía y golpe suavizados; wvL: luz de fondo (sube y baja despacio)
// cintas: dos bordes con dos senos compartidos (desfasados, para que la cinta se retuerza) y uno propio, una barriga, mezcla rápida/lenta y respuesta al golpe (todo determinista)
const wvRib = WV_RIB.map((rb, ri) => {
  let sd = 7 + ri * 13;
  const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const comp = () => ({ f: 1.1 + 3.2 * rnd(), a: 0.4 + 0.6 * rnd(), ph: rnd() * 6.28, sp: (rnd() < 0.5 ? -1 : 1) * (0.3 + 0.65 * rnd()) });   // avance propio de cada seno (rad/s)
  const norm = cs => { const t = cs.reduce((x, c) => x + c.a, 0); cs.forEach(c => { c.a *= 1.1 / t; }); return cs; };
  const sh = [comp(), comp()];
  const A = norm([...sh.map(c => ({ ...c })), comp()]);
  const B = norm([...sh.map(c => ({ ...c, ph: c.ph + 0.8 + 1.8 * rnd(), a: c.a * (0.6 + 0.6 * rnd()) })), comp()]);
  return { ...rb, A, B, bel: comp(), m: 0.55 + 0.45 * rnd(), kw: 0.6 + rnd(), g: 0.85 + 0.3 * rnd(), off: rnd() };
});

const wvCurve = v => 0.25 + 1.9 * Math.pow(Math.min(1, v), 1.7);   // altura según el nivel: el nivel medio da poca y solo los altos llegan al máximo (más rango)

function drawWave(w, h, dt) {
  const lv = viz.levels, cy = h * 0.56, H = Math.min(h * 0.19, w * 0.22);
  for (let i = 0; i < N; i++) {
    wvB[i] = follow(wvB[i], lv[i], dt, 9, 2.8);
    wvF[i] = follow(wvF[i], lv[i], dt, 32, 10);
    wvPk[i] = Math.max(wvF[i], wvPk[i] - dt * 0.1, 0.08);
    wvS[i] = wvB[i] * (0.55 + 0.45 / wvPk[i]);   // normalización a medias: los graves siguen pesando algo más
    wvQ[i] = wvF[i] * (0.55 + 0.45 / wvPk[i]);
    wvAc[i] = follow(wvAc[i], lv[i], dt, 3, 1.3);
    wvPa[i] = Math.max(wvAc[i], wvPa[i] - dt * 0.1, 0.08);
    wvT[i] = wvAc[i] * (0.55 + 0.45 / wvPa[i]);
  }
  // golpes por frecuencia: en cada grupo de 6 barras, si la respuesta rápida se adelanta con claridad a la lenta, sale una onda que recorre cada cinta de izquierda a
  // derecha desde donde está esa frecuencia en ella
  for (let g = 0; g < 6; g++) {
    let d = 0;
    for (let i = g * 6; i < g * 6 + 6; i++) d += wvF[i] - wvB[i];
    d /= 6;
    wvOn[g] = Math.max(0, wvOn[g] - dt);
    if (d > 0.07 && wvOn[g] === 0) {
      wvOn[g] = 0.3;
      const f = (g * 6 + 3) / (N - 1);
      wvPul.push({ f, a: Math.min(1, d * 4.5), age: 0, u: wvRib.map(rb => {   // primera posición (desde la izquierda) donde la cinta tiene esa frecuencia
        let best = 0, bd = 9;
        for (let j = 0; j <= WV_NS; j++) { const dd = Math.abs(tri(j / WV_NS * rb.k + rb.off) - f); if (dd < 0.05) { best = j; break; } if (dd < bd) { bd = dd; best = j; } }
        return best / WV_NS;
      }) });
      if (wvPul.length > 14) wvPul.shift();
    }
  }
  for (let q = wvPul.length - 1; q >= 0; q--) { wvPul[q].age += dt; if (wvPul[q].age > 3) wvPul.splice(q, 1); }
  const kk = Math.min(1, Math.max(0, bass - bassAvg) * 2.8);
  wvK = follow(wvK, kk, dt, 12, 3.5);
  wvE = follow(wvE, energy, dt, 1.5);
  ctx.fillStyle = '#04040e';
  ctx.fillRect(0, 0, w, h);
  const gl = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.5);
  gl.addColorStop(0, pal(0, 60, 40, (0.03 + 0.05 * wvE + 0.03 * wvK).toFixed(3)));
  gl.addColorStop(1, pal(0, 60, 40, 0));
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, w, h);
  wvL = glowLevel(wvL, Math.max(wvK, 0.8 * pulse), dt);   // golpe de graves: subida sobre su media o golpe detectado
  glowBehind(w, h, cy, wvL);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.lineWidth = 0.75;
  const x0 = -w * 0.01, xw = w * 1.02, sp = 0.7 + 0.6 * wvE;
  for (let ri = 0; ri < wvRib.length; ri++) {
    const rb = wvRib[ri];
    for (const c of rb.A) c.ph += dt * c.sp * sp;
    for (const c of rb.B) c.ph += dt * c.sp * sp;
    rb.bel.ph += dt * rb.bel.sp * sp;
    // onda interna: las frecuencias se desplazan poco a poco por la cinta (el espectro se recorre en triángulo, graves → agudos → graves, así no hay saltos)
    rb.off = (rb.off + dt * rb.sv * (0.7 + 0.8 * wvE) + 1) % 1;
    const es = wvEs, ef = wvEf, ea = wvEa, oy = cy + h * rb.y, kick = 1 + 0.6 * rb.kw * wvK;
    for (let j = 0; j <= WV_NS; j++) {
      const f = tri(j / WV_NS * rb.k + rb.off) * (N - 1), i0 = Math.min(N - 2, Math.floor(f)), t = f - i0, sm = t * t * (3 - 2 * t);
      es[j] = wvS[i0] + (wvS[i0 + 1] - wvS[i0]) * sm;
      ef[j] = wvQ[i0] + (wvQ[i0 + 1] - wvQ[i0]) * sm;
      ea[j] = wvT[i0] + (wvT[i0 + 1] - wvT[i0]) * sm;
    }
    for (const arr of [es, ef, ea]) for (let pass = 0; pass < 6; pass++) {
      let prev = arr[0];
      for (let j = 1; j < WV_NS; j++) { const cur = arr[j]; arr[j] = (prev + 2 * cur + arr[j + 1]) / 4; prev = cur; }
    }
    for (let j = 0; j <= WV_NS; j++) {
      const u = j / WV_NS, tap = 0.3 + 0.7 * Math.pow(Math.sin(Math.PI * u), 0.8);
      const env = es[j] * (1 - rb.m) + ef[j] * rb.m;
      const amp = H * rb.g * tap * ((2 / 3) * wvCurve(env) * kick + (1 / 3) * wvCurve(ea[j]));   // 2/3 respuesta viva (con golpe) + 1/3 acumulada (sin golpes)
      let sa = 0, sb = 0;
      for (const c of rb.A) sa += c.a * Math.sin(TAU * c.f * u + c.ph);
      for (const c of rb.B) sb += c.a * Math.sin(TAU * c.f * u + c.ph);
      let bump = 0;   // golpes viajeros: un bulto que avanza hacia la derecha y se apaga
      for (const pu of wvPul) { const dx = (u - pu.u[ri] - 0.42 * pu.age) / 0.06; if (dx > -3 && dx < 3) bump += pu.a * Math.exp(-pu.age * 1.1) * Math.exp(-dx * dx); }
      const by = H * 0.7 * tap * bump;
      wvA[j] = oy - amp * sa - by;
      wvBo[j] = oy - amp * sb - by * 0.75;
      wvBe[j] = -H * 0.22 * tap * (0.4 + env) * Math.sin(TAU * rb.bel.f * u + rb.bel.ph);
    }
    const grads = [0, 1, 2, 3].map(q => {   // de un borde al otro el tono cambia; a lo ancho, poco
      const hue = rb.dh + ((q + 0.5) / 4 - 0.5) * 50, g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, pal(hue - 16, 75, 58, 1));
      g.addColorStop(0.5, pal(hue, 80, 65, 1));
      g.addColorStop(1, pal(hue + 16, 75, 58, 1));
      return g;
    });
    for (let l = 0; l < WV_L; l++) {
      const t = l / (WV_L - 1), bl = 4 * t * (1 - t);
      ctx.strokeStyle = grads[Math.min(3, Math.floor(t * 4))];
      ctx.globalAlpha = l === 0 || l === WV_L - 1 ? 0.6 : 0.26;
      ctx.beginPath();
      for (let j = 0; j <= WV_NS; j++) {
        const y = wvA[j] + (wvBo[j] - wvA[j]) * t + wvBe[j] * bl, x = x0 + xw * j / WV_NS;
        if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ==========================
// == VISTA ONDA DE SEDA ==
// ==========================
// Las reglas de la Seda (una cinta por franja de frecuencias, graves abajo y agudos arriba, que sigue a su banda como un muelle, ondula a su ritmo y se junta con
// las demás en los extremos) con la estética de la Onda: cada cinta es una malla de líneas finas tendidas entre dos bordes que ondulan algo desfasados (así se
// retuerce), con luz sumada, tonos de la paleta repartidos entre las cintas y la luz de fondo que sube con los golpes de graves.
const SW_L = 22;                      // líneas por cinta
const swk = new Float32Array(SILK);   // nivel suavizado de cada cinta (como en la Seda)
let swT = 0, swAvg = 0, swL = 0, swA = new Float32Array(0), swB = swA;   // swA/swB: los dos bordes de la cinta que se dibuja (se reutilizan)

function drawSilkWave(w, h, dt) {
  const mean = silkBands(swk, dt), kick = (swk[0] + swk[1]) / 2;
  swAvg = follow(swAvg, mean, dt, 2.5);
  swT += dt * (0.22 + swAvg * 1.0);
  const cy = h * 0.62, amp = Math.min(h * 0.17, w * 0.3);
  ctx.fillStyle = '#04040e';
  ctx.fillRect(0, 0, w, h);
  swL = glowLevel(swL, Math.max(Math.min(1, Math.max(0, bass - bassAvg) * 2.8), 0.8 * pulse), dt);
  glowBehind(w, h, cy, swL);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.lineWidth = 0.75;
  const steps = Math.max(24, Math.round(w / 10));
  if (swA.length !== steps + 1) { swA = new Float32Array(steps + 1); swB = new Float32Array(steps + 1); }
  const ya = swA, yb = swB;
  for (let j = 0; j < SILK; j++) {
    const f = j / (SILK - 1), a = Math.min(1, Math.pow(swk[j], 0.8) * 1.5), off = (0.5 - f) * amp * 1.3, k1 = 3 + f * 5, k2 = 8 + f * 9;
    const A = amp * (1 + 0.3 * kick + 0.08 * pulse) * (0.1 + 0.9 * a);
    for (let i = 0; i <= steps; i++) {
      const u = i / steps, t = Math.pow(Math.sin(u * Math.PI), 1.2);
      ya[i] = cy + t * (off + A * (0.75 * Math.sin(u * k1 + swT * 0.8 + j * 0.7) + 0.25 * Math.sin(u * k2 - swT * 1.1 + j * 1.1)));
      yb[i] = cy + t * (off + A * 0.85 * (0.75 * Math.sin(u * k1 + swT * 0.8 + j * 0.7 + 1.4) + 0.25 * Math.sin(u * k2 - swT * 1.1 + j * 1.1 + 2.1)));   // el otro borde, desfasado
    }
    const dh = (j - (SILK - 1) / 2) * 14;   // cada cinta con su tono, de un extremo al otro de la paleta
    const grads = [0, 1, 2].map(q => {
      const hue = dh + (q - 1) * 16, g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, pal(hue - 14, 75, 58, 1));
      g.addColorStop(0.5, pal(hue, 80, 66, 1));
      g.addColorStop(1, pal(hue + 14, 75, 58, 1));
      return g;
    });
    for (let l = 0; l < SW_L; l++) {
      const t = l / (SW_L - 1);
      ctx.strokeStyle = grads[Math.min(2, Math.floor(t * 3))];
      ctx.globalAlpha = (l === 0 || l === SW_L - 1 ? 0.55 : 0.22) * (0.55 + 0.45 * a);   // como en la Seda, la cinta que suena brilla más
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const x = i / steps * w, y = ya[i] + (yb[i] - ya[i]) * t;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ==================
// == VISTA OCÉANO ==
// ==================
// Una gran ola ancha hecha de puntos de luz, vista en diagonal y con la cámara algo ladeada. Una marejada grande cruza todo el ancho de la pantalla y respira con los graves; con cada golpe
// del beat se levanta de golpe (un impulso que luego va cayendo) y lanza hacia ti un frente de ola que la cruza y se apaga. Los puntos de las crestas crecen y brillan, y el desenfoque de
// profundidad (nítidos a media distancia, difusos solo los muy cercanos) da volumen. Los colores salen de la paleta compartida y se reparten entre los puntos (tono base, dos vecinos, uno lejano
// y blanco suave). Sin líneas ni malla y sin techo: la ola sube todo lo que pida la música. Entre golpes, los medios y los agudos mueven la superficie.
const O_M = 150, O_STEP = 0.2, O_ZC = 13, O_ZNEAR = 0.5, O_ZFAR = 15, O_ZFOCUS = 5.5;   // puntos por lado, separación, centro de la malla, límites visibles, distancia a la que todo está nítido
const O_HC = 1.5, O_SPR = 64, O_TILT = 0.45;   // altura de la cámara, lado de los sprites, inclinación de la ola respecto a la pantalla (la cresta va en diagonal)
const O_DH = [0, 52, -52, 115], O_KINDS = 5;   // desviación de tono de cada clase de punto (la quinta es casi blanca)
const oSprites = [];   // [clase][desenfoque] → lienzo con un punto (se repintan cuando cambia el tono)
const oFronts = [];    // frentes de ola lanzados por los golpes: { p: posición (profundidad), a: altura }
let oT = 0, oKick = 0, oK = 0, oSwell = 0;   // oKick: impulso del golpe (cae solo); oK: el mismo suavizado, que es el que se ve (así nada salta de golpe)
let oMid = 0, oHi = 0, oMidP = 0, oHiP = 0;   // medios y agudos suavizados y fase de sus olas (avanzan más deprisa cuanto más suenan)
const oB = new Float32Array(N);   // nivel suavizado de cada barra: la cresta de la ola sube o baja según la zona del espectro que tiene encima

// Puntos con tres grados de desenfoque (0 nítido, 1 suave, 2 muy suave) para cada clase de color
let oSpriteHue = NaN;
function oPaintSprites() {
  if (Math.round(palHue) === oSpriteHue) return;   // solo cuando cambia el tono (un grado)
  oSpriteHue = Math.round(palHue);
  const R = O_SPR / 2, prof = [[1, 1, 0.95, 0.35, 0], [0.9, 0.75, 0.45, 0.14, 0], [0.65, 0.5, 0.28, 0.08, 0]];   // opacidad en 0, .35, .55, .7 y 1 del radio
  for (let k = 0; k < O_KINDS; k++) {
    if (!oSprites[k]) oSprites[k] = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = c.height = O_SPR; return c; });
    const hue = palHue + (k < 4 ? O_DH[k] : 0), sat = k < 4 ? 78 : 25, lig = k < 4 ? 70 : 90;
    for (let b = 0; b < 3; b++) {
      const g2 = oSprites[k][b].getContext('2d'), gr = g2.createRadialGradient(R, R, 0, R, R, R), pr = prof[b];
      [0, 0.35, 0.55, 0.7, 1].forEach((st, i) => gr.addColorStop(st, 'hsla(' + (((hue % 360) + 360) % 360).toFixed(0) + ', ' + sat + '%, ' + (i === 0 ? Math.min(92, lig + 14) : lig) + '%, ' + pr[i] + ')'));
      g2.clearRect(0, 0, O_SPR, O_SPR);
      g2.fillStyle = gr;
      g2.fillRect(0, 0, O_SPR, O_SPR);
    }
  }
}

function drawOcean(w, h, dt) {
  const lv = viz.levels;
  oT += dt;
  // impulso del beat: sube de golpe y cae; con cada golpe sale además un frente de ola desde el fondo
  if (beatNow) {
    oKick = Math.min(2, oKick + 1.1 + 0.8 * Math.min(1, bass * 1.3));
    oFronts.push({ p: O_ZFAR, a: 0.8 + 1.1 * Math.min(1, bass * 1.3) });
    if (oFronts.length > 9) oFronts.shift();
  }
  oKick = Math.max(0, oKick - dt * 2.6);
  oK = follow(oK, oKick, dt, 13, 5);
  oSwell = follow(oSwell, bass, dt, 6);
  for (let i = 0; i < N; i++) oB[i] = follow(oB[i], lv[i], dt, 10, 4);
  for (let f = oFronts.length - 1; f >= 0; f--) {
    const fr = oFronts[f];
    fr.p -= dt * 6; fr.a *= 1 - dt * 0.4;
    if (fr.p < 0.2) oFronts.splice(f, 1);
  }
  let hi = 0, md = 0;
  for (let i = 18; i < N; i++) hi += lv[i];
  for (let i = 6; i < 18; i++) md += lv[i];
  hi /= N - 18; md /= 12;
  // medios y agudos: entre golpes mueven la superficie (ondas que cruzan el mar con los medios y rizado con los agudos), sin tocar la ola grande de los graves
  oMid = follow(oMid, md, dt, 8, 3);
  oHi = follow(oHi, hi, dt, 10, 4);
  oMidP += dt * (0.8 + 3 * oMid);
  oHiP += dt * (1.5 + 5 * oHi);
  const mA = 0.12 + 0.75 * oMid, hA = 0.05 + 1.1 * oHi;
  oPaintSprites();
  const k0 = Math.min(1.4, oK), cx = w / 2, cy = h / 2, horizon = h * (0.31 - 0.01 * k0), F = h * 0.95 * (1 + 0.04 * k0);   // con el golpe la cámara se acerca un poco
  const yaw = 0.62 + 0.1 * Math.sin(oT * 0.07), ca = Math.cos(yaw), sa = Math.sin(yaw);
  const roll = 0.07 + 0.04 * Math.sin(oT * 0.11 + 1);
  const swell = 0.3 + 0.7 * oSwell + 0.7 * k0, zc = 5.4 + 0.7 * Math.sin(oT * 0.25);   // altura y posición de la ola grande
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(roll); ctx.translate(-cx, -cy);
  // fondo oscuro con un leve velo de color hacia el horizonte (se enciende con el impulso)
  const bg = ctx.createLinearGradient(0, 0, 0, h * 1.1);
  bg.addColorStop(0, '#02030a');
  bg.addColorStop(0.4, pal(0, 55, (4 + 2 * oSwell + 2.5 * Math.min(1, oK)).toFixed(1), 1));
  bg.addColorStop(1, '#03040b');
  ctx.fillStyle = bg;
  ctx.fillRect(-w, -h, w * 3, h * 3);
  ctx.restore();
  // los puntos suman luz: el orden no importa. El ladeo de la cámara se aplica a la posición de cada punto con cuentas (son redondos: se ven igual) y no
  // girando el lienzo, porque pintar miles de imágenes giradas es mucho más lento
  ctx.globalCompositeOperation = 'lighter';
  const rc = Math.cos(roll), rs = Math.sin(roll);
  const half = O_M / 2, unit = 0.026 * F, zr = O_ZFAR - O_ZNEAR, k1 = Math.min(1.4, oK);
  for (let j = 0; j <= O_M; j++) {
    const v = (j - half) * O_STEP;
    for (let i = 0; i <= O_M; i++) {
      const u = (i - half) * O_STEP, x = u * ca - v * sa, z = O_ZC + u * sa + v * ca;
      if (z < O_ZNEAR || z > O_ZFAR || x > z * 1.45 + 0.8 || x < -z * 1.45 - 0.8) continue;
      const far = 1 - 0.8 * (z - O_ZNEAR) / zr, sd = z + O_TILT * x;   // sd: posición a lo largo de la ola (la cresta es la línea sd constante, en diagonal)
      const sx = cx + x / z * F;
      if (sx < -60 || sx > w + 60) continue;
      const bi = Math.min(N - 1, Math.floor(Math.abs(sx / w - 0.5) * 2 * N)), spec = 0.5 + 1.2 * ease(oB[bi]);   // graves en el centro, agudos hacia los lados
      let y = 0.06 * Math.sin(x * 0.6 + z * 0.4 + oT * 0.7) + 0.09 * hi * (1 - far * 0.8) * Math.sin(x * 2.6 + z * 2.2 + oT * 3);   // rizado de los agudos: suave y más en el fondo que cerca (cerca hacía muelles)
      y += mA * (0.25 + 0.35 * (1 - far)) * Math.sin(x * 0.9 - z * 0.55 + oMidP * 1.6) + hA * 0.16 * (1 - far * 0.75) * Math.sin(x * 2.1 + z * 1.7 - oHiP * 2.4);   // ondas de medios (anchas, cruzan el mar) y de agudos (más finas)
      y += swell * spec * Math.exp(-((sd - zc) * (sd - zc)) / 5.3);
      for (let f = 0; f < oFronts.length; f++) { const dd = sd - oFronts[f].p; if (dd > -2.6 && dd < 2.6) y += oFronts[f].a * Math.min(1, (O_ZFAR - oFronts[f].p) / 3, oFronts[f].p / 1.5) * (0.5 + 0.8 * ease(oB[bi])) * Math.exp(-dd * dd / 0.9); }
      const sy = horizon + (O_HC - y) / z * F;
      if (sy < -60 || sy > h + 60) continue;   // sin techo: la ola puede subir por encima del horizonte (solo se descarta lo que cae fuera de la pantalla)
      const crest = Math.max(0, Math.min(1, y * 0.6)), blur = Math.abs(Math.log(z / O_ZFOCUS)), lvl = blur < 0.8 ? 0 : blur < 1.4 ? 1 : 2;
      const r = Math.min(20, Math.max(0.9, unit / z * (0.6 + 1.2 * crest + 0.8 * k1 * crest))) * 1.45;
      const kind = (i * 7 + j * 13 + ((i * j) >> 3)) % O_KINDS, fog = Math.pow(1 - (z - O_ZNEAR) / zr, 0.9);
      ctx.globalAlpha = Math.min(1, (0.14 + 0.8 * fog) * (0.3 + 0.7 * crest + 0.35 * k1 * crest + 0.3 * oHi * crest) * (lvl === 2 ? 0.8 : 1) * (z < 1.1 ? (z - O_ZNEAR) / 0.6 : 1));
      const dx = sx - cx, dy = sy - cy;
      ctx.drawImage(oSprites[kind][lvl], cx + dx * rc - dy * rs - r, cy + dx * rs + dy * rc - r, r * 2, r * 2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ===========
// == BUCLE ==
// ===========
let drawn = -1, drawnOn = null;   // vista dibujada en el fotograma anterior y en qué lienzo (el Vórtice parte de fondo limpio si viene de otra o de otro lienzo)
function size() {
  const w = presEl.clientWidth, h = presEl.clientHeight;
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (w * h || 1))));
  const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
  if (presCanvas.width !== cw || presCanvas.height !== ch) { presCanvas.width = cw; presCanvas.height = ch; }
  presCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, dpr };
}

function frame(now) {
  if (!open) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  const { w, h, dpr } = size();
  if (w < 2 || h < 2) return;   // sin tamaño todavía (o ventana minimizada): no hay nada que dibujar
  ctx = presCtx;
  render(w, h, dpr, dt, now);
  if (now - infoAt > 250) { infoAt = now; info(); }
}

// Un fotograma de la vista actual en ctx (w × h en píxeles CSS; dpr: píxeles reales por cada uno)
function render(w, h, dpr, dt, now) {
  const lv = viz.levels;
  if (ctx.canvas !== drawnOn) { drawn = -1; drawnOn = ctx.canvas; }
  analyse(lv, dt, now);
  const c = palColor();
  if (mode === VORTEX) drawVortex(w, h, dt, dpr);
  else if (mode === SILK_MODE) drawSilk(w, h, dt);
  else if (mode === OCEAN) drawOcean(w, h, dt);
  else if (mode === WAVE) drawWave(w, h, dt);
  else if (mode === SILK_WAVE) drawSilkWave(w, h, dt);
  else {
    moveParticles(w, h, dt);
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, w, h);
    if (mode === SPECTRUM) drawSpectrum(w, h, c, lv); else drawRadial(w, h, c, lv, dt);
  }
  drawn = mode;
}

// ==================================
// == TEXTOS Y COPIAS DE LOS CONTROLES ==
// ==================================
const PLAY_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
let playing = null, dragging = null;

// Las copias de los volúmenes no se tocan mientras se están moviendo
function syncRange(copy, orig, label, origLabel) {
  if (dragging !== copy && document.activeElement !== copy && copy.value !== orig.value) copy.value = orig.value;
  copy.disabled = orig.disabled;
  setText(label, origLabel.textContent);
}

// Emisoras: una tarjeta por cada botón de la página (se actualizan en su sitio; se rehacen solo si cambia su número)
let stripCenter = true;   // la activa se centra solo al abrir la presentación (y si se rehace la tira), nunca al elegir otra: la tira no salta
function syncStrip() {
  const src = Array.from(presetsBox.querySelectorAll('.preset:not(.more)'));
  if (presStrip.children.length !== src.length) {
    presStrip.textContent = '';
    src.forEach((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="pn"></span><span class="pf"></span>';
      b.addEventListener('click', e => { e.stopPropagation(); const cur = presetsBox.querySelectorAll('.preset:not(.more)')[i]; if (cur) cur.click(); });
      presStrip.appendChild(b);
    });
    stripCenter = true;
  }
  src.forEach((b, i) => {
    const c = presStrip.children[i];
    c.className = b.className;
    c.disabled = b.disabled;
    setText(c.firstChild, b.querySelector('.pn').textContent);
    setText(c.lastChild, b.querySelector('.pf').textContent);
  });
  const act = presStrip.querySelector('.active');
  if (stripCenter) {   // solo en ese momento: si entonces no hay ninguna activa, la tira se queda donde está
    stripCenter = false;
    if (act) { stopGlide(); presStrip.scrollLeft = act.offsetLeft - (presStrip.clientWidth - act.offsetWidth) / 2; }
  }
}

// Nombre que no cabe (con nombres largos, en los modos que no son el Radial): va de un lado a otro, con una pausa en cada extremo. En el Radial se reparte en varias líneas
let fitKey = '';
const measure = document.createElement('canvas').getContext('2d');
function fitName() {
  const key = presPsText.textContent + '|' + presPs.clientWidth + '|' + mode + '|' + innerWidth + 'x' + innerHeight;
  if (key === fitKey) return;
  fitKey = key;
  const cs = getComputedStyle(presPs);
  if (mode === RADIAL) {
    // Radial: sin marquesina; el tamaño se ajusta para que cada línea quepa dentro del círculo (con un mínimo legible)
    presPs.classList.remove('marquee');
    measure.font = cs.fontWeight + ' 100px ' + cs.fontFamily;
    const wide = Math.max(...presPsText.textContent.split('\n').map(l => measure.measureText(l).width + l.length * 6));   // 6 = letter-spacing .06em a 100px
    const vmin = Math.min(innerWidth, innerHeight), box = parseFloat(cs.maxWidth) || vmin * 0.34;
    presPs.style.fontSize = Math.max(vmin * 0.034, Math.min(vmin * 0.056, box * 100 / wide * 0.96)).toFixed(1) + 'px';
    return;
  }
  presPs.style.fontSize = '';
  const avail = presPs.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const over = presPsText.offsetWidth - avail;
  if (over > 1) {
    presPs.style.setProperty('--dx', -Math.ceil(over) + 'px');
    presPs.style.setProperty('--dur', Math.max(6, over / 35 + 5).toFixed(1) + 's');
    presPs.classList.add('marquee');
  } else presPs.classList.remove('marquee');
}

// En pantalla completa se ve el nombre de la emisora que suena (Radio Madrid); si no tiene uno propio, el nombre corto de la cadena (SER) o el nombre
// En el Radial el nombre se parte en dos líneas desde que tiene unas pocas letras: casi siempre la marca arriba ("LOS40") y la emisora debajo ("Andalucía").
// Se parte por un espacio, buscando líneas parecidas pero con preferencia por dejar la primera palabra sola; si aun así una línea no cabe, el navegador la sigue repartiendo
function twoLines(name) {
  const words = name.match(/\([^)]*\)|\S+/g) || [name];   // un paréntesis ("(Las Pedroñeras)") no se parte
  if (words.length < 2 || name.length < 9) return name;
  let best = 1, bestScore = Infinity;
  for (let k = 1; k < words.length; k++) {
    const score = Math.max(words.slice(0, k).join(' ').length, words.slice(k).join(' ').length) - (k === 1 ? 3 : 0);
    if (score < bestScore) { bestScore = score; best = k; }
  }
  return words.slice(0, best).join(' ') + '\n' + words.slice(best).join(' ');
}

// Fuera del Radial el nombre va en una línea; si no cabe (pasa sobre todo en el móvil: "LOS40 Barcelona") se parte en dos, y solo si aun así no cabe se desplaza
function fitsOneLine(name) {
  const cs = getComputedStyle(presPs), fs = parseFloat(cs.fontSize);
  measure.font = cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily;
  const box = presPs.parentElement, cb = getComputedStyle(box);
  let avail = parseFloat(cs.maxWidth) || innerWidth;
  if (cb.maxWidth !== 'none') avail = Math.min(avail, parseFloat(cb.maxWidth) - parseFloat(cb.paddingLeft) - parseFloat(cb.paddingRight));   // Océano: la ventana de cristal
  avail -= parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  return measure.measureText(name).width + name.length * fs * 0.06 <= avail;   // 0,06 = letter-spacing
}

// en pantalla completa, "SER Web" es "SER": el Web sobra
function presName() {
  const st = shownStation();
  return st ? emisoraName(st, shownVariant(), true).replace(/\s+web$/i, '') || emisoraName(st, shownVariant(), true) : '—';
}
function info() {
  const name = presName();
  setText(presPsText, mode === RADIAL || !fitsOneLine(name) ? twoLines(name) : name);
  presPs.classList.toggle('pending', S.pending);
  fitName();
  setText(presQual, S.current ? [S.quality, S.degraded ? 'sin EQ' : ''].filter(Boolean).join(' • ') : '');
  setText(presClock, clockEl.textContent);
  const on = !stop.disabled;
  if (on !== playing) {
    playing = on;
    presPlay.innerHTML = on ? PAUSE_ICON : PLAY_ICON;
    presPlay.setAttribute('aria-label', on ? 'Detener' : 'Reproducir');
  }
  presPlay.disabled = on ? stop.disabled : toggle.disabled;
  syncRange(presVol, volume, presVolValue, volValue);
  syncRange(presNewsVol, newsVolume, presNewsVolValue, newsVolValue);
  presNews.checked = newsToggle.checked;
  presNews.disabled = newsToggle.disabled;
  presNewsSw.classList.toggle('wont', newsBox.classList.contains('wont'));
  syncStrip();
}

presPlay.addEventListener('click', () => (playing ? stop : toggle).click());
[[presVol, volume], [presNewsVol, newsVolume]].forEach(([copy, orig]) => {
  copy.addEventListener('input', () => { orig.value = copy.value; orig.dispatchEvent(new Event('input')); });
  copy.addEventListener('pointerdown', () => { dragging = copy; });
});
window.addEventListener('pointerup', () => { dragging = null; });
window.addEventListener('pointercancel', () => { dragging = null; });
presNews.addEventListener('change', () => { newsToggle.checked = presNews.checked; newsToggle.dispatchEvent(new Event('change')); });
// La tira de emisoras se mueve con la rueda (también con deltas en líneas, como en Firefox) y arrastrándola con el ratón; al soltarla sigue un poco
// con la velocidad que llevaba y frena poco a poco (inercia, como la que pone el navegador al deslizar con el dedo)
presStrip.addEventListener('wheel', e => {
  stopGlide();
  const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? presStrip.clientWidth : 1;
  presStrip.scrollLeft += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * k;
  e.preventDefault();
}, { passive: false });
let stripDrag = null, stripDragged = false;
let glide = 0, glideV = 0, glidePos = 0, glideT = 0;   // inercia: velocidad (px/s, en el sentido del ratón) y posición con decimales
const GLIDE_FRICTION = 4;   // cuánto frena (más = se para antes); con un arrastre rápido recorre del orden de media pantalla
function stopGlide() { if (glide) { cancelAnimationFrame(glide); glide = 0; } }
function glideStep(now) {
  const dt = Math.min(0.05, (now - glideT) / 1000);
  glideT = now;
  const max = presStrip.scrollWidth - presStrip.clientWidth;
  glidePos = Math.max(0, Math.min(max, glidePos - glideV * dt));
  presStrip.scrollLeft = glidePos;
  glideV *= Math.exp(-GLIDE_FRICTION * dt);
  glide = Math.abs(glideV) > 15 && glidePos > 0 && glidePos < max ? requestAnimationFrame(glideStep) : 0;   // se para al frenar o al llegar a un extremo
}
presStrip.addEventListener('pointerdown', e => {
  stopGlide();   // tocar la tira mientras se desliza la para
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  stripDrag = { x: e.clientX, left: presStrip.scrollLeft, moved: false, pts: [[e.timeStamp, e.clientX]] };
});
presStrip.addEventListener('pointermove', e => {
  if (!stripDrag) return;
  const dx = e.clientX - stripDrag.x;
  if (!stripDrag.moved && Math.abs(dx) > 5) { stripDrag.moved = true; presStrip.setPointerCapture(e.pointerId); presStrip.classList.add('dragging'); }
  if (stripDrag.moved) presStrip.scrollLeft = stripDrag.left - dx;
  const pts = stripDrag.pts;
  pts.push([e.timeStamp, e.clientX]);
  while (pts.length > 2 && e.timeStamp - pts[0][0] > 100) pts.shift();   // la velocidad, con los últimos 100 ms
});
const endStripDrag = e => {
  if (stripDrag && stripDrag.moved && e.type === 'pointerup') {
    const pts = stripDrag.pts, [t0, x0] = pts[0], [t1, x1] = pts[pts.length - 1];
    // si el ratón ya estaba quieto al soltar, no hay inercia
    glideV = t1 > t0 && e.timeStamp - t1 < 60 ? (x1 - x0) / (t1 - t0) * 1000 : 0;
    if (Math.abs(glideV) > 150) { glidePos = presStrip.scrollLeft; glideT = performance.now(); glide = requestAnimationFrame(glideStep); }
  }
  if (stripDrag && stripDrag.moved) { stripDragged = true; setTimeout(() => { stripDragged = false; }, 60); }   // el clic que sigue a un arrastre no elige emisora
  stripDrag = null;
  presStrip.classList.remove('dragging');
};
presStrip.addEventListener('pointerup', endStripDrag);
presStrip.addEventListener('pointercancel', endStripDrag);
presStrip.addEventListener('click', e => { if (stripDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
[presCtl, presStrip].forEach(el => el.addEventListener('click', e => e.stopPropagation()));   // tocar un panel no cambia la vista

// ==========================
// == ENTRAR, SALIR Y MODO ==
// ==========================
// Los paneles salen con el ratón en su zona; en pantallas táctiles, mientras no pase el tiempo sin tocar nada
const ptr = { x: -1, y: -1, touch: false };
function layoutPanels() {
  const idle = presEl.classList.contains('idle');
  presEl.classList.toggle('show-top', ptr.touch ? !idle : ptr.x >= 0 && ptr.x < TOP_ZONE.w && ptr.y < TOP_ZONE.h);
  presEl.classList.toggle('show-bottom', ptr.touch ? !idle : ptr.y >= 0 && ptr.y > presEl.clientHeight - BOTTOM_ZONE);
}
function poke(e) {
  if (e && e.clientX !== undefined) { ptr.x = e.clientX; ptr.y = e.clientY; ptr.touch = e.pointerType === 'touch'; }
  presEl.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { presEl.classList.add('idle'); layoutPanels(); }, IDLE_MS);
  layoutPanels();
}

function setMode(m) {
  mode = (m + MODES.length) % MODES.length;
  try { localStorage.setItem(MODE_KEY, MODES[mode]); } catch (_) {}
  presEl.dataset.mode = String(mode);
  presMode.textContent = MODES[mode];
  syncStereo();
  presMode.classList.add('show');
  clearTimeout(modeTimer);
  modeTimer = setTimeout(() => presMode.classList.remove('show'), 1600);
}

// La pantalla no se apaga mientras dura la presentación (si el navegador lo permite)
async function lockScreen() {
  try {
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => { wake = null; });
  } catch (_) { wake = null; }
}

function openPres(full) {
  if (open) return;
  open = true;
  fsUsed = !!full;
  presEl.hidden = false;
  presEl.dataset.mode = String(mode);
  syncStereo();
  last = performance.now();
  infoAt = 0;
  stripCenter = true;   // la tira se abre con la activa en el centro
  syncPipAction();
  ptr.x = ptr.y = -1;
  ptr.touch = false;
  raf = requestAnimationFrame(frame);
  poke();
  if (full && presEl.requestFullscreen) presEl.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});   // sin pantalla completa real, la capa cubre la ventana
  lockScreen();
}

function closePres() {
  if (!open) return;
  open = false;
  syncStereo();
  syncPipAction();
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});   // la ventana flotante es de la presentación: se cierra con ella
  cancelAnimationFrame(raf);
  stopGlide();
  drawn = -1;
  clearTimeout(idleTimer);
  presEl.hidden = true;
  presEl.classList.remove('show-top', 'show-bottom');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (wake) { wake.release().catch(() => {}); wake = null; }
}

presOpen.addEventListener('click', e => { e.stopPropagation(); openPres(true); });
presExpand.addEventListener('click', e => { e.stopPropagation(); openPres(false); });
for (const b of [presOpen, presExpand]) b.addEventListener('keydown', e => e.stopPropagation());
presClose.addEventListener('click', e => { e.stopPropagation(); closePres(); });
presEl.addEventListener('pointermove', poke);
let idleAtDown = false;   // con los controles escondidos, el primer toque solo los muestra
presEl.addEventListener('pointerdown', e => { idleAtDown = presEl.classList.contains('idle'); poke(e); });
presEl.addEventListener('pointerleave', () => { ptr.x = ptr.y = -1; layoutPanels(); });
presEl.addEventListener('click', e => {
  const wasIdle = idleAtDown;
  idleAtDown = false;
  poke(e);
  if (!wasIdle) setMode(mode + 1);
});
document.addEventListener('keydown', e => {
  if (!open) return;
  if (e.key === 'Escape') closePres();
  else if (e.target.closest && e.target.closest('input, button')) return;   // en los controles, las flechas y el espacio son suyos
  else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); setMode(mode + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); setMode(mode - 1); }
});
// (con la imagen en imagen abierta, salir de la pantalla completa no cierra la presentación: en el móvil se sale al minimizar, y la ventana la necesita)
document.addEventListener('fullscreenchange', () => { if (open && fsUsed && !document.fullscreenElement && !pipOn) closePres(); });
document.addEventListener('visibilitychange', () => { if (open && !document.hidden && !wake) lockScreen(); });

// ======================
// == IMAGEN EN IMAGEN ==
// ======================
// La ventana flotante del navegador solo admite vídeo: la vista se dibuja en un lienzo propio (16:9; 1:1 en el Radial y el Vórtice), que se convierte
// en un vídeo mudo (captureStream) y es ese vídeo el que va a la ventana. El sonido sigue saliendo de la página. Es cosa de la presentación: se abre
// con el botón de al lado de la ✕ (y se cierra con el mismo) o, con el interruptor "Imagen en imagen" activado (por defecto) y la presentación abierta,
// sola al cambiar de pestaña o minimizar cuando el navegador lo permite (Chrome llama entonces a la acción "enterpictureinpicture" de Media Session).
// Salir de la presentación la cierra. Los botones de la ventana son los de la notificación: pausa y reanuda, y anterior y siguiente cambian de emisora.
// Con la página oculta el navegador no da fotogramas (requestAnimationFrame), así que la ventana lleva su propio ritmo con un temporizador y pone ella
// al día los niveles (viz.tick). Si se está viendo la presentación, la ventana copia su lienzo (recortado a su forma) en vez de dibujar otra vez: las
// vistas no avanzan dos veces.
const PIP_KEY = 'rn_pip';                     // '0' = no se abre sola (el botón sigue funcionando)
const PIP_TEXTS = true;                       // nombre de la emisora (y en el Radial la hora) sobre el dibujo; false = solo el dibujo
const PIP_WIDE = [854, 480], PIP_SQUARE = [480, 480];   // tamaño del lienzo (px)
const PIP_FPS = 30;
const pipOk = !!(document.pictureInPictureEnabled && HTMLCanvasElement.prototype.captureStream);
const pipCanvas = document.createElement('canvas'), pipCtx = pipCanvas.getContext('2d');
let pipOn = false, pipVideo = null, pipTimer = 0, pipLast = 0, pipFont = '';

function pipTick() {
  pipTimer = setTimeout(pipTick, 1000 / PIP_FPS);
  const now = performance.now(), dt = Math.min(0.05, (now - pipLast) / 1000 || 1 / PIP_FPS);
  pipLast = now;
  if (document.hidden) viz.tick(now);   // sin fotogramas del navegador, los niveles no se moverían
  const [w, h] = mode === RADIAL || mode === VORTEX ? PIP_SQUARE : PIP_WIDE;
  if (pipCanvas.width !== w || pipCanvas.height !== h) { pipCanvas.width = w; pipCanvas.height = h; drawnOn = null; }
  pipCtx.setTransform(1, 0, 0, 1, 0, 0);
  if (open && !document.hidden && presCanvas.width > 1) {
    // la presentación se está dibujando: se copia su lienzo, centrado y recortado a la forma de la ventana
    const sw = presCanvas.width, sh = presCanvas.height, k = Math.max(w / sw, h / sh);
    pipCtx.drawImage(presCanvas, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k);
  } else {
    ctx = pipCtx;
    render(w, h, 1, dt, now);
    ctx = presCtx;
  }
  if (PIP_TEXTS) pipTexts(w, h);
}

// Los textos de cada vista (en pantalla completa son de la página, no del dibujo): el nombre arriba (en el Océano, en su ventana de cristal);
// en el Radial, el nombre y la hora en el centro; el Vórtice, sin textos
function pipTexts(w, h) {
  if (mode === VORTEX) return;
  if (!pipFont) pipFont = getComputedStyle(document.body).fontFamily;
  const c = pipCtx, name = presName();
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const font = (px, weight = 750) => { c.font = weight + ' ' + px.toFixed(1) + 'px ' + pipFont; };
  const fit = (text, px, max, weight) => { font(px, weight); const tw = c.measureText(text).width; if (tw > max) font(px * max / tw, weight); };   // reduce la letra si no cabe
  const glow = () => { c.shadowColor = rgba(palColor(), 0.55); c.shadowBlur = h * 0.03; };
  if (mode === RADIAL) {
    const lines = twoLines(name).split('\n'), px = h * 0.056, lh = px * 1.15, clock = clockEl.textContent;
    const y0 = h / 2 - (lines.length * lh + px * 0.75) / 2 + lh / 2;
    c.fillStyle = '#f1f5f9';
    glow();
    lines.forEach((ln, i) => { fit(ln, px, h * 0.34, 750); c.fillText(ln, w / 2, y0 + i * lh); });
    c.shadowBlur = 0;
    c.fillStyle = '#cbd5e1';
    font(px * 0.62, 600);
    c.fillText(clock, w / 2, y0 + lines.length * lh + px * 0.1);
  } else if (mode === OCEAN) {
    const px = h * 0.075;
    fit(name, px, w * 0.8, 750);
    const tw = c.measureText(name).width, bw = tw + px * 1.6, bh = px * 1.6, x = (w - bw) / 2, y = h * 0.07;
    c.fillStyle = 'rgba(14, 18, 28, .5)';
    c.strokeStyle = 'rgba(255, 255, 255, .12)';
    c.lineWidth = 1;
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, bw, bh, px * 0.45); else c.rect(x, y, bw, bh);
    c.fill();
    c.stroke();
    c.fillStyle = '#f1f5f9';
    glow();
    c.fillText(name, w / 2, y + bh / 2);
  } else {
    c.fillStyle = '#f1f5f9';
    glow();
    fit(name, h * 0.13, w * 0.92, 750);
    c.fillText(name, w / 2, h * 0.15);
  }
  c.restore();
}

async function pipOpen() {
  if (!pipOk || document.pictureInPictureElement) return;
  if (!pipVideo) {
    pipVideo = document.createElement('video');
    pipVideo.muted = true;
    pipVideo.playsInline = true;
    pipVideo.setAttribute('aria-hidden', 'true');
    pipVideo.style.cssText = 'position: fixed; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none;';
    pipVideo.addEventListener('leavepictureinpicture', pipStop);
    document.body.appendChild(pipVideo);
  }
  pipOn = true;
  syncStereo();
  clearTimeout(pipTimer);
  pipLast = performance.now();
  pipTick();   // el primer fotograma ya está antes de pedir la ventana
  if (!pipVideo.srcObject) pipVideo.srcObject = pipCanvas.captureStream(PIP_FPS);
  try {
    await pipVideo.play();
    await pipVideo.requestPictureInPicture();
  } catch (_) { pipStop(); }
}

// Al cerrarse la ventana se deja de dibujar y se suelta el vídeo
function pipStop() {
  if (!pipOn) return;
  pipOn = false;
  clearTimeout(pipTimer);
  pipTimer = 0;
  if (pipVideo && pipVideo.srcObject) { pipVideo.srcObject.getTracks().forEach(t => t.stop()); pipVideo.srcObject = null; }
  syncStereo();
}

// Interruptor "Imagen en imagen" (en el panel de volúmenes y en su copia de la presentación): si está activado y la presentación está abierta, el navegador
// puede abrir la ventana solo
let pipAuto = true;
try { pipAuto = localStorage.getItem(PIP_KEY) !== '0'; } catch (_) {}
function syncPipAction() {
  if (!pipOk) return;
  try { navigator.mediaSession.setActionHandler('enterpictureinpicture', pipAuto && open ? () => { pipOpen(); } : null); } catch (_) {}   // navegadores sin esta acción: solo el botón
}
function setPipAuto(on, save) {
  pipAuto = on;
  if (save) { try { localStorage.setItem(PIP_KEY, on ? '1' : '0'); } catch (_) {} }
  pipToggle.checked = presPip.checked = on;
  syncPipAction();
}
if (pipOk) {
  presPipBtn.hidden = pipRow.hidden = presPipRow.hidden = false;
  setPipAuto(pipAuto, false);
  for (const t of [pipToggle, presPip]) t.addEventListener('change', () => setPipAuto(t.checked, true));
  presPipBtn.addEventListener('click', e => {
    e.stopPropagation();   // no cambia de vista
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {}); else pipOpen();
    presPipBtn.blur();     // que el teclado vuelva a cambiar de vista
  });
}
