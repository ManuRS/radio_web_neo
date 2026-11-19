// ================
// == REPRODUCTOR ==
// ================
// La sesión de escucha: pulsar Reproducir, Detener y la pausa retenida de la notificación. Aquí viven el deck que suena (main) y el de las noticias en
// espera (newsDeck). Los cambios de emisora con fundido van en transitions.js; la rejilla de emisoras, en stations.js.

import { S, FADE_S, endNewsState } from './state.js';
import { Deck } from './deck.js';
import { applyVolume, deckHooks, decks, fadeDeck, initAudioGraph, refreshEq, releaseDeck, setFade, viz } from './audio.js';
import { log, setStatus, toast, updateButtons } from './ui.js';
import { cancelTransition } from './transitions.js';
import { clearMediaSession, scheduleMediaTitle, setPlaybackState } from './mediasession.js';
import { refreshStations } from './stations.js';
import { refreshRecBtn } from './recorder.js';
import { anchorOk, setAnchor, wakeAnchor } from './anchor.js';

let main = null;       // deck que suena (o al que se está entrando)
let newsDeck = null;   // deck de la emisora de noticias, conectado en silencio a la espera de la hora
let waitPaused = false;   // esperando las noticias sin música, se ha pulsado la pausa de la notificación
let keepAnchor = false;   // se detiene para volver a entrar enseguida: el ancla no se toca
let wasWaiting = false;

export const getMain = () => main;
export const getNewsDeck = () => newsDeck;

// ======================
// == ABRIR Y CERRAR DECKS ==
// ======================

// Abre una emisora en silencio (fundido a 0). giveUp: nº de fallos tras los que se renuncia (los decks que preparan una entrada renuncian antes)
export function openDeck(station, variant = 0, opts = {}) {
  const d = new Deck(station, variant, deckHooks, opts);
  d.on.playing = () => { if (d === main) { syncUi(); scheduleMediaTitle(); } };
  d.on.quality = () => { if (d === main) syncUi(); };
  d.on.retry = () => { if (d === main) syncUi(); };
  d.on.failed = () => { if (d === main) syncUi(); };
  // el navegador no dejó iniciar el audio (falta un gesto): se para todo para que se pueda volver a pulsar Reproducir, en vez de quedarse en "Conectando…"
  d.on.blocked = () => {
    if (d !== main) return;
    log('El navegador ha bloqueado el audio de ' + d.station.name + ': hace falta pulsar Reproducir');
    stopAll();
    toast('El navegador ha bloqueado el audio: pulsa Reproducir');
  };
  d.start();
  return d;
}

export function closeDeck(d) {
  if (!d) return;
  if (d === main) main = null;
  if (d === newsDeck) newsDeck = null;
  d.close();
  releaseDeck(d);
}

// El deck pasa a ser el que suena
export function setMain(d) {
  S.pending = false;   // cambio confirmado: el panel pasa a mostrar la nueva emisora
  S.ahead = null;
  if (d === newsDeck) newsDeck = null;
  main = d;
  if (d) { S.current = d.station; S.variant = d.variant; if (S.session === 'off') S.session = 'music'; }
  else if (!S.held) { S.session = 'off'; S.current = null; }   // se acabó lo único que sonaba (noticias sin música debajo)
  syncUi();
}

// Guarda el deck de las noticias, ya conectado, para entrar en cuanto llegue la hora
export function setNewsDeck(d) { newsDeck = d; }

const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;   // pantalla táctil

// =================================
// == ESTADO EN PANTALLA Y NOTIFICACIÓN ==
// =================================
// Recalcula lo que depende del deck que suena: modo degradado, calidad, barras sintéticas y texto de estado
export function syncUi() {
  const d = main;
  S.degraded = !!d && !d.wa;
  S.quality = d ? d.quality : '';
  viz.setSynthetic(S.degraded);
  viz.setSmooth(COARSE && !!d && d.kind !== 'hls');   // las barras de HLS ya van fluidas: el suavizado es para móviles y el resto de formatos
  refreshEq();
  refreshStations();
  updateButtons(S.session !== 'off', S.newsOn && !S.prevStation);   // durante unas noticias sin música debajo se puede pulsar Reproducir
  refreshRecBtn();
  if (S.session === 'off') {
    setStatus(S.newsMode ? 'Esperando noticias' : 'Desconectado');
  } else if (S.held) {
    setStatus('Pausado');
  } else if (!d) {
    setStatus('Conectando…');
  } else if (d.state === 'playing') {
    setStatus(S.newsOn ? 'Noticias' : 'En directo');
  } else {
    setStatus(d.everPlayed ? 'Reconectando…' : 'Conectando…');
  }
  syncAnchor();
}

// =============================
// == ANCLA DE LA NOTIFICACIÓN ==
// =============================
// El ancla (anchor.js) sigue a la sesión: suena con ella (también mientras se reconecta o se cambia de emisora), se pausa con la pausa de la
// notificación y se apaga al detener. A la espera de las noticias sin música también suena, con su notificación ("Esperando noticias")

// Se esperan las noticias sin música (solo cuenta donde hay ancla: sin ella no hay notificación que mostrar)
export const isWaiting = () => anchorOk && S.session === 'off' && S.newsMode && S.configLoaded;
export const isWaitPaused = () => isWaiting() && waitPaused;

function syncAnchor() {
  const waiting = isWaiting();
  if (!keepAnchor) setAnchor(S.session !== 'off' ? (S.held ? 'paused' : 'on') : waiting ? (waitPaused ? 'paused' : 'on') : 'off');
  if (waiting) { scheduleMediaTitle(); setPlaybackState(waitPaused ? 'paused' : 'playing'); }
  else if (wasWaiting && S.session === 'off') clearMediaSession();
  wasWaiting = waiting;
}

// Pausa y play de la notificación mientras se esperan las noticias: solo cambian la notificación (en pausa se puede descartar)
export function pauseWaiting() { if (!isWaiting()) return; waitPaused = true; syncUi(); }
export function resumeWaiting() { waitPaused = false; syncUi(); }

// Detener para volver a entrar enseguida (otra emisora estando en pausa, cambio de la salida de audio): la notificación no se suelta
export function stopForRestart(keepSlot = false) {
  keepAnchor = true;
  stopAll(true, keepSlot);
  keepAnchor = false;
}

// ==============================
// == REPRODUCIR, DETENER Y PAUSA ==
// ==============================

// Pulsar Reproducir (o una emisora estando parado): se conecta la última emisora, o la indicada, con un fundido de entrada
export function play(station = null, variant = 0) {
  if (!S.configLoaded || !S.stations.length) return;
  const st = station || S.lastStation || S.stations[0];
  const vi = station ? variant : (S.lastStation ? S.lastVariant : 0);
  S.lastStation = st;
  S.lastVariant = vi;
  S.held = false;
  waitPaused = false;
  setAnchor('on');   // lo primero, dentro del gesto: la notificación ya tiene quien la sostenga mientras conecta la emisora
  // sin nada sonando se recrea el audio (tras cambiar de salida, p. ej. unos cascos, el anterior puede quedarse mudo); grabando no, se cortaría la
  // grabación; con la página oculta (botones de la notificación) tampoco: un audio nuevo creado en segundo plano puede nacer parado
  initAudioGraph(decks.size === 0 && !S.recording && !document.hidden);
  if (S.newsOn) {
    // se pulsa Reproducir durante unas noticias: siguen sonando y al acabar se vuelve a esta emisora
    S.prevStation = st;
    S.prevVariant = vi;
    S.session = 'music';
    S.current = main ? main.station : st;
    log('Reproducir durante las noticias: al acabar se vuelve a ' + st.name);
    syncUi();
    return;
  }
  cancelTransition();
  for (const d of [...decks]) if (d !== newsDeck) closeDeck(d);
  S.pending = true;   // el panel espera a que suene para confirmar
  S.session = 'music';
  S.current = st;
  S.variant = vi;
  S.volMode = 'music';
  applyVolume();
  viz.start();
  log('Conectando con ' + st.name);
  const d = openDeck(st, vi);
  main = d;
  const first = d.on.playing;
  d.on.playing = x => {
    if (d === main) S.pending = false;
    first(x);
    if (d === main && d.fadeV < 1) fadeDeck(d, 1, FADE_S);
    setPlaybackState('playing');
  };
  syncUi();
}

// Detener: se cierra todo (también la emisora de noticias en espera). El modo boletines queda como estaba, pero si se detiene durante un boletín
// esa franja se da por abandonada: con el interruptor puesto y nada sonando, si no, el boletín volvería a entrar al momento.
// keepSlot: no se abandona (al cambiar la salida de audio se vuelve a entrar enseguida)
export function stopAll(keepMedia = false, keepSlot = false) {
  const slot = !keepSlot && S.newsOn && S.newsSlot ? S.newsSlot.idx : -1;
  cancelTransition();
  for (const d of [...decks]) closeDeck(d);
  main = newsDeck = null;
  S.session = 'off';
  S.held = false;
  waitPaused = false;
  S.pending = false;
  S.volMode = 'music';
  S.current = null;
  S.degraded = false;
  S.quality = '';
  endNewsState();
  S.skippedSlot = slot;
  viz.stop();
  applyVolume();
  if (keepMedia) setPlaybackState('paused'); else clearMediaSession();
  syncUi();
}

// Pausa desde la notificación: la emisora se queda retenida (la notificación sigue viva) y el play vuelve a conectar en directo
export function holdPlayback() {
  if (S.session === 'off' || !main || S.held) return;
  cancelTransition();
  S.pending = false;
  for (const d of [...decks]) if (d !== main) closeDeck(d);
  S.held = true;
  main.hold();
  setPlaybackState('paused');
  log('Pausa: ' + main.station.name + ' queda retenida');
  syncUi();
}

// Acaba un boletín con el audio en pausa: no se vuelve sonando. La pausa pasa a ser de la emisora de antes (al reanudar sonará ella) o,
// si no había música debajo, se detiene todo y se queda a la espera
export function endNewsWhileHeld(back, vi) {
  if (!S.held || !main) return;
  cancelTransition();
  S.volMode = 'music';
  if (!back) { log('Fin de noticias en pausa: no había cadena anterior, se queda a la espera'); stopAll(); return; }
  main.retarget(back, vi);
  S.current = back;
  S.variant = main.variant;
  log('Fin de noticias en pausa: al reanudar sonará ' + back.name);
  applyVolume();
  syncUi();
}

export function resumePlayback() {
  if (!S.held || !main) return;
  S.held = false;
  setAnchor('on');   // antes de soltar el <audio> en pausa: la notificación no se queda sin nadie
  log('Se reanuda ' + main.station.name + ' en directo');
  setFade(main, 0);
  initAudioGraph(false);
  const d = main;
  const first = d.on.playing;
  d.on.playing = x => {
    first(x);
    if (d === main && d.fadeV < 1) fadeDeck(d, 1, FADE_S);
    setPlaybackState('playing');
  };
  d.resumeLive();
  syncUi();
}

// Al cambiar la salida de audio en los ajustes: se vuelve a entrar en la misma emisora con el audio nuevo
export function restartAudio() {
  if (S.session === 'off') return;
  const st = S.current && !S.newsOn ? S.current : S.lastStation, vi = S.current && !S.newsOn ? S.variant : S.lastVariant;
  stopForRestart(true);
  if (st) play(st, vi); else stopAll(false, true);
}

// Si la emisora que suena está parada por algo ajeno, al elegir otra se quiere oír
export function wake() {
  wakeAnchor();
  if (main && main.interrupted) main.resumeInterrupted();
}
