// ===================================
// == IMPORTADOR DE TDTCHANNELS (UI) ==
// ===================================
// El panel gris con la lupa (sobre el modo boletines) abre una ventana con los canales de las listas de TDTChannels que coinciden con el nombre buscado.
// Cada canal muestra sus opciones (formato y servidor); se elige una y se decide: añadirla como una emisora más de una cadena que ya existe
// (con el nombre de la opción, editable) o crear con ella una cadena nueva. Las listas y su caché de una semana están en tdt.js, junto al catálogo interno
// del proyecto (la base de datos de bbdd/), que también entra en la búsqueda: las cadenas y emisoras conocidas se pueden recuperar aunque no estén en los ajustes.

import { S } from './state.js';
import { closeDialog, log, openDialog, toast } from './ui.js';
import { editHooks } from './stations.js';
import { addChainFromForm, createChain, lastSettingsMsg } from './settings.js';
import { TDT_MAX_AGE_MS, dedupe, importFile, loadCatalog, loadLists, norm, optionName, search } from './tdt.js';

const $ = id => document.getElementById(id);
const panel = $('tdtPanel'), query = $('tdtQuery'), go = $('tdtGo');
const dlg = $('tdtDlg'), q2 = $('tdtQ'), statusEl = $('tdtStatus'), listEl = $('tdtList'), infoEl = $('tdtInfo');
const addDlg = $('tdtAddDlg'), addTitle = $('tdtAddTitle'), selName = $('tdtSelName'), selInfo = $('tdtSelInfo'), dest = $('tdtDest'), msg = $('tdtMsg');
const modeOld = $('tdtModeOld'), modeNew = $('tdtModeNew'), oldRow = $('tdtOldRow'), newRow = $('tdtNewRow');
const chainSel = $('tdtChain'), labelIn = $('tdtLabel'), addBtn = $('tdtAdd');
const nName = $('tdtNName'), nShort = $('tdtNShort'), nType = $('tdtNType'), nColor = $('tdtNColor'), nColorPick = $('tdtNColorPick');
const fileBtn = $('tdtFileBtn'), fileIn = $('tdtFile');
const titleEl = $('tdtTitle'), tabs = $('tdtTabs'), tabCat = $('tdtTabCat'), tabUrl = $('tdtTabUrl'), catBox = $('tdtCat'), urlBox = $('tdtUrl');
const stForm = $('stForm'), varForm = $('varForm'), stMsg = $('stMsg'), stAdd = $('stAdd');

const MAX_SHOWN = 60;
const httpOk = location.protocol !== 'https:';
let lists = null;        // { items (catálogo interno + TDTChannels), tdt (cuántos son de TDTChannels), errors, missing, oldest }
let loading = null;      // descarga en curso (promesa)
let picked = null;       // { ch, i }: la opción elegida
let mode = 'old';        // 'old' = emisora de una cadena existente; 'new' = cadena nueva
let busy = false;
let ctx = null;          // de dónde se abrió: null = el buscador; { kind: 'new', group } = el "+" de un grupo; { kind: 'old', st } = "Añadir emisora…" de una cadena

const setMsg = (text, isError) => {
  msg.textContent = text || '';
  msg.className = 'cfgmsg' + (text ? (isError ? ' err' : ' ok') : '');
};

// ============
// == LISTAS ==
// ============
async function ensureLists(force = false) {
  if (!force && lists && Date.now() - lists.oldest <= TDT_MAX_AGE_MS) return;
  if (loading) return loading;
  statusEl.textContent = 'Cargando las listas de TDTChannels…';
  statusEl.className = 'tdtstatus';
  loading = Promise.all([loadLists(force), loadCatalog()]).then(([r, cat]) => {
    const tdt = dedupe(cat, r.items);   // lo que ya está en el catálogo de Radio Web Neo no se repite en TDTChannels
    // Se cuentan emisoras: las de Neo son las opciones de cada cadena (urls[]); en TDTChannels cada canal ya es una emisora
    lists = { ...r, items: cat.concat(tdt), neo: cat.reduce((n, c) => n + c.o.length, 0), tdt: tdt.length };
    if (r.refreshed.length) log('TDTChannels: listas descargadas (' + r.refreshed.join(', ') + '): ' + r.items.length + ' canales que se pueden escuchar');
    for (const k of Object.keys(r.errors)) log('TDTChannels: no se pudo descargar la lista de ' + (k === 'tv' ? 'televisión' : 'radio') + ': ' + r.errors[k]);
  }).finally(() => { loading = null; });
  return loading;
}

// =============
// == RESULTADOS ==
// =============
function renderStatus(shown, total) {
  const errs = lists ? Object.keys(lists.errors) : [];
  if (!lists || !lists.items.length) {
    statusEl.className = 'tdtstatus err';
    statusEl.textContent = 'No se pudieron cargar las listas (sin conexión, o el sitio no permite leerlas desde el navegador).';
    return;
  }
  statusEl.className = 'tdtstatus';
  const bits = [];
  if (!norm(q2.value)) bits.push('Escribe el nombre de la emisora que buscas');
  else if (!total) bits.push('Sin resultados');
  else bits.push(total === 1 ? '1 coincidencia' : total + ' coincidencias' + (shown < total ? ' (se muestran ' + shown + ': afina la búsqueda)' : ''));
  if (errs.length) {
    statusEl.className = 'tdtstatus err';
    const names = errs.map(k => k === 'tv' ? 'televisión' : 'radio').join(' ni la de ');
    bits.push(lists.missing.length ? 'no se pudo descargar la lista de ' + names + ' de TDTChannels' : 'no se pudo actualizar la lista de ' + names + ': se usa la guardada');
  }
  statusEl.textContent = bits.join(' · ');
}

function renderInfo() {
  const n = c => c + (c === 1 ? ' emisora' : ' emisoras');
  infoEl.textContent = lists ? [lists.neo ? 'Radio Web Neo ' + n(lists.neo) : '', lists.tdt ? 'TDTChannels ' + n(lists.tdt) : ''].filter(Boolean).join(' · ') : '';
}

// Lo que se ve de una opción: su formato, con número si el canal tiene varias del mismo (AAC 1, AAC 2…)
// Final del enlace, para distinguir las opciones de un canal de TDTChannels: ".../CADENASERAAC.aac" → "CADENASERAAC". Si el final no dice nada ("stream", "live"…), el servidor
function urlTail(u) {
  let x;
  try { x = new URL(u); } catch { return String(u).slice(-24); }
  const seg = decodeURIComponent(x.pathname.split('/').filter(Boolean).pop() || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  return !seg || /^(stream|live|listen|play|radio|index|audio|directo)$/i.test(seg) ? x.hostname.replace(/^www\./, '') : seg;
}
const fmtName = o => (o.f === 'm3u8' ? 'HLS' : o.f === 'stream' ? 'Directo' : o.f.toUpperCase());
function optLabel(ch, i) {
  const o = ch.o[i];
  if (ch.k === 'neo' && o.l) return o.l;   // catálogo interno: el nombre de la emisora
  const f = fmtName(o);
  const same = ch.o.filter(x => x.f === o.f);
  return same.length > 1 ? f + ' ' + (same.indexOf(o) + 1) : f;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Salvo en las cadenas por comunidad de SER y LOS40 (ahí la tarjeta con el nombre de la comunidad se ve siempre, aunque tengan una sola emisora)
const isSolo = ch => ch._all === 1 && !ch.r;

function renderResults() {
  listEl.textContent = '';
  const hits = lists ? search(lists.items, q2.value, httpOk) : [];
  const shown = hits.filter(h => h.k === 'neo').concat(hits.filter(h => h.k !== 'neo')).slice(0, MAX_SHOWN);   // primero el catálogo de Neo
  const keep = picked && shown.find(h => h.n === picked.ch.n && h.a === picked.ch.a && h.k === picked.ch.k);
  if (!keep) clearPick();
  // dos apartados: el catálogo de Radio Web Neo y el de TDTChannels (cada uno con su título, si tiene resultados)
  let section = '';
  for (const ch of shown) {
    const sec = ch.k === 'neo' ? 'Catálogo Radio Web Neo' : 'Catálogo TDTChannels';
    if (sec !== section) { section = sec; listEl.appendChild(el('div', 'tdtsec', sec)); }
    const solo = isSolo(ch);   // un canal con una sola emisora no tiene nada que elegir: su nombre es el botón (como en el menú de una cadena con una sola emisora)
    const card = el('div', solo ? 'tdtch solo' : 'tdtch');
    const head = el(solo ? 'span' : 'div', solo ? 'fmt tdthead' : 'tdthead');
    head.appendChild(el('b', '', ch.n));
    if (solo && ch.k !== 'neo') head.appendChild(el('span', 'tag', optLabel(ch, 0)));   // en TDTChannels, el formato de su única opción en una burbuja (con varias, va en cada fila)
    if (ch.k !== 'neo') head.appendChild(el('span', 'tag', ch.k === 'tv' ? 'Audio TV' : 'Radio'));
    if (ch.a) head.appendChild(el('span', 'tag', ch.a));   // el tipo/ámbito que da TDTChannels (Musicales, Andalucía…), también en burbuja
    if (ch.g) head.appendChild(el('span', 'tag geo', 'solo España'));
    if (!solo) card.appendChild(head);
    ch.o.forEach((o, i) => {
      const b = el('button', 'tdtopt');
      b.type = 'button';
      if (solo) b.appendChild(head);
      else if (ch.k === 'neo') b.appendChild(el('span', 'fmt', optLabel(ch, i)));
      else {   // TDTChannels: varias opciones son varios enlaces del mismo canal: el final de cada enlace y su formato en una burbuja
        const f = el('span', 'fmt', urlTail(o.u));
        f.appendChild(el('span', 'tag', fmtName(o)));
        b.appendChild(f);
      }
      b.addEventListener('click', () => pick(ch, i));
      card.appendChild(b);
    });
    listEl.appendChild(card);
  }
  renderStatus(shown.length, hits.length);
  renderInfo();
}

// ================
// == SELECCIÓN ==
// ================
function clearPick() {
  picked = null;
  if (addDlg.open) closeDialog(addDlg);
  setMsg('');
}

const chainName = c => c.name + (c.group === 'musical' ? ' (musical)' : '');

// Cadena que ya existe y parece la del canal: su nombre o su nombre corto aparecen en el del canal ("SER Algeciras" → "Cadena SER" por el corto "SER")
function guessChain(chName) {
  const n = ' ' + norm(chName) + ' ';
  let best = null, score = 0;
  for (const c of S.stations) {
    for (const cand of [c.name, c.short]) {
      const k = norm(cand);
      if (k && n.includes(' ' + k + ' ') && k.length > score) { best = c; score = k.length; }
    }
  }
  return best;
}

function fillChains(selectedId) {
  chainSel.textContent = '';
  const first = el('option', '', 'Elige una cadena…');
  first.value = '';
  chainSel.appendChild(first);
  for (const c of S.stations) {
    const o = el('option', '', chainName(c));
    o.value = c.id;
    chainSel.appendChild(o);
  }
  chainSel.value = selectedId || '';
}

function setMode(m) {
  mode = m;
  [[modeOld, 'old'], [modeNew, 'new']].forEach(([b, k]) => { b.classList.toggle('active', m === k); b.setAttribute('aria-selected', String(m === k)); });
  oldRow.hidden = m !== 'old';
  newRow.hidden = m !== 'new';
  $('tdtForm').classList.toggle('isnew', m === 'new');
}

function pick(ch, i) {
  picked = { ch, i };
  // arriba, lo elegido: el canal y, debajo, la opción (emisora o enlace y formato) y de qué catálogo viene
  selName.textContent = ch.n;
  const opt = isSolo(ch) ? (ch.k === 'neo' ? '' : fmtName(ch.o[i])) : ch.k === 'neo' ? optLabel(ch, i) : urlTail(ch.o[i].u) + ' · ' + fmtName(ch.o[i]);
  selInfo.textContent = [opt, ch.k === 'neo' ? 'Catálogo Radio Web Neo' : 'TDTChannels'].filter(Boolean).join(' · ');
  labelIn.value = optionName(ch, i);
  // el catálogo interno ya trae el nombre corto, el tipo y el color de la cadena; las listas de TDTChannels, no
  nName.value = ch.n.slice(0, 40);
  nShort.value = ch.short || '';
  nType.value = ch.t || 'general';
  nColor.value = ch.c || '';
  if (ch.c) nColorPick.value = ch.c;
  if (ctx && ctx.kind === 'new') { fillChains(''); setMode('new'); if (ctx.group) nType.value = ctx.group; }
  else if (ctx) { fillChains(ctx.st.id); setMode('old'); oldRow.hidden = true; }   // la cadena ya está elegida
  else {
    const guess = guessChain(ch.n);
    fillChains(guess ? guess.id : '');
    setMode(guess ? 'old' : 'new');
  }
  dest.hidden = !!ctx;   // con un contexto, el destino no se elige
  addTitle.textContent = !ctx ? 'Añadir emisora' : ctx.kind === 'new' ? 'Crear nueva presintonía' : 'Nueva emisora en ' + ctx.st.name;
  setMsg('');
  openDialog(addDlg);   // otra ventana encima de la lista
  (mode === 'new' ? nName : labelIn).focus();
}

async function add() {
  if (busy || !picked) return;
  const o = picked.ch.o[picked.i];
  const label = labelIn.value.trim();
  busy = true;
  addBtn.disabled = true;
  addBtn.textContent = 'Comprobando…';
  setMsg('Comprobando el enlace…');
  try {
    let err;
    if (mode === 'old') {
      if (!chainSel.value) { setMsg('Elige la cadena a la que añadir la emisora', true); return; }
      const st = S.stations.find(x => x.id === chainSel.value);
      err = await editHooks.addVariant(chainSel.value, o.u, label);
      if (!err) setMsg('Emisora añadida a ' + (st ? st.name : 'la cadena') + (label ? ': ' + label : ''));
    } else {
      const name = nName.value.trim();
      err = await createChain({ name, short: nShort.value, group: nType.value, color: nColor.value, url: o.u, label });
      if (!err) setMsg('Cadena añadida: ' + name);
    }
    if (err) { setMsg(err, true); return; }
    log('TDTChannels: ' + picked.ch.n + ' (' + o.f + ') importada');
    toast(msg.textContent);
    closeDialog(addDlg);   // vuelve a la lista (para añadir más) o, si se vino del "+" o del menú de una cadena, se cierra todo
    if (ctx) closeDialog(dlg);
  } finally {
    busy = false;
    addBtn.disabled = false;
    addBtn.textContent = 'Añadir';
  }
}

// ============
// == VENTANA ==
// ============
let debounce = 0;
async function openSearch() {
  const text = query.value.trim();
  setCtx(null);
  q2.value = text;
  openDialog(dlg);
  q2.focus();   // en el mismo toque, para que el teclado del móvil salga ya en la ventana
  clearPick();
  listEl.textContent = '';
  try { await ensureLists(); } catch (err) { log('TDTChannels: ' + ((err && err.message) || err)); }
  renderResults();
}

// =========================================================
// == CREAR PRESINTONÍA / NUEVA EMISORA: CATÁLOGO O ENLACE ==
// =========================================================
// La misma ventana, con dos pestañas: "Consultar catálogo" (el buscador, con el destino ya fijado) y "Tengo un enlace" (el formulario de siempre)
function setCtx(c) {
  ctx = c;
  tabs.hidden = !c;
  titleEl.textContent = !c ? 'Buscar emisoras' : c.kind === 'new' ? 'Crear nueva presintonía' : 'Nueva emisora en ' + c.st.name;
  stForm.hidden = !c || c.kind !== 'new';
  varForm.hidden = !c || c.kind !== 'old';
  showTab('cat');
}
function showTab(t) {
  catBox.hidden = t !== 'cat';
  urlBox.hidden = t !== 'url';
  [[tabCat, 'cat'], [tabUrl, 'url']].forEach(([b, k]) => { b.classList.toggle('active', k === t); b.setAttribute('aria-selected', String(k === t)); });
  if (t === 'url') (ctx && ctx.kind === 'old' ? $('varUrl') : $('stName')).focus();
  else if (dlg.open) q2.focus();
}
async function openAdd(c) {
  setCtx(c);
  q2.value = '';
  stMsg.textContent = '';
  stMsg.className = 'cfgmsg';
  varForm.reset();
  if (c.kind === 'new' && c.group) $('stType').value = c.group;
  openDialog(dlg);
  clearPick();
  listEl.textContent = '';
  q2.focus();
  try { await ensureLists(); } catch (err) { log('TDTChannels: ' + ((err && err.message) || err)); }
  renderResults();
}
editHooks.newChain = group => openAdd({ kind: 'new', group });
editHooks.newVariant = st => openAdd({ kind: 'old', st });
tabCat.addEventListener('click', () => showTab('cat'));
tabUrl.addEventListener('click', () => showTab('url'));

// "Tengo un enlace": cadena nueva (el formulario de settings.js) o emisora nueva de la cadena elegida
let urlBusy = false;
async function addFromUrl() {
  if (!ctx || urlBusy) return;
  if (ctx.kind === 'new') {
    if (await addChainFromForm()) { toast(lastSettingsMsg()); closeDialog(dlg); }
    return;
  }
  urlBusy = true;
  stAdd.disabled = true;
  stAdd.textContent = 'Comprobando…';
  stMsg.className = 'cfgmsg';
  stMsg.textContent = '';
  try {
    const st = ctx.st, name = $('varName').value;
    const err = editHooks.addVariant ? await editHooks.addVariant(st.id, $('varUrl').value, name) : 'No disponible';
    if (err) { stMsg.className = 'cfgmsg err'; stMsg.textContent = err; return; }
    toast('Emisora añadida a ' + st.name + (name.trim() ? ': ' + name.trim() : ''));
    closeDialog(dlg);
  } catch (_) {
    stMsg.className = 'cfgmsg err';
    stMsg.textContent = 'No se pudo añadir la emisora';
  } finally {
    urlBusy = false;
    stAdd.disabled = false;
    stAdd.textContent = 'Añadir';
  }
}
stAdd.addEventListener('click', addFromUrl);
stForm.addEventListener('submit', e => { e.preventDefault(); addFromUrl(); });
varForm.addEventListener('submit', e => { e.preventDefault(); addFromUrl(); });

// El buscador de la página solo abre la ventana (se escribe allí y los resultados salen en vivo)
panel.addEventListener('click', openSearch);
query.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSearch(); } });
q2.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(renderResults, 120); });
q2.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); renderResults(); } });
$('tdtClose').addEventListener('click', () => closeDialog(dlg));
dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(dlg); });
dlg.addEventListener('close', () => { if (!ctx) query.value = q2.value.trim(); });   // el texto vuelve al buscador de la página solo si se abrió desde él

modeOld.addEventListener('click', () => setMode('old'));
modeNew.addEventListener('click', () => setMode('new'));
addBtn.addEventListener('click', add);
$('tdtAddClose').addEventListener('click', () => closeDialog(addDlg));
$('tdtBack').addEventListener('click', () => closeDialog(addDlg));
addDlg.addEventListener('click', e => { if (e.target === addDlg) closeDialog(addDlg); });
addDlg.addEventListener('close', () => { picked = null; });
nColorPick.addEventListener('input', () => { nColor.value = nColorPick.value; });
nColor.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(nColor.value.trim())) nColorPick.value = nColor.value.trim(); });

// Carga a mano de radio.json y tv.json (por si el navegador no puede descargarlos): el tipo se deduce del nombre del archivo ("tv" = televisión)
fileBtn.addEventListener('click', () => fileIn.click());
fileIn.addEventListener('change', async () => {
  const files = [...(fileIn.files || [])];
  fileIn.value = '';
  const done = [];
  for (const f of files) {
    const kind = /tv|tele/i.test(f.name) ? 'tv' : 'radio';
    try { await importFile(kind, await f.text()); done.push(f.name); }
    catch (err) { setMsg(f.name + ': ' + ((err && err.message) || err), true); }
  }
  if (done.length) {
    log('TDTChannels: listas cargadas desde archivo (' + done.join(', ') + ')');
    lists = null;
    try { await ensureLists(); } catch (_) {}
    renderResults();
  }
});
