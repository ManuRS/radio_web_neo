// ===========================
// == INSTALAR LA APLICACIÓN ==
// ===========================
// Chrome y Edge (Android y PC) avisan con "beforeinstallprompt" cuando la web se puede instalar: se guarda el aviso y la ventana de instalación
// se abre con un botón nuestro. En iPhone/iPad y en los navegadores que no lo avisan no se enseña nada (se instala desde su menú).
// Dónde sale el botón (cada sitio es opcional: lo que no está en la página se salta):
//   - #insHint: aviso antes de la emisora, con Instalar (#insHintGo) y ✕ (#insHintX). Cerrado, no vuelve (APP_ID + "_install")
//   - #insBtn: icono de la cabecera, solo cuando el aviso ya se ha cerrado
//   - #insRow: fila de Ajustes › Datos (#insGo)
//   - #introIns: la imagen del último paso de la bienvenida (clase "can" cuando se puede pulsar); .ins-now / .ins-menu, el texto de cada caso
// Igual en Neo y en Proxy.

let deferred = null;
const subs = new Set();
const emit = () => subs.forEach(f => f());

addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; emit(); });
addEventListener('appinstalled', () => { deferred = null; emit(); });

const installed = () => matchMedia('(display-mode: standalone), (display-mode: minimal-ui)').matches || navigator.standalone === true;

// true si ahora mismo se puede abrir la ventana de instalación
export const canInstall = () => !!deferred && !installed();

// Abre la ventana del navegador; true si se instala
export async function install() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
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
    const ok = canInstall();
    if (hint) hint.hidden = !ok || closed();
    if (btn) btn.hidden = !ok || !closed();
    if (row) row.hidden = !ok;
    $('introIns')?.classList.toggle('can', ok);
    for (const el of document.querySelectorAll('.ins-now')) el.hidden = !ok;
    for (const el of document.querySelectorAll('.ins-menu')) el.hidden = ok;
  }

  for (const id of ['insHintGo', 'insBtn', 'insGo', 'introIns']) $(id)?.addEventListener('click', e => { if (!canInstall()) return; e.preventDefault(); install(); });
  $('insHintX')?.addEventListener('click', () => { try { localStorage.setItem(KEY, '1'); } catch {} paint(); });
  subs.add(paint);
  paint();
}
