// ============================================================
// == AJUSTES: ALMACENAMIENTO, VALIDACIÓN Y VENTANA ==
// ============================================================
// Los ajustes (emisoras, noticias, ecualizador y color) vienen por defecto en stations.json (dentro del proyecto) y se pueden cambiar pegando otros
// o cargándolos desde un archivo en la ventana de ajustes; lo que se guarda va al navegador (localStorage: no viaja a ningún servidor) y sustituye
// al de por defecto hasta que se borra. La pestaña General reúne los ajustes propios de cada navegador: retraso del reloj, salida de audio,
// normalización, color personalizado por cadena y script de personalización (custom.js).

import { pad, parseNumber } from './utils.js';
import { S, DEFAULT_DELAY_S, SOUND_CACHE } from './state.js';
import { autoDelay, cfgClear, cfgClearSounds, cfgFile, cfgFileInput, cfgMsg, cfgSave, cfgText, colorSwitch, customBtn, customInput, delayInput, normSwitch, outSelect, settingsClose, settingsDlg, settingsTabs, statusBox, tabConfig, tabGeneral, tabLog, logBox, tabStations, stForm, stMsg, stAdd } from './dom.js';
import { closeDialog, log, openDialog, toast } from './ui.js';
import { prefetchSounds } from './sounds.js';
import { getNormOn, getOutMode, setNormOn, setOutMode } from './audio.js';
import { restartAudio } from './player.js';
import { editHooks, expandGroup, refreshAccent } from './stations.js';
import { loadCustom, saveCustom } from './custom.js';
import { refreshDelayUi, setAutoDelay, setManualDelay } from './clock.js';
import { forgetNoCors } from './deck.js';

// ====================================
// == ALMACENAMIENTO EN EL NAVEGADOR ==
// ====================================
const CFG_KEY = 'rn_cfg';
export const loadConfigText = () => { try { return localStorage.getItem(CFG_KEY) || ''; } catch (_) { return ''; } };
function saveConfigText(text) {
  try { localStorage.setItem(CFG_KEY, text); return true; } catch (_) { return false; }
}
function clearConfigStorage() { try { localStorage.removeItem(CFG_KEY); localStorage.removeItem(BASE_KEY); } catch (_) {} }
// Las cadenas por defecto (stations.json) de las que partió lo guardado: sirven para saber qué ha tocado el usuario y qué no (ver syncDefaults)
const BASE_KEY = 'rn_cfg_base';
function loadBase() {
  try { const b = JSON.parse(localStorage.getItem(BASE_KEY)); return Array.isArray(b) ? b : null; } catch (_) { return null; }
}
function saveBase(list) { try { localStorage.setItem(BASE_KEY, JSON.stringify(list)); } catch (_) {} }
let lastDefaultStations = null;   // las cadenas del último stations.json leído

// Ajustes por defecto: stations.json, dentro del proyecto. Devuelve el texto (null si no se pudo descargar)
export async function fetchDefaultConfigText() {
  try {
    const res = await fetch('stations.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    try { const d = JSON.parse(stripJsonComments(text)); if (d && Array.isArray(d.stations) && d.stations.length) lastDefaultStations = d.stations; } catch (_) {}
    return text;
  } catch (err) {
    log('No se pudieron cargar los ajustes por defecto (stations.json): ' + ((err && err.message) || err));
    return null;
  }
}

// ===============================
// == VALIDACIÓN DE LOS AJUSTES ==
// ===============================
// Ajustes vacíos: lo que se aplica si no hay ninguno válido
const emptyConfig = () => ({
  accent: '', eq: { modes: [] }, defaultDelayS: DEFAULT_DELAY_S,
  stations: [], newsStationId: null, news: [],
});
export const emptyConfigFn = emptyConfig;

// Ecualizador: límites de las ganancias en dB (bandas y preamplificación)
const EQ_GAIN_MIN = -24;
const EQ_GAIN_MAX = 18;

// Color de énfasis: luminosidad relativa (0 negro – 1 blanco) de un "#rrggbb"
const luminance = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
                     .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ACCENT_MIN_LUM = 0.15;   // por debajo, el color se pierde sobre el fondo oscuro y el texto oscuro de los botones no se lee

function stripJsonComments(text) {
  return text
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n\r]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '')
    .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (m, str, tail) => str || tail);
}
export function validateConfig(text) {
  const errors = [];
  let raw;
  try { raw = JSON.parse(stripJsonComments(text)); }
  catch (e) { return { errors: ['JSON no válido: ' + e.message] }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['El contenido debe ser un objeto { ... }'] };
  const cfg = emptyConfig();
  const color = (v, where) => {   // "#rrggbb" con luminosidad suficiente sobre el fondo oscuro; null si no es válido (y lo anota)
    const a = typeof v === 'string' ? v.trim() : '';
    if (!/^#[0-9a-f]{6}$/i.test(a)) { errors.push('"' + where + '": debe ser un color #rrggbb (por ejemplo "#4da3ff")'); return null; }
    if (luminance(a) < ACCENT_MIN_LUM) { errors.push('"' + where + '": demasiado oscuro sobre el fondo oscuro; prueba un tono más claro'); return null; }
    return a.toLowerCase();
  };

  // color de énfasis (opcional): "#rrggbb"; si falta, se queda el verde por defecto (el de styles.css)
  if (raw.accent !== undefined && raw.accent !== null && raw.accent !== '') cfg.accent = color(raw.accent, 'accent') || '';

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
    const item = { id, name, group: s.group === 'musical' ? 'musical' : 'general', urls, cors: s.cors !== false, news: !!s.news };
    if (typeof s.short === 'string' && s.short.trim()) item.short = s.short.trim().slice(0, 14);   // nombre corto para el botón de la rejilla
    if (s.color !== undefined && s.color !== null && s.color !== '') { const c = color(s.color, where + '.color'); if (c) item.color = c; }
    cfg.stations.push(item);
  });

  // ecualizador (opcional): sin bloque "eq" o sin modos no hay ecualizador; con modos hacen falta las cuatro frecuencias/Q
  if (raw.eq && typeof raw.eq === 'object') {
    const e = raw.eq, modes = Array.isArray(e.modes) ? e.modes : [];
    const num = (v, lo, hi, name, required) => {
      if (v === undefined) { if (required) errors.push('"eq.' + name + '": falta'); return required ? null : 0; }
      const n = Number(v);
      if (!isFinite(n) || n < lo || n > hi) { errors.push('"eq.' + name + '": debe estar entre ' + lo + ' y ' + hi); return required ? null : 0; }
      return n;
    };
    if (modes.length > 5) errors.push('"eq.modes": máximo 5 modos');
    // modo que se usa mientras no se elija otro pulsando el visualizador: posición en "modes" (0 = el primero; sin él, el ecualizador empieza plano)
    let defaultMode = -1;
    if (e.defaultMode !== undefined) {
      const n = Number(e.defaultMode);
      if (!Number.isInteger(n) || n < 0 || n >= Math.min(modes.length, 5)) errors.push('"eq.defaultMode": debe ser un número entre 0 y ' + (Math.min(modes.length, 5) - 1) + ' (posición en "modes")');
      else defaultMode = n;
    }
    if (modes.length) {
      cfg.eq = {
        lowHz: num(e.lowHz, 20, 500, 'lowHz', true),
        midHz: num(e.midHz, 200, 8000, 'midHz', true),
        midQ: num(e.midQ, 0.1, 10, 'midQ', true),
        highHz: num(e.highHz, 2000, 16000, 'highHz', true),
        defaultMode,
        modes: modes.slice(0, 5).map((m, i) => ({
          label: m && m.label !== undefined ? String(m.label).slice(0, 24) : 'EQ ' + (i + 1),
          low: num(m && m.low, EQ_GAIN_MIN, EQ_GAIN_MAX, 'modes[' + i + '].low'),
          mid: num(m && m.mid, EQ_GAIN_MIN, EQ_GAIN_MAX, 'modes[' + i + '].mid'),
          high: num(m && m.high, EQ_GAIN_MIN, EQ_GAIN_MAX, 'modes[' + i + '].high'),
          pre: num(m && m.pre, EQ_GAIN_MIN, EQ_GAIN_MAX, 'modes[' + i + '].pre'),
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
  if (!settingsDlg.open && !silent) toast(lines[0]);   // sin la ventana abierta (arrastrar o editar desde la rejilla), el resultado se ve como aviso
}

// Pestañas de la ventana: General (reloj y audio), Cadena (alta de emisoras), Configuración (el texto con los ajustes) y Registro
const tabPanels = { general: tabGeneral, stations: tabStations, config: tabConfig, log: tabLog };
settingsTabs.forEach(b => b.addEventListener('click', () => {
  settingsTabs.forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on)); });
  Object.keys(tabPanels).forEach(k => { tabPanels[k].hidden = k !== b.dataset.tab; });
  if (b.dataset.tab === 'log') logBox.scrollTop = 0;
}));

function openSettings() {
  refreshDelayUi();
  outSelect.value = getOutMode();
  refreshNormSwitch();
  cfgText.value = S.configText;
  cfgMsg.textContent = stMsg.textContent = '';
  cfgMsg.className = stMsg.className = 'cfgmsg';
  openDialog(settingsDlg);
}

function closeSettings() {
  closeDialog(settingsDlg);
}

// Valida, aplica y guarda (en el navegador) unos ajustes escritos o cargados desde archivo
// "live": cambio de emisoras ya comprobado como seguro (ver editConfig), que se puede hacer con la reproducción en marcha; el resto exige pararla
function saveSettingsFrom(text, live = false) {
  const r = validateConfig(text);
  if (r.errors.length) { showCfgMsg(r.errors, true); return false; }
  const busy = S.session !== 'off' || S.trans || S.newsOn;
  if (busy && !live) {
    showCfgMsg([S.trans || S.newsOn ? 'No se pueden cambiar los ajustes durante un boletín o una transición' : 'Detén la reproducción para cambiar los ajustes'], true);
    return false;
  }
  if (busy) applyLiveFn(r.cfg); else applyConfigFn(r.cfg);
  S.configText = JSON.stringify(r.parsed, null, 2);
  const stored = saveConfigText(JSON.stringify(r.parsed));
  cfgText.value = S.configText;
  const info = r.cfg.stations.length + ' cadenas, ' + r.cfg.news.length + ' franjas';
  if (!stored) {
    showCfgMsg(['Aplicado, pero NO se pudo guardar en este navegador (almacenamiento bloqueado): valdrá solo hasta cerrar la página'], true);
    log('Ajustes aplicados sin guardar: el navegador bloquea el almacenamiento');
    return false;
  }
  if (!loadBase() && lastDefaultStations) saveBase(lastDefaultStations);   // primera vez que se guarda: se anota de qué cadenas por defecto se partió
  showCfgMsg(['Guardado: ' + info], false);
  log('Ajustes guardados: ' + info);
  return true;
}

// ==========================================================
// == LO GUARDADO Y LAS CADENAS POR DEFECTO (stations.json) ==
// ==========================================================
// Lo guardado en el navegador manda, pero solo en lo que el usuario ha tocado. Al arrancar con ajustes guardados se compara, cadena por cadena y dato por dato
// (nombre, nombre corto, tipo, color, CORS, noticias y emisoras), el stations.json de ahora con el que había cuando se guardó (rn_cfg_base):
//  - lo que ha cambiado por defecto y el usuario no había tocado se actualiza (por ejemplo, la URL nueva de un stream);
//  - lo que el usuario cambió se queda como lo dejó, y una cadena que eliminó no vuelve;
//  - una cadena nueva por defecto aparece, detrás de la que la precede en stations.json;
//  - el orden del usuario se respeta, y las cadenas que desaparecen de stations.json no se le quitan.
// Solo las cadenas: franjas, ecualizador, retraso, color general y cadena de noticias guardados no se tocan.
const SYNC_FIELDS = ['name', 'short', 'group', 'color', 'cors', 'news', 'urls'];
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copyJson = v => JSON.parse(JSON.stringify(v));
// Cadenas ya validadas (con los valores por omisión puestos), por id: así se comparan sin que importe cómo estén escritas
function normById(list) {
  const r = validateConfig(JSON.stringify({ stations: list }));
  return new Map(((r.cfg && r.cfg.stations) || []).map(s => [s.id, s]));
}
// Aplica a raw (los ajustes guardados) los cambios entre base y def (cadenas por defecto de antes y de ahora). Devuelve qué ha cambiado (textos para el registro)
function mergeDefaults(raw, base, def) {
  ensureIds(raw.stations);
  const U = normById(raw.stations), B = normById(base), D = normById(def);
  const rawU = new Map(raw.stations.filter(x => x && x.id).map(x => [x.id, x]));
  const notes = [];
  def.forEach((d, i) => {
    const nd = d && D.get(d.id);
    if (!nd) return;
    const nb = B.get(d.id);
    if (!nb) {   // cadena nueva por defecto
      if (rawU.has(d.id)) return;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) { const p = raw.stations.indexOf(rawU.get(def[j] && def[j].id)); if (p >= 0) { at = p + 1; break; } }
      const item = copyJson(d);
      raw.stations.splice(at, 0, item);
      rawU.set(d.id, item);
      notes.push(nd.name + ' (nueva)');
      return;
    }
    const nu = U.get(d.id), ru = rawU.get(d.id);
    if (!nu || !ru) return;   // el usuario la eliminó
    let changed = false;
    for (const f of SYNC_FIELDS) {
      if (sameJson(nd[f], nb[f]) || !sameJson(nu[f], nb[f])) continue;   // no ha cambiado por defecto, o el usuario lo tocó
      if (f === 'urls') { ru.urls = copyJson(d.urls !== undefined ? d.urls : [d.url]); delete ru.url; }
      else if (d[f] === undefined) delete ru[f];
      else ru[f] = copyJson(d[f]);
      changed = true;
    }
    if (changed) notes.push(nu.name);
  });
  return notes;
}

// Al arrancar con ajustes guardados (main.js): lee stations.json por detrás y pone al día lo que el usuario no ha tocado. Si algo suena o la ventana de ajustes
// está abierta, no hace nada y lo deja para el siguiente arranque
export async function syncDefaults() {
  const text = await fetchDefaultConfigText();
  const def = text ? lastDefaultStations : null;
  if (!def) return;
  const base = loadBase();
  if (!base) { saveBase(def); return; }   // guardado antes de existir esto: no se sabe de qué partió; se anota lo de ahora y vale de aquí en adelante
  if (sameJson(base, def)) return;
  if (S.session !== 'off' || S.trans || S.newsOn || S.newsMode || settingsDlg.open) return;
  let raw;
  try { raw = JSON.parse(stripJsonComments(S.configText || '')); } catch (_) { return; }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.stations)) return;
  const notes = mergeDefaults(raw, base, def);
  if (notes.length) {
    const r = validateConfig(JSON.stringify(raw));
    if (r.errors.length) { log('No se pudieron poner al día las cadenas por defecto: ' + r.errors[0]); return; }
    if (!saveConfigText(JSON.stringify(r.parsed))) return;
    applyConfigFn(r.cfg);
    S.configText = JSON.stringify(r.parsed, null, 2);
    log('Cadenas por defecto puestas al día: ' + notes.join(', '));
  }
  saveBase(def);
}

statusBox.addEventListener('click', openSettings);

statusBox.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSettings(); } });

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

outSelect.addEventListener('change', () => {
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
  refreshAccent();
});

settingsClose.addEventListener('click', closeSettings);

settingsDlg.addEventListener('click', e => { if (e.target === settingsDlg) closeSettings(); });

cfgSave.addEventListener('click', () => saveSettingsFrom(cfgText.value));

cfgFile.addEventListener('click', () => cfgFileInput.click());

cfgFileInput.addEventListener('change', async () => {
  const file = cfgFileInput.files && cfgFileInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    cfgText.value = text;
    saveSettingsFrom(text);
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

cfgClearSounds.addEventListener('click', async () => {
  try { await caches.delete(SOUND_CACHE); showCfgMsg(['Caché de sonidos vaciada. Se volverán a descargar'], false); prefetchSounds(); }
  catch (_) { showCfgMsg(['Este navegador no tiene caché de sonidos (solo funciona en páginas https)'], true); }
});

// Borrar los ajustes guardados: se vuelve a los de por defecto (stations.json)
cfgClear.addEventListener('click', async () => {
  if (S.trans || S.newsOn) { showCfgMsg(['No se pueden borrar los ajustes durante un boletín o una transición'], true); return; }
  if (S.session !== 'off') { showCfgMsg(['Detén la reproducción para cambiar los ajustes'], true); return; }
  clearConfigStorage();
  forgetNoCors();
  const text = await fetchDefaultConfigText();
  const r = text ? validateConfig(text) : null;
  if (r && !r.errors.length) {
    applyConfigFn(r.cfg);
    S.configText = JSON.stringify(r.parsed, null, 2);
    cfgText.value = S.configText;
    showCfgMsg(['Ajustes guardados borrados: se usan los de por defecto'], false);
  } else {
    applyConfigFn(emptyConfig());
    S.configText = '';
    cfgText.value = '';
    showCfgMsg(['Ajustes borrados, pero no se pudieron cargar los de por defecto'], true);
  }
});


// ==============================================================
// == EMISORAS: AÑADIR, AÑADIR VARIANTE, REORDENAR Y ELIMINAR (ESCRIBE EL JSON) ==
// ==============================================================
// Todas las operaciones modifican el JSON de los ajustes (el mismo de la pestaña Configuración), lo validan y lo guardan como si se hubiera escrito a mano.
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
function editConfig(mutate) {
  let raw;
  const text = (S.configText || '').trim();
  if (!text) raw = { stations: [] };
  else {
    try { raw = JSON.parse(stripJsonComments(text)); }
    catch (e) { showCfgMsg(['Los ajustes actuales no son un JSON válido; corrígelos antes en Configuración (' + e.message + ')'], true); return false; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { showCfgMsg(['Los ajustes actuales deben ser un objeto { ... }'], true); return false; }
  if (!Array.isArray(raw.stations)) raw.stations = [];
  ensureIds(raw.stations);
  const err = mutate(raw);
  if (err === NOOP) return false;
  if (err) { showCfgMsg([err], true); return false; }
  return saveSettingsFrom(JSON.stringify(raw), true);
}

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
  if (raw.newsStation === id) return 'Es la cadena de noticias: elige otra en "newsStation" (pestaña Configuración) antes de eliminarla';
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
  // las musicales enlazan con el boletín de la cadena de noticias; las generalistas no (las que son de noticias, a mano en Configuración con "news": true)
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

let adding = false;
async function addStationFromForm() {
  if (adding) return;
  if (!field('stName').value.trim()) { showCfgMsg(['Escribe el nombre de la cadena'], true); field('stName').focus(); return; }
  const url = field('stUrl').value.trim();
  if (!url) { showCfgMsg(['Escribe el enlace del stream'], true); field('stUrl').focus(); return; }
  const bad = urlProblem(url);
  if (bad) { showCfgMsg([bad], true); field('stUrl').focus(); return; }
  adding = true;
  stAdd.disabled = true;
  stAdd.textContent = 'Comprobando…';
  showCfgMsg(['Comprobando el enlace…'], false);
  try {
    const err = await createChain({ name: field('stName').value, short: field('stShort').value, group: field('stType').value, color: field('stColor').value, url });
    if (err) { showCfgMsg([err], true); return; }
    stForm.reset();
    field('stColorPick').value = '#4da3ff';
  } finally {
    adding = false;
    stAdd.disabled = false;
    stAdd.textContent = 'Añadir';
  }
}
stAdd.addEventListener('click', addStationFromForm);
stForm.addEventListener('submit', e => { e.preventDefault(); addStationFromForm(); });

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
