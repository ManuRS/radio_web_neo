// =======================
// == MODO PRESENTACIÓN ==
// =======================
// Pantalla completa con las barras como protagonistas (botón en la esquina del visualizador). Seis vistas, que se cambian tocando la pantalla:
// "Espectro" (barras grandes con reflejo, picos que caen, halo que late con los graves y partículas), "Radial" (las barras en círculo
// alrededor de la emisora) y "Vórtice" (sin barras: la forma de onda real del audio dibujada en anillo y con realimentación, que la convierte
// en un túnel que gira y se dispara con los golpes) y "Seda" (cintas de luz finas que ondulan despacio, la vista tranquila) y "Onda" (una cinta de hilos de luz como la forma de onda de una voz) y "Océano" (un mar de puntos de luz con desenfoque de profundidad, en diagonal, con olas hechas con el sonido que viajan hacia ti). Todas comparten una paleta de colores suaves que va cambiando de tono, más deprisa cuanto más rápido es el tempo. Lee los niveles del visualizador normal (viz.levels) y no toca el audio. Con el ratón arriba a la izquierda aparece el
// control (reproducir, volúmenes y boletines) y abajo las emisoras; en pantallas táctiles, ambos al tocar. Son copias de los controles de la
// página, que se mantienen al día con ellos.

import { S } from './state.js';
import {
  newsBox, newsToggle, newsVolume, newsVolValue, clockEl, presetsBox, stop, toggle, volume, volValue,
  presCanvas, presClock, presClose, presCtl, presEl, presMode, presNews, presNewsSw, presNewsVol, presNewsVolValue, presOpen, presExpand,
  presPlay, presPs, presPsText, presQual, presStrip, presVol, presVolValue
} from './dom.js';
import { setText } from './ui.js';
import { viz } from './audio.js';
import { shownStation, shownVariant } from './stations.js';
import { emisoraName } from './utils.js';
import { mix, shade } from './viz.js';

const MODE_KEY = 'rn_pres';
const MODES = ['Espectro', 'Onda', 'Océano', 'Radial', 'Vórtice', 'Seda'];
const [SPECTRUM, WAVE, OCEAN, RADIAL, VORTEX, SILK_MODE] = MODES.map((_, i) => i);
const IDLE_MS = 4000;       // sin tocar nada, se esconden el botón de salir, el puntero y (en pantallas táctiles) los paneles
const TOP_ZONE = { w: 340, h: 230 };   // con el ratón en esta esquina (px) aparece el control
const BOTTOM_ZONE = 150;               // y con el ratón a esta distancia del borde inferior (px), las emisoras
const MAX_PIXELS = 2.6e6;   // tope de píxeles del canvas en pantallas grandes
const PEAK_HOLD_S = 0.35;   // tiempo que se queda cada pico arriba antes de caer
const N = viz.levels.length;
const WIDE = 15;            // bandas (de las 36) que cuentan para el bote del círculo del Radial: graves y medios bajos
const NARROW_PX = 600;      // por debajo de este ancho (móvil en vertical) el espectro lleva menos barras

const ctx = presCanvas.getContext('2d');
let mode = 0;
// Se guarda el nombre de la vista (antes, su número en el orden de entonces: 0 Espectro, 1 Radial, 2 Vórtice, 3 Seda)
try {
  const saved = localStorage.getItem(MODE_KEY), old = ['Espectro', 'Radial', 'Vórtice', 'Seda'];
  mode = Math.max(0, MODES.indexOf(/^\d+$/.test(saved || '') ? old[+saved] : saved));
} catch (_) {}
let fsUsed = false, open = false, raf = 0, last = 0, infoAt = 0, wake = null, idleTimer = 0, modeTimer = 0;

const rgba = (hex, a) => 'rgba(' + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',') + ',' + a + ')';
const ease = l => Math.pow(l, 1.4);   // los niveles bajos se notan menos y los picos destacan más
const rounded = (x, y, w, h, r) => { if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };

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
  energy += (e - energy) * Math.min(1, dt * 6);
  bass += (b - bass) * Math.min(1, dt * 11.5);
  // golpe: los graves superan con claridad su nivel medio reciente
  const prevBeat = beatAt;
  if (b > bassAvg * 1.2 + 0.04 && b > 0.3 && now - beatAt > 170) { pulse = 1; beatAt = now; beatNow = true; }
  if (beatNow && prevBeat) tempoBeat(now - prevBeat, now);
  bassAvg += (b - bassAvg) * Math.min(1, dt * 1.5);
  // golpe suave para el círculo del Radial: subida de los graves (como antes) o de una banda más ancha (graves y medios bajos: cajas, voces, guitarras), que se recupera enseguida y
  // deprisa, así que salta muchas más veces que el golpe de graves
  let wv = 0;
  for (let i = 0; i < WIDE; i++) wv += lv[i];
  wv /= WIDE;
  wide += (wv - wide) * Math.min(1, dt * 14);
  punch = Math.min(1, Math.max(0, (b - bassAvg) * 4.6, (wide - wideAvg) * 3.4));   // el bombo pesa más que el resto de la banda
  wideAvg += (wide - wideAvg) * Math.min(1, dt * 2.2);
  pulse = Math.max(0, pulse - dt * 3.2);
  spin += dt * (0.25 + energy * 2.5);
  if (now - beatAt > 3000) tempo += (0 - tempo) * Math.min(1, dt * 0.2);   // sin golpes de graves, el tempo se olvida poco a poco
  movePalette(dt);
  // picos: suben con la barra, se quedan un momento y caen acelerando
  for (let i = 0; i < N; i++) {
    if (lv[i] >= peaks[i]) { peaks[i] = lv[i]; hold[i] = PEAK_HOLD_S; fall[i] = 0; }
    else if (hold[i] > 0) hold[i] -= dt;
    else { fall[i] += dt * 2.4; peaks[i] = Math.max(lv[i], peaks[i] - fall[i] * dt); }
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
    ctx.arc(p.x, p.y, p.r * (1 + energy * 1.4), 0, 6.2832);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function halo(w, h, cx, cy, radius, c) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, rgba(c, 0.08 + 0.3 * bass + 0.22 * pulse));
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
  palVel += ((4 + 20 * tn + 10 * energy + 26 * palBoost) * 0.85 - palVel) * Math.min(1, dt * 0.9);   // 0,85: un 15% más lento que el ritmo base
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
function group(src, n) {
  const k = src.length / n, out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let t = 0; for (let j = 0; j < k; j++) t += src[i * k + j]; out[i] = t / k; }
  return out;
}
function drawSpectrum(w, h, c, levels) {
  const narrow = w < NARROW_PX, n = narrow ? N / 3 : N, lv = n === N ? levels : group(levels, n), pk = n === N ? peaks : group(peaks, n);
  const base = h * 0.8, maxH = h * (narrow ? 0.4 : 0.5), margin = w * 0.06, usable = w - margin * 2;
  const gap = usable / n * 0.28, bw = (usable - gap * (n - 1)) / n;
  halo(w, h, w / 2, base, Math.max(w, h) * (0.45 + 0.1 * pulse), c);
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
function drawRadial(w, h, c, lv) {
  const cx = w / 2, cy = h / 2, m = Math.min(w, h), R = m * 0.19, maxLen = m * 0.26, lw = Math.max(3, 2 * Math.PI * R / (2 * N) * 0.55);
  // luz de fondo: late con cada golpe (el mismo `punch` que el círculo) y además se ensancha, así que se nota bien entre golpes y con cada uno
  const hg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * (0.5 + 0.28 * punch + 0.12 * pulse));   // radio sobre el lado largo: en pantallas anchas la luz llega hasta los bordes
  hg.addColorStop(0, rgba(c, Math.min(0.5, 0.04 + 0.34 * punch + 0.18 * pulse + 0.08 * bass)));
  hg.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, w, h);
  drawParticles(c);
  // círculo interior: reacciona a cada subida de los graves por encima de su nivel reciente (no a su nivel, que con música densa es alto siempre), así late con cada
  // golpe y entre golpes vuelve a quedarse en reposo, sin color de fondo permanente; en cada golpe fuerte suelta además una onda
  const kb = punch, rr = R * (1 + 0.5 * kb + 0.2 * pulse);   // recorrido amplio: en un golpe fuerte el círculo crece hasta un 70%
  if (kb > 0.02 || pulse > 0.02) {
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    core.addColorStop(0, rgba(c, 0.18 * kb + 0.1 * pulse));
    core.addColorStop(1, rgba(c, 0.4 * kb + 0.25 * pulse));
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832); ctx.fill();
  }
  if (pulse > 0.02) {
    ctx.strokeStyle = rgba(c, 0.5 * pulse);
    ctx.lineWidth = 2 + 4 * pulse;
    ctx.beginPath(); ctx.arc(cx, cy, rr * (1 + (1 - pulse) * 0.45), 0, 6.2832); ctx.stroke();
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(c, 0.14 + 0.2 * kb + 0.1 * pulse);
  ctx.lineWidth = lw * (2.4 + 1.0 * kb);
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832); ctx.stroke();
  ctx.strokeStyle = rgba(c, 0.55 + 0.35 * kb);
  ctx.lineWidth = 2 + 1.5 * kb;
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832); ctx.stroke();
  ctx.save();
  ctx.setLineDash([1, 15]);
  ctx.lineDashOffset = -spin * 40;
  ctx.strokeStyle = rgba(c, 0.5);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, R + maxLen * 1.12, 0, 6.2832); ctx.stroke();
  ctx.restore();
  // barras en círculo: graves abajo, agudos arriba, iguales a izquierda y derecha
  ctx.lineWidth = lw;
  const dark = shade(c, 0.7);
  for (let i = 0; i < N; i++) {
    const l = ease(lv[i]), len = 3 + l * maxLen, a = i / (N - 1) * Math.PI;
    ctx.strokeStyle = mix(dark, '#ffffff', l * 0.6);
    ctx.beginPath();
    for (const s of [1, -1]) {
      const t = Math.PI / 2 - s * a, cos = Math.cos(t), sin = Math.sin(t), r0 = R + (rr - R) * 0.3 + lw;   // las barras se apartan solo en parte, para no salirse de la pantalla
      ctx.moveTo(cx + cos * r0, cy + sin * r0);
      ctx.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
    }
    ctx.stroke();
  }
  // puntas de los picos
  ctx.fillStyle = mix(c, '#ffffff', 0.75);
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    if (peaks[i] <= 0.03) continue;
    const a = i / (N - 1) * Math.PI, d = rr + lw + 3 + ease(peaks[i]) * maxLen + lw;
    for (const s of [1, -1]) {
      const t = Math.PI / 2 - s * a;
      ctx.moveTo(cx + Math.cos(t) * d + lw / 3, cy + Math.sin(t) * d);
      ctx.arc(cx + Math.cos(t) * d, cy + Math.sin(t) * d, lw / 3, 0, 6.2832);
    }
  }
  ctx.fill();
}

// ===================
// == VISTA VÓRTICE ==
// ===================
// Cada fotograma parte del anterior, ampliado y girado un poco y algo más oscuro (así lo dibujado se aleja en espiral y deja estela), y sobre él se
// dibuja con luz sumada: un anillo con la forma de onda real, un bucle de fase (la señal frente a ella misma unos instantes después) y, con cada
// golpe de graves, un estallido de rayos y un destello. El color es el de la paleta compartida; el giro se invierte de vez en cuando.
const TAU = 6.2832, RING = 256;
let wave = new Float32Array(2048), env = 0.1, wgain = 3, dir = 1, beats = 0, drawn = -1;

function drawVortex(w, h, dt, dpr) {
  const m = Math.min(w, h), cx = w / 2, cy = h / 2, an = viz.analyser, cw = presCanvas.width, ch = presCanvas.height;
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
  wgain += (Math.min(8, 0.9 / Math.max(env, 0.04)) - wgain) * Math.min(1, dt * 3);
  if (beatNow) { beats++; if (beats % 7 === 0) dir = -dir; }
  // realimentación: el fotograma anterior, ampliado, girado y apagado un poco
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (drawn !== VORTEX) { ctx.fillStyle = '#030408'; ctx.fillRect(0, 0, cw, ch); }   // al entrar en esta vista se parte de fondo limpio
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(dir * dt * (0.08 + energy * 0.7 + pulse * 0.5));
  const zoom = 1 + dt * (0.3 + bass * 1.7 + pulse * 1.3);
  ctx.scale(zoom, zoom);
  ctx.translate(-cw / 2, -ch / 2);
  ctx.drawImage(presCanvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(3, 4, 8, 0.07)';
  ctx.fillRect(0, 0, cw, ch);
  // luz nueva, sumada a lo que ya hay
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = ctx.lineCap = 'round';
  const R = m * (0.11 + 0.07 * bass + 0.05 * pulse), amp = m * 0.13, step = Math.floor(wave.length / RING), light = 62 + pulse * 14;
  ctx.strokeStyle = pal(0, 75, light, 1);
  ctx.lineWidth = 1.5 + bass * 5 + pulse * 4;
  ctx.beginPath();
  for (let i = 0; i <= RING; i++) {
    const k = i % RING, a = k / RING * TAU + spin * 0.6, r = R + wave[k * step] * wgain * amp;
    if (i) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.stroke();
  const d = 6 + Math.floor(energy * 40), q = -spin * 0.9, cq = Math.cos(q), sq = Math.sin(q), R2 = m * 0.17;
  ctx.strokeStyle = pal(150, 70, 66, 1);
  ctx.lineWidth = 1.2 + energy * 3;
  ctx.beginPath();
  for (let i = 0; i < RING; i++) {
    const j = i * step, x = wave[j] * wgain, y = wave[(j + d) % wave.length] * wgain, px = cx + (x * cq - y * sq) * R2, py = cy + (x * sq + y * cq) * R2;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.stroke();
  if (beatNow) {
    ctx.lineWidth = 2 + bass * 4;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * TAU, r0 = R * 1.1, r1 = R + m * (0.08 + Math.random() * 0.22);
      ctx.strokeStyle = pal(Math.random() * 70, 75, 72, 1);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    }
    ctx.fillStyle = pal(0, 75, 64, 0.06);
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

function drawSilk(w, h, dt) {
  const lv = viz.levels, per = N / SILK;
  let sum = 0;
  // Cada cinta sigue a su banda como un muelle amortiguado: sube rápido (más reactiva) y baja a un ritmo propio y continuo, sin mesetas
  // ni cortes; así responde a cada golpe pero el movimiento no da trompicones
  for (let j = 0; j < SILK; j++) {
    let v = 0;
    for (let i = 0; i < per; i++) v += lv[Math.floor(j * per) + i];
    v /= per;
    sk[j] += (v - sk[j]) * Math.min(1, dt * (v > sk[j] ? 14 : 3.6));
    sum += sk[j];
  }
  const kick = (sk[0] + sk[1]) / 2;   // los graves, suavizados
  skAvg += (sum / SILK - skAvg) * Math.min(1, dt * 2.5);
  skT += dt * (0.22 + skAvg * 1.0);
  const hue = palHue, cy = h * 0.62, amp = Math.min(h * 0.17, w * 0.3);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#070a12');
  bg.addColorStop(1, 'hsl(' + hue.toFixed(0) + ', 40%, 11%)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const gl = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.6);
  gl.addColorStop(0, 'hsla(' + hue.toFixed(0) + ', 70%, 55%, ' + (0.08 + 0.4 * kick).toFixed(3) + ')');
  gl.addColorStop(1, 'hsla(' + hue.toFixed(0) + ', 70%, 55%, 0)');
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, w, h);
  if (!stars) { stars = []; for (let i = 0; i < 40; i++) stars.push({ x: Math.random(), y: Math.random() * 0.5, r: 0.6 + Math.random() * 1.2, ph: Math.random() * 6.28 }); }
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
// Una cinta de hilos de luz en el centro, como la forma de onda de una voz: una decena de hebras que ondulan casi a la vez pero desfasadas, así que se abren y se cruzan formando una
// cinta retorcida que brilla donde se juntan. Su altura en cada punto sale del espectro (los graves en el centro y los agudos hacia los extremos, donde se afina hasta cerrarse) y el color
// va del cálido al frío de un lado a otro, con la paleta compartida, y casi blanco en el centro.
const WV_S = 10, WV_E = 9, WV_K = 17;   // hebras, bandas del espectro que forman la altura, puntos de control a lo ancho
const wvB = new Float32Array(WV_E);      // nivel suavizado de cada banda
let wvT = 0, wvPh = 0;
const WV_EDGES = [0, 2, 4, 6, 9, 12, 16, 22, 36];   // reparto de las 36 barras en WV_E bandas (más fino en graves)

function drawWave(w, h, dt) {
  const lv = viz.levels;
  // cada banda sube rápido y baja más despacio
  for (let g = 0; g < WV_E; g++) {
    let v = 0;
    for (let i = WV_EDGES[g]; i < WV_EDGES[g + 1]; i++) v += lv[i];
    v = ease(v / (WV_EDGES[g + 1] - WV_EDGES[g]));
    wvB[g] += (v - wvB[g]) * Math.min(1, dt * (v > wvB[g] ? 16 : 4.2));
  }
  wvT += dt;
  wvPh += dt * (0.9 + energy * 2.2 + pulse * 1.2);
  const cy = h * 0.58, A = Math.min(h * 0.34, w * 0.3), kick = Math.min(1, Math.max(0, bass - bassAvg) * 2.8);
  // fondo: azul casi negro con un velo de color detrás de la cinta
  ctx.fillStyle = '#04040e';
  ctx.fillRect(0, 0, w, h);
  const gl = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.55);
  gl.addColorStop(0, pal(0, 60, 40, (0.1 + 0.3 * energy + 0.25 * kick).toFixed(3)));
  gl.addColorStop(1, pal(0, 60, 40, 0));
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, w, h);
  // altura en los puntos de control: centro = graves; a la derecha se usa otra mezcla de bandas, para que la cinta no sea simétrica
  const ctl = new Float32Array(WV_K), mid = (WV_K - 1) / 2;
  for (let k = 0; k < WV_K; k++) {
    const d = Math.abs(k - mid) / mid, bpos = Math.min(WV_E - 1, d * (WV_E - 1) * (k < mid ? 1 : 0.86) + (k < mid ? 0 : 0.4)), b0 = Math.floor(bpos), f = bpos - b0;
    ctl[k] = wvB[b0] * (1 - f) + wvB[Math.min(WV_E - 1, b0 + 1)] * f;
  }
  const steps = Math.max(40, Math.round(w / 5)), env = new Float32Array(steps + 1), ph1 = new Float32Array(steps + 1), ph2 = new Float32Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, kf = u * (WV_K - 1), k0 = Math.min(WV_K - 2, Math.floor(kf)), t = kf - k0, sm = t * t * (3 - 2 * t);
    const lvl = ctl[k0] * (1 - sm) + ctl[k0 + 1] * sm, win = Math.pow(Math.sin(u * Math.PI), 1.3);
    env[i] = Math.min(1, 0.05 + 1.6 * lvl) * win * (1 + 0.22 * pulse);
    ph1[i] = u * 6.2832 * 3.1 + wvPh + 0.8 * Math.sin(u * 5 + wvT * 0.3);
    ph2[i] = u * 6.2832 * 7.3 - wvPh * 1.4;
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = ctx.lineCap = 'round';
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, pal(-65, 90, 60, 1));
  grad.addColorStop(0.3, pal(-25, 90, 66, 1));
  grad.addColorStop(0.5, pal(0, 35, 88, 1));
  grad.addColorStop(0.7, pal(35, 90, 66, 1));
  grad.addColorStop(1, pal(80, 90, 60, 1));
  ctx.strokeStyle = grad;
  for (let s = 0; s < WV_S; s++) {
    const c = (s - (WV_S - 1) / 2) / ((WV_S - 1) / 2), dl = c * 1.05, k = 1 - 0.35 * Math.abs(c);   // c: -1 .. 1 a lo ancho de la cinta
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const y = cy - A * env[i] * (0.85 * Math.sin(ph1[i] + dl) + 0.18 * Math.sin(ph2[i] + dl * 1.7) * (0.4 + Math.abs(c)));
      if (i) ctx.lineTo(i / steps * w, y); else ctx.moveTo(0, y);
    }
    ctx.globalAlpha = 0.07 * k + 0.05 * kick;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.globalAlpha = (0.38 + 0.45 * k) * (0.8 + 0.2 * energy);
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ==================
// == VISTA OCÉANO ==
// ==================
// Un mar de puntos de luz: una nube de miles de puntos sobre una superficie que ondula con la música, vista en diagonal y con la cámara algo ladeada. Sin líneas ni malla. Los puntos tienen
// desenfoque de profundidad, como en una foto: nítidos a media distancia, y más grandes y difusos los muy cercanos (y algo los lejanos, que además son más pequeños y tenues). Los colores
// salen de la paleta compartida y se reparten entre los puntos (el tono base, dos vecinos, uno más lejano y blanco suave). Las olas nacen lejos con el sonido de ese instante y viajan hacia ti
// (lo cercano es lo que sonó hace un momento): los graves levantan marejadas largas y lentas, los medios olas medianas y los agudos rizado fino; los puntos de las crestas crecen y brillan.
const O_M = 150, O_STEP = 0.2, O_ZC = 13, O_ZNEAR = 0.5, O_ZFAR = 15, O_ZFOCUS = 5.5;   // puntos por lado, separación, centro de la malla, límites visibles, distancia a la que todo está nítido
const O_HIST = 110, O_RATE = 32, O_SPEED = 9, O_PHASE = 4.2, O_HC = 1.5, O_SPR = 64;   // historial del sonido (32 muestras/s), velocidad a la que el sonido viaja hacia ti, velocidad de las crestas, altura de la cámara, lado de los sprites
const O_DH = [0, 52, -52, 115], O_KINDS = 5;   // desviación de tono de cada clase de punto (la quinta es casi blanca)
const oHist = [new Float32Array(O_HIST), new Float32Array(O_HIST), new Float32Array(O_HIST)], oLv = new Float32Array(3);
const oSprites = [];   // [clase][desenfoque] → lienzo con un punto (se repintan cada fotograma con el tono actual)
let oHead = 0, oAcc = 0, oT = 0;
const O_WAVES = [   // [dirección x, z, número de onda, velocidad relativa, alcance]
  [0.375, 0.927, 1.1, 1, 0.95], [-0.469, 0.883, 2.6, 1.12, 0.5], [0.766, 0.643, 6, 1.3, 0.2], [-0.82, 0.57, 9, 1.4, 0.12]
];

function oSample(g, d) {   // nivel del grupo g hace d muestras (interpolado)
  const f = Math.floor(d), r = d - f, hs = oHist[g];
  return hs[(oHead - f + O_HIST * 2) % O_HIST] * (1 - r) + hs[(oHead - f - 1 + O_HIST * 2) % O_HIST] * r;
}

// Puntos con tres grados de desenfoque (0 nítido, 1 suave, 2 muy suave), uno por cada clase de color
function oPaintSprites() {
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
  // tres grupos de bandas, suavizados, que entran en el historial a 32 muestras por segundo
  const groups = [[0, 6], [6, 18], [18, N]];
  for (let g = 0; g < 3; g++) {
    let v = 0;
    for (let i = groups[g][0]; i < groups[g][1]; i++) v += lv[i];
    v = ease(v / (groups[g][1] - groups[g][0]));
    oLv[g] += (v - oLv[g]) * Math.min(1, dt * 12);
  }
  oAcc += dt;
  while (oAcc >= 1 / O_RATE) { oAcc -= 1 / O_RATE; oHead = (oHead + 1) % O_HIST; for (let g = 0; g < 3; g++) oHist[g][oHead] = oLv[g]; }
  oPaintSprites();
  const glow = Math.min(1, bass * 1.4), kick = Math.min(1, Math.max(0, bass - bassAvg) * 2.8);
  const cx = w / 2, cy = h / 2, horizon = h * 0.4, F = h * 0.95;
  const yaw = 0.62 + 0.1 * Math.sin(oT * 0.07), ca = Math.cos(yaw), sa = Math.sin(yaw);
  const roll = 0.07 + 0.04 * Math.sin(oT * 0.11 + 1);
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(roll); ctx.translate(-cx, -cy);
  // fondo oscuro con un leve velo de color hacia el horizonte
  const bg = ctx.createLinearGradient(0, 0, 0, h * 1.1);
  bg.addColorStop(0, '#02030a');
  bg.addColorStop(0.4, pal(0, 55, (6 + 5 * glow + 3 * kick).toFixed(1), 1));
  bg.addColorStop(1, '#03040b');
  ctx.fillStyle = bg;
  ctx.fillRect(-w, -h, w * 3, h * 3);
  // los puntos suman luz: el orden no importa
  ctx.globalCompositeOperation = 'lighter';
  const half = O_M / 2, unit = 0.026 * F, zr = O_ZFAR - O_ZNEAR, lift = 1 + 0.6 * kick;   // lift: todo el mar se levanta un poco con cada golpe de bombo
  for (let j = 0; j <= O_M; j++) {
    const v = (j - half) * O_STEP;
    for (let i = 0; i <= O_M; i++) {
      const u = (i - half) * O_STEP, x = u * ca - v * sa, z = O_ZC + u * sa + v * ca;
      if (z < O_ZNEAR || z > O_ZFAR || x > z * 1.45 + 0.8 || x < -z * 1.45 - 0.8) continue;
      const d = Math.min((O_ZFAR - z) / O_SPEED * O_RATE, O_HIST - 2), far = 1 - 0.8 * (z - O_ZNEAR) / zr;
      const a0 = oSample(0, d), a1 = oSample(1, d), a2 = oSample(2, d), A = [a0, a1, a2, a2];   // lo que sonó en ese punto cuando salió de lejos
      let y = 0.03 * Math.sin(x * 0.7 + z * 0.5 + oT * 0.6);
      for (let q = 0; q < 4; q++) {
        const wv = O_WAVES[q];
        y += A[q] * wv[4] * (q > 1 ? 1.0 * far : 1.7) * Math.sin(wv[2] * (x * wv[0] + z * wv[1]) + wv[2] * O_PHASE * wv[3] * oT + q * 1.7);
      }
      y = 1.15 * Math.tanh(y * lift / 1.15);
      const sx = cx + x / z * F, sy = horizon + (O_HC - y) / z * F;
      if (sy < horizon - 4 || sx < -60 || sx > w + 60 || sy > h + 60) continue;
      const loud = Math.min(1, (a0 * 0.9 + a1 * 0.8 + a2 * 0.6) * 0.9), crest = Math.max(0, Math.min(1, y * 0.9 + 0.15)), blur = Math.abs(Math.log(z / O_ZFOCUS)), lvl = blur < 0.8 ? 0 : blur < 1.4 ? 1 : 2;
      // el tamaño y el brillo de cada punto siguen a lo que suena ahí: donde pasa un golpe, los puntos crecen y se encienden; en los silencios, el mar se queda pequeño y tenue
      const r = Math.min(20, Math.max(0.9, unit / z * (0.7 + 0.8 * loud + 0.4 * crest + 0.3 * kick))) * 1.45;
      const kind = (i * 7 + j * 13 + ((i * j) >> 3)) % O_KINDS, fog = Math.pow(1 - (z - O_ZNEAR) / zr, 0.9);
      ctx.globalAlpha = Math.min(1, (0.12 + 0.8 * fog) * (0.3 + 0.8 * loud + 0.3 * crest) * (lvl === 2 ? 0.8 : 1) * (z < 1.1 ? (z - O_ZNEAR) / 0.6 : 1));
      ctx.drawImage(oSprites[kind][lvl], sx - r, sy - r, r * 2, r * 2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// ===========
// == BUCLE ==
// ===========
function size() {
  const w = presEl.clientWidth, h = presEl.clientHeight;
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (w * h || 1))));
  const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
  if (presCanvas.width !== cw || presCanvas.height !== ch) { presCanvas.width = cw; presCanvas.height = ch; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, dpr };
}

function frame(now) {
  if (!open) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  const { w, h, dpr } = size(), lv = viz.levels;
  analyse(lv, dt, now);
  const c = palColor();
  if (mode === VORTEX) drawVortex(w, h, dt, dpr);
  else if (mode === SILK_MODE) drawSilk(w, h, dt);
  else if (mode === OCEAN) drawOcean(w, h, dt);
  else if (mode === WAVE) drawWave(w, h, dt);
  else {
    moveParticles(w, h, dt);
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, w, h);
    if (mode === SPECTRUM) drawSpectrum(w, h, c, lv); else drawRadial(w, h, c, lv);
  }
  drawn = mode;
  if (now - infoAt > 250) { infoAt = now; info(); }
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
let stripKey = '';
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
    stripKey = '';
  }
  src.forEach((b, i) => {
    const c = presStrip.children[i];
    c.className = b.className;
    c.disabled = b.disabled;
    setText(c.firstChild, b.querySelector('.pn').textContent);
    setText(c.lastChild, b.querySelector('.pf').textContent);
  });
  // la activa se deja a la vista al cambiar
  const act = presStrip.querySelector('.active'), key = act ? Array.prototype.indexOf.call(presStrip.children, act) + ':' + presStrip.children.length : '';
  if (act && key !== stripKey) presStrip.scrollLeft = act.offsetLeft - (presStrip.clientWidth - act.offsetWidth) / 2;
  stripKey = key;
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

function info() {
  const st = shownStation();
  const name = st ? emisoraName(st, shownVariant(), true).replace(/\s+web$/i, '') || emisoraName(st, shownVariant(), true) : '—';   // en pantalla completa, "SER Web" es "SER": el Web sobra
  setText(presPsText, mode === RADIAL ? twoLines(name) : name);
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
// La tira de emisoras se mueve con la rueda (también con deltas en líneas, como en Firefox) y arrastrándola con el ratón
presStrip.addEventListener('wheel', e => {
  const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? presStrip.clientWidth : 1;
  presStrip.scrollLeft += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * k;
  e.preventDefault();
}, { passive: false });
let stripDrag = null, stripDragged = false;
presStrip.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  stripDrag = { x: e.clientX, left: presStrip.scrollLeft, moved: false };
});
presStrip.addEventListener('pointermove', e => {
  if (!stripDrag) return;
  const dx = e.clientX - stripDrag.x;
  if (!stripDrag.moved && Math.abs(dx) > 5) { stripDrag.moved = true; presStrip.setPointerCapture(e.pointerId); presStrip.classList.add('dragging'); }
  if (stripDrag.moved) presStrip.scrollLeft = stripDrag.left - dx;
});
const endStripDrag = () => {
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
  last = performance.now();
  infoAt = 0;
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
  cancelAnimationFrame(raf);
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
document.addEventListener('fullscreenchange', () => { if (open && fsUsed && !document.fullscreenElement) closePres(); });
document.addEventListener('visibilitychange', () => { if (open && !document.hidden && !wake) lockScreen(); });
