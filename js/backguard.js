// ==================================
// == PROTECCIÓN DEL BOTÓN ATRÁS ==
// ==================================
// Con la radio en marcha, el botón (o el gesto) de atrás no saca de la aplicación sin preguntar: sale la ventana "¿Seguro que quieres salir?".
// En pantallas táctiles con CloseWatcher (Chrome, como en Radio Web Fast) el navegador avisa del gesto atrás sin tocar el historial: así Android no
// anima la "vista previa" de la página anterior (que aquí sería la propia app). Sin CloseWatcher, o en PC (botón atrás del ratón, Alt+←), se añade una
// entrada propia al historial al empezar a sonar y se pregunta al volver de ella.
// Con la ventana abierta, atrás la cierra (como Cancelar): solo el botón "Sí, cerrar" saca de la página; "Sí, cerrar" sigue hacia atrás y, si no hay página anterior, intenta cerrar la ventana.
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
let guarded = false, leaving = false, watcher = null, dlgWatcher = null;
const useWatcher = MOBILE && 'CloseWatcher' in window;

// Con CloseWatcher: un vigilante nuevo por cada pregunta (Chrome solo deja cancelar el mismo un par de veces). Con la radio parada se quita
function armWatcher() {
  if (watcher || leaving || !playing() || dlg.open) return;
  const w = new CloseWatcher();
  watcher = w;
  // Primer gesto atrás: abre la ventana. Chrome solo deja cancelarlo si se ha tocado la página desde el último; si no, salta a "close" para que nadie quede atrapado
  w.addEventListener('cancel', e => {
    if (!e.cancelable) return;
    e.preventDefault();
    w.destroy();
    watcher = null;
    if (playing()) showExit();
  });
  w.addEventListener('close', () => { watcher = null; if (!leaving) history.back(); });
}
// Abre la ventana; con CloseWatcher, tiene su propio vigilante (no se confía en el de la ventana, que no se crea bien si se abre desde un gesto atrás): atrás la cierra
function showExit() {
  openDialog(dlg);
  if (!useWatcher || dlgWatcher) return;
  const d = new CloseWatcher();
  dlgWatcher = d;
  d.addEventListener('close', () => { dlgWatcher = null; cancel(); });
}
dlg.addEventListener('close', () => { if (dlgWatcher) { dlgWatcher.destroy(); dlgWatcher = null; } });
function disarmWatcher() {
  if (!watcher) return;
  watcher.destroy();
  watcher = null;
}

// Añade la entrada propia (una sola vez); el navegador solo respeta las añadidas después de que se haya tocado la página, y para sonar ya se ha tocado
function arm() {
  if (useWatcher) { armWatcher(); return; }
  if (guarded || leaving) return;
  history.pushState({ backGuard: 1 }, '');
  guarded = true;
}
new MutationObserver(() => { if (playing()) arm(); else disarmWatcher(); }).observe(stop, { attributes: true, attributeFilter: ['disabled'] });
if (playing()) arm();

window.addEventListener('popstate', e => {
  if (e.state && e.state.backGuard) { guarded = true; return; }   // se ha vuelto hacia delante a la entrada propia
  if (!guarded) return;
  guarded = false;
  if (leaving) return;
  if (!playing()) { history.back(); return; }   // sin radio: el atrás que se pulsó sigue hasta la página anterior
  if (dlg.open) closeDialog(dlg); else showExit();
  arm();   // siempre queda una entrada propia detrás: con la ventana abierta, atrás la cierra y no saca de la página
});

function cancel() {
  closeDialog(dlg);
  arm();
}
document.getElementById('exitCancel').addEventListener('click', cancel);
document.getElementById('exitClose').addEventListener('click', cancel);
dlg.addEventListener('cancel', e => { e.preventDefault(); cancel(); });   // Escape (o atrás, si la ventana tiene su vigilante propio)
document.getElementById('exitGo').addEventListener('click', async () => {
  if (leaving) return;
  leaving = true;
  closeDialog(dlg);
  await requestStop();   // para la radio; si graba, pregunta antes y, si se cancela, la radio sigue
  if (playing()) { leaving = false; arm(); return; }
  history.go(guarded ? -2 : -1);   // con entrada propia (sin CloseWatcher) hay que saltar también esa
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
