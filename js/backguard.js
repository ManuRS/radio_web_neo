// ==================================
// == PROTECCIÓN DEL BOTÓN ATRÁS ==
// ==================================
// Con la radio en marcha, el botón (o el gesto) de atrás no saca de la aplicación sin preguntar: al empezar a sonar se añade una entrada propia
// al historial (con el mismo documento) y, si se vuelve de ella con la radio puesta, sale la ventana "¿Seguro que quieres salir?".
// Cancelar (o la ✕, o Escape) vuelve a poner la entrada; "Sí, cerrar" sigue hacia atrás y, si no hay página anterior, intenta cerrar la ventana.
// Sin la radio puesta, el atrás sigue su camino sin preguntar.

import { stop } from './dom.js';
import { closeDialog, openDialog } from './ui.js';

const dlg = document.getElementById('exitDlg');
const MOBILE = matchMedia('(pointer: coarse)').matches;   // pantalla táctil: móvil o tableta
document.getElementById('exitNote').textContent = MOBILE
  ? 'Minimiza la app con el botón home para seguir escuchando la radio'
  : 'No cierres la pestaña para seguir escuchando la radio';

const playing = () => !stop.disabled;   // hay una sesión de escucha (el botón Detener se puede pulsar)
let guarded = false, leaving = false;

// Añade la entrada propia (una sola vez); el navegador solo respeta las añadidas después de que se haya tocado la página, y para sonar ya se ha tocado
function arm() {
  if (guarded || leaving) return;
  history.pushState({ backGuard: 1 }, '');
  guarded = true;
}
new MutationObserver(() => { if (playing()) arm(); }).observe(stop, { attributes: true, attributeFilter: ['disabled'] });
if (playing()) arm();

window.addEventListener('popstate', e => {
  if (e.state && e.state.backGuard) { guarded = true; return; }   // se ha vuelto hacia delante a la entrada propia
  if (!guarded) return;
  guarded = false;
  if (leaving) return;
  if (playing()) openDialog(dlg);
  else history.back();   // sin radio: el atrás que se pulsó sigue hasta la página anterior
});

function cancel() {
  closeDialog(dlg);
  arm();
}
document.getElementById('exitCancel').addEventListener('click', cancel);
document.getElementById('exitClose').addEventListener('click', cancel);
dlg.addEventListener('cancel', e => { e.preventDefault(); cancel(); });   // Escape
document.getElementById('exitGo').addEventListener('click', () => {
  leaving = true;
  closeDialog(dlg);
  history.back();
  // si no había página anterior, la ventana no se va: se intenta cerrar (el navegador solo lo permite si la pestaña no tiene más historial que esta página)
  setTimeout(() => { window.close(); leaving = false; }, 300);
});
