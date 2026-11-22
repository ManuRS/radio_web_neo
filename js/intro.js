// ================================
// == INFORMACIÓN: TUTORIAL ==
// ================================
// Ventana de cinco pasos (bienvenida, buscar emisoras, sonido, noticias e instalación) que se abre con el botón de información de la cabecera y, sola, la primera vez que se abre la aplicación recién instalada.
// "rn_intro" recuerda que ya se ha visto. Quien ya usaba la aplicación (tiene ajustes o última emisora guardados) no la ve sola: se marca como vista sin abrirla.

import { infoBtn, introDlg } from './dom.js';
import { closeDialog, openDialog } from './ui.js';

const KEY = 'rn_intro';
const steps = [...introDlg.querySelectorAll('.intro-step')];
const dots = [...introDlg.querySelectorAll('.intro-dots i')];
const back = document.getElementById('introBack');
const next = document.getElementById('introNext');
let step = 0;

function get(k) { try { return localStorage.getItem(k); } catch { return null; } }
function set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento: se verá otra vez */ } }

// Muestra el paso n: el botón de la izquierda es "Saltar" en el primero y "Atrás" en los demás; el de la derecha, "Siguiente" y, en el último, "Empezar"
function show(n) {
  step = Math.max(0, Math.min(steps.length - 1, n));
  steps.forEach((s, i) => {
    s.hidden = i !== step;
    s.classList.remove('in');
    if (i === step) { void s.offsetWidth; s.classList.add('in'); }   // la entrada suave, cada vez
  });
  dots.forEach((d, i) => d.classList.toggle('on', i === step));
  back.textContent = step === 0 ? 'Saltar' : 'Atrás';
  next.textContent = step === steps.length - 1 ? 'Empezar' : 'Siguiente';
}

function open() {
  show(0);
  openDialog(introDlg);
}

back.addEventListener('click', () => { if (step === 0) closeDialog(introDlg); else show(step - 1); });
next.addEventListener('click', () => { if (step === steps.length - 1) closeDialog(introDlg); else show(step + 1); });
document.getElementById('introClose').addEventListener('click', () => closeDialog(introDlg));
introDlg.addEventListener('close', () => set(KEY, '1'));   // cerrada de cualquier forma (Esc, ✕, Saltar, Empezar): ya vista
infoBtn.addEventListener('click', open);

// Primera vez: sin nada guardado de antes (ni este aviso ni ajustes ni última emisora)
if (!get(KEY)) {
  const used = get('rn_datos') || get('rn_last');
  if (used) set(KEY, '1');
  else setTimeout(open, 500);
}
