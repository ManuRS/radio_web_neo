// ==================================
// == PROTECCIÓN DEL BOTÓN ATRÁS ==
// ==================================
// Con la radio en marcha, el botón (o el gesto) de atrás no saca de la aplicación sin preguntar: al empezar a sonar se añade una entrada propia
// al historial (con el mismo documento) y, si se vuelve de ella con la radio puesta, sale la ventana "¿Seguro que quieres salir?".
// Cancelar (o la ✕, o Escape) vuelve a poner la entrada; "Sí, cerrar" sigue hacia atrás y, si no hay página anterior, intenta cerrar la ventana.
// Sin la radio puesta, el atrás sigue su camino sin preguntar.
// "Sí, cerrar" detiene la radio (si graba, antes pregunta) y sigue hacia atrás; si la página sigue ahí (una app instalada no se puede cerrar desde la web), avisa de que ya se puede salir.
// Al cerrar o recargar la pestaña con la radio puesta, el navegador pregunta con su propio aviso (la web no puede poner el suyo).

import { stop } from './dom.js';
import { closeDialog, openDialog, toast } from './ui.js';
import { requestStop } from './recorder.js';

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
document.getElementById('exitGo').addEventListener('click', async () => {
  if (leaving) return;
  leaving = true;
  closeDialog(dlg);
  await requestStop();   // para la radio; si graba, pregunta antes y, si se cancela, la radio sigue
  if (playing()) { leaving = false; arm(); return; }
  history.back();
  // si no había página anterior, la ventana no se va: se intenta cerrar (el navegador solo lo permite si la abrió la propia web) y, si sigue ahí, se avisa
  setTimeout(() => {
    window.close();
    setTimeout(() => {
      leaving = false;
      if (document.visibilityState === 'visible') toast(MOBILE ? 'Ya puedes salir de la app' : 'Ya puedes cerrar la pestaña');
    }, 200);
  }, 300);
});

// Cerrar o recargar la pestaña con la radio puesta: aviso del propio navegador (sin texto propio; solo sale si la página se ha tocado, y para sonar ya se ha tocado)
window.addEventListener('beforeunload', e => {
  if (playing() && !leaving) { e.preventDefault(); e.returnValue = ''; }
});
