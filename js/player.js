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

let main = null;       // deck que suena (o al que se está entrando)
let newsDeck = null;   // deck de la emisora de noticias, conectado en silencio a la espera de la hora

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
  if (S.session === 'off') {
    setStatus(S.newsMode ? 'Esperando noticias' : 'Desconectado');
  } else if (S.held) {
    setStatus('Pausado');
  } else if (!d) {
    setStatus('Conectando…');
  } else if (d.state === 'playing') {
    setStatus(S.newsOn ? 'Noticias' : 'En directo', 'on');
  } else {
    setStatus(d.everPlayed ? 'Reconectando…' : 'Conectando…');
  }
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
  initAudioGraph(decks.size === 0);   // sin nada sonando se recrea el audio (tras cambiar de salida, p. ej. unos cascos, el anterior puede quedarse mudo)
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
  stopAll(false, true);
  if (st) play(st, vi);
}

// Si la emisora que suena está parada por algo ajeno, al elegir otra se quiere oír
export function wake() {
  if (main && main.interrupted) main.resumeInterrupted();
}
