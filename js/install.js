// ===========================
// == INSTALAR LA APLICACIÓN ==
// ===========================
// Chrome y Edge (Android y PC) avisan con "beforeinstallprompt" cuando la web se puede instalar: se guarda el aviso y la ventana de instalación
// se abre con un botón nuestro. En iPhone/iPad no hay botón posible: el aviso y la fila de Datos dicen cómo hacerlo (Compartir › Añadir a pantalla
// de inicio; clase "ios"). En los navegadores que no lo avisan no se enseña nada (se instala desde su menú).
// Dónde sale el botón (cada sitio es opcional: lo que no está en la página se salta):
//   - #insHint: aviso antes de la emisora, con Instalar (#insHintGo) y ✕ (#insHintX). Cerrado, no vuelve (APP_ID + "_install")
//   - #insBtn: icono de la cabecera, solo cuando el aviso ya se ha cerrado (en iPhone no: no tendría nada que abrir)
//   - #insRow: fila de Ajustes › Datos (#insGo)
//   - #introIns: la imagen del último paso de la bienvenida (clase "can" cuando se puede pulsar); .ins-now / .ins-ios / .ins-menu, el texto de cada caso
// Igual en Neo y en Proxy.

// En Proxy la aplicación llega tarde (boot.js la pide al Worker) y el aviso puede haber llegado antes: boot.js lo guarda en window.__bip
let deferred = window.__bip || null;
const subs = new Set();
const emit = () => subs.forEach(f => f());

addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; emit(); });
addEventListener('appinstalled', () => { deferred = window.__bip = null; emit(); });

const installed = () => matchMedia('(display-mode: standalone), (display-mode: minimal-ui)').matches || navigator.standalone === true;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPad se presenta como Mac

// true si ahora mismo se puede abrir la ventana de instalación
export const canInstall = () => !!deferred && !installed();

// true en iPhone/iPad sin instalar: solo se puede explicar cómo
export const iosManual = () => ios && !installed();

// Abre la ventana del navegador; true si se instala
export async function install() {
  if (!deferred) return false;
  const e = deferred;
  deferred = window.__bip = null;
  emit();   // el aviso solo sirve una vez: fuera botones hasta que el navegador avise de nuevo
  try { e.prompt(); } catch { return false; }
  const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
  return outcome === 'accepted';
}

export function initInstall(app) {
  const KEY = app + '_install';
  const $ = id => document.getElementById(id);
  const hint = $('insHint'), btn = $('insBtn'), row = $('insRow');
  const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const closed = () => get() === '1';

  function paint() {
    const ok = canInstall(), man = !ok && iosManual();
    if (hint) { hint.hidden = !(ok || man) || closed(); hint.classList.toggle('ios', man); }
    if (btn) btn.hidden = !ok || !closed();
    if (row) { row.hidden = !(ok || man); row.classList.toggle('ios', man); }
    $('introIns')?.classList.toggle('can', ok);
    for (const el of document.querySelectorAll('.ins-now')) el.hidden = !ok;
    for (const el of document.querySelectorAll('.ins-ios')) el.hidden = !man;
    for (const el of document.querySelectorAll('.ins-menu')) el.hidden = ok || man;
  }

  for (const id of ['insHintGo', 'insBtn', 'insGo', 'introIns']) $(id)?.addEventListener('click', e => { if (!canInstall()) return; e.preventDefault(); install(); });
  $('insHintX')?.addEventListener('click', () => { try { localStorage.setItem(KEY, '1'); } catch {} paint(); });
  subs.add(paint);
  paint();
}
