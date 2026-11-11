// ===============
// == PRINCIPAL ==
// ===============
// Punto de entrada: aplica los ajustes y arranca la aplicación.

import { emptyConfigFn, fetchDefaultConfigText, initSettingsDialog, loadConfigText, syncDefaults, validateConfig } from './settings.js';
import { S } from './state.js';
import { stop, toggle } from './dom.js';
import { layoutCheck, log } from './ui.js';
import { runCustom } from './custom.js';
import { refreshEq, refreshVolumeUi, resetEq } from './audio.js';
import { ensureSounds, ARTWORK_URL } from './sounds.js';
import { buildStations, refreshStations, restoreLast } from './stations.js';
import { rebuildSlots, slotPlan, tick } from './boletines.js';
import { loadArtwork } from './mediasession.js';
import { play, syncUi } from './player.js';
import { initClock } from './clock.js';
import { checkUnfinished, requestStop } from './recorder.js';
import './presentation.js';
import './importer.js';

// ===============================
// == APLICACIÓN DE LOS AJUSTES ==
// ===============================

let started = false;   // mientras se cargan los ajustes al arrancar, el modo de ecualizador guardado no se toca

// Aplica unos ajustes ya validados: emisoras, franjas y sonidos
function applyConfig(cfg) {
  S.configLoaded = cfg.stations.length > 0;
  document.body.classList.toggle('no-config', !S.configLoaded);   // sin ajustes, los paneles quedan vacíos
  refreshVolumeUi();                                               // y los volúmenes, bloqueados
  S.accent = cfg.accent || '';                                     // color de énfasis general (vacío = verde por defecto)
  const eq = cfg.eq || { modes: [] };
  if (started && JSON.stringify(eq) !== JSON.stringify(S.eq)) resetEq();   // ajustes distintos o borrados: se olvida el modo guardado
  S.eq = eq;
  refreshEq();
  S.artwork = ARTWORK_URL;   // fija, en el código
  loadArtwork();
  S.stations = cfg.stations;
  S.defaultDelayS = cfg.defaultDelayS;
  S.newsStation = cfg.stations.find(x => x.id === cfg.newsStationId) || null;
  S.news = cfg.news;
  rebuildSlots();
  slotPlan.clear();
  S.skippedSlot = -1;
  S.current = null;
  restoreLast();
  buildStations();
  refreshStations();
  if (S.newsMode) ensureSounds();
}

// Cambio de emisoras con la reproducción en marcha (añadir, reordenar, eliminar una que no suena): se conservan los objetos de emisora que ya existen
// (los decks y el estado apuntan a ellos) y solo se redibuja la rejilla. Lo demás de los ajustes no se toca.
function applyLive(cfg) {
  const old = new Map(S.stations.map(x => [x.id, x]));
  S.stations = cfg.stations.map(n => {
    const o = old.get(n.id);
    if (!o) return n;
    Object.keys(o).forEach(k => { if (!(k in n)) delete o[k]; });   // lo que ya no está (nombre corto, color...) se borra; Object.assign solo añade y cambia
    Object.assign(o, n);
    return o;
  });
  S.newsStation = S.stations.find(x => x.id === cfg.newsStationId) || null;
  if (S.lastStation && !S.stations.includes(S.lastStation)) restoreLast();
  buildStations();
  refreshStations();
}

// ==============
// == ARRANQUE ==
// ==============

initSettingsDialog(applyConfig, applyLive);
initClock();
refreshVolumeUi();
toggle.addEventListener('click', () => play());
stop.addEventListener('click', () => requestStop());   // grabando, se pregunta antes (ver recorder.js)

// Los ajustes guardados en el navegador mandan; si no hay (o no son válidos), los de por defecto (stations.json)
async function loadSettings() {
  const stored = loadConfigText();
  let r = stored ? validateConfig(stored) : null;
  if (r && r.errors.length) { log('Los ajustes guardados no son válidos: ' + r.errors[0]); r = null; }
  let source = 'guardados';
  if (!r) {
    const def = await fetchDefaultConfigText();
    r = def ? validateConfig(def) : null;
    if (r && r.errors.length) { log('Los ajustes por defecto no son válidos: ' + r.errors[0]); r = null; }
    source = 'por defecto';
  }
  if (!r) { applyConfig(emptyConfigFn()); log('Sin ajustes'); return ''; }
  applyConfig(r.cfg);
  S.configText = stored && source === 'por defecto' ? stored : JSON.stringify(r.parsed, null, 2);   // si lo guardado no vale, se deja a la vista para corregirlo
  log('Ajustes ' + source + ': ' + r.cfg.stations.length + ' cadenas, ' + r.cfg.news.length + ' franjas');
  return source;
}

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});   // permite instalarla como app (PWA)
}

loadSettings().then(source => {
  started = true;
  syncUi();
  layoutCheck();
  tick();
  setInterval(tick, 1000);
  runCustom();   // personalizar.js (si el usuario lo ha subido): lo último de todo
  checkUnfinished();   // si quedó una grabación a medias (se cerró la página grabando), se ofrece descargarla
  if (source === 'guardados') syncDefaults();   // por detrás: las cadenas por defecto que no se han tocado se ponen al día con stations.json
});
