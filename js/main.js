// ===============
// == PRINCIPAL ==
// ===============
// Punto de entrada: aplica los ajustes y arranca la aplicación.

import { configTextWith, emptyConfigFn, initSettingsDialog, loadDefaults, validateConfig } from './settings.js';
import { S, APP_ID } from './state.js';
import { stop, toggle } from './dom.js';
import { layoutCheck, log } from './ui.js';
import { runCustom } from './custom.js';
import { refreshEq, refreshVolumeUi, resetEq } from './audio.js';
import { ensureSounds } from './sounds.js';
import { buildStations, refreshStations, restoreLast } from './stations.js';
import { rebuildSlots, slotPlan, tick } from './boletines.js';
import { artworkSrc, loadArtwork } from './mediasession.js';
import { play, resumePlayback, syncUi } from './player.js';
import { initClock, setCfgStreamDelay } from './clock.js';
import { checkUnfinished, requestStop } from './recorder.js';
import './presentation.js';
import './importer.js';
import './intro.js';
import './eqtab.js';
import './newstab.js';
import './glow.js';
import './grupo.js';
import './backguard.js';
import { setFootPhrases } from './foot.js';
import { initStats } from './stats.js';

// ===============================
// == APLICACIÓN DE LOS AJUSTES ==
// ===============================

let started = false;   // mientras se cargan los ajustes al arrancar, el modo de ecualizador guardado no se toca

// Aplica unos ajustes ya validados: emisoras, franjas y sonidos
function applyConfig(cfg) {
  S.configLoaded = cfg.stations.length > 0;
  document.body.classList.toggle('no-config', !S.configLoaded);   // sin ajustes, los paneles quedan vacíos
  refreshVolumeUi();                                               // y los volúmenes, bloqueados
  const eq = cfg.eq || { modes: [] };
  if (started && JSON.stringify(eq) !== JSON.stringify(S.eq)) resetEq();   // ajustes distintos o borrados: se olvida el modo guardado
  S.eq = eq;
  refreshEq();
  S.artwork = artworkSrc();   // la elegida en Preferencias
  loadArtwork();
  S.stations = cfg.stations;
  setCfgStreamDelay(cfg.defaultDelayS);   // salvo que se haya cambiado en General (clock.js)
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

// Cambio de emisoras con la reproducción en marcha (añadir, reordenar, eliminar una que no suena), y del ecualizador y las franjas: se conservan los objetos de emisora que ya existen
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
  // ecualizador y franjas (pestañas Ecualizador y Boletines): se cambian sin olvidar el modo de ecualizador elegido; las franjas, fuera de un boletín
  const eq = cfg.eq || { modes: [] };
  if (JSON.stringify(eq) !== JSON.stringify(S.eq)) { S.eq = eq; refreshEq(); }
  if (JSON.stringify(cfg.news) !== JSON.stringify(S.news) && !S.newsOn && !S.trans) {
    S.news = cfg.news;
    rebuildSlots();
    slotPlan.clear();
    S.skippedSlot = -1;
  }
  if (S.lastStation && !S.stations.includes(S.lastStation)) restoreLast();
  buildStations();
  refreshStations();
}

// ==============
// == ARRANQUE ==
// ==============

initSettingsDialog(applyConfig, applyLive);
initClock();
setFootPhrases(['Con ❤️ por la 📻', '¡Viva la radio siempre!']);   // pie: se alternan cada 30 s
refreshVolumeUi();
toggle.addEventListener('click', () => (S.held ? resumePlayback() : play()));   // en pausa desde la notificación, Reproducir la reanuda en directo
stop.addEventListener('click', () => requestStop());   // grabando, se pregunta antes (ver recorder.js)

// Ajustes: lo de por defecto (default/) con los cambios guardados en el navegador; si esos cambios ya no valen, lo de por defecto
async function loadSettings() {
  if (!(await loadDefaults())) { applyConfig(emptyConfigFn()); log('Sin ajustes'); return; }
  let text = configTextWith(), r = validateConfig(text);
  if (r.errors.length) {
    log('Los cambios guardados no son válidos: ' + r.errors[0]);
    text = configTextWith({});
    r = validateConfig(text);
  }
  if (r.errors.length) { applyConfig(emptyConfigFn()); log('Los ajustes por defecto no son válidos: ' + r.errors[0]); return; }
  applyConfig(r.cfg);
  S.configText = text;
  log('Ajustes: ' + r.cfg.stations.length + ' cadenas, ' + r.cfg.news.length + ' franjas');
}

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});   // permite instalarla como app (PWA)
}

loadSettings().then(() => {
  started = true;
  syncUi();
  layoutCheck();
  tick();
  setInterval(tick, 1000);
  runCustom();   // personalizar.js (si el usuario lo ha subido): lo último de todo
  checkUnfinished();   // si quedó una grabación a medias (se cerró la página grabando), se ofrece descargarla
  initStats(APP_ID);   // estadística anónima (usuarios por día y tiempo de escucha, ver js/stats.js)
});
