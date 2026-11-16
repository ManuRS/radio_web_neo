// ================
// == EMISORAS ==
// ================
// Rejilla de emisoras (generalistas y musicales), nombre de la emisora actual, selección con fundido, anterior y siguiente (notificación) y color de énfasis.
// Cada botón es una cadena; la elegida, si tiene varias emisoras, lleva debajo en gris cuántas son. El formato se ve encima del visualizador.

import { S, endNewsState } from './state.js';
import { emisoraName, emisoraSub } from './utils.js';
import { presetsBox, psText, psValue } from './dom.js';
import { applyAccent, desk, paletteColor, setText } from './ui.js';
import { switchStation } from './transitions.js';
import { play, stopAll, wake } from './player.js';
import { updateNewsSwitch } from './boletines.js';
import { corsAllowed } from './deck.js';
import { toast } from './ui.js';

// Edición de las emisoras desde la rejilla (arrastrar para reordenar; clic derecho para añadir una variante o eliminar): settings.js rellena estas funciones y escribe el JSON
// Cada función devuelve (o resuelve con) el texto del error, o nada si todo fue bien. addVariant(id, url, nombre) comprueba la URL; rename(id, nombre, corto, nombresVariantes) cambia los nombres
export const editHooks = { move: null, remove: null, removeVariant: null, addVariant: null, rename: null, newChain: null, newVariant: null };   // newChain(grupo) y newVariant(cadena): abren la ventana del catálogo (importer.js)

// Grabando, las emisoras sin CORS (modo degradado) no se pueden poner: su audio no llega a la grabación (ver recorder.js)
const recBlocked = (st, vi) => S.recording && !corsAllowed(st, vi);
const REC_BLOCK_MSG = 'Esta emisora no se puede grabar';

const GROUPS = [{ id: 'general', title: 'Generalistas' }, { id: 'musical', title: 'Musicales' }];
const LAST_KEY = 'rn_last';

// =========================
// == ÚLTIMA EMISORA ELEGIDA ==
// =========================
// Se recuerda en este navegador para que Reproducir retome la misma
function saveLast(st, vi) {
  S.lastStation = st;
  S.lastVariant = vi;
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ id: st.id, v: vi })); } catch (_) {}
  setPos(st, vi);
}

// Posición de cada cadena (qué emisora de ella sonó la última vez, la 3/5): al volver a pulsarla se retoma ahí, no en la primera. Se recuerda en este navegador (rn_pos)
const POS_KEY = 'rn_pos';
let posMap = null;
function loadPos() {
  if (posMap) return posMap;
  try { posMap = JSON.parse(localStorage.getItem(POS_KEY)) || {}; } catch (_) { posMap = {}; }
  if (typeof posMap !== 'object' || Array.isArray(posMap)) posMap = {};
  return posMap;
}
function posOf(st) {
  const v = loadPos()[st.id];
  return Number.isInteger(v) && v >= 0 && v < st.urls.length ? v : 0;   // si se quitaron emisoras, vale la primera
}
function setPos(st, vi) {
  const m = loadPos();
  if (vi === 0) delete m[st.id]; else m[st.id] = vi;
  try { localStorage.setItem(POS_KEY, JSON.stringify(m)); } catch (_) {}
}
export function restoreLast() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(LAST_KEY)); } catch (_) {}
  const st = o && S.stations.find(x => x.id === o.id);
  S.lastStation = st || S.stations[0] || null;
  S.lastVariant = st && o.v >= 0 && o.v < st.urls.length ? o.v : 0;
}

// ===========================
// == REJILLA DE EMISORAS ==
// ===========================
let groups = [];   // [{ id, list, grid, buttons, labels, more, bar }]
const expandedGroups = new Set();   // grupos con la rejilla desplegada: se conservan al redibujar (al reordenar, añadir o eliminar)

// Despliega la rejilla de un grupo (al añadir una cadena, para que se vea el botón nuevo)
export function expandGroup(id) { expandedGroups.add(id); }

export function buildStations() {
  presetsBox.innerHTML = '';
  groups = [];
  GROUPS.forEach(g => {
    const list = S.stations.filter(s => s.group === g.id);
    if (!list.length) return;
    const wrap = document.createElement('section');
    wrap.className = 'pgroup';
    const title = document.createElement('h2');
    title.className = 'ptitle';
    title.textContent = g.title;
    const grid = document.createElement('div');
    grid.className = 'pgrid';
    const buttons = list.map(st => {
      const b = document.createElement('button');
      b.className = 'preset';
      b.type = 'button';
      b.innerHTML = '<span class="pn"></span><span class="pf"></span>';
      b.querySelector('.pn').textContent = st.short || st.name;   // en la rejilla, el nombre corto (si lo hay)
      b.addEventListener('click', () => onStationClick(st));
      bindEdit(b, st);
      grid.appendChild(b);
      return b;
    });
    const more = document.createElement('button');
    more.className = 'preset more';
    more.type = 'button';
    more.textContent = '+';
    more.title = 'Crear nueva presintonía';
    more.setAttribute('aria-label', 'Crear nueva presintonía ' + (g.id === 'musical' ? 'musical' : 'generalista'));
    const bar = document.createElement('button');
    bar.className = 'mbar';
    bar.type = 'button';
    bar.innerHTML = '<span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    const grp = { id: g.id, list, grid, buttons, labels: buttons.map(b => b.querySelector('.pf')), more, bar };
    more.addEventListener('click', () => { if (editHooks.newChain) editHooks.newChain(g.id); });   // "+": "Crear nueva presintonía" con el tipo del grupo
    bar.addEventListener('click', () => { if (expandedGroups.has(g.id)) expandedGroups.delete(g.id); else expandedGroups.add(g.id); applyVisibility(); });
    grid.appendChild(more);
    wrap.append(title, grid, bar);
    presetsBox.appendChild(wrap);
    groups.push(grp);
  });
  applyVisibility();
}

// ====================================================
// == REORDENAR (ARRASTRAR) Y ELIMINAR (CLIC DERECHO) ==
// ====================================================
// Arrastrar un botón sobre otro de la misma o de otra rejilla lo coloca en su sitio; el clic derecho (o pulsación larga en el móvil) abre el menú (añadir variante, quitar una variante o eliminar la emisora).
// Ambos cambian el JSON de los ajustes; con algo sonando, solo lo que no afecte a lo que suena (lo decide settings.js)
let dragId = null;
let dropOn = null;
const clearDrop = () => { if (dropOn) dropOn.classList.remove('drop-target'); dropOn = null; };

// Arrastre táctil (el nativo de HTML5 no funciona con el dedo): pulsación larga abre el menú y, si el dedo se mueve a partir de ahí, el menú se cierra y la cadena se arrastra
// (una copia sigue al dedo, la casilla de debajo se marca y, cerca de los bordes, la pantalla se desplaza). Al soltar, se coloca con el mismo editHooks.move que el ratón.
const SLOP_PX = 8;           // lo que puede moverse el dedo en la pulsación larga sin que cuente como desplazamiento
const EDGE_PX = 56;          // franja junto al borde del área que se desplaza donde se activa el desplazamiento automático
const btnStation = new WeakMap();   // botón de la rejilla → su cadena
let pressing = false;        // hay un dedo sobre una cadena
let holding = false;         // la pulsación larga ya abrió el menú: el navegador no debe desplazar ni seleccionar
let tdrag = null;            // arrastre táctil en curso: { b, st, ghost, ox, oy, x, y, pid, tick }
let ignoreClickUntil = 0;
// Con el dedo puesto, el navegador no debe desplazar la página ni seleccionar texto (touchmove tiene que poder cancelarse: de ahí passive: false)
document.addEventListener('touchmove', e => { if (holding || tdrag) e.preventDefault(); }, { passive: false });
document.addEventListener('selectstart', e => { if ((pressing || tdrag) && !(e.target.closest && e.target.closest('input, textarea'))) e.preventDefault(); });
// El clic que puede llegar al soltar tras arrastrar no debe sintonizar la cadena que quede debajo
presetsBox.addEventListener('click', e => { if (Date.now() < ignoreClickUntil) { e.preventDefault(); e.stopPropagation(); } }, true);

// Zona que se desplaza con la rejilla: el panel de presintonías (pantallas grandes), la columna interna (pantallas altas) o la página entera
function scrollArea() {
  const s = [presetsBox, presetsBox.closest('.scroller')].find(el => el && el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible');
  if (s) {
    const r = s.getBoundingClientRect();
    return { top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom), by: dy => { s.scrollTop += dy; } };
  }
  return { top: 0, bottom: window.innerHeight, by: dy => window.scrollBy(0, dy) };
}
function moveGhost() {
  const d = tdrag;
  d.ghost.style.transform = 'translate(' + Math.round(d.x - d.ox) + 'px,' + Math.round(d.y - d.oy) + 'px)';
}
// Marca la casilla que hay bajo el dedo (la copia no estorba: pointer-events: none)
function markDrop() {
  const d = tdrag;
  const el = document.elementFromPoint(d.x, d.y);
  const b = el && el.closest ? el.closest('.preset') : null;
  const t = b && b !== d.b && btnStation.has(b) ? b : null;
  if (t === dropOn) return;
  clearDrop();
  if (t) { dropOn = t; t.classList.add('drop-target'); }
}
function dragTick() {
  const d = tdrag;
  if (!d) return;
  const a = scrollArea();
  let dy = 0;
  if (d.y < a.top + EDGE_PX) dy = -Math.ceil((1 - Math.max(0, d.y - a.top) / EDGE_PX) * 14);
  else if (d.y > a.bottom - EDGE_PX) dy = Math.ceil((1 - Math.max(0, a.bottom - d.y) / EDGE_PX) * 14);
  if (dy) { a.by(dy); markDrop(); }
}
function onTouchDragMove(e) { if (tdrag && e.pointerId === tdrag.pid) { tdrag.x = e.clientX; tdrag.y = e.clientY; moveGhost(); markDrop(); } }
function onTouchDragEnd(e) { if (tdrag && e.pointerId === tdrag.pid) endTouchDrag(e.type === 'pointerup'); }
function beginTouchDrag(b, st, e) {
  closeMenu();
  const r = b.getBoundingClientRect();
  const ghost = b.cloneNode(true);
  ghost.className = 'preset dnd-card';
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  document.body.appendChild(ghost);
  try { window.getSelection().removeAllRanges(); } catch (_) {}   // si Android llegó a empezar una selección, se quita (su tinte se vería en rectángulos sobre las casillas)
  b.classList.add('dragging');
  tdrag = { b, st, ghost, ox: e.clientX - r.left, oy: e.clientY - r.top, x: e.clientX, y: e.clientY, pid: e.pointerId, tick: setInterval(dragTick, 16) };
  moveGhost();
  markDrop();
  document.addEventListener('pointermove', onTouchDragMove);
  document.addEventListener('pointerup', onTouchDragEnd);
  document.addEventListener('pointercancel', onTouchDragEnd);
}
function endTouchDrag(drop) {
  const d = tdrag;
  if (!d) return;
  tdrag = null;
  clearInterval(d.tick);
  document.removeEventListener('pointermove', onTouchDragMove);
  document.removeEventListener('pointerup', onTouchDragEnd);
  document.removeEventListener('pointercancel', onTouchDragEnd);
  const target = drop && dropOn ? btnStation.get(dropOn) : null;
  d.ghost.remove();
  d.b.classList.remove('dragging');
  clearDrop();
  pressing = holding = false;
  ignoreClickUntil = Date.now() + 400;
  if (target && target !== d.st && editHooks.move) editHooks.move(d.st.id, target.id);
}

function bindEdit(b, st) {
  btnStation.set(b, st);
  b.draggable = true;
  b.addEventListener('dragstart', e => {
    dragId = st.id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', st.id); } catch (_) {}
    // imagen que sigue al ratón: la misma tarjeta que sigue al dedo en el móvil (redondeada y con el color de énfasis). Sin ella el navegador hace una foto
    // del botón, y si la hace tarde (con la radio sonando va más cargado) pilla la casilla ya vacía y saca su recuadro de selección
    const r = b.getBoundingClientRect(), img = b.cloneNode(true);
    img.className = 'preset dnd-card dnd-img';
    img.style.width = r.width + 'px';
    img.style.height = r.height + 'px';
    document.body.appendChild(img);
    try { e.dataTransfer.setDragImage(img, e.clientX - r.left, e.clientY - r.top); } catch (_) {}
    setTimeout(() => { img.remove(); if (dragId === st.id) b.classList.add('dragging'); }, 0);   // en su sitio queda el hueco
  });
  b.addEventListener('dragend', () => { dragId = null; clearDrop(); b.classList.remove('dragging'); });
  b.addEventListener('dragover', e => {
    if (!dragId || dragId === st.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropOn !== b) { clearDrop(); dropOn = b; b.classList.add('drop-target'); }
  });
  b.addEventListener('dragleave', e => { if (dropOn === b && !b.contains(e.relatedTarget)) clearDrop(); });
  b.addEventListener('drop', e => {
    if (!dragId) return;
    e.preventDefault();
    const id = dragId;
    dragId = null;
    clearDrop();
    if (id !== st.id && editHooks.move) editHooks.move(id, st.id);
  });
  let long = false, touch = false;   // long: la pulsación actual ya abrió el menú (su clic final no debe sintonizar)
  b.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!touch) { openMenu(e.clientX, e.clientY, st); return; }   // ratón: clic derecho normal
    if (tdrag) return;   // ya se está arrastrando: no se vuelve a abrir el menú
    long = holding = true;
    openMenuOnce(e.clientX, e.clientY, st);
  });

  // Pulsación larga en pantallas táctiles: no se deja al navegador (selecciona el texto y saca "copiar/pegar", y en iOS ni siquiera avisa con contextmenu):
  // un temporizador propio abre el menú, y el clic que llega al soltar el dedo se descarta para que no sintonice la cadena.
  // Si después el dedo se mueve, empieza el arrastre (se cierra el menú); si se mueve antes de la pulsación larga, es un desplazamiento normal
  let timer = 0, sx = 0, sy = 0;
  const cancel = () => { clearTimeout(timer); timer = 0; };
  b.addEventListener('pointerdown', e => {
    cancel();
    long = false;
    touch = e.pointerType !== 'mouse';
    if (!touch) { b.draggable = true; return; }
    b.draggable = false;   // el arrastre nativo del navegador táctil se confundiría con la pulsación larga
    pressing = true;
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { timer = 0; long = holding = true; openMenuOnce(sx, sy, st); if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} } }, LONG_PRESS_MS);
  });
  b.addEventListener('pointermove', e => {
    if (!touch || tdrag || Math.hypot(e.clientX - sx, e.clientY - sy) <= SLOP_PX) return;
    if (timer) cancel();   // el dedo se mueve antes de la pulsación larga: desplazamiento normal
    else if (long) beginTouchDrag(b, st, e);
  });
  ['pointerup', 'pointercancel'].forEach(t => b.addEventListener(t, () => { cancel(); if (!tdrag) pressing = holding = false; }));
  b.addEventListener('click', e => {
    if (long) { long = false; e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}

// Abre el menú una sola vez por pulsación larga (algunos navegadores avisan además con contextmenu)
const LONG_PRESS_MS = 450;
let menuAt = 0;
function openMenuOnce(x, y, st) {
  if (Date.now() - menuAt < 900) return;
  menuAt = Date.now();
  openMenu(x, y, st);
}

let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
// Etiqueta de una variante en el menú: su nombre (por defecto, el formato; con número si hay dos iguales); la calidad, si se conoce, solo se ve junto al EQ
function variantLabel(st, i) {
  const u = st.urls[i];
  const same = st.urls.filter(x => x.label === u.label).length > 1;
  return u.label + (same ? ' · ' + (i + 1) : '');
}
// Sintonizar una variante concreta desde el menú
function pickVariant(st, vi) {
  if (recBlocked(st, vi)) { toast(REC_BLOCK_MSG); return; }
  if (S.session === 'off') { saveLast(st, vi); play(st, vi); return; }
  if (S.current === st && S.variant === vi) return;   // ya suena
  selectStation(st, vi);
}
function placeMenu(m, x, y, center = false) {
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, center ? (window.innerWidth - r.width) / 2 : Math.min(x, window.innerWidth - r.width - 6)) + 'px';
  m.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 6)) + 'px';
}
// Formulario de la cadena (cambiar nombre): ventana como la de ajustes, arriba, en vez del menú. fields: [{ type, placeholder,
// label, value, max, wide }]; run(valores) devuelve (promesa) el texto del error, o nada si todo fue bien (y la ventana se cierra). Mientras tanto, los campos se bloquean
const formDlg = document.getElementById('formDlg');
const formTitle = document.getElementById('formDlgTitle');
const formForm = document.getElementById('formDlgForm');
const formMsg = document.getElementById('formMsg');
const formGo = document.getElementById('formGo');
let formRun = null, formBusy = false;
function openFormDialog(title, { fields, button, busyText, failText, run }) {
  formTitle.textContent = title;
  formMsg.textContent = '';
  formGo.textContent = button;
  formGo.disabled = false;
  formBusy = false;
  const inputs = fields.map(f => {
    const input = document.createElement('input');
    input.type = f.type || 'text';
    input.placeholder = f.placeholder || '';
    if (f.value) input.value = f.value;
    if (f.max) input.maxLength = f.max;
    input.spellcheck = false;
    input.autocomplete = 'off';
    const lab = document.createElement('label');
    if (f.wide) lab.className = 'wide';
    lab.append(f.label, input);
    return { input, node: lab };
  });
  formForm.replaceChildren(...inputs.map(i => i.node));
  formRun = { inputs, button, busyText, failText, run };
  if (typeof formDlg.showModal === 'function') { if (!formDlg.open) formDlg.showModal(); } else formDlg.setAttribute('open', '');
  inputs[0].input.focus();
  inputs[0].input.select();
}
const closeFormDialog = () => { if (typeof formDlg.close === 'function') formDlg.close(); else formDlg.removeAttribute('open'); };
formForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!formRun || formBusy) return;
  const r = formRun, lock = on => { r.inputs.forEach(i => { i.input.disabled = on; }); formGo.disabled = on; };
  formBusy = true; lock(true); formGo.textContent = r.busyText || r.button; formMsg.textContent = '';
  let msg = null;
  try { msg = await r.run(r.inputs.map(i => i.input.value)); } catch (_) { msg = r.failText; }
  if (formRun !== r) return;   // se abrió otro formulario mientras tanto
  formBusy = false; lock(false); formGo.textContent = r.button;
  if (!msg) { closeFormDialog(); return; }
  formMsg.textContent = msg;
  r.inputs[0].input.focus();
});
document.getElementById('formClose').addEventListener('click', closeFormDialog);
formDlg.addEventListener('click', e => { if (e.target === formDlg) closeFormDialog(); });
// Nombre de la emisora, nombre corto del botón y el nombre de cada variante (vacío = el formato)
const openRenameForm = st => openFormDialog('Cambiar nombre · ' + st.name, {
  fields: [
    { max: 40, value: st.name, label: 'Nombre de la cadena' },
    { max: 14, value: st.short || '', label: 'Nombre corto (botón)' },
    ...st.urls.map((u, i) => ({ max: 30, value: u.label, placeholder: u.kind.toUpperCase(), wide: true, label: (st.urls.length > 1 ? 'Emisora ' + (i + 1) : 'Emisora') + ' (' + u.kind.toUpperCase() + ')' })),
  ],
  button: 'Guardar', failText: 'No se pudo cambiar el nombre',
  run: ([name, short, ...labels]) => editHooks.rename ? editHooks.rename(st.id, name, short, labels) : 'No disponible',
});
// Menú. Con varias emisoras: arriba el nombre de la cadena (en gris) y una fila por emisora (clic = sintonizarla) con "Eliminar" en rojo a la derecha
// (pide una segunda pulsación; quita solo esa emisora). Con una sola no hay nada que elegir: arriba el nombre de la cadena, con el color normal, y "Eliminar" a su lado
// (quita la cadena entera). Al final, en ambos casos, "Añadir emisora…" y "Cambiar nombre…"
function openMenu(x, y, st) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'ctxmenu';
  m.setAttribute('role', 'menu');
  const head = document.createElement('div');   // cabecera gris del menú con varias emisoras
  head.className = 'ctxtitle';
  head.textContent = st.name;
  // "Eliminar" en dos pasos: la primera pulsación pide confirmación; la segunda quita la emisora i (con una sola, la cadena entera)
  const deleteButton = (i, aria) => {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ctxdel';
    del.setAttribute('role', 'menuitem');
    del.textContent = 'Eliminar';
    del.setAttribute('aria-label', aria);
    let armed = false;
    del.addEventListener('click', () => {
      if (!armed) { armed = true; del.textContent = '¿Seguro?'; del.classList.add('danger'); return; }
      closeMenu();
      if (st.urls.length > 1) { if (editHooks.removeVariant) editHooks.removeVariant(st.id, i); }
      else if (editHooks.remove) editHooks.remove(st.id);
    });
    return del;
  };
  if (st.urls.length === 1) {
    const row = document.createElement('div');
    row.className = 'ctxrow ctxsolo';
    const name = document.createElement('div');
    name.className = 'ctxname';
    name.textContent = st.name;
    row.append(name, deleteButton(0, 'Eliminar ' + st.name));
    m.appendChild(row);
  } else {
    m.appendChild(head);
    const list = document.createElement('div');   // la lista de emisoras se desplaza por dentro; el nombre arriba y las acciones abajo siempre se ven
    list.className = 'ctxlist';
    m.appendChild(list);
    st.urls.forEach((u, i) => {
      const row = document.createElement('div');
      row.className = 'ctxrow';
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'ctxgo';
      go.setAttribute('role', 'menuitem');
      go.textContent = variantLabel(st, i);
      if (S.current === st && S.variant === i) go.classList.add('on');   // la que suena
      if (recBlocked(st, i)) { go.disabled = true; go.classList.add('recoff'); go.title = REC_BLOCK_MSG; }
      go.addEventListener('click', () => { closeMenu(); pickVariant(st, i); });
      row.append(go, deleteButton(i, 'Eliminar ' + variantLabel(st, i)));
      list.appendChild(row);
    });
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'ctxadd';
  add.setAttribute('role', 'menuitem');
  add.textContent = 'Añadir emisora…';
  add.addEventListener('click', () => { closeMenu(); if (editHooks.newVariant) editHooks.newVariant(st); });
  m.appendChild(add);
  const ren = document.createElement('button');
  ren.type = 'button';
  ren.className = 'ctxadd ctxren';
  ren.setAttribute('role', 'menuitem');
  ren.textContent = 'Cambiar nombre…';
  ren.addEventListener('click', () => { closeMenu(); openRenameForm(st); });
  m.appendChild(ren);
  document.body.appendChild(m);
  placeMenu(m, x, y);
  menuEl = m;
  const first = m.querySelector('.ctxgo') || m.querySelector('.ctxadd');   // sin lista de emisoras (una sola), el foco va a "Añadir emisora…"
  if (first) first.focus({ preventScroll: true });
}
document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('resize', closeMenu);
window.addEventListener('blur', closeMenu);

// Columnas de una rejilla (cambian con el ancho de la pantalla)
const lastCols = new WeakMap();
function columns(grid) {
  let n = 0;
  if (typeof getComputedStyle === 'function') {
    const cols = getComputedStyle(grid).gridTemplateColumns;
    if (cols && !/repeat|none/.test(cols)) n = cols.trim().split(/\s+/).length;
  }
  if (n) lastCols.set(grid, n);
  return n || lastCols.get(grid) || 4;
}
// Texto de la barra: plegado, cuántas presintonías quedan ocultas (o solo "Mostrar más" si lo único oculto es el "+"); desplegado, "Mostrar menos"
function barLabel(bar, open, hiddenN) {
  bar.classList.toggle('open', open);
  bar.setAttribute('aria-expanded', String(open));
  bar.firstChild.textContent = open ? 'Mostrar menos' : hiddenN ? 'Mostrar ' + hiddenN + ' más' : 'Mostrar más';
}
// De cada grupo se ven dos filas enteras de cadenas; si con el "+" no caben todas, la barra de debajo despliega el resto (y el "+", siempre el último).
// En pantallas grandes, todo desplegado y sin barra (el panel se desplaza por dentro)
function applyVisibility() {
  groups.forEach(g => {
    const capacity = columns(g.grid) * 2;
    const fold = !desk.matches && g.buttons.length + 1 > capacity;
    const open = fold && expandedGroups.has(g.id);
    g.buttons.forEach((b, i) => { b.hidden = fold && !open && i >= capacity; });
    g.more.hidden = fold && !open;
    g.bar.hidden = !fold;
    if (fold) barLabel(g.bar, open, Math.max(0, g.buttons.length - capacity));
  });
}
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(applyVisibility).observe(presetsBox);
desk.addEventListener('change', applyVisibility);

// ¿Esta emisora impide el modo boletines? (las generalistas, salvo las marcadas con news: true)
export const blocksNews = st => !!st && st.group !== 'musical' && !st.news;

// ===========================
// == ELEGIR UNA EMISORA ==
// ===========================
// Un clic suena esa cadena (en la emisora donde se dejó); otro clic mientras suena pasa a su siguiente emisora (si tiene más de una). Parado, el clic la elige y la pone a sonar.
function onStationClick(st) {
  if (S.current === st && S.session !== 'off') {
    if (st.urls.length < 2) return;   // ya suena
    // la siguiente emisora de la cadena (grabando, se saltan las que no se pueden grabar)
    for (let k = 1; k < st.urls.length; k++) {
      const vi = (S.variant + k) % st.urls.length;
      if (!recBlocked(st, vi)) { selectStation(st, vi); return; }
    }
    return;
  }
  const vi = posOf(st);   // retoma la emisora de la cadena donde se dejó
  if (recBlocked(st, vi)) { toast(REC_BLOCK_MSG); return; }
  if (S.session === 'off') { saveLast(st, vi); play(st, vi); return; }
  selectStation(st, vi);
}

export function selectStation(st, vi = 0) {
  wake();   // si el audio estaba pausado por algo ajeno, al elegir emisora se quiere oír
  if (S.held) { stopAll(); saveLast(st, vi); play(st, vi); return; }   // en pausa: se elige y vuelve a sonar
  if (S.newsOn) {
    // cambio manual durante unas noticias: se respeta tu elección y no se vuelve a la emisora anterior
    S.skippedSlot = S.newsSlot ? S.newsSlot.idx : -1;
    endNewsState();
  }
  const prevPos = posOf(st);
  saveLast(st, vi);
  const prev = { station: S.current, variant: S.variant };
  S.pending = true;                   // el nombre del panel no cambia (y parpadea) hasta que la nueva emisora esté confirmada
  S.current = st;
  S.variant = vi;
  S.lastPick = st;
  updateNewsSwitch();                 // si la nueva emisora no es musical, el interruptor de boletines se pone naranja
  refreshStations();                  // resalta ya la emisora elegida
  switchStation({ station: st, variant: vi }, {
    volMode: 'music', crossover: true,
    onAbort: () => { S.pending = false; S.current = prev.station; S.variant = prev.variant; setPos(st, prevPos); if (prev.station) saveLast(prev.station, prev.variant); refreshStations(); },
  });
}

// Anterior y siguiente (flechas del panel y botones de la notificación): recorren las emisoras del grupo de la actual, de forma cíclica
export function stepStation(dir) {
  const base = S.current || S.lastStation || S.stations[0];
  if (!base) return;
  const list = S.stations.filter(s => s.group === base.group);
  const i = Math.max(0, list.indexOf(base));
  let next = null;
  for (let k = 1; k <= list.length; k++) {   // grabando, se saltan las que no se pueden grabar
    const c = list[(i + dir * k + list.length * k) % list.length];
    if (!recBlocked(c, posOf(c))) { next = c; break; }
  }
  if (!next || next === S.current) return;
  const vi = posOf(next);
  if (S.session === 'off') { saveLast(next, vi); play(next, vi); } else selectStation(next, vi);
}

// ============================
// == COLOR DE ÉNFASIS ==
// ============================
// Con "Color personalizado" activado, el de la cadena que suena (campo "color" de los ajustes o, si no tiene, uno de la lista);
// apagado, el color por defecto (Ajustes > General)
let accentShown = null;
export function refreshAccent() {
  if (S.pending) return;   // mientras se espera la confirmación del cambio, el color se queda como estaba
  const st = S.stationColors ? S.current : null;
  const hex = st ? st.color || paletteColor(st.name) : S.accent;   // sin color en los ajustes, uno de la lista (ver paletteColor)
  if (hex === accentShown) return;
  accentShown = hex;
  applyAccent(hex);
}

// ================================
// == PANEL DE LA EMISORA Y BOTONES ==
// ================================
// Emisora cuyo nombre se ve en el panel. Con un cambio pedido y sin confirmar (S.pending) no cambia: la actual parpadea hasta que el cambio se confirma
let shown = null, shownV = 0;
export const shownStation = () => shown;
export const shownVariant = () => shownV;

// Nombre que no cabe en el panel (nombres largos, o con el botón de grabar ocupando sitio): va de un lado a otro con una pausa en cada extremo,
// como en pantalla completa. El panel nunca se ensancha por él
let fitKey = '';
function fitNow() {
  const key = psText.textContent + '|' + psValue.clientWidth;
  if (key === fitKey) return;
  fitKey = key;
  const cs = getComputedStyle(psValue);
  const over = psText.offsetWidth - (psValue.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  if (over > 1) {
    psValue.style.setProperty('--dx', -Math.ceil(over) + 'px');
    psValue.style.setProperty('--dur', Math.max(6, over / 35 + 5).toFixed(1) + 's');
    psValue.classList.add('marquee');
  } else psValue.classList.remove('marquee');
}
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitNow).observe(psValue);
if (document.fonts) document.fonts.addEventListener('loadingdone', () => { fitKey = ''; fitNow(); });   // con la fuente propia ya cargada, el nombre mide otra cosa

export function refreshNow() {
  if (!S.pending) { shown = S.current || S.lastStation; shownV = S.current ? S.variant : S.lastVariant; }
  psValue.classList.toggle('idle', !S.current && !S.pending);
  psValue.classList.toggle('pending', S.pending);
  setText(psText, shown ? emisoraName(shown, shownV) : '—');   // el nombre de la emisora (Radio Madrid), no el de la cadena (Cadena SER)
  fitNow();
}

export function refreshStations() {
  groups.forEach(g => g.buttons.forEach((b, i) => {
    const st = g.list[i];
    const active = S.current === st;
    b.classList.toggle('active', active);
    const off = !active && recBlocked(st, posOf(st));   // grabando: su emisora no se puede grabar
    b.classList.toggle('recoff', off);
    if (off) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    b.title = off ? REC_BLOCK_MSG : '';
    setText(g.labels[i], emisoraSub(st, active));   // bajo el nombre, solo en la elegida y con varias emisoras: "10 emisoras"
  }));
  refreshNow();
  updateNewsSwitch();
  refreshAccent();
}
