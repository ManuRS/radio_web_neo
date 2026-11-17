// ===========================
// == PESTAÑA ECUALIZADOR ==
// ===========================
// Edita los modos del ecualizador (los que se eligen pulsando el visualizador, detrás del "normal"): nombre, graves, medios, agudos y volumen,
// con una gráfica de cómo queda el sonido de graves a agudos. Los modos no se borran: se activan o desactivan (los desactivados no salen al pulsar
// el visualizador) y cada uno se puede restablecer a como venía. Lo que se edita suena al momento; se guarda en el bloque "eq" de los ajustes al soltar.

import { S } from './state.js';
import { DEFAULT_EQ, EQ_GAIN_MAX, EQ_GAIN_MIN, editSettings } from './settings.js';
import { currentEqMode, refreshEq, setEqMode } from './audio.js';
import { paintRange } from './ui.js';

const panel = document.getElementById('tabEq');
const modesBox = document.getElementById('eqModes');
const edit = document.getElementById('eqEdit');
const nameIn = document.getElementById('eqName');
const canvas = document.getElementById('eqCurve');
const defSw = document.getElementById('eqDefault');
const actBtn = document.getElementById('eqAct');
const resetBtn = document.getElementById('eqReset');
const msg = document.getElementById('eqMsg');
const SLIDERS = { low: 'eqLow', mid: 'eqMid', high: 'eqHigh', pre: 'eqPre' };
const sliders = Object.fromEntries(Object.entries(SLIDERS).map(([k, id]) => [k, document.getElementById(id)]));
const values = Object.fromEntries(Object.entries(SLIDERS).map(([k, id]) => [k, document.getElementById(id + 'V')]));

let sel = 0;   // modo que se edita (posición en S.eq.modes)

function report(lines, isError) {
  msg.className = 'cfgmsg' + (isError ? ' err' : ' ok');
  msg.textContent = lines.join('\n');
}
const clearMsg = () => { msg.className = 'cfgmsg'; msg.textContent = ''; };
const modes = () => (S.eq && Array.isArray(S.eq.modes) ? S.eq.modes : []);
const fmtDb = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' dB';

// El bloque "eq" tal como se escribe en los ajustes (frecuencias de siempre si aún no las había)
function rawEq() {
  const eq = S.eq || {};
  const f = typeof eq.lowHz === 'number' ? eq : DEFAULT_EQ;
  const o = { lowHz: f.lowHz, midHz: f.midHz, midQ: f.midQ, highHz: f.highHz };
  if (eq.defaultMode >= 0 && eq.defaultMode < modes().length) o.defaultMode = eq.defaultMode;
  o.modes = modes().map(m => Object.assign({ label: m.label, low: m.low, mid: m.mid, high: m.high, pre: m.pre }, m.active === false ? { active: false } : {}));
  return o;
}
const busy = () => {
  if (!S.newsOn && !S.trans) return false;
  report(['No se puede cambiar el ecualizador durante un boletín o una transición'], true);
  return true;
};
function save(mutate) {
  if (busy()) { render(); return false; }
  const ok = editSettings(raw => { if (mutate) mutate(raw); else raw.eq = rawEq(); }, report);
  if (ok) clearMsg();
  return ok;
}

// ============
// == GRÁFICA ==
// ============
// La respuesta real de los tres filtros (los mismos tipos que usa el audio) calculada con Web Audio, más el volumen
const N = 240, F_MIN = 20, F_MAX = 20000, DB = 24;
const freqs = new Float32Array(N).map((_, i) => F_MIN * Math.pow(F_MAX / F_MIN, i / (N - 1)));
let oac = null, fl, fm, fh;
function response(m, f) {
  if (!oac) {
    try {
      oac = new OfflineAudioContext(1, 128, 48000);
      fl = oac.createBiquadFilter(); fl.type = 'lowshelf';
      fm = oac.createBiquadFilter(); fm.type = 'peaking';
      fh = oac.createBiquadFilter(); fh.type = 'highshelf';
    } catch (_) { oac = false; }
  }
  if (!oac) return null;
  fl.frequency.value = f.lowHz; fl.gain.value = m.low;
  fm.frequency.value = f.midHz; fm.Q.value = f.midQ; fm.gain.value = m.mid;
  fh.frequency.value = f.highHz; fh.gain.value = m.high;
  const out = new Float32Array(N).fill(m.pre || 0);
  const mag = new Float32Array(N), ph = new Float32Array(N);
  for (const flt of [fl, fm, fh]) {
    flt.getFrequencyResponse(freqs, mag, ph);
    for (let i = 0; i < N; i++) out[i] += 20 * Math.log10(Math.max(mag[i], 1e-6));
  }
  return out;
}

function draw() {
  const m = modes()[sel];
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const padL = 30, padB = 18, padT = 8, padR = 8, pw = w - padL - padR, ph = h - padT - padB;
  const x = f => padL + pw * Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN);
  const y = db => padT + ph * (1 - (Math.max(-DB, Math.min(DB, db)) + DB) / (2 * DB));
  // rejilla: dB a la izquierda, frecuencias abajo
  g.font = '10px system-ui, sans-serif';
  g.fillStyle = '#6b7788';
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  for (const db of [12, 0, -12]) {
    g.strokeStyle = db === 0 ? '#3a4554' : '#252e3a';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, Math.round(y(db)) + .5); g.lineTo(w - padR, Math.round(y(db)) + .5); g.stroke();
    g.fillText((db > 0 ? '+' : db < 0 ? '−' : '') + Math.abs(db), padL - 6, y(db));
  }
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  for (const [f, t] of [[50, '50'], [100, '100'], [500, '500'], [1000, '1k'], [5000, '5k'], [10000, '10k']]) {
    g.strokeStyle = '#1f2731';
    g.beginPath(); g.moveTo(Math.round(x(f)) + .5, padT); g.lineTo(Math.round(x(f)) + .5, padT + ph); g.stroke();
    g.fillText(t, x(f), h - 4);
  }
  if (!m) return;
  const f = typeof S.eq.lowHz === 'number' ? S.eq : DEFAULT_EQ;
  const r = response(m, f);
  if (!r) return;
  const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#938bff';
  g.beginPath();
  for (let i = 0; i < N; i++) { const px = x(freqs[i]), py = y(r[i]); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
  g.save();
  g.lineTo(x(freqs[N - 1]), y(0)); g.lineTo(x(freqs[0]), y(0)); g.closePath();
  g.globalAlpha = .16; g.fillStyle = accent; g.fill();
  g.restore();
  g.beginPath();
  for (let i = 0; i < N; i++) { const px = x(freqs[i]), py = y(r[i]); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
  g.strokeStyle = accent; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
}
if (window.ResizeObserver) new ResizeObserver(() => { if (!panel.hidden) draw(); }).observe(canvas);

// ===============
// == FORMULARIO ==
// ===============
function render() {
  const list = modes();
  if (sel >= list.length) sel = Math.max(0, list.length - 1);
  modesBox.textContent = '';
  list.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(i + 1);
    b.title = m.label + (m.active === false ? ' (desactivado)' : '');
    b.setAttribute('aria-label', 'Modo ' + (i + 1) + ': ' + b.title);
    b.classList.toggle('active', i === sel);
    b.classList.toggle('off', m.active === false);
    b.addEventListener('click', () => { sel = i; setEqMode(i + 1); clearMsg(); render(); });
    modesBox.appendChild(b);
  });
  const m = list[sel];
  edit.hidden = !m;
  if (!m) { report(['Los ajustes no traen modos de ecualizador'], false); return; }
  const on = m.active !== false;
  if (document.activeElement !== nameIn) nameIn.value = m.label;
  for (const k of Object.keys(SLIDERS)) {
    sliders[k].min = String(EQ_GAIN_MIN);
    sliders[k].max = String(EQ_GAIN_MAX);
    sliders[k].value = String(m[k] || 0);
    paintRange(sliders[k]);
    values[k].textContent = fmtDb(m[k] || 0);
  }
  defSw.checked = on && S.eq.defaultMode === sel;
  defSw.disabled = !on;
  actBtn.textContent = (on ? 'Desactivar' : 'Activar') + ' Modo ' + (sel + 1);
  resetBtn.textContent = 'Restablecer Modo ' + (sel + 1);
  edit.classList.toggle('off', !on);
  draw();
}


for (const k of Object.keys(SLIDERS)) {
  sliders[k].addEventListener('input', () => {   // suena y se dibuja al momento
    const m = modes()[sel];
    if (!m) return;
    m[k] = Number(sliders[k].value);
    values[k].textContent = fmtDb(m[k]);
    if (currentEqMode() !== sel + 1) setEqMode(sel + 1); else refreshEq();
    draw();
  });
  sliders[k].addEventListener('change', () => save());   // al soltar, se guarda
}
nameIn.addEventListener('input', () => {
  const m = modes()[sel];
  if (!m) return;
  m.label = nameIn.value.trim().slice(0, 24) || 'EQ ' + (sel + 1);
  refreshEq();
  modesBox.children[sel].title = m.label;
});
nameIn.addEventListener('change', () => { nameIn.value = (modes()[sel] || {}).label || ''; save(); });
defSw.addEventListener('change', () => {
  if (busy()) { render(); return; }
  S.eq.defaultMode = defSw.checked ? sel : -1;
  save();
  render();
});
// Activar o desactivar el modo (los desactivados no salen al pulsar el visualizador ni pueden ser la opción por defecto)
actBtn.addEventListener('click', () => {
  if (busy()) return;
  const m = modes()[sel];
  if (!m) return;
  const on = m.active === false;
  if (on) delete m.active; else m.active = false;
  if (!on && S.eq.defaultMode === sel) S.eq.defaultMode = -1;
  save();
  setEqMode(on ? sel + 1 : 0);   // al activarlo suena; al desactivarlo se vuelve al normal
  render();
});
// Restablecer el modo: nombre, valores y si viene activado, como en los de serie (si es uno que no está en ellos, plano)
resetBtn.addEventListener('click', () => {
  if (busy()) return;
  const list = modes();
  if (!list[sel]) return;
  const d = DEFAULT_EQ.modes[sel] || { label: 'EQ ' + (sel + 1), low: 0, mid: 0, high: 0, pre: 0 };
  list[sel] = { ...d, active: d.active !== false };
  if (list[sel].active === false && S.eq.defaultMode === sel) S.eq.defaultMode = -1;
  save();
  setEqMode(sel + 1);
  render();
});

panel.addEventListener('show', () => {
  clearMsg();
  const cur = currentEqMode();
  if (cur > 0) sel = cur - 1;
  render();
});
