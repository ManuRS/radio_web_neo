// ===========
// == AUDIO ==
// ===========
// Todo lo que suena por la página: grafo de Web Audio (normalización, ecualizador, volumen), fundidos de cada deck, sonidos locales y salida degradada.
//
// Cada emisora (deck, ver deck.js) con CORS pasa por Web Audio:
//   emisora -> normalización -> fundido -> bus -> limitador -> mezcla (+ sonidos locales) -> ecualizador -> volumen -> salida
// y el analizador de las barras cuelga del ecualizador. Una emisora sin CORS (modo degradado) sale directa por su <audio>: el volumen y el fundido se
// aplican con audio.volume, sin ecualizador, normalización ni barras reales (las barras son sintéticas).

import { createVisualizer } from './viz.js';
import { S, NORM_MAX_BOOST_DB, NORM_MAX_CUT_DB, NORM_SILENCE_DB, NORM_TARGET_DB, NORM_TAU_S } from './state.js';
import { eqLabel, newsVolume, newsVolValue, vizBox, vizCanvas, volume, volValue } from './dom.js';
import { closeDialog, log, openDialog } from './ui.js';
import { loadSounds } from './sounds.js';
import { wakeAnchor } from './anchor.js';

// ===============================
// == SALIDA DE AUDIO (AJUSTES) ==
// ===============================
// 'webaudio' (con ecualizador, normalización, barras y fundidos exactos) o 'nativa' (el navegador lo saca directamente, sin nada de eso).
// Se elige en los ajustes y se guarda en el navegador
const OUT_KEY = 'rn_salida';
let outMode = 'webaudio';
try { if (localStorage.getItem(OUT_KEY) === 'nativa') outMode = 'nativa'; } catch (_) {}
export const getOutMode = () => outMode;
// Punto del que graba recorder.js: tras la normalización y el ecualizador, antes del volumen (null sin Web Audio)
export const getRecTap = () => eqPre;
export function setOutMode(mode) {
  outMode = mode === 'nativa' ? 'nativa' : 'webaudio';
  try { localStorage.setItem(OUT_KEY, outMode); } catch (_) {}
  log('Salida de audio: ' + (outMode === 'nativa' ? 'nativa' : 'Web Audio'));
  if (outMode === 'nativa') resetEq(); else refreshEq();
}

// ==============
// == DECKS ==
// ==============
// Todos los decks abiertos (la emisora que suena, la que se prepara, la de noticias en espera...)
export const decks = new Set();
export const anyPlaying = () => { for (const d of decks) if (d.isPlaying()) return true; return false; };

export const viz = createVisualizer(vizCanvas, () => !anyPlaying());

let busNode = null, mixNode = null, gainNode = null, analyser = null, lastVol = null;
let eqLow = null, eqMid = null, eqHigh = null, eqPre = null, limiter = null;   // ecualizador (el bloque "eq" de los ajustes; sin él, plano) y limitador

// Volumen activo (0 a 1): el de la música o el de las noticias
const masterVol = () => Number((S.volMode === 'news' ? newsVolume : volume).value);

export function applyVolume() {
  const v = masterVol();
  if (gainNode && v !== lastVol) gainNode.gain.setTargetAtTime(v, S.audioCtx.currentTime, 0.02);
  lastVol = v;
  for (const d of decks) if (!d.wa && d.el) d.el.volume = Math.min(1, Math.max(0, v * d.fadeV));   // modo degradado: el volumen va en el propio <audio>
}

// ===============================
// == GRAFO DE AUDIO WEB (FRESH) ==
// ===============================
// fresh = al pulsar Reproducir: se recrea el contexto (tras cambiar de salida, como unos cascos, el anterior puede quedarse mudo). Solo se hace con
// el audio parado, porque los decks viejos dejarían de sonar
export function initAudioGraph(fresh = false) {
  if (S.audioCtx && !fresh) {
    if (S.audioCtx.state !== 'running') S.audioCtx.resume().catch(() => {});   // suspendido o interrumpido (p. ej. tras una pausa del sistema)
    return;
  }
  if (S.audioCtx) {
    const old = S.audioCtx;
    S.audioCtx = null;
    old.onstatechange = null;
    old.close().catch(() => {});
    busNode = mixNode = gainNode = analyser = null;
    eqLow = eqMid = eqHigh = eqPre = limiter = null;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  lastVol = null;
  if (outMode === 'nativa' || !AC) return;
  try {
    S.audioCtx = new AC({ latencyHint: 'playback' });
    S.audioCtx.onstatechange = () => log('Estado del audio del navegador: ' + S.audioCtx.state);
    busNode = S.audioCtx.createGain();
    limiter = S.audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    mixNode = S.audioCtx.createGain();
    gainNode = S.audioCtx.createGain();
    eqPre = S.audioCtx.createGain();
    eqLow = S.audioCtx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    if (typeof S.eq.lowHz === 'number') eqLow.frequency.value = S.eq.lowHz;
    eqMid = S.audioCtx.createBiquadFilter();
    eqMid.type = 'peaking';
    if (typeof S.eq.midHz === 'number') { eqMid.frequency.value = S.eq.midHz; eqMid.Q.value = S.eq.midQ; }
    eqHigh = S.audioCtx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    if (typeof S.eq.highHz === 'number') eqHigh.frequency.value = S.eq.highHz;
    busNode.connect(limiter);
    limiter.connect(mixNode);
    mixNode.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(eqPre);
    eqPre.connect(gainNode);
    gainNode.connect(S.audioCtx.destination);
    refreshEq(true);
    try {
      analyser = S.audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.78;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -20;
      eqHigh.connect(analyser);   // las barras muestran el efecto del ecualizador
      viz.attach(S.audioCtx, analyser, eqHigh);
    } catch (err) {
      analyser = null;
      log('Visualización no disponible: ' + err.message);
    }
    if (S.newsMode) loadSounds();   // los sonidos son del modo boletines: sin él no se descargan ni se decodifican
  } catch (err) {
    log('Web Audio no disponible (' + err.message + '). Se usa el volumen del navegador y no habrá barras reales');
    S.audioCtx = busNode = mixNode = gainNode = analyser = null;
    eqLow = eqMid = eqHigh = eqPre = limiter = null;
  }
}

// =====================================
// == CONEXIÓN DE CADA DECK AL GRAFO ==
// =====================================
// Los ganchos que recibe cada deck: attach al crear su <audio> y detach antes de destruirlo
export const deckHooks = {
  attach(d) {
    decks.add(d);
    d.wa = false;
    d.srcNode = d.levelAn = d.normNode = d.fadeNode = null;
    d.norm = null;
    d.fadeInfo = null;
    if (!S.audioCtx || !d.cors) { d.el.volume = Math.min(1, d.fadeV * masterVol()); return; }
    try {
      const ac = S.audioCtx;
      d.srcNode = ac.createMediaElementSource(d.el);
      d.levelAn = ac.createAnalyser();   // mide la emisora tal como llega, antes de la normalización
      d.levelAn.fftSize = 2048;
      d.normNode = ac.createGain();
      d.fadeNode = ac.createGain();
      d.fadeNode.gain.value = d.fadeV;
      d.srcNode.connect(d.levelAn);
      d.srcNode.connect(d.normNode);
      d.normNode.connect(d.fadeNode);
      d.fadeNode.connect(busNode);
      d.wa = true;
      d.el.volume = 1;
    } catch (err) {
      d.wa = false;
      d.el.volume = Math.min(1, d.fadeV * masterVol());
      log('No se pudo conectar ' + d.station.name + ' a Web Audio (' + err.message + '): modo degradado');
    }
  },
  detach(d) {
    for (const n of [d.srcNode, d.levelAn, d.normNode, d.fadeNode]) { if (n) { try { n.disconnect(); } catch (_) {} } }
    d.srcNode = d.levelAn = d.normNode = d.fadeNode = null;
    d.wa = false;
    if (d.closing && d.state === 'closed') decks.delete(d);
  },
};

// Un deck cerrado ya no cuenta
export function releaseDeck(d) {
  decks.delete(d);
  if (d.rampTimer) { clearInterval(d.rampTimer); d.rampTimer = null; }
}

// ====================================
// == FUNDIDOS DE CADA DECK (ENTRADA Y SALIDA) ==
// ====================================
// Con Web Audio el fundido se programa en el reloj del audio (exacto); en modo degradado se va moviendo audio.volume a pasos.
// power = fundido de potencia constante (para el fundido cruzado entre dos emisoras: la suma de ambas no se hunde en el centro)
const CURVE_N = 48;
function curve(from, to, power) {
  const c = new Float32Array(CURVE_N);
  for (let i = 0; i < CURVE_N; i++) {
    const t = i / (CURVE_N - 1);
    c[i] = power ? (to > from ? from + (to - from) * Math.sin(t * Math.PI / 2) : to + (from - to) * Math.cos(t * Math.PI / 2)) : from + (to - from) * t;
  }
  return c;
}

// Nivel por el que va el fundido programado de un deck con Web Audio. Se lleva la cuenta aquí (inicio, fin, duración y forma) en vez de leer gain.value:
// no todos los navegadores reflejan en gain.value una rampa en curso
function rampLevel(d) {
  const f = d.fadeInfo;
  if (!f) return d.fadeV;
  const k = Math.min(1, Math.max(0, (performance.now() - f.t0) / f.ms));
  if (k >= 1) return f.to;
  if (!f.power) return f.from + (f.to - f.from) * k;
  return f.to > f.from ? f.from + (f.to - f.from) * Math.sin(k * Math.PI / 2) : f.to + (f.from - f.to) * Math.cos(k * Math.PI / 2);
}

export function fadeDeck(d, target, seconds, power = false) {
  const dur = Math.max(0.01, seconds);
  if (d.rampTimer) { clearInterval(d.rampTimer); d.rampTimer = null; }
  if (d.wa && d.fadeNode) {
    const g = d.fadeNode.gain, t = S.audioCtx.currentTime, cur = rampLevel(d);
    const curved = power && Math.abs(target - cur) > 0.02;
    d.fadeInfo = { from: cur, to: target, t0: performance.now(), ms: dur * 1000, power: curved };
    d.fadeV = target;
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(cur, t);
      if (curved) { try { g.setValueCurveAtTime(curve(cur, target, true), t, dur); } catch (_) { d.fadeInfo.power = false; g.linearRampToValueAtTime(target, t + dur); } }
      else g.linearRampToValueAtTime(target, t + dur);
    } catch (_) {   // si el navegador no deja programar la rampa, el nivel se pone de golpe: una transición nunca debe quedarse a medias
      d.fadeInfo = null;
      try { g.value = target; } catch (_2) {}
    }
    return;
  }
  // degradado: pasos de 50 ms
  const from = d.fadeV, t0 = performance.now(), cv = curve(from, target, power);
  d.rampTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / (dur * 1000));
    d.fadeV = cv[Math.round(k * (CURVE_N - 1))];
    if (d.el) d.el.volume = Math.min(1, Math.max(0, d.fadeV * masterVol()));
    if (k >= 1) { clearInterval(d.rampTimer); d.rampTimer = null; d.fadeV = target; }
  }, 50);
}

// Nivel de fundido actual de un deck (0 a 1)
export function fadeLevel(d) {
  return d.wa && d.fadeNode ? rampLevel(d) : d.fadeV;
}

// Pone el fundido de golpe (sin rampa)
export function setFade(d, v) {
  if (d.rampTimer) { clearInterval(d.rampTimer); d.rampTimer = null; }
  d.fadeV = v;
  d.fadeInfo = null;
  if (d.wa && d.fadeNode) { const g = d.fadeNode.gain; g.cancelScheduledValues(S.audioCtx.currentTime); g.value = v; }
  else if (d.el) d.el.volume = Math.min(1, Math.max(0, v * masterVol()));
}

// ======================================================
// == ECUALIZADOR (PANEL DEBAJO DEL VISUALIZADOR) ==
// ======================================================
// normal -> modos de los ajustes (EQ Graves, EQ Dinámico...) -> normal... Se cambia con ‹ y › del panel, que enseña el modo y, debajo, el formato de la emisora;
// su botón abre la ventana de los modos (eqtab.js).
// El modo elegido se guarda en el navegador; se olvida si los ajustes del ecualizador cambian o se borran (ver resetEq).
// Con una emisora en modo degradado (sin Web Audio) no hay ecualizador: el visualizador lo avisa

// El primer modo es siempre "normal" (plano y sin texto); detrás van los de los ajustes
const eqPanel = document.getElementById('eqPanel');
const eqNow = document.getElementById('eqNow');
const eqPrev = document.getElementById('eqPrev');
const eqNext = document.getElementById('eqNext');
const eqDlg = document.getElementById('eqDlg');
eqPrev.addEventListener('click', () => cycleEq(-1));
eqNext.addEventListener('click', () => cycleEq(1));
// La ventana de los modos (antes, pestaña de los ajustes): al abrirse, la pestaña recibe "show" para pintarse
document.getElementById('eqOpen').addEventListener('click', () => { openDialog(eqDlg); document.getElementById('tabEq').dispatchEvent(new Event('show')); });
document.getElementById('eqClose').addEventListener('click', () => closeDialog(eqDlg));
eqDlg.addEventListener('click', e => { if (e.target === eqDlg) closeDialog(eqDlg); });

const eqModes = () => [{ label: '', low: 0, mid: 0, high: 0, pre: 0, active: true }, ...S.eq.modes];
const eqActive = (modes, i) => i === 0 || (!!modes[i] && modes[i].active !== false);   // los desactivados no salen con ‹ ›
let audition = false;   // la pestaña Ecualizador está haciendo sonar un modo desactivado para editarlo

// -1: aún no se ha elegido ninguno en este navegador (se usa el "defaultMode" de los ajustes; no se guarda hasta que se cambie con ‹ ›)
let eqMode = -1;
let eqShown = 0;   // modo que se aplica ahora (el elegido o, si no hay, el de por defecto)
try { const n = parseInt(localStorage.getItem('rn_eq'), 10); if (n >= 0) eqMode = n; } catch (_) {}
function saveEqMode() { try { localStorage.setItem('rn_eq', String(eqMode)); } catch (_) {} }

// Olvida el modo guardado y vuelve a "normal"
export function resetEq() {
  eqMode = -1;
  audition = false;
  try { localStorage.removeItem('rn_eq'); } catch (_) {}
  refreshEq();
}

// Aplica el modo actual (y las frecuencias y la Q de los ajustes) al panel y a los filtros
export function refreshEq(immediate = false) {
  const modes = eqModes();
  // hasta que se cargan los ajustes no se sabe cuántos modos hay: mientras tanto se conserva el modo guardado
  if (S.configLoaded && (eqMode >= modes.length || (eqMode > 0 && !audition && !eqActive(modes, eqMode)))) { eqMode = -1; try { localStorage.removeItem('rn_eq'); } catch (_) {} }
  if (S.configLoaded && eqMode < 0) {   // el primero es "normal": el de los ajustes va uno por detrás (si está desactivado, normal)
    const d = Math.min(Math.max(0, (S.eq.defaultMode >= 0 ? S.eq.defaultMode + 1 : 0)), modes.length - 1);
    eqShown = eqActive(modes, d) ? d : 0;
  }
  else if (eqMode >= 0) eqShown = eqMode;
  const m = modes[eqShown] || modes[0];
  const native = outMode === 'nativa';   // salida nativa: sin barras ni ecualizador, el área queda apagada
  const noEq = !native && S.degraded;   // emisora sin Web Audio: se muestran barras sintéticas y sin ecualizador
  // el modo y, debajo, el formato (o calidad) de la emisora que suena
  eqLabel.textContent = native || !S.current ? '' : S.quality;
  const interactive = !native && modes.some((x, i) => i > 0 && eqActive(modes, i));   // sin modos activos, ‹ › no hacen nada
  eqNow.textContent = native || noEq ? 'Sin EQ' : (m.label || 'Normal');
  eqPrev.disabled = eqNext.disabled = !interactive || noEq;
  eqPanel.classList.toggle('off', native || noEq);
  vizBox.classList.toggle('off', native);
  if (!eqLow || !S.audioCtx) return;
  try {
    const t = S.audioCtx.currentTime, tc = immediate ? 0.001 : 0.05;   // cambio suave para que no haya chasquidos
    if (typeof S.eq.lowHz === 'number') {   // frecuencias y Q solo si los ajustes las traen
      eqLow.frequency.setTargetAtTime(S.eq.lowHz, t, tc);
      eqMid.frequency.setTargetAtTime(S.eq.midHz, t, tc);
      eqHigh.frequency.setTargetAtTime(S.eq.highHz, t, tc);
    }
    eqLow.gain.setTargetAtTime(m.low, t, tc);
    eqMid.gain.setTargetAtTime(m.mid, t, tc);
    if (typeof S.eq.midQ === 'number') eqMid.Q.setTargetAtTime(typeof m.q === 'number' ? m.q : S.eq.midQ, t, tc);   // cada modo puede llevar su Q
    eqHigh.gain.setTargetAtTime(m.high, t, tc);
    eqPre.gain.setTargetAtTime(Math.pow(10, m.pre / 20), t, tc);
  } catch (err) {
    log('Ecualizador no disponible: ' + ((err && err.message) || err));   // nunca debe dejar el audio mudo
  }
}

// Modo que suena ahora (0 = normal; 1.. = los de los ajustes)
export const currentEqMode = () => eqShown;

// Elige un modo (0 = normal; 1.. = los de los ajustes) y lo recuerda, como si se hubiera cambiado con ‹ › (lo usa la pestaña Ecualizador para oír lo que se edita)
export function setEqMode(n) {
  eqMode = Math.max(0, n | 0);
  audition = !eqActive(eqModes(), eqMode);   // uno desactivado suena mientras se edita, pero no se recuerda
  if (audition) { try { localStorage.removeItem('rn_eq'); } catch (_) {} } else saveEqMode();
  refreshEq();
}

// dir: 1 = siguiente, -1 = anterior
function cycleEq(dir = 1) {
  if (outMode === 'nativa') return;
  const modes = eqModes();
  let n = eqShown;
  do n = (n + dir + modes.length) % modes.length; while (n !== 0 && !eqActive(modes, n));   // salta los desactivados
  eqMode = n;
  audition = false;
  saveEqMode();
  refreshEq();
}
refreshEq();   // pinta el nombre del modo guardado (los filtros se ajustan al crear el grafo de audio)

// Sin ajustes cargados los volúmenes quedan bloqueados y sin valor ("-")
export function refreshVolumeUi() {
  const on = S.configLoaded;
  volume.disabled = newsVolume.disabled = !on;
  volValue.textContent = on ? Math.round(Number(volume.value) * 100) + '%' : '-';
  newsVolValue.textContent = on ? Math.round(Number(newsVolume.value) * 100) + '%' : '-';
}

// ==============================
// == NORMALIZACIÓN DEL VOLUMEN ==
// ==============================
// Cada emisora llega a un nivel distinto. Se mide el nivel medio (RMS) de lo que llega, antes de la normalización y de los sonidos locales, y se aplica
// la ganancia necesaria (subida o bajada, con topes) para llegar a NORM_TARGET_DB, de forma suave. Cada deck lleva su medida, y el nivel de cada emisora
// se recuerda en este navegador para aplicarlo nada más llegar. Un limitador evita saturar al subir. Solo actúa en emisoras con Web Audio.

// Se puede desactivar en los ajustes (se guarda en el navegador)
const NORM_KEY = 'rn_norm';
let normOn = true;
try { normOn = localStorage.getItem(NORM_KEY) !== '0'; } catch (_) {}
export const getNormOn = () => normOn;
export function setNormOn(on) {
  normOn = !!on;
  try { localStorage.setItem(NORM_KEY, normOn ? '1' : '0'); } catch (_) {}
  log('Normalización del volumen: ' + (normOn ? 'activada' : 'desactivada'));
  for (const d of decks) { if (d.norm) d.norm.logged = 0; if (!normOn && d.normNode) d.normNode.gain.setTargetAtTime(1, S.audioCtx.currentTime, 0.3); }
}

const LEVELS_KEY = 'rn_levels';
let levels = {};   // emisora y variante -> último nivel medido (dB)
try { levels = JSON.parse(localStorage.getItem(LEVELS_KEY)) || {}; } catch (_) {}
let normSaved = 0;
const levelBuf = new Float32Array(2048);
const toDb = p => 10 * Math.log10(p);

function normTick() {
  if (!normOn || !S.audioCtx || S.audioCtx.state !== 'running') return;
  for (const d of decks) {
    if (!d.wa || !d.levelAn || d.state !== 'playing' || d.held || !d.el || d.el.paused) continue;
    const key = d.station.id + '|' + d.variant;
    if (!d.norm || d.norm.key !== key) {   // emisora nueva en este deck: se parte del nivel recordado, si lo hay
      const mem = levels[key];
      d.norm = { key, pow: typeof mem === 'number' ? Math.pow(10, mem / 10) : null, count: 0, sure: typeof mem === 'number', last: 0, logged: 0 };
    }
    const n = d.norm;
    d.levelAn.getFloatTimeDomainData(levelBuf);
    let sum = 0;
    for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
    const p = sum / levelBuf.length;
    if (toDb(p) >= NORM_SILENCE_DB) {
      const now = performance.now(), dt = n.last ? (now - n.last) / 1000 : 0.25;
      n.last = now;
      n.count++;
      n.pow = n.pow === null ? p : n.pow + (p - n.pow) * Math.max(Math.min(dt / NORM_TAU_S, 1), 1 / (n.count + 1));
      if (n.count >= 12) n.sure = true;   // unos 3 s de audio medido
    }
    if (!n.sure || n.pow === null) continue;
    const level = toDb(n.pow);
    const boost = Math.min(NORM_MAX_BOOST_DB, Math.max(-NORM_MAX_CUT_DB, NORM_TARGET_DB - level));
    d.normNode.gain.setTargetAtTime(Math.pow(10, boost / 20), S.audioCtx.currentTime, 0.5);
    if (Math.abs(boost - n.logged) >= 2) {
      n.logged = boost;
      log('Volumen normalizado en ' + d.station.name + ': nivel ' + level.toFixed(0) + ' dB, ganancia ' + (boost > 0 ? '+' : '') + boost.toFixed(0) + ' dB');
    }
    if (Date.now() - normSaved > 10000) {
      normSaved = Date.now();
      levels[key] = Math.round(level * 10) / 10;
      try { localStorage.setItem(LEVELS_KEY, JSON.stringify(levels)); } catch (_) {}
    }
  }
}
setInterval(normTick, 250);

// ====================================
// == SONIDOS LOCALES (ENTRADA Y SALIDA DE NOTICIAS) ==
// ====================================
// Siempre por Web Audio (también con emisoras en modo degradado): suenan por la mezcla, tras el limitador

let currentJingle = null; // { node, gain } del sonido local que está sonando

export function canPlayJingles() { return !!S.audioCtx; }

export function playJingle(buf) {
  if (!S.audioCtx) return;
  const node = S.audioCtx.createBufferSource();
  const gain = S.audioCtx.createGain();
  node.buffer = buf;
  node.connect(gain);
  gain.connect(mixNode);
  node.start();
  currentJingle = { node, gain };
  node.onended = () => { if (currentJingle && currentJingle.node === node) currentJingle = null; };
}

export function stopJingle() {
  if (!currentJingle || !S.audioCtx) return;
  const { node, gain } = currentJingle;
  currentJingle = null;
  try {
    gain.gain.setTargetAtTime(0, S.audioCtx.currentTime, 0.05);
    node.stop(S.audioCtx.currentTime + 0.3);
  } catch (_) {}
}

// ==========================================
// == EVENTOS: VOLUMEN ==
// ==========================================

volume.addEventListener('input', () => {
  applyVolume();
  volValue.textContent = Math.round(Number(volume.value) * 100) + '%';
});

newsVolume.addEventListener('input', () => {
  applyVolume();
  newsVolValue.textContent = Math.round(Number(newsVolume.value) * 100) + '%';
});

// ============================================
// == SALIDA COLGADA Y VIGILANTE DE LOS DECKS ==
// ============================================
// Si el reloj del contexto de Web Audio se queda parado con algo sonando, la salida está colgada: se reinicia y, si sigue igual, se recrea el audio.
// Lo mismo si el contexto deja de estar en marcha (suspendido o interrumpido) con una emisora sonando por él: sin esto, la notificación diría que
// suena y no se oiría nada. Y cada segundo cada deck comprueba que avanza (reconexión) y que no acumula retraso (salto al directo).

let lastClock = 0, stuck = 0, lastRestart = 0;
let badCtx = 0;        // segundos seguidos con el contexto parado y una emisora sonando por él
let restarts = 0;      // reinicios de la salida sin que el reloj haya vuelto a avanzar
let rebuilt = false;   // ya se ha recreado el audio en este atasco: no se repite hasta que vuelva a funcionar

const waPlaying = () => { for (const d of decks) if (d.wa && d.isPlaying()) return true; return false; };

// Último recurso: contexto nuevo y las emisoras conectadas otra vez a él (un <audio> no puede cambiar de contexto: estrenan uno). Grabando no se hace
function rebuildAudio(why) {
  if (rebuilt || S.recording) return;
  rebuilt = true;
  log(why + ': se recrea el audio del navegador');
  initAudioGraph(true);
  for (const d of [...decks]) {
    if (d.state === 'closed' || d.state === 'failed') continue;
    d.build();
    if (!d.held) d.start();
  }
}

async function restartOutput(why) {
  if (!S.audioCtx || Date.now() - lastRestart < 10000) return;
  lastRestart = Date.now();
  log(why + ': se reinicia la salida de audio');
  try {
    restarts++;
    const ctx = S.audioCtx;
    await ctx.suspend();
    await ctx.resume();
    log('Salida de audio reiniciada (' + ctx.state + ')');   // si no queda en marcha, el vigilante sigue con ella
  } catch (err) {
    log('No se pudo reiniciar la salida de audio: ' + ((err && err.message) || err));
  }
}

// Reconecta ya las emisoras que estén esperando un reintento, paradas o sin datos (no toca las que suenan bien)
function recoverAllIfStalled(reason) {
  for (const d of decks) d.recoverIfStalled(reason);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (S.audioCtx && S.audioCtx.state !== 'running') S.audioCtx.resume().catch(() => {});
  wakeAnchor();
  for (const d of decks) if (d.interrupted) d.resumeInterrupted();
  recoverAllIfStalled('página de nuevo en primer plano');
});
// El navegador congeló la página en segundo plano y la despierta (puede seguir oculta): los temporizadores han estado parados
document.addEventListener('resume', () => {
  log('Página descongelada');
  if (S.audioCtx && S.audioCtx.state !== 'running') S.audioCtx.resume().catch(() => {});
  recoverAllIfStalled('página descongelada');
});
// "online" solo dice que hay red, no que haya internet: adelanta el reintento, pero no sustituye a los periódicos. Con "offline" no hay que hacer nada: retrySoon ya no gasta intentos sin red
window.addEventListener('online', () => recoverAllIfStalled('vuelve la red'));
// Página restaurada desde la caché de ida y vuelta del navegador
window.addEventListener('pageshow', e => { if (e.persisted) recoverAllIfStalled('página restaurada'); });

setInterval(() => {
  for (const d of decks) d.watch();
  if (!S.audioCtx || !anyPlaying()) { stuck = badCtx = 0; return; }
  if (S.audioCtx.state !== 'running') {
    stuck = 0;
    if (!waPlaying()) { badCtx = 0; return; }   // las emisoras en modo degradado no pasan por el contexto
    badCtx++;
    if (badCtx === 1) log('El audio del navegador está parado (' + S.audioCtx.state + ') con una emisora sonando: se intenta reanudar');
    if (badCtx % 3 === 1) S.audioCtx.resume().catch(() => {});
    if (badCtx === 10) rebuildAudio('El audio del navegador no se reanuda');
    return;
  }
  if (badCtx) { badCtx = 0; log('Audio del navegador en marcha de nuevo'); }
  const t = S.audioCtx.currentTime;
  stuck = t - lastClock < 0.05 ? stuck + 1 : 0;
  lastClock = t;
  if (!stuck) { restarts = 0; rebuilt = false; }
  if (stuck >= 2) {
    stuck = 0;
    if (restarts >= 1 && Date.now() - lastRestart >= 10000) rebuildAudio('El reloj del audio sigue parado');
    else restartOutput('El reloj del audio está parado');
  }
}, 1000);
