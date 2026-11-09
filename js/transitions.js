// ==================
// == TRANSICIONES ==
// ==================
// Cambio de emisora con fundidos y sonido local (switchStation). La emisora nueva se prepara en silencio (otro deck) mientras suena la actual:
// no hay silencio entre emisoras, salvo el que pide un sonido local. Dos formas:
//  - fundido cruzado (cambio a mano, sin sonido): cuando la nueva ya suena en silencio, una sale y otra entra a la vez (potencia constante);
//  - con sonido local o con cambio de volumen (noticias): fundido de salida -> sonido -> fundido de entrada, con la nueva ya conectada.

import { soundName } from './utils.js';
import { S, clockNow, FADE_S, CROSS_S, LOAD_TIMEOUT_S } from './state.js';
import { log } from './ui.js';
import { applyVolume, fadeDeck, fadeLevel, playJingle, stopJingle, canPlayJingles } from './audio.js';
import { jingleHit, soundBuffers } from './sounds.js';
import { closeDeck, getMain, getNewsDeck, openDeck, setMain, syncUi } from './player.js';
import { scheduleMediaTitle } from './mediasession.js';

let transToken = 0; // para cancelar la transición anterior
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function cancelTransition() {
  transToken++;
  const t = S.trans;
  S.trans = null;
  stopJingle();
  // la emisora que se estaba preparando se descarta (salvo la de noticias en espera, que sigue conectada para su hora)
  if (t && t.deck && t.deck !== getMain() && t.deck !== getNewsDeck() && !t.keep) closeDeck(t.deck);
}

// ¿Es esta emisora (y variante) la que ya suena?
const sameTarget = (d, t) => !!d && !!t && d.station === t.station && d.variant === t.variant;

// Cambio de emisora. target = { station, variant } (o null: solo se apaga la actual).
// Opciones: label, jingle, volMode, onSilence, onAbort, fadeS, fadeInS, overlapS, startAt (cuándo empieza, ms absolutos), fadeInAt (cuándo debe
// entrar la nueva, ms absolutos), crossover (fundido cruzado si se puede), deck (ya conectado en silencio, por ejemplo el de noticias)
export async function switchStation(target, o = {}) {
  const { label = '', jingle = null, volMode: vm = 'music', onSilence = null, onAbort = null,
          fadeS = FADE_S, fadeInS = fadeS, overlapS = 0, startAt = 0, fadeInAt = 0, crossover = false, deck: given = null } = o;
  const old = getMain();
  const wasBusy = !!S.trans;
  cancelTransition();
  const token = transToken;
  const alive = () => token === transToken;
  const vm0 = S.volMode;   // el volumen con el que sonaba la actual (si hay que volver atrás)
  const trans = S.trans = { station: target ? target.station : null, deck: given, keep: !!given };   // el deck de noticias ya conectado se registra desde el principio: así la gestión de la conexión previa no lo cierra mientras se espera la hora

  // 0) esperar al instante exacto de inicio (el modo boletines se adelanta para llegar justo a la hora)
  if (startAt) {
    const w = startAt - clockNow();
    if (w > 0) { await sleep(w); if (!alive()) return; }
  }

  // la que se pide ya es la que suena
  if (target && !given && sameTarget(old, target) && !jingle) { S.trans = null; if (S.pending) { S.pending = false; syncUi(); } return; }

  // 1) la emisora nueva se conecta ya, en silencio y mientras suena la actual
  let nd = null;
  if (target) {
    nd = given || openDeck(target.station, target.variant, { giveUp: 3 });
    trans.deck = nd;
  }
  const abort = async why => {
    log((label ? label + ': ' : '') + why);
    if (nd && nd !== given) closeDeck(nd);
    if (onAbort) onAbort();
    S.volMode = vm0;
    applyVolume();
    if (old && fadeLevel(old) < 0.99) fadeDeck(old, 1, fadeS);   // la anterior vuelve a sonar
    if (alive()) S.trans = null;
  };
  const showTitle = ms => setTimeout(() => { if (alive() || !S.trans) scheduleMediaTitle(); }, ms);

  // 2a) fundido cruzado: solo con una emisora sonando, sin sonido local, sin cambio de volumen y sin otra transición a medias
  if (nd && old && crossover && !jingle && !wasBusy && vm === S.volMode && fadeLevel(old) > 0.99) {
    const ok = await nd.ready(LOAD_TIMEOUT_S * 1000);
    if (!alive()) return;
    if (!ok) { await abort('no se pudo conectar con ' + target.station.name + ', se queda la cadena actual'); return; }
    if (onSilence) onSilence();
    setMain(nd);
    fadeDeck(old, 0, CROSS_S, true);
    fadeDeck(nd, 1, CROSS_S, true);
    setTimeout(() => closeDeck(old), CROSS_S * 1000 + 200);   // la anterior se desconecta al acabar el fundido
    showTitle(CROSS_S * 500);
    await sleep(CROSS_S * 1000);
    if (alive()) S.trans = null;
    return;
  }

  // 2b) fundido de salida de la actual
  if (old) {
    const cur = fadeLevel(old);
    if (cur > 0.02) {
      fadeDeck(old, 0, fadeS);
      await sleep(fadeS * cur * 1000);
      if (!alive()) return;
    }
  }

  // 3) en silencio: sonido local (si lo hay) y volumen del nuevo modo
  if (onSilence) onSilence();
  S.volMode = vm;
  applyVolume();
  let jingleEnd = 0;
  const buf = jingle ? soundBuffers.get(jingle.src) : null;
  if (buf && canPlayJingles()) {
    playJingle(buf);
    const hit = jingleHit(jingle, buf);
    jingleEnd = clockNow() + hit * 1000;   // el solape se cuenta desde su golpe final (o final audible), no desde el final del archivo
    log('Sonido de transición: ' + soundName(jingle.src) + ' (' + hit.toFixed(1) + (jingle.hit ? ' s hasta el golpe final de ' : ' s audibles de ') + buf.duration.toFixed(1) + ' s)');
  } else if (jingle) {
    log('Sonido de transición no disponible (' + soundName(jingle.src) + '): solo fundido');
  }

  // 4) el fundido de entrada empieza solapado con el final del sonido local, pero nunca antes de la hora indicada ni de que la nueva suene
  const readyAt = Math.max(jingleEnd - overlapS * 1000, fadeInAt || 0, clockNow());
  const waitMs = readyAt - clockNow();
  if (waitMs > 0) { await sleep(waitMs); if (!alive()) return; }
  if (nd) {
    const ok = await nd.ready(LOAD_TIMEOUT_S * 1000);
    if (!alive()) return;
    if (!ok) {
      if (old) { await abort('no se pudo conectar con ' + target.station.name + ', se vuelve a la cadena anterior'); return; }
      closeDeck(nd);
      if (onAbort) onAbort();
      log((label ? label + ': ' : '') + 'no se pudo conectar con ' + target.station.name);
      if (alive()) S.trans = null;
      return;
    }
    setMain(nd);
    if (old) closeDeck(old);   // la anterior ya estaba en silencio: se desconecta
    fadeDeck(nd, 1, fadeInS);
    showTitle(fadeInS * 500);
    await sleep(fadeInS * 1000);
  } else if (old) {
    // sin emisora de destino (se acaban las noticias y no había música): se apaga la que suena
    closeDeck(old);
    setMain(null);
  }
  if (alive()) S.trans = null;
}
