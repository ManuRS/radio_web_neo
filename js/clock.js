// ==================
// == RELOJ LOCAL ==
// ==================
// Retraso del reloj local (hora real = hora local + retraso): a mano o detectado solo comparando con una hora oficial.
// Lo detectado solo corrige diferencias mayores de AUTO_DEAD_S; entre medias se queda en 0. Se aplica con decimales y se muestra con uno.

import { parseNumber } from './utils.js';
import { S } from './state.js';
import { autoDelay, delayInput } from './dom.js';
import { log } from './ui.js';

const TIME_URL = 'https://time.now/developer/api/timezone/Europe/Madrid';
const AUTO_DEAD_S = 1;        // diferencias dentro de ±esto (s) no se corrigen
const MAX_RTT_MS = 3000;      // si la respuesta tarda más, la medida no es fiable
const RECHECK_MS = 20 * 60000;   // además de al cargar, se repite cada tanto (y al volver a la página si la última tiene más de esto)
const RETRY_MS = 20000;       // tras un fallo se reintenta (hasta MAX_RETRIES veces)
const MAX_RETRIES = 3;

const KEY_MANUAL = 'rn_delay', KEY_AUTO_ON = 'rn_autodelay', KEY_AUTO_VAL = 'rn_autodelay_val';
const load = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, String(value)); } catch (_) {} };

let autoOn = load(KEY_AUTO_ON) !== '0';                 // por defecto, activada
let manualSec = parseNumber(load(KEY_MANUAL)) || 0;     // retraso escrito a mano
let autoSec = parseNumber(load(KEY_AUTO_VAL)) || 0;     // última detección: vale hasta que llegue la nueva
let lastOk = 0, retries = 0, retryTimer = null, running = false;

const apply = () => { S.clockDelayMs = (autoOn ? autoSec : manualSec) * 1000; };
apply();

// Campo e interruptor de la ventana de ajustes: con la autodetección activa el campo no se edita y muestra el valor aplicado
export function refreshDelayUi() {
  autoDelay.checked = autoOn;
  delayInput.disabled = autoOn;
  const sec = autoOn ? autoSec : manualSec;
  delayInput.value = autoOn ? sec.toFixed(1) : sec !== 0 ? String(sec) : '';
}

export function setManualDelay(sec) {
  manualSec = sec;
  save(KEY_MANUAL, sec);
  apply();
}

export function setAutoDelay(on) {
  autoOn = on;
  save(KEY_AUTO_ON, on ? 1 : 0);
  clearTimeout(retryTimer);
  retries = 0;
  apply();
  refreshDelayUi();
  log('Retraso del reloj: ' + (on ? 'autodetección activada' : 'manual (' + manualSec + ' s)'));
  if (on) detect();
}

// La hora oficial corresponde a un instante entre el envío y la llegada de la respuesta: se toma el punto medio
async function detect() {
  if (running) return;
  running = true;
  clearTimeout(retryTimer);
  try {
    const t0 = Date.now();
    const res = await fetch(TIME_URL, { cache: 'no-store' });
    const data = await res.json();
    const t1 = Date.now();
    const official = new Date(data.datetime).getTime();
    if (!res.ok || !isFinite(official)) throw new Error('respuesta no válida');
    if (t1 - t0 > MAX_RTT_MS) throw new Error('la respuesta tardó ' + ((t1 - t0) / 1000).toFixed(1) + ' s');
    if (!autoOn) return;   // se desactivó mientras tanto
    const diff = (official - (t0 + t1) / 2) / 1000;
    autoSec = Math.abs(diff) > AUTO_DEAD_S ? Math.round(diff * 1000) / 1000 : 0;
    lastOk = Date.now();
    retries = 0;
    save(KEY_AUTO_VAL, autoSec);
    apply();
    refreshDelayUi();
    log('Reloj local: diferencia con la hora oficial de ' + diff.toFixed(1) + ' s' + (autoSec === 0 ? ' (sin corrección)' : ', retraso aplicado: ' + autoSec.toFixed(1) + ' s'));
  } catch (err) {
    log('No se pudo detectar el retraso del reloj: ' + ((err && err.message) || err));
    if (autoOn && retries < MAX_RETRIES) { retries++; retryTimer = setTimeout(detect, RETRY_MS); }
  } finally {
    running = false;
  }
}

export function initClock() {
  refreshDelayUi();
  if (autoOn) detect();
}

setInterval(() => { if (autoOn) detect(); }, RECHECK_MS);   // también con la pantalla apagada: las noticias dependen de la hora
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && autoOn && Date.now() - lastOk > RECHECK_MS) detect();   // los temporizadores se frenan en segundo plano
});
