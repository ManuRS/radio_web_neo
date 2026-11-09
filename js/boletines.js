// ====================
// == MODO BOLETINES ==
// ====================
// Modo boletines: franjas de noticias, sorteo de sonidos, conexión previa en silencio de la emisora de noticias y decisiones de cada segundo (tick).
//
// Las franjas son HORAS REALES DE EMISIÓN (hora de Madrid). El stream de internet va por detrás de la emisión (S.defaultDelayS, unos 32 s):
// las noticias entran en el stream en inicio + retraso y salen en fin + retraso (igual que en Radio Web Fast). Con la emisora de noticias conectada en
// silencio desde NEWS_PRECONNECT_S antes, la entrada es inmediata: fundido de la música, sonido local y fundido de entrada de las noticias.

import { madridClock, madridSeconds, pickWeighted, soundName, toSeconds } from './utils.js';
import { S, clockNow, endNewsState, NEWS_FADE_S, NEWS_IN_OVERLAP_S, NEWS_LOAD_MARGIN_S, NEWS_OUT_OVERLAP_S, NEWS_PRECONNECT_S } from './state.js';
import { clockEl, newsBox, newsToggle } from './dom.js';
import { log } from './ui.js';
import { applyVolume, initAudioGraph, decks } from './audio.js';
import { ensureSounds, jingleHit, soundBuffers, SOUNDS_FROM_NEWS_BY_NAME, SOUNDS_FROM_NEWS_DEFAULT, SOUNDS_TO_NEWS } from './sounds.js';
import { switchStation } from './transitions.js';
import { blocksNews } from './stations.js';
import { closeDeck, endNewsWhileHeld, getMain, getNewsDeck, openDeck, play, setNewsDeck, syncUi } from './player.js';

// ==============================================
// == FRANJAS DE NOTICIAS: ESTADO Y ANTELACIÓN ==
// ==============================================

let NEWS_SLOTS = [];
let newsWarned = false;   // ya se avisó en el registro de que no se puede entrar en noticias ahora

export function rebuildSlots() {
  NEWS_SLOTS = S.news.map(n => ({ ...n, s: toSeconds(n.start), e: toSeconds(n.end) }))
                     .filter(n => !isNaN(n.s) && !isNaN(n.e));
}

// Retraso del stream de la emisora de noticias (ms): las franjas se miran con el reloj "del stream", ahora menos este retraso
const newsDelayMs = () => S.defaultDelayS * 1000;

const TICK_MARGIN_MS = 1100;   // el reloj avanza cada segundo: se adelanta un poco la comprobación

// Estado de una franja respecto a "ahora" (ya con el retraso restado): ¿en curso?, y cuándo empieza / acaba (ms absolutos, en hora de emisión).
// "start" es cuando EMPIEZAN las noticias y "end" cuando ACABAN.
function slotState(i, nowMs) {
  const n = NEWS_SLOTS[i];
  const sec = madridSeconds(nowMs);
  const dur = n.e > n.s ? n.e - n.s : n.e + 86400 - n.s;
  const sinceStart = (sec - n.s + 86400) % 86400;
  const inside = sinceStart < dur;
  const raw = inside ? nowMs - sinceStart * 1000 : nowMs + ((n.s - sec + 86400) % 86400) * 1000;
  const startAbs = Math.round(raw / 1000) * 1000;   // las franjas son de segundos enteros
  return { inside, startAbs, endAbs: startAbs + dur * 1000 };
}

// Antelación con la que hay que empezar la transición para que las noticias suenen justo a la hora:
// fundido de salida de la música + lo que dure más el sonido local o la espera de la emisora de noticias (si aún no suena).
function newsLeadMs(i) {
  const plan = slotPlan.get(i);
  const buf = plan && plan.jingle ? soundBuffers.get(plan.jingle.src) : null;
  const d = jingleHit(plan && plan.jingle, buf);
  const jingleWait = Math.max(0, d - NEWS_IN_OVERLAP_S);   // el fundido de entrada empieza antes de que acabe el sonido
  const nd = getNewsDeck();
  const wait = nd && nd.state === 'playing' ? jingleWait : Math.max(jingleWait, NEWS_LOAD_MARGIN_S);
  return ((getMain() ? NEWS_FADE_S : 0) + wait) * 1000;
}

// ======================================================
// == SORTEO DE SONIDOS Y ACTIVACIÓN DENTRO DE HORARIO ==
// ======================================================

// Sorteo del sonido de entrada: una tirada independiente (con los pesos de SOUNDS_TO_NEWS) para CADA emisión de
// cada franja, hecha poco antes (PLAN_AHEAD_MS) para poder calcular la antelación. Nada se repite por sistema:
// cada día y cada hora se vuelve a sortear.
const PLAN_AHEAD_MS = 120000;

export const slotPlan = new Map();   // franja -> { jingle, forStart }  (forStart: inicio de la emisión para la que se sorteó)

// Al activar el modo: si ya estamos en horario de noticias (o en el minuto en que empiezan), solo fundido, sin sonido local
function markNearSlots() {
  const now = clockNow() - newsDelayMs();
  NEWS_SLOTS.forEach((n, i) => {
    const st = slotState(i, now);
    const sameMinute = Math.floor(st.startAbs / 60000) === Math.floor(now / 60000);
    const plan = slotPlan.get(i);
    if (st.inside || sameMinute) {
      slotPlan.set(i, { jingle: null, forStart: st.startAbs, noJingle: true });
      log('Modo boletines: ya estamos en el horario de las noticias de las ' + n.start + '. Solo fundido, sin sonido local');
    } else if (plan && plan.noJingle && Math.abs(plan.forStart - st.startAbs) < 60000) {
      slotPlan.delete(i);   // ya no aplica: se sorteará con normalidad
    }
  });
}

function ensurePlans(nowMs) {
  if (!S.newsMode) return;
  NEWS_SLOTS.forEach((n, i) => {
    const st = slotState(i, nowMs);
    if (!st.inside && st.startAbs - nowMs > PLAN_AHEAD_MS) return;     // aún falta mucho
    const plan = slotPlan.get(i);
    if (plan && Math.abs(plan.forStart - st.startAbs) < 60000) return; // ya sorteado para esta emisión
    const jingle = pickWeighted(SOUNDS_TO_NEWS);
    slotPlan.set(i, { jingle, forStart: st.startAbs });
    if (jingle) log('Sorteo para las noticias de las ' + n.start + ': ' + soundName(jingle.src));
  });
}

// ==========================================
// == INTERRUPTOR SEGÚN LA EMISORA ACTUAL ==
// ==========================================

// La emisora que suena sin contar las noticias (la que se oye ahora o, si ya suenan noticias, la de antes). null = no suena ninguna
const musicStation = () => (S.session === 'music' && !S.held ? (S.newsOn ? S.prevStation : S.current) : null);

// El interruptor lo decide solo el usuario y no se toca solo. Si la emisora actual no es musical las noticias no saltarían:
// entonces el interruptor se pone naranja (en vez del color de énfasis)
export function updateNewsSwitch() {
  const wont = !S.newsOn && blocksNews(musicStation());
  newsBox.classList.toggle('wont', wont);
  newsToggle.parentElement.title = wont ? 'Con esta cadena no saltarán las noticias' : 'Activar modo boletines';
}

// ===================================================
// == CONEXIÓN PREVIA EN SILENCIO DE LA EMISORA DE NOTICIAS ==
// ===================================================
// Unos NEWS_PRECONNECT_S antes de la entrada se abre la emisora de noticias con el fundido a cero. Así está lista y, además, un deck sonando
// (aunque sea sin volumen) ayuda a que el navegador no duerma la página en segundo plano. Si ya no hace falta (se apaga el modo, la emisora
// no permite noticias, se abandona la franja), se cierra.
function wantNewsDeck(ns) {
  if (!S.newsMode || S.newsOn || !NEWS_SLOTS.length || !S.newsStation || blocksNews(musicStation())) return false;
  for (let i = 0; i < NEWS_SLOTS.length; i++) {
    if (i === S.skippedSlot) continue;
    const st = slotState(i, ns);
    const until = st.inside ? 0 : st.startAbs - ns;
    if (until <= NEWS_PRECONNECT_S * 1000 + newsLeadMs(i)) return true;
  }
  return false;
}

function manageNewsDeck(nowMs) {
  const nd = getNewsDeck();
  const want = wantNewsDeck(nowMs - newsDelayMs());
  if (nd && nd.station !== S.newsStation && !(S.trans && S.trans.deck === nd)) {   // se cambió la emisora de noticias en los ajustes
    closeDeck(nd);
    return;
  }
  if (want && !nd && !S.trans && !S.held) {
    log('Modo boletines: se conecta ' + S.newsStation.name + ' en silencio, a la espera de la hora');
    setNewsDeck(openDeck(S.newsStation, 0));
  } else if (!want && nd && !(S.trans && S.trans.deck === nd)) {
    log('Modo boletines: ya no hace falta la conexión previa, se cierra ' + nd.station.name);
    closeDeck(nd);
  }
}

// ===============================
// == DECISIONES (CADA SEGUNDO) ==
// ===============================

function newsTick(nowMs) {
  if (!NEWS_SLOTS.length || !S.newsStation) return;
  const D = newsDelayMs(), ns = nowMs - D;   // ns: el instante de la emisión que el stream lleva ahora

  // franja abandonada a mano: se libera cuando ya no está en curso ni a punto de empezar
  if (S.skippedSlot !== -1) {
    const st = slotState(S.skippedSlot, ns);
    if (!st.inside && st.startAbs - ns > newsLeadMs(S.skippedSlot) + TICK_MARGIN_MS) S.skippedSlot = -1;
  }
  if (S.trans) return; // hay una transición en curso: no se inicia otra hasta que acabe

  if (S.newsMode && !S.newsOn) {
    // ¿Alguna franja en curso o a punto de empezar (teniendo en cuenta la antelación)?
    let idx = -1, st = null, lead = 0;
    for (let i = 0; i < NEWS_SLOTS.length; i++) {
      if (i === S.skippedSlot) continue;
      const s2 = slotState(i, ns), l = newsLeadMs(i);
      if (s2.inside || s2.startAbs - ns <= l + TICK_MARGIN_MS) { idx = i; st = s2; lead = l; break; }
    }
    if (idx !== -1) {
      const music = musicStation();
      if (S.held) {
        S.skippedSlot = idx;   // en pausa: no se entra en las noticias
        log('Modo boletines: no se entra en las noticias de las ' + NEWS_SLOTS[idx].start + ', el audio está en pausa');
      } else if (blocksNews(music)) {
        // el interruptor sigue puesto: solo se deja pasar esta emisión
        S.skippedSlot = idx;
        newsWarned = false;
        log('Modo boletines: no se entra en las noticias de las ' + NEWS_SLOTS[idx].start + ', la cadena actual (' + music.name + ') no es musical');
      } else {
        const plan = slotPlan.get(idx);             // sonido sorteado poco antes
        const jingle = plan ? plan.jingle : null;   // el plan se conserva (marca que esta emisión ya está sorteada)
        const arrive = st.startAbs + D;             // cuándo entran las noticias en el stream (hora de este dispositivo, ya corregida)
        S.prevStation = music;
        S.prevVariant = music ? S.variant : 0;
        S.newsOn = true;
        S.newsSlot = { idx, startAbs: arrive, endAbs: st.endAbs + D };
        newsWarned = false;
        log('Modo boletines: noticias a las ' + NEWS_SLOTS[idx].start + ' (en el stream, ' + madridClock(arrive) + '). Empieza la transición');
        switchStation({ station: S.newsStation, variant: 0 }, {
          label: 'Modo boletines',
          volMode: 'news',
          jingle,
          fadeS: NEWS_FADE_S,
          fadeInS: NEWS_FADE_S,
          overlapS: NEWS_IN_OVERLAP_S,
          startAt: arrive - lead,     // cuándo empieza el fundido de salida
          fadeInAt: arrive,           // cuándo deben entrar las noticias
          deck: getNewsDeck(),        // la emisora de noticias ya conectada en silencio (si no, se conecta ahora)
          onAbort: endNewsState,
        });
      }
    } else {
      newsWarned = false;
    }
  } else if (S.newsOn && (!S.newsMode || !S.newsSlot || nowMs >= S.newsSlot.endAbs)) {
    // Terminan las noticias (o se apaga el modo): volver a la emisora anterior
    const back = S.prevStation, vi = S.prevVariant;
    if (S.held) {
      // en pausa (notificación): ni sonido local ni música; la pausa se queda con la emisora de antes
      endNewsState();
      endNewsWhileHeld(back, vi);
    } else if (back) {
      const list = SOUNDS_FROM_NEWS_BY_NAME[back.name] || SOUNDS_FROM_NEWS_DEFAULT;
      switchStation({ station: back, variant: vi }, {
        label: 'Fin de noticias',
        volMode: 'music',
        jingle: pickWeighted(list),
        fadeS: NEWS_FADE_S,
        fadeInS: NEWS_OUT_OVERLAP_S,
        overlapS: NEWS_OUT_OVERLAP_S,
        onSilence: endNewsState,
        // la emisora de antes no conecta a la primera: no se queda en las noticias, se sigue intentando con ella como al pulsar Reproducir
        onAbort: () => { log('Fin de noticias: se sigue intentando con ' + back.name); play(back, vi); },
      });
    } else {
      // no había música debajo: se apaga la emisora de noticias y se queda a la espera
      log('Fin de noticias: no había cadena anterior, se queda a la espera');
      switchStation(null, { label: 'Fin de noticias', volMode: 'music', fadeS: NEWS_FADE_S, onSilence: endNewsState });
    }
  }
  applyVolume();
}

// ==========================
// == ACTIVAR / DESACTIVAR ==
// ==========================

function setNewsMode(on) {
  S.newsMode = on;
  newsToggle.checked = on;
  if (on) {
    S.skippedSlot = -1;
    if (S.session === 'off') initAudioGraph(decks.size === 0);   // sin música, se queda a la espera de las noticias: el audio se prepara con este gesto
    ensureSounds();   // los sonidos de entrada y salida se descargan y decodifican ahora, no al abrir la web
  }
  log('Modo boletines ' + (on ? 'activado' : 'desactivado') + (on && S.session === 'off' ? ' (a la espera de las noticias, sin música)' : ''));
  applyVolume();
  syncUi();
}

newsToggle.addEventListener('change', () => {
  setNewsMode(newsToggle.checked);
  if (newsToggle.checked) markNearSlots();
  tick();
});

// ============================================
// == TICK PRINCIPAL: RELOJ Y COMPROBACIONES ==
// ============================================

export function tick() {
  const now = clockNow();
  // El reloj muestra la hora de reproducción: la hora real de Madrid (la del dispositivo con su retraso corregido) menos el retraso del stream,
  // es decir, la misma con la que se calculan las franjas de los boletines
  clockEl.textContent = S.configLoaded ? madridClock(now - newsDelayMs()) : '--:--:--';
  ensurePlans(now - newsDelayMs());
  updateNewsSwitch();
  manageNewsDeck(now);
  newsTick(now);
  // marco del periódico en verde mientras suenan las noticias (de la hora de inicio a la de fin)
  newsBox.classList.toggle('live', !!(S.newsOn && S.newsSlot && now >= S.newsSlot.startAbs && now < S.newsSlot.endAbs));
}
