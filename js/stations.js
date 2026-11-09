// ================
// == EMISORAS ==
// ================
// Rejilla de emisoras (generalistas y musicales), nombre de la emisora actual, selección con fundido, anterior y siguiente (notificación) y color de énfasis.
// Cada botón es una cadena; la elegida, si tiene varias emisoras, lleva debajo en gris cuántas son. El formato se ve encima del visualizador.

import { S, endNewsState } from './state.js';
import { emisoraName, emisoraSub } from './utils.js';
import { presetsBox, psValue } from './dom.js';
import { applyAccent, setText } from './ui.js';
import { switchStation } from './transitions.js';
import { play, stopAll, wake } from './player.js';
import { updateNewsSwitch } from './boletines.js';

// Edición de las emisoras desde la rejilla (arrastrar para reordenar; clic derecho para añadir una variante o eliminar): settings.js rellena estas funciones y escribe el JSON
// Cada función devuelve (o resuelve con) el texto del error, o nada si todo fue bien. addVariant(id, url, nombre) comprueba la URL; rename(id, nombre, corto, nombresVariantes) cambia los nombres
export const editHooks = { move: null, remove: null, removeVariant: null, addVariant: null, rename: null };

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
let groups = [];   // [{ id, list, grid, buttons, labels, more, expanded }]
const expandedGroups = new Set();   // grupos con la rejilla desplegada: se conservan al redibujar (al reordenar, añadir o eliminar)

// Despliega la rejilla de un grupo (al añadir una emisora, para que se vea el botón nuevo)
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
    const grp = { id: g.id, list, grid, buttons, labels: buttons.map(b => b.querySelector('.pf')), more, expanded: expandedGroups.has(g.id) };
    more.addEventListener('click', () => { grp.expanded = !grp.expanded; if (grp.expanded) expandedGroups.add(g.id); else expandedGroups.delete(g.id); applyVisibility(); });
    grid.appendChild(more);
    wrap.append(title, grid);
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
document.addEventListener('selectstart', e => { if (pressing && !(e.target.closest && e.target.closest('input, textarea'))) e.preventDefault(); });
// El clic que puede llegar al soltar tras arrastrar no debe sintonizar la cadena que quede debajo
presetsBox.addEventListener('click', e => { if (Date.now() < ignoreClickUntil) { e.preventDefault(); e.stopPropagation(); } }, true);

// Zona que se desplaza con la rejilla: la columna interna (pantallas altas) o la página entera
function scrollArea() {
  const s = presetsBox.closest('.scroller');
  if (s && s.scrollHeight > s.clientHeight + 1 && getComputedStyle(s).overflowY !== 'visible') {
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
    setTimeout(() => { if (dragId === st.id) b.classList.add('dragging'); }, 0);   // un instante después: el navegador ya ha hecho la imagen que se arrastra y en su sitio queda el hueco
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
let menuForm = false;   // con el formulario de la variante abierto, el menú no se cierra al redimensionar (teclado del móvil) ni al cambiar de ventana (para copiar el enlace)
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; menuForm = false; } }
// Etiqueta de una variante en el menú: su nombre (por defecto, el formato; con número si hay dos iguales); la calidad, si se conoce, solo se ve junto al EQ
function variantLabel(st, i) {
  const u = st.urls[i];
  const same = st.urls.filter(x => x.label === u.label).length > 1;
  return u.label + (same ? ' · ' + (i + 1) : '');
}
// Sintonizar una variante concreta desde el menú
function pickVariant(st, vi) {
  if (S.session === 'off') { saveLast(st, vi); play(st, vi); return; }
  if (S.current === st && S.variant === vi) return;   // ya suena
  selectStation(st, vi);
}
function placeMenu(m, x, y) {
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(x, window.innerWidth - r.width - 6)) + 'px';
  m.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 6)) + 'px';
}
// Formulario dentro del menú (sustituye a las opciones). fields: [{ type, placeholder, label (texto pequeño encima, opcional), value, max, aria }];
// run(valores) devuelve (promesa) el texto del error, o nada si todo fue bien (y el menú se cierra). Mientras tanto, los campos se bloquean.
function openMenuForm(m, head, x, y, { fields, button, busyText, failText, run }) {
  menuForm = true;
  m.replaceChildren(head);
  const form = document.createElement('form');
  form.className = 'ctxform';
  form.noValidate = true;
  const inputs = fields.map(f => {
    const input = document.createElement('input');
    input.type = f.type || 'text';
    input.placeholder = f.placeholder || '';
    if (f.value) input.value = f.value;
    if (f.max) input.maxLength = f.max;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', f.aria || f.label || f.placeholder || '');
    if (!f.label) return { input, node: input };
    const lab = document.createElement('label');
    const t = document.createElement('span');
    t.textContent = f.label;
    lab.append(t, input);
    return { input, node: lab };
  });
  const err = document.createElement('div');
  err.className = 'ctxerr';
  err.hidden = true;
  const go = document.createElement('button');
  go.type = 'submit';
  go.textContent = button;
  const box = document.createElement('div');   // los campos se desplazan por dentro; el aviso y el botón quedan siempre a la vista (hay cadenas con muchas emisoras)
  box.className = 'ctxfields';
  box.append(...inputs.map(i => i.node));
  form.append(box, err, go);
  const lock = on => { inputs.forEach(i => { i.input.disabled = on; }); go.disabled = on; };
  let busy = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    busy = true; lock(true); go.textContent = busyText || button; err.hidden = true;
    let msg = null;
    try { msg = await run(inputs.map(i => i.input.value)); } catch (_) { msg = failText; }
    if (!msg) { if (menuEl === m) closeMenu(); return; }
    if (menuEl !== m) return;   // el menú se cerró mientras tanto
    busy = false; lock(false); go.textContent = button;
    err.textContent = msg; err.hidden = false;
    placeMenu(m, x, y);
    inputs[0].input.focus({ preventScroll: true });
  });
  m.appendChild(form);
  placeMenu(m, x, y);
  inputs[0].input.focus({ preventScroll: true });
  inputs[0].input.select();
}
const openVariantForm = (m, head, st, x, y) => openMenuForm(m, head, x, y, {
  fields: [
    { type: 'url', placeholder: 'https://…/stream.aac', aria: 'Enlace de la emisora' },
    { max: 24, placeholder: 'SER Málaga', aria: 'Nombre de la emisora (opcional)' },
  ],
  button: 'Añadir', busyText: 'Comprobando…', failText: 'No se pudo añadir la emisora',
  run: ([url, name]) => editHooks.addVariant ? editHooks.addVariant(st.id, url, name) : 'No disponible',
});
// Nombre de la emisora, nombre corto del botón y el nombre de cada variante (vacío = el formato)
const openRenameForm = (m, head, st, x, y) => openMenuForm(m, head, x, y, {
  fields: [
    { max: 40, value: st.name, label: 'Nombre de la cadena' },
    { max: 14, value: st.short || '', label: 'Nombre corto (botón)' },
    ...st.urls.map((u, i) => ({ max: 24, value: u.label, placeholder: u.kind.toUpperCase(), label: (st.urls.length > 1 ? 'Emisora ' + (i + 1) : 'Emisora') + ' (' + u.kind.toUpperCase() + ')' })),
  ],
  button: 'Guardar', failText: 'No se pudo cambiar el nombre',
  run: ([name, short, ...labels]) => editHooks.rename ? editHooks.rename(st.id, name, short, labels) : 'No disponible',
});
// Menú: arriba el nombre de la emisora (en gris); una fila por variante (clic = sintonizarla) con "Eliminar" en rojo a la derecha (pide una segunda pulsación;
// con una sola variante elimina la emisora entera); al final, "Añadir variante…" y "Cambiar nombre…"
function openMenu(x, y, st) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'ctxmenu';
  m.setAttribute('role', 'menu');
  const head = document.createElement('div');
  head.className = 'ctxtitle';
  head.textContent = st.name;
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
    go.addEventListener('click', () => { closeMenu(); pickVariant(st, i); });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ctxdel';
    del.setAttribute('role', 'menuitem');
    del.textContent = 'Eliminar';
    del.setAttribute('aria-label', 'Eliminar ' + (st.urls.length > 1 ? variantLabel(st, i) : st.name));
    let armed = false;   // dos pasos: la primera pulsación pide confirmación
    del.addEventListener('click', () => {
      if (!armed) { armed = true; del.textContent = '¿Seguro?'; del.classList.add('danger'); return; }
      closeMenu();
      if (st.urls.length > 1) { if (editHooks.removeVariant) editHooks.removeVariant(st.id, i); }
      else if (editHooks.remove) editHooks.remove(st.id);
    });
    row.append(go, del);
    list.appendChild(row);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'ctxadd';
  add.setAttribute('role', 'menuitem');
  add.textContent = 'Añadir emisora…';
  add.addEventListener('click', () => openVariantForm(m, head, st, x, y));
  m.appendChild(add);
  const ren = document.createElement('button');
  ren.type = 'button';
  ren.className = 'ctxadd ctxren';
  ren.setAttribute('role', 'menuitem');
  ren.textContent = 'Cambiar nombre…';
  ren.addEventListener('click', () => openRenameForm(m, head, st, x, y));
  m.appendChild(ren);
  document.body.appendChild(m);
  placeMenu(m, x, y);
  menuEl = m;
  const first = m.querySelector('.ctxgo');
  if (first) first.focus({ preventScroll: true });
}
document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('resize', () => { if (!menuForm) closeMenu(); });
window.addEventListener('blur', () => { if (!menuForm) closeMenu(); });

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
// De cada grupo solo se ven las dos primeras filas: la última casilla es el "+" (que muestra las demás) y, con todas visibles, el "−" las oculta
function applyVisibility() {
  groups.forEach(g => {
    const capacity = columns(g.grid) * 2;
    const needMore = g.buttons.length > capacity;
    const visible = needMore && !g.expanded ? capacity - 1 : g.buttons.length;
    g.buttons.forEach((b, i) => { b.hidden = i >= visible; });
    g.more.hidden = !needMore;
    g.more.textContent = g.expanded ? '−' : '+';
    const label = g.expanded ? 'Ocultar cadenas' : 'Mostrar más cadenas';
    g.more.title = label;
    g.more.setAttribute('aria-label', label);
  });
}
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(applyVisibility).observe(presetsBox);

// ¿Esta emisora impide el modo boletines? (las generalistas, salvo las marcadas con news: true)
export const blocksNews = st => !!st && st.group !== 'musical' && !st.news;

// ===========================
// == ELEGIR UNA EMISORA ==
// ===========================
// Un clic suena esa cadena (en la emisora donde se dejó); otro clic mientras suena pasa a su siguiente emisora (si tiene más de una). Parado, el clic la elige y la pone a sonar.
function onStationClick(st) {
  if (S.session === 'off') { const vi = posOf(st); saveLast(st, vi); play(st, vi); return; }
  if (S.current === st) {
    if (st.urls.length < 2) return;   // ya suena
    selectStation(st, (S.variant + 1) % st.urls.length);
    return;
  }
  selectStation(st, posOf(st));   // retoma la emisora de la cadena donde se dejó
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
  const next = list[(i + dir + list.length) % list.length];
  const vi = posOf(next);
  if (S.session === 'off') { saveLast(next, vi); play(next, vi); } else selectStation(next, vi);
}

// ============================
// == COLOR DE ÉNFASIS ==
// ============================
// El de la emisora que suena (campo "color" de los ajustes) o, si no tiene, el general
let accentShown = null;
export function refreshAccent() {
  if (S.pending) return;   // mientras se espera la confirmación del cambio, el color se queda como estaba
  const st = S.stationColors ? S.current : null;
  const hex = (st && st.color) || S.accent;
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

export function refreshNow() {
  if (!S.pending) { shown = S.current || S.lastStation; shownV = S.current ? S.variant : S.lastVariant; }
  psValue.classList.toggle('idle', !S.current && !S.pending);
  psValue.classList.toggle('pending', S.pending);
  setText(psValue, shown ? emisoraName(shown, shownV) : '—');   // el nombre de la emisora (Radio Madrid), no el de la cadena (Cadena SER)
}

export function refreshStations() {
  groups.forEach(g => g.buttons.forEach((b, i) => {
    const st = g.list[i];
    const active = S.current === st;
    b.classList.toggle('active', active);
    setText(g.labels[i], emisoraSub(st, active));   // bajo el nombre, solo en la elegida y con varias emisoras: "10 emisoras"
  }));
  refreshNow();
  updateNewsSwitch();
  refreshAccent();
}
