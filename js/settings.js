// ============================================================
// == AJUSTES: ALMACENAMIENTO, VALIDACIÓN Y VENTANA ==
// ============================================================
// Los ajustes (emisoras y noticias) vienen por defecto en default/ (dentro del proyecto). En el navegador (localStorage: no viaja a ningún
// servidor) solo se guardan los cambios del usuario sobre ellos, y eso es también lo que se exporta e importa, en un archivo cifrado (datos.js). La pestaña General reúne los ajustes propios de cada navegador: retraso del reloj, salida de audio,
// normalización, color personalizado por cadena y script de personalización (custom.js).

import { pad, parseNumber } from './utils.js';
import { APP_ID, S, APP_VERSION, DEFAULT_DELAY_S, SOUND_CACHE } from './state.js';
import { autoDelay, cfgClear, cfgClearSounds, cfgFile, cfgFileInput, cfgExport, cfgMsg, accentPick, accentSelect, bgSwitch, matSelect, colorSwitch, logShow, customBtn, customInput, delayInput, normSwitch, outSelect, settingsBtn, settingsClose, settingsDlg, settingsTabs, tabConfig, tabGeneral, tabLog, logBox, stForm, stMsg, stAdd } from './dom.js';
import { closeDialog, log, openDialog, toast } from './ui.js';
import { glowOn, matMode, setGlow, setMaterial } from './glow.js';
import { groupOn, setGroup } from './grupo.js';
import { prefetchSounds } from './sounds.js';
import { getNormOn, getOutMode, setNormOn, setOutMode } from './audio.js';
import { restartAudio } from './player.js';
import { ask, stopRecording } from './recorder.js';
import { editHooks, expandGroup, refreshAccent } from './stations.js';
import { loadCustom, saveCustom } from './custom.js';
import { refreshDelayUi, setAutoDelay, setManualDelay } from './clock.js';
import { parseJsonc, stripJsonComments } from './jsonc.js';
import { diff, isEmpty, merge, openFile, sealFile } from './datos.js';

// ====================================
// == ALMACENAMIENTO EN EL NAVEGADOR ==
// ====================================
// Lo de por defecto: default/cadenas.json (las cadenas) y default/general.json (lo demás). En el navegador (rn_datos), solo los cambios del usuario
const DATA_KEY = 'rn_datos';
const LISTS = { stations: s => s.id };   // las cadenas se comparan una a una por su id
const DEFAULT_FILES = ['default/cadenas.json', 'default/general.json'];
let defaults = null;   // lo de por defecto, ya leído (null si no se pudo)
const loadChanges = () => { try { return JSON.parse(localStorage.getItem(DATA_KEY)) || {}; } catch (_) { return {}; } };
function saveChanges(p) {
  try { if (isEmpty(p)) localStorage.removeItem(DATA_KEY); else localStorage.setItem(DATA_KEY, JSON.stringify(p)); return true; } catch (_) { return false; }
}

// Lee lo de por defecto (default/). Devuelve null si no se pudo descargar
export async function loadDefaults() {
  try {
    const [stations, general] = await Promise.all(DEFAULT_FILES.map(async f => {
      const res = await fetch(f, { cache: 'no-cache' });
      if (!res.ok) throw new Error(f + ': HTTP ' + res.status);
      return res.json();
    }));
    defaults = { ...general, stations };
  } catch (err) {
    log('No se pudieron cargar los ajustes por defecto: ' + ((err && err.message) || err));
    defaults = null;
  }
  return defaults;
}
// Ajustes en uso (texto JSON): lo de por defecto con los cambios encima; sin changes, los guardados
export const configTextWith = (changes = loadChanges()) => (defaults ? JSON.stringify(merge(defaults, changes, LISTS)) : '');

// ===============================
// == VALIDACIÓN DE LOS AJUSTES ==
// ===============================
// Ajustes vacíos: lo que se aplica si no hay ninguno válido
const emptyConfig = () => ({
  eq: { modes: [] }, defaultDelayS: DEFAULT_DELAY_S,
  stations: [], newsStationId: null, news: [],
});
export const emptyConfigFn = emptyConfig;

// Ecualizador: límites de las ganancias en dB (bandas y preamplificación)
export const EQ_GAIN_MIN = -24;
export const EQ_GAIN_MAX = 18;
// Factor Q de los medios en cada modo: 0,3 (ancho, casi cuatro octavas en total) a 4 (estrecho, un tercio de octava en total); sin "q", el "midQ" del bloque
export const EQ_Q_MIN = 0.3;
export const EQ_Q_MAX = 4;
export const EQ_MAX_MODES = 6;   // modos del ecualizador (además del "normal")

// Color de énfasis: luminosidad relativa (0 negro – 1 blanco) de un "#rrggbb"
const luminance = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
                     .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ACCENT_MIN_LUM = 0.15;   // por debajo, el color se pierde sobre el fondo oscuro y el texto oscuro de los botones no se lee
// Un color demasiado oscuro no se rechaza: se aclara lo justo (misma tonalidad y saturación) hasta que se ve bien sobre el fondo
function usableColor(hex) {
  hex = hex.toLowerCase();
  if (luminance(hex) >= ACCENT_MIN_LUM) return hex;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0, l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const toHex = L => {
    const c = (1 - Math.abs(2 * L - 1)) * s, x = c * (1 - Math.abs((h % 2 + 2) % 2 - 1)), m = L - c / 2;
    const [a, bb, cc] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return '#' + [a, bb, cc].map(v => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, '0')).join('');
  };
  if (h < 0) h += 6;
  for (; l < 1; l += 0.01) { const out = toHex(l); if (luminance(out) >= ACCENT_MIN_LUM) return out; }
  return '#ffffff';
}
// Ecualizador por defecto (detrás del "normal", plano y sin texto): el que se usa si los ajustes no traen el bloque "eq" (con "eq" pero sin modos, no hay ecualizador)
export const DEFAULT_EQ = {
  lowHz: 100, midHz: 1000, midQ: 0.8, highHz: 8000, defaultMode: 1,
  modes: [
    { label: 'EQ Graves', low: 10, mid: 0, high: 2, pre: 0 },
    { label: 'EQ Dinámico', low: 5, mid: -1, high: 4, pre: 0 },
    { label: 'Amplitud Modulada', low: -18, mid: 8, high: -18, pre: 0 },
    { label: 'EQ Voz', low: -4, mid: 3, high: 2, pre: 0, active: false },             // tertulias y boletines: menos graves, más presencia
    { label: 'EQ Especial Móvil', low: -3, mid: 2, high: 3, pre: 0, active: false },  // altavoz del móvil: no gasta en graves que no puede dar
    { label: 'EQ Extra', low: 0, mid: 0, high: 0, pre: 0, active: false },            // libre para el gusto de cada uno
  ],
};

export function validateConfig(text) {
  const errors = [];
  let raw;
  try { raw = JSON.parse(stripJsonComments(text)); }
  catch (e) { return { errors: ['JSON no válido: ' + e.message] }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['El contenido debe ser un objeto { ... }'] };
  const cfg = emptyConfig();
  const color = (v, where) => {   // "#rrggbb" (si es demasiado oscuro, aclarado); null si no es válido (y lo anota)
    const a = typeof v === 'string' ? v.trim() : '';
    if (!/^#[0-9a-f]{6}$/i.test(a)) { errors.push('"' + where + '": debe ser un color #rrggbb (por ejemplo "#4da3ff")'); return null; }
    return usableColor(a);   // demasiado oscuro: se aclara
  };


  // retraso del stream de la emisora de noticias respecto a la emisión (s): solo sirve para calcular la hora de las franjas del modo boletines
  if (raw.defaultDelayS !== undefined) {
    const d = Number(raw.defaultDelayS);
    if (!isFinite(d) || d < 0 || d > 300) errors.push('"defaultDelayS": debe estar entre 0 y 300 segundos');
    else cfg.defaultDelayS = d;
  }

  // cadenas: cada una con una o varias URL (la primera es la principal; las demás, variantes)
  const list = Array.isArray(raw.stations) ? raw.stations : [];
  if (!list.length) errors.push('"stations": hace falta al menos una cadena');
  const ids = new Set();
  list.forEach((s, i) => {
    const where = 'stations[' + i + ']';
    if (!s || typeof s !== 'object') { errors.push('"' + where + '": debe ser un objeto'); return; }
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    if (!name) { errors.push('"' + where + '": falta el nombre'); return; }
    const id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : slugOf(name);
    if (ids.has(id)) { errors.push('"' + where + '": "id" repetido (' + id + ')'); return; }
    if (s.group !== undefined && s.group !== 'general' && s.group !== 'musical') { errors.push('"' + where + '.group": debe ser "general" o "musical"'); return; }
    const rawUrls = Array.isArray(s.urls) ? s.urls : (s.url !== undefined ? [s.url] : []);
    const urls = [];
    rawUrls.forEach((u, j) => {
      const o = typeof u === 'string' ? { url: u } : (u || {});
      const url = typeof o.url === 'string' ? o.url.trim() : '';
      if (!/^https?:\/\/\S+$/i.test(url)) { errors.push('"' + where + '.urls[' + j + ']": la URL debe empezar por http:// o https://'); return; }
      const kind = o.kind === 'hls' || o.kind === 'aac' || o.kind === 'mp3' ? o.kind : kindOfUrl(url);
      const item = { url, kind, label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 30) : kind.toUpperCase() };
      if (o.cors === false) item.cors = false;   // esa emisora no admite CORS (modo degradado), aunque las demás de la cadena sí
      urls.push(item);   // el nombre de la variante es libre ("SER Málaga"); por defecto, el formato. La calidad no se guarda: se lee en directo
    });
    if (!urls.length) { errors.push('"' + where + '": hace falta al menos una URL'); return; }
    ids.add(id);
    // newsSource: generalista que puede dar los boletines (las que salen en la pestaña Boletines)
    const item = { id, name, group: s.group === 'musical' ? 'musical' : 'general', urls, cors: s.cors !== false, news: !!s.news, newsSource: s.group !== 'musical' && !!s.newsSource };
    if (typeof s.short === 'string' && s.short.trim()) item.short = s.short.trim().slice(0, 14);   // nombre corto para el botón de la rejilla
    if (s.color !== undefined && s.color !== null && s.color !== '') { const c = color(s.color, where + '.color'); if (c) item.color = c; }
    cfg.stations.push(item);
  });

  // ecualizador (opcional): sin bloque "eq", el de por defecto (DEFAULT_EQ); con "eq" sin modos, no hay ecualizador; con modos hacen falta las cuatro frecuencias/Q
  if (raw.eq === undefined) cfg.eq = structuredClone(DEFAULT_EQ);
  else if (raw.eq && typeof raw.eq === 'object') {
    const e = raw.eq, modes = Array.isArray(e.modes) ? e.modes : [];
    const num = (v, lo, hi, name, required) => {
      if (v === undefined) { if (required) errors.push('"eq.' + name + '": falta'); return required ? null : 0; }
      const n = Number(v);
      if (!isFinite(n) || n < lo || n > hi) { errors.push('"eq.' + name + '": debe estar entre ' + lo + ' y ' + hi); return required ? null : 0; }
      return n;
    };
    if (modes.length > EQ_MAX_MODES) errors.push('"eq.modes": máximo ' + EQ_MAX_MODES + ' modos');
    // modo que se usa mientras no se elija otro pulsando el visualizador: posición en "modes" (0 = el primero; sin él, el ecualizador empieza plano)
    let defaultMode = -1;
    if (e.defaultMode !== undefined) {
      const n = Number(e.defaultMode);
      if (!Number.isInteger(n) || n < 0 || n >= Math.min(modes.length, EQ_MAX_MODES)) errors.push('"eq.defaultMode": debe ser un número entre 0 y ' + (Math.min(modes.length, EQ_MAX_MODES) - 1) + ' (posición en "modes")');
      else defaultMode = n;
    }
    if (modes.length) {
      cfg.eq = {
        lowHz: num(e.lowHz, 20, 500, 'lowHz', true),
        midHz: num(e.midHz, 200, 8000, 'midHz', true),
        midQ: num(e.midQ, 0.1, 10, 'midQ', true),
        highHz: num(e.highHz, 2000, 16000, 'highHz', true),
        defaultMode,
        modes: modes.slice(0, EQ_MAX_MODES).map((m, i) => ({
          label: m && m.label !== undefined ? (m.label === 'Frecuencia Modulada' ? 'Amplitud Modulada' : String(m.label).slice(0, 24)) : 'EQ ' + (i + 1),   // el nombre de antes de ese modo, corregido
          low: num(m && m.low, EQ_GAIN_MIN, EQ_GAIN_MAX, 'modes[' + i + '].low'),
          mid: num(m && m.mid, EQ_GAIN_MIN, EQ_GAIN_MAX, 'modes[' + i + '].mid'),
          high: num(m && m.high, EQ_GAIN_MIN, EQ_GAIN_MAX, 'modes[' + i + '].high'),
          pre: num(m && m.pre, EQ_GAIN_MIN, EQ_GAIN_MAX, 'modes[' + i + '].pre'),
          ...(m && m.q !== undefined ? { q: num(m.q, EQ_Q_MIN, EQ_Q_MAX, 'modes[' + i + '].q') } : {}),
          active: !(m && m.active === false),   // "active": false = desactivado (no sale al pulsar el visualizador)
        })),
      };
    }
  }

  // franjas de noticias (horas reales de emisión, hora de Madrid)
  const hms = v => {
    const m = typeof v === 'string' && v.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m || +m[1] > 23 || +m[2] > 59 || +(m[3] || 0) > 59) return null;
    return pad(+m[1]) + ':' + m[2] + ':' + (m[3] || '00');
  };
  (Array.isArray(raw.news) ? raw.news : []).forEach((n, i) => {
    const start = n && hms(n.start), end = n && hms(n.end);
    if (!start || !end) errors.push('"news[' + i + ']": "start" y "end" deben ser hh:mm:ss');
    else cfg.news.push({ start, end });
  });

  // cadena de noticias: el id de una de las cadenas
  if (raw.newsStation !== undefined && raw.newsStation !== null && raw.newsStation !== '') {
    if (typeof raw.newsStation !== 'string' || !ids.has(raw.newsStation)) errors.push('"newsStation": debe ser el "id" de una de las cadenas');
    else cfg.newsStationId = raw.newsStation;
  }
  if (cfg.news.length && !cfg.newsStationId && !errors.some(x => x.startsWith('"newsStation"'))) errors.push('"newsStation": hace falta la cadena de noticias si hay franjas');

  return { errors, cfg, parsed: raw };
}

// ========================================
// == VENTANA DE AJUSTES (PULSA LA HORA) ==
// ========================================
let applyConfigFn = null;
let applyLiveFn = null;
// main.js entrega aquí las funciones que aplican los ajustes (así este módulo no depende del resto de la aplicación): completa, y solo de emisoras (con la reproducción en marcha)
export function initSettingsDialog(fn, liveFn) { applyConfigFn = fn; applyLiveFn = liveFn; }

let lastMsg = '';
let silent = false;   // el menú de la rejilla muestra él mismo el error: no se duplica como aviso
function showCfgMsg(lines, isError) {
  const cls = 'cfgmsg' + (isError ? ' err' : ' ok');
  cfgMsg.className = stMsg.className = cls;
  cfgMsg.textContent = stMsg.textContent = lastMsg = lines.join('\n');
  if (!settingsDlg.open && !document.getElementById('tdtDlg').open && !silent) toast(lines[0]);   // sin la ventana abierta (arrastrar o editar desde la rejilla), el resultado se ve como aviso
}

// Pestañas de la ventana: Preferencias (reloj y audio), Datos (exportar e importar) y Registro (oculta salvo con "Mostrar", en Datos). El ecualizador y los boletines tienen su propia ventana.
// Al mostrarse, cada pestaña recibe el evento "show" para pintarse con los ajustes de ese momento
const tabPanels = { general: tabGeneral, config: tabConfig, log: tabLog };
settingsTabs.forEach(b => b.addEventListener('click', () => {
  settingsTabs.forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on)); });
  Object.keys(tabPanels).forEach(k => { tabPanels[k].hidden = k !== b.dataset.tab; });
  if (b.dataset.tab === 'log') logBox.scrollTop = 0;
  tabPanels[b.dataset.tab].dispatchEvent(new Event('show'));
  b.scrollIntoView({ block: 'nearest', inline: 'nearest' });   // en el móvil las pestañas pueden no caber: la elegida, a la vista
}));

// La pestaña Registro está oculta: "Mostrar" (Configuración) la saca y la abre, solo durante esta sesión; al cerrar y volver a abrir la aplicación vuelve a estar oculta
const SHOWLOG_KEY = 'rn_showlog';
const logTabBtn = [...settingsTabs].find(b => b.dataset.tab === 'log');
try { logTabBtn.hidden = sessionStorage.getItem(SHOWLOG_KEY) !== '1'; } catch (_) {}
logShow.addEventListener('click', () => {
  try { sessionStorage.setItem(SHOWLOG_KEY, '1'); } catch (_) {}
  logTabBtn.hidden = false;
  logTabBtn.click();
});

// Versión de la aplicación, al final de Configuración (la misma numeración en Neo y Proxy; se sube con cada cambio, como la caché de sw.js)
document.getElementById('appVer').textContent = 'Versión ' + APP_VERSION;

// Acerca de: la página /about, en otra pestaña para que la radio siga sonando
document.getElementById('aboutBtn').addEventListener('click', () => window.open(new URL('about/', document.baseURI), '_blank', 'noopener'));

function openSettings() {
  refreshDelayUi();
  outSelect.value = getOutMode();
  refreshNormSwitch();
  refreshExportBtn();
  cfgMsg.textContent = '';
  cfgMsg.className = 'cfgmsg';
  openDialog(settingsDlg);
  Object.values(tabPanels).forEach(p => { if (!p.hidden) p.dispatchEvent(new Event('show')); });
}

function closeSettings() {
  closeDialog(settingsDlg);
}

// Valida, aplica y guarda (en el navegador) unos ajustes importados desde archivo (o cambiados por la propia app). Se guardan solo los cambios sobre lo de por defecto.
// "live": cambio ya comprobado como seguro (ver editConfig), que se puede hacer con la reproducción en marcha; el resto exige pararla.
// opts.force: se aplica con applyLive aunque no suene nada (cambios de las pestañas Ecualizador y Boletines: no reinician el modo de ecualizador elegido);
// opts.report: dónde se cuentan los errores (por defecto, el aviso de Configuración); opts.quiet: sin aviso si todo va bien
function saveSettingsFrom(text, live = false, opts = {}) {
  const report = opts.report || showCfgMsg;
  const r = validateConfig(text);
  if (r.errors.length) { report(r.errors, true); return false; }
  const busy = S.session !== 'off' || S.trans || S.newsOn;
  if (busy && !live) {
    report([S.trans || S.newsOn ? 'No se pueden cambiar los ajustes durante un boletín o una transición' : 'Detén la reproducción para cambiar los ajustes'], true);
    return false;
  }
  if (busy || opts.force) applyLiveFn(r.cfg); else applyConfigFn(r.cfg);
  S.configText = text;
  const stored = !!defaults && saveChanges(diff(defaults, r.parsed, LISTS));
  const info = r.cfg.stations.length + ' cadenas, ' + r.cfg.news.length + ' franjas';
  if (!stored) {
    report(['Aplicado, pero NO se pudo guardar en este navegador (almacenamiento bloqueado): valdrá solo hasta cerrar la página'], true);
    log('Ajustes aplicados sin guardar: el navegador bloquea el almacenamiento');
    return false;
  }
  if (!opts.quiet) report(['Configuración importada: ' + info], false);
  log('Ajustes guardados: ' + info);
  return true;
}

settingsBtn.addEventListener('click', openSettings);

delayInput.addEventListener('input', () => {
  if (delayInput.value.trim() === '') { setManualDelay(0); return; }
  const n = parseNumber(delayInput.value);
  if (n !== null) setManualDelay(n);   // mientras se escribe "-" no se hace nada
});

autoDelay.addEventListener('change', () => setAutoDelay(autoDelay.checked));

// La normalización solo existe con Web Audio: en la salida nativa el interruptor queda bloqueado
function refreshNormSwitch() {
  normSwitch.checked = getNormOn();
  normSwitch.disabled = getOutMode() === 'nativa';
}

outSelect.addEventListener('change', async () => {
  await stopRecording();   // el audio se va a rehacer: si se estaba grabando, se cierra y se descarga lo grabado
  setOutMode(outSelect.value);
  refreshNormSwitch();
  restartAudio();
});

normSwitch.addEventListener('change', () => setNormOn(normSwitch.checked));

// Color personalizado por la cadena (activado por defecto): si está apagado, el color de énfasis es siempre el general (se guarda en el navegador)
const COLOR_KEY = 'rn_stcolor';
try { S.stationColors = localStorage.getItem(COLOR_KEY) !== '0'; } catch (_) {}   // activado salvo que se haya apagado
colorSwitch.checked = S.stationColors;
colorSwitch.addEventListener('change', () => {
  S.stationColors = colorSwitch.checked;
  try { localStorage.setItem(COLOR_KEY, S.stationColors ? '1' : '0'); } catch (_) {}
  log('Color personalizado por la cadena: ' + (S.stationColors ? 'activado' : 'desactivado'));
  syncAccentRow();
  refreshAccent();
});

// Color de fondo (solo PC; activado por defecto): la luz desde abajo con el sonido (glow.js)
bgSwitch.checked = glowOn();
bgSwitch.addEventListener('change', () => {
  setGlow(bgSwitch.checked);
  log('Color de fondo: ' + (bgSwitch.checked ? 'activado' : 'desactivado'));
});
// Agrupar opciones de sonido (solo móvil; activado por defecto): visualizador, ecualizador y volúmenes, uno a la vista y se desliza (grupo.js)
const groupSwitch = document.getElementById('groupSwitch');
groupSwitch.checked = groupOn();
groupSwitch.addEventListener('change', () => {
  setGroup(groupSwitch.checked);
  log('Agrupar opciones de sonido: ' + (groupSwitch.checked ? 'activado' : 'desactivado'));
});
// Material Design (PC y móvil; Desactivado, Estándar o Extremo; desactivado por defecto): sonando, la cabecera toma el color de énfasis y los textos se tiñen (styles.css)
matSelect.value = matMode();
matSelect.addEventListener('change', () => {
  setMaterial(matSelect.value);
  log('Material Design: ' + matSelect.options[matSelect.selectedIndex].text);
});

// Color por defecto (Ajustes > General): Índigo (el de serie), Verde, Azul, Rojo o uno personalizado con el selector. Solo cuenta con
// siempre (es el de cuando no suena nada y el de todas si "Color personalizado" está apagado). Se guarda en el navegador (rn_accent: "indigo", "green", "blue", "red" o "#rrggbb")
const ACCENT_KEY = 'rn_accent';
const ACCENT_GREEN = '#58dfa3', ACCENT_BLUE = '#38bdf8', ACCENT_RED = '#e5484d', ACCENT_INDIGO = '#566db9';   // el índigo, #566db9, es el de serie
function accentHex(v) { return v === 'green' ? ACCENT_GREEN : v === 'blue' ? ACCENT_BLUE : v === 'red' ? ACCENT_RED : v === 'indigo' ? ACCENT_INDIGO : /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : ACCENT_INDIGO; }
let accentSaved = 'indigo';
try { accentSaved = localStorage.getItem(ACCENT_KEY) || 'indigo'; } catch (_) {}
S.accent = accentHex(accentSaved);
accentSelect.value = ['indigo', 'green', 'blue', 'red'].includes(accentSaved) ? accentSaved : 'custom';
if (accentSelect.value === 'custom') accentPick.value = S.accent || ACCENT_INDIGO;
function syncAccentRow() {
  accentPick.hidden = accentSelect.value !== 'custom';
}
function setDefaultAccent(v) {
  try { localStorage.setItem(ACCENT_KEY, v); } catch (_) {}
  S.accent = accentHex(v);
  refreshAccent();
}
accentSelect.addEventListener('change', () => {
  syncAccentRow();
  setDefaultAccent(accentSelect.value === 'custom' ? usableColor(accentPick.value) : accentSelect.value);
  log('Color por defecto: ' + accentSelect.options[accentSelect.selectedIndex].text);
});
accentPick.addEventListener('input', () => {
  setDefaultAccent(usableColor(accentPick.value));   // demasiado oscuro: se aplica aclarado
});
accentPick.addEventListener('change', () => { accentPick.value = usableColor(accentPick.value); });   // el selector enseña el que se aplica
syncAccentRow();

settingsClose.addEventListener('click', closeSettings);

settingsDlg.addEventListener('click', e => { if (e.target === settingsDlg) closeSettings(); });

// Exportar: solo los cambios sobre lo de por defecto, en un archivo cifrado (datos.js); Importar: un archivo exportado
const EXPORT_NAME = 'radio_web_neo.json';
const FILE_KEY = 'OaN9Lj3846y5XezbRvOjl0oQeq9ACg34mJiukgH_qeo', FILE_KIND = 'rn-datos';
function refreshExportBtn() { cfgExport.disabled = !S.configText; }
cfgExport.addEventListener('click', async () => {
  const changes = loadChanges();
  if (isEmpty(changes)) { showCfgMsg(['Sin cambios que exportar'], false); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([await sealFile('config', changes, FILE_KEY, FILE_KIND)], { type: 'application/json' }));
  a.download = EXPORT_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  showCfgMsg(['Configuración exportada: ' + EXPORT_NAME], false);
});

cfgFile.addEventListener('click', () => cfgFileInput.click());

cfgFileInput.addEventListener('change', async () => {
  const file = cfgFileInput.files && cfgFileInput.files[0];
  if (!file) return;
  try {
    const f = await openFile(await file.text(), 'config', FILE_KEY, FILE_KIND);
    if (!f.ok) showCfgMsg(['Archivo no válido'], true);
    else saveSettingsFrom(configTextWith(f.value));
    refreshExportBtn();
  } catch (err) { showCfgMsg(['No se pudo leer el archivo: ' + err.message], true); }
  cfgFileInput.value = '';
});

// Script de personalización: se guarda en el navegador y se ejecuta al recargar la web; un solo botón: "Cargar" y, si ya hay uno guardado, "Eliminar" (en rojo)
let hasCustom = false;
async function refreshCustomBtn() {
  hasCustom = !!(await loadCustom()).trim();
  customBtn.textContent = hasCustom ? 'Eliminar' : 'Cargar';
  customBtn.classList.toggle('danger', hasCustom);
}
refreshCustomBtn();
customBtn.addEventListener('click', async () => {
  if (!hasCustom) { customInput.click(); return; }
  try { await saveCustom(''); log('personalizar.js eliminado: dejará de aplicarse al recargar la web'); } catch (_) {}
  refreshCustomBtn();
});
customInput.addEventListener('change', async () => {
  const file = customInput.files && customInput.files[0];
  customInput.value = '';
  if (!file) return;
  try {
    const bytes = await saveCustom(await file.text());
    log(bytes ? 'personalizar.js guardado (' + bytes + ' bytes): se aplicará al recargar la web' : 'personalizar.js quitado');
  } catch (err) { log('No se pudo guardar personalizar.js: ' + err.message); }
  refreshCustomBtn();
});

// Aviso de los botones de debajo de Exportar e Importar (recargar sonidos, borrar ajustes): en el cuadro de mensajes de Configuración
const showGenMsg = (text, isError) => showCfgMsg([text], isError);
cfgClearSounds.addEventListener('click', async () => {
  try { await caches.delete(SOUND_CACHE); prefetchSounds(); showGenMsg('Caché de sonidos recargada: los sonidos se han vuelto a descargar', false); }
  catch (_) { showGenMsg('Este navegador no tiene caché de sonidos (solo funciona en páginas https)', true); }
});

// Restablecer aplicación: se borra todo lo que la app guarda en este navegador (ajustes, preferencias, ecualizador, sonidos, grabaciones sin
// recuperar, script de personalización...) y se recarga como recién instalada, con la bienvenida. Solo se queda la propia web (caché rn-shell-)
async function wipeApp() {
  try { Object.keys(localStorage).filter(k => k.startsWith(APP_ID + '_')).forEach(k => localStorage.removeItem(k)); } catch (_) {}
  try { sessionStorage.clear(); } catch (_) {}
  try { await Promise.all((await caches.keys()).filter(k => !k.startsWith(APP_ID + '-shell-')).map(k => caches.delete(k))); } catch (_) {}
  try { indexedDB.deleteDatabase(APP_ID + '_rec'); } catch (_) {}
}
cfgClear.addEventListener('click', async () => {
  if (S.trans || S.newsOn) { showGenMsg('No se puede restablecer durante un boletín o una transición', true); return; }
  if (S.session !== 'off') { showGenMsg('Detén la reproducción para restablecer la aplicación', true); return; }
  if (!(await ask('¿Estás seguro?', 'Se borra todo lo guardado en este dispositivo y la aplicación vuelve a empezar', 'Eliminar todo', 'Cancelar', true))) return;
  await wipeApp();
  location.reload();
});


// ==============================================================
// == EMISORAS: AÑADIR, AÑADIR VARIANTE, REORDENAR Y ELIMINAR (ESCRIBE EL JSON) ==
// ==============================================================
// Todas las operaciones modifican los ajustes en uso, los validan y guardan los cambios sobre lo de por defecto.
const NOOP = Symbol('noop');
const slugOf = n => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cadena';
const kindOfUrl = url => (/\.m3u8(\?|#|$)/i.test(url) ? 'hls' : /\.(aac|acc)(\?|#|$)/i.test(url) ? 'aac' : 'mp3');
const groupOf = s => (s && s.group === 'musical' ? 'musical' : 'general');

// Las emisoras sin "id" lo reciben aquí (el mismo que les daría la validación), para poder identificarlas
function ensureIds(list) {
  const used = new Set(list.map(s => s && typeof s.id === 'string' && s.id.trim() ? s.id.trim() : null).filter(Boolean));
  list.forEach(s => {
    if (!s || typeof s !== 'object' || (typeof s.id === 'string' && s.id.trim())) return;
    const base = slugOf(typeof s.name === 'string' ? s.name : '');
    let id = base, n = 2;
    while (used.has(id)) id = base + '-' + n++;
    used.add(id);
    s.id = id;
  });
}

// Parte del JSON actual, aplica el cambio y lo guarda (mutate devuelve un texto de error, NOOP si no hay nada que hacer, o nada si todo va bien)
function editConfig(mutate, opts = {}) {
  const report = opts.report || showCfgMsg;
  let raw;
  const text = (S.configText || '').trim();
  if (!text) raw = { stations: [] };
  else {
    try { raw = parseJsonc(text); }
    catch (e) { report(['Los ajustes actuales no son un JSON válido; importa una configuración correcta (' + e.message + ')'], true); return false; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { report(['Los ajustes actuales deben ser un objeto { ... }'], true); return false; }
  if (!Array.isArray(raw.stations)) raw.stations = [];
  ensureIds(raw.stations);
  const err = mutate(raw);
  if (err === NOOP) return false;
  if (err) { report([err], true); return false; }
  return saveSettingsFrom(JSON.stringify(raw), true, { quiet: true, ...opts });
}
// Para las pestañas Ecualizador y Boletines: cambia los ajustes y los aplica sin reiniciar nada (report: su propio aviso)
export const editSettings = (mutate, report) => editConfig(mutate, { force: true, report });

// Con algo sonando, estas cadenas no se pueden quitar ni cambiar de tipo: las usa el audio (la actual, la que se retoma tras las noticias y la de noticias)
const busyNow = () => S.session !== 'off' || !!S.trans || S.newsOn;
const inUse = id => [S.current, S.lastPick, S.lastStation, S.newsStation].some(x => x && x.id === id);

// Arrastrar: la emisora ocupa el sitio de la de destino (si es de otro tipo, pasa a ese tipo)
function moveTo(raw, id, targetId) {
  const list = raw.stations;
  const from = list.findIndex(x => x && x.id === id), to = list.findIndex(x => x && x.id === targetId);
  if (from < 0 || to < 0) return 'No se encuentra la cadena';
  const target = list[to];
  if (busyNow() && groupOf(list[from]) !== groupOf(target) && inUse(id)) return 'No se puede pasar a otro tipo una cadena en uso mientras suena; cambia de cadena o detén la reproducción';
  const item = list.splice(from, 1)[0];
  const t = list.indexOf(target);
  list.splice(from < to ? t + 1 : t, 0, item);
  item.group = groupOf(target);
}

function removeStation(raw, id) {
  if (busyNow()) {
    if (S.trans || S.newsOn) return 'Hay un cambio de cadena o un boletín en curso: inténtalo en unos segundos';
    if (inUse(id)) return 'Esa cadena está en uso (suena o se retomará después): cambia de cadena o detén la reproducción para eliminarla';
  }
  if (raw.newsStation === id) return 'Es la cadena de noticias: cambia "newsStation" en la configuración (exportar, editar el archivo e importar) antes de eliminarla';
  raw.stations = raw.stations.filter(x => !(x && x.id === id));
}

// Quita solo una variante (URL) de una emisora que tiene varias
function removeVariant(raw, id, index) {
  const st = raw.stations.find(x => x && x.id === id);
  if (!st || !Array.isArray(st.urls) || st.urls.length < 2 || index < 0 || index >= st.urls.length) return 'No se encuentra esa emisora';
  if (busyNow() && (S.trans || S.newsOn || inUse(id))) return 'Esa cadena está en uso: cambia de cadena o detén la reproducción para quitarle una emisora';
  st.urls.splice(index, 1);
}

// Desde la rejilla (arrastrar y clic derecho)
editHooks.move = (id, targetId) => {
  const name = (S.stations.find(x => x.id === id) || {}).name || 'Emisora';
  if (editConfig(raw => moveTo(raw, id, targetId))) showCfgMsg(['Orden guardado: ' + name], false);
};
editHooks.removeVariant = (id, index) => {
  const st = S.stations.find(x => x.id === id);
  const u = st && st.urls[index];
  if (editConfig(raw => removeVariant(raw, id, index))) showCfgMsg(['Emisora eliminada: ' + (st ? st.name : '') + (u ? ' ' + u.label : '')], false);
};
editHooks.remove = id => {
  const name = (S.stations.find(x => x.id === id) || {}).name || 'Cadena';
  if (editConfig(raw => removeStation(raw, id))) showCfgMsg(['Cadena eliminada: ' + name], false);
};

// Formulario de alta
const field = id => document.getElementById(id);
field('stColorPick').addEventListener('input', () => { field('stColor').value = field('stColorPick').value; });
field('stColor').addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(field('stColor').value.trim())) field('stColorPick').value = field('stColor').value.trim(); });

// Comprobación de una URL de stream al añadirla (el usuario no elige formato, CORS ni calidad):
// - con una petición normal se ve si el servidor da CORS (si falla, se repite sin CORS: si responde, la URL vale pero sin CORS → modo degradado; si no, no se llega al servidor)
// - el formato sale de la cabecera Content-Type (o de la extensión); la calidad no se guarda: si el servidor la anuncia, el reproductor la lee en directo en cada conexión (deck.js)
export async function probeStream(url) {
  const out = { reachable: true, cors: true, kind: kindOfUrl(url) };
  const attempt = async mode => {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, 7000);
    try {
      const r = await fetch(url, { mode, signal: ctl.signal, cache: 'no-store' });
      const h = r.type === 'opaque' ? null : r.headers;
      const ct = h ? (h.get('content-type') || '').toLowerCase() : '';
      ctl.abort();   // basta con las cabeceras: no se sigue descargando el stream
      return { ok: true, ct };
    } catch (_) {
      return { ok: false, timedOut };
    } finally { clearTimeout(timer); }
  };
  let r = await attempt('cors');
  if (!r.ok) {
    if (r.timedOut) return out;                 // sin respuesta a tiempo: no se sabe; se deja con CORS y, si falla al sonar, la aplicación pasa sola a modo degradado
    const n = await attempt('no-cors');
    if (!n.ok) { if (n.timedOut) return out; out.reachable = false; return out; }
    out.cors = false;
    return out;
  }
  if (/mpegurl/.test(r.ct) || out.kind === 'hls') out.kind = 'hls';
  else if (/aac|mp4/.test(r.ct) || out.kind === 'aac') out.kind = 'aac';
  else out.kind = 'mp3';
  return out;
}

// Comprueba que el enlace sea válido para esta web (texto del error, o '' si vale)
function urlProblem(url) {
  if (!/^https?:\/\/\S+$/i.test(url)) return 'El enlace debe empezar por http:// o https://';
  if (location.protocol === 'https:' && /^http:/i.test(url)) return 'El enlace es http y esta web va por https: el navegador lo bloquearía. Usa la versión https del stream';
  return '';
}
// Variante (URL) tal como se guarda en el JSON, a partir de lo que dijo la comprobación (sin calidad: se lee en directo al sonar). El nombre es opcional; sin él, el formato
const variantOf = (url, p, name = '') => ({ label: name.trim().slice(0, 30) || p.kind.toUpperCase(), url, kind: p.kind, ...(p.cors ? {} : { cors: false }) });

// Crea una cadena nueva con una emisora (enlace comprobado). opts: { name, short, group, color, url, label }. Devuelve el texto del error, o '' si se creó
// (también la usa el importador de TDTChannels). El mensaje de éxito lo muestra showCfgMsg (en la pestaña, o como aviso si la ventana está cerrada)
export async function createChain(opts) {
  const name = (opts.name || '').trim();
  const url = (opts.url || '').trim();
  if (!name) return 'Escribe el nombre de la cadena';
  if (!url) return 'Escribe el enlace de la emisora';
  const bad = urlProblem(url);
  if (bad) return bad;
  const p = await probeStream(url);
  if (!p.reachable) return 'No se pudo conectar con ese enlace: revísalo o inténtalo de nuevo';
  // las musicales enlazan con el boletín de la cadena de noticias; las generalistas no (las que son de noticias, con "news": true en el archivo de configuración)
  const st = { name };
  const short = (opts.short || '').trim();
  if (short) st.short = short;
  st.group = opts.group === 'musical' ? 'musical' : 'general';
  st.urls = [variantOf(url, p, opts.label || '')];
  const color = (opts.color || '').trim();
  if (color) st.color = color;
  expandGroup(st.group);   // la rejilla de su tipo se despliega para que se vea el botón nuevo
  silent = true;
  let ok;
  try {
    ok = editConfig(raw => {
      const used = new Set(raw.stations.map(x => x && x.id));
      const base = slugOf(name);
      let id = base, n = 2;
      while (used.has(id)) id = base + '-' + n++;
      raw.stations.push({ id, ...st });
    });
  } finally { silent = false; }
  if (!ok) return lastMsg || 'No se pudo guardar';
  showCfgMsg(['Cadena añadida: ' + name + (p.cors ? '' : ' (sin CORS: sonará sin ecualizador ni visualizador real)')], false);
  return '';
}

// "Tengo un enlace" al crear una presintonía (ventana del catálogo, ver importer.js): cadena nueva con los datos del formulario.
// Los avisos van al cuadro de debajo del formulario; devuelve true si se creó
let adding = false;
export async function addChainFromForm() {
  if (adding) return false;
  if (!field('stName').value.trim()) { showCfgMsg(['Escribe el nombre de la cadena'], true); field('stName').focus(); return false; }
  const url = field('stUrl').value.trim();
  if (!url) { showCfgMsg(['Escribe el enlace del stream'], true); field('stUrl').focus(); return false; }
  const bad = urlProblem(url);
  if (bad) { showCfgMsg([bad], true); field('stUrl').focus(); return false; }
  adding = true;
  stAdd.disabled = true;
  stAdd.textContent = 'Comprobando…';
  showCfgMsg(['Comprobando el enlace…'], false);
  try {
    const err = await createChain({ name: field('stName').value, short: field('stShort').value, group: field('stType').value, color: field('stColor').value, url, label: field('stLabel').value });
    if (err) { showCfgMsg([err], true); return false; }
    stForm.reset();
    field('stColorPick').value = '#4da3ff';
    return true;
  } finally {
    adding = false;
    stAdd.disabled = false;
    stAdd.textContent = 'Añadir';
  }
}
export const lastSettingsMsg = () => lastMsg;

// Clic derecho en una emisora > "Añadir variante": se añade al final de sus URL (los números de las demás no cambian, así que se puede con algo sonando).
// Devuelve el texto del error (el menú lo muestra) o nada si se añadió
editHooks.addVariant = async (id, rawUrl, rawName) => {
  const url = (rawUrl || '').trim();
  const st = S.stations.find(x => x.id === id);
  if (!st) return 'No se encuentra la cadena';
  if (!url) return 'Escribe el enlace de la emisora';
  const bad = urlProblem(url);
  if (bad) return bad;
  if (st.urls.some(u => u.url === url)) return 'Esa URL ya es una emisora de esta cadena';
  const p = await probeStream(url);
  if (!p.reachable) return 'No se pudo conectar con ese enlace: revísalo o inténtalo de nuevo';
  const v = variantOf(url, p, rawName || '');
  silent = true;
  let ok;
  try {
    ok = editConfig(raw => {
      const s = raw.stations.find(x => x && x.id === id);
      if (!s) return 'La cadena ya no existe';
      if (!Array.isArray(s.urls)) s.urls = [];
      if (s.urls.some(u => u && u.url === url)) return 'Esa URL ya es una emisora de esta cadena';
      s.urls.push(v);
    });
  } finally { silent = false; }
  if (!ok) return lastMsg || 'No se pudo guardar';
  showCfgMsg(['Emisora añadida a ' + st.name + ': ' + v.label + (p.cors ? '' : ' (sin CORS: esa emisora sonará sin ecualizador ni visualizador real)')], false);
  return '';
};

// Clic derecho en una emisora > "Cambiar nombre…": cambia el nombre, el nombre corto del botón y el nombre de cada variante (vacío = el formato).
// El "id" no cambia, así que nada que dependa de él se rompe; se puede con la emisora sonando. Devuelve el texto del error o nada si se cambió
editHooks.rename = (id, rawName, rawShort, rawLabels = []) => {
  const name = (rawName || '').trim(), short = (rawShort || '').trim();
  if (!name) return 'Escribe el nombre de la cadena';
  silent = true;
  let ok;
  try {
    ok = editConfig(raw => {
      const s = raw.stations.find(x => x && x.id === id);
      if (!s) return 'La cadena ya no existe';
      s.name = name;
      if (short) s.short = short; else delete s.short;
      if (rawLabels.length) {
        if (!Array.isArray(s.urls)) { s.urls = s.url !== undefined ? [s.url] : []; delete s.url; }
        s.urls = s.urls.map((u, i) => {
          if (i >= rawLabels.length) return u;
          const o = typeof u === 'string' ? { url: u } : u;
          const label = String(rawLabels[i] || '').trim().slice(0, 30);
          if (label) o.label = label; else delete o.label;   // sin nombre, el formato
          return o;
        });
      }
    });
  } finally { silent = false; }
  if (!ok) return lastMsg || 'No se pudo guardar';
  showCfgMsg(['Nombres guardados: ' + name], false);
  return '';
};
