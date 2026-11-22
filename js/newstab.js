// ========================
// == VENTANA DE LOS BOLETINES ==
// ========================
// [NEO>
// Elige quién da los boletines ("newsStation", solo generalistas con "newsSource": true) y sus franjas ("news").
//  - Cadena SER (guiada), la primera: su horario ya hecho, una fila por boletín con su interruptor; donde hay dos duraciones se elige una.
// <NEO]
//    "Restablecer" vuelve a la selección de siempre.
//  - Cadena SER (lista manual) y el resto: una lista de franjas (Inicio y Fin) escrita a mano; se añaden con "+" y se quitan con ✕ (si hay más de una).   // [NEO]
// Lo de cada opción se guarda: al cambiar de opción, la lista de la que se deja va a "newsSaved" (por opción) y la de la nueva sale de ahí.
// En los ajustes, la SER manual se distingue por "newsGuided": false. Se guarda al momento; las franjas que se pisan o se tocan se unen al sonar.

import { S } from './state.js';
import { editSettings } from './settings.js';
import { parseJsonc } from './jsonc.js';
import { soundKey } from './utils.js';
import { closeDialog, openDialog } from './ui.js';

const panel = document.getElementById('tabNews');
const sel = document.getElementById('newsSel');
const list = document.getElementById('newsList');
const addBtn = document.getElementById('newsAdd');
const resetBtn = document.getElementById('newsReset');
const msg = document.getElementById('newsMsg');

// Ventana: se abre con el botón de editar del panel "Modo boletines" (antes era una pestaña de los ajustes)
const dlg = document.getElementById('newsDlg');
document.getElementById('newsEdit').addEventListener('click', () => { openDialog(dlg); panel.dispatchEvent(new Event('show')); });
document.getElementById('newsClose').addEventListener('click', () => closeDialog(dlg));
dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(dlg); });

// Horario de la SER: [nombre, [opción, franjas], ...]; con dos opciones se elige una (la corta, "Portada", o la larga). Una tarjeta puede
// encender varias franjas a la vez (los boletines de la noche, de la mañana...): se guardan las mismas franjas de siempre, una por boletín
const F = (start, end) => ({ start, end });
const SER_ROWS = [
  ['Boletines noche', ['', [F('01:59:38', '02:05:00'), F('02:59:38', '03:05:00'), F('03:59:38', '04:05:00'), F('04:59:38', '05:05:00')]]],
  ['Las 6 de HxH', ['Portada', [F('05:59:38', '06:05:00')]], ['Tramo completo', [F('05:59:38', '06:30:00')]]],
  ['Las 7 de HxH', ['Portada', [F('06:59:38', '07:05:00')]], ['Tramo completo', [F('06:59:38', '07:20:00')]]],
  ['Las 8 de HxH', ['Portada', [F('07:59:55', '08:06:00')]], ['Tramo completo', [F('07:59:55', '08:20:10')]]],
  ['Boletines mañana', ['', [F('08:59:55', '09:04:00'), F('09:59:55', '10:05:50'), F('10:59:38', '11:05:50'), F('11:59:38', '12:05:50'), F('12:59:38', '13:06:40')]]],
  ['Portada H14', ['Portada', [F('13:59:38', '14:06:10')]], ['Portada y desconexión', [F('13:59:38', '14:30:00')]]],
  ['Hora 14', ['', [F('14:30:00', '15:00:00')]]],
  ['Boletines tarde', ['', [F('15:59:38', '16:05:20'), F('16:59:38', '17:05:20'), F('17:59:38', '18:05:20'), F('18:59:38', '19:05:00')]]],
  ['Todo Por La Radio', ['', [F('16:59:38', '18:00:00')]]],
  ['Hora 20', ['Portada', [F('19:59:38', '20:06:00')]], ['Tramo completo', [F('19:59:38', '20:25:10')]]],
  ['Portadas de Hora 25', ['', [F('20:59:38', '21:04:00'), F('21:59:55', '22:04:00'), F('22:59:55', '23:04:00')]]],
].map(([label, ...opts]) => ({ label, opts: opts.map(([name, slots]) => ({ name, slots })) }));
const RENAMED = [[F('06:59:38', '07:30:00'), F('06:59:38', '07:20:00')]];   // franjas guardadas de antes que han cambiado: el tramo de las 7 acaba a las 7:20
// Selección de siempre (la de default/general.json): la de partida y la de "Restablecer"
const SER_DEFAULT = [['07:59:55', '08:20:10'], ['08:59:55', '09:04:00'], ['09:59:55', '10:05:50'], ['10:59:38', '11:05:50'], ['11:59:38', '12:05:50'],
  ['12:59:38', '13:06:40'], ['13:59:38', '14:06:10'], ['15:59:38', '16:05:20'], ['16:59:38', '17:05:20'], ['17:59:38', '18:05:20'], ['18:59:38', '19:05:00'],
  ['19:59:38', '20:25:10'], ['20:59:38', '21:04:00'], ['21:59:55', '22:04:00'], ['22:59:55', '23:04:00']].map(([start, end]) => ({ start, end }));
const GUIDED = 'ser-guiada';   // la opción de la SER con su horario (las demás opciones son el id de la cadena)

const isSer = st => !!st && (st.id === 'ser' || ['ser', 'cadenaser'].includes(soundKey(st.name)));   // [NEO]
const same = (a, b) => a.start === b.start && a.end === b.end;

// [NEO>
let station = null;   // cadena elegida (objeto de S.stations)
let opt = '';         // opción elegida en el selector (GUIDED o el id de la cadena)
// <NEO]
let pick = [];        // con la SER: opción elegida de cada fila (-1 = apagada)
let last = [];        // con la SER: última opción usada en cada fila (para volver a ella al encenderla)
let rows = [];        // con otra cadena: [{ start, end }] (puede haber filas a medio escribir)

function report(lines, isError) {
  msg.className = 'cfgmsg' + (isError ? ' err' : ' ok');
  msg.textContent = lines.join('\n');
}
const clearMsg = () => { msg.className = 'cfgmsg'; msg.textContent = ''; };

// Lo que hay en los ajustes, pasado a filas de la SER: una opción está puesta si están todas sus franjas (null si sobra alguna franja que no
// encaja en el horario, o si de una tarjeta con varias solo hay algunas: entonces se ve como lista manual)
function serPick(news) {
  news = news.map(n => (RENAMED.find(([o]) => same(o, n)) || [, n])[1]);
  const has = x => news.some(n => same(n, x));
  const out = SER_ROWS.map(row => row.opts.findIndex(o => o.slots.every(has)));
  const used = SER_ROWS.flatMap((row, i) => (out[i] >= 0 ? row.opts[out[i]].slots : []));
  return news.every(n => used.some(x => same(x, n))) ? out : null;
}

function save(news) {
  if (S.newsOn || S.trans) { report(['No se pueden cambiar los boletines durante un boletín o una transición'], true); return false; }
  const ok = editSettings(raw => {
    raw.newsStation = station.id;   // [NEO]
    raw.news = news.map(n => ({ start: n.start, end: n.end }));
  }, report);
  if (ok) clearMsg();
  return ok;
}
const saveSer = () => save(SER_ROWS.flatMap((row, i) => (pick[i] >= 0 ? row.opts[pick[i]].slots : [])));
// Con otra cadena se guardan las filas completas (las vacías o a medias se quedan en pantalla hasta terminarlas)
const hms = v => {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v || '');
  return m && +m[1] < 24 && +m[2] < 60 && +(m[3] || 0) < 60 ? m[1] + ':' + m[2] + ':' + (m[3] || '00') : '';
};
function saveOwn() {
  const wrong = rows.find(r => (r.start && !hms(r.start)) || (r.end && !hms(r.end)));
  if (wrong) { report(['Hora no válida: escribe hh:mm:ss (por ejemplo 08:59:50)'], true); return false; }
  const done = rows.map(r => ({ start: hms(r.start), end: hms(r.end) })).filter(r => r.start && r.end);
  const bad = done.find(r => r.start === r.end);
  if (bad) { report(['La franja de las ' + bad.start + ' empieza y acaba a la misma hora'], true); return false; }
  return save(done);
}

// =============
// == PINTADO ==
// =============
function switchEl(checked, label, onChange) {
  const sw = document.createElement('label');
  sw.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => onChange(input.checked));
  const track = document.createElement('span');
  track.className = 'track';
  sw.append(input, track);
  return sw;
}

function renderSer() {
  list.textContent = '';
  list.className = 'nlist ser';
  SER_ROWS.forEach((row, i) => {
    const on = pick[i] >= 0;
    const el = document.createElement('div');
    el.className = 'nrow' + (on ? '' : ' off');
    const text = document.createElement('div');
    text.className = 'ntext';
    const b = document.createElement('b');
    b.textContent = row.label;   // sin las horas: el horario ya está hecho
    text.append(b);
    el.append(text, switchEl(on, row.label, v => { pick[i] = v ? last[i] : -1; saveSer(); renderSer(); }));
    if (row.opts.length > 1) {
      const seg = document.createElement('div');
      seg.className = 'nseg';
      row.opts.forEach((op, j) => {
        const bt = document.createElement('button');
        bt.type = 'button';
        if (op.name === 'Portada y desconexión') bt.innerHTML = '<span class="nlong">Portada y desconexión</span><span class="nshort">Portada y desco</span>';   // en el móvil no cabe entero
        else bt.textContent = op.name;
        bt.classList.toggle('active', j === (on ? pick[i] : last[i]));
        bt.addEventListener('click', () => { last[i] = j; pick[i] = j; saveSer(); renderSer(); });   // elegir una opción enciende la fila
        seg.appendChild(bt);
      });
      el.appendChild(seg);
    }
    list.appendChild(el);
  });
  addBtn.hidden = true;
  resetBtn.hidden = false;
}

function renderOwn() {
  list.textContent = '';
  list.className = 'nlist own';
  const head = document.createElement('div');
  head.className = 'nhead';
  head.innerHTML = '<span>Inicio</span><span>Fin</span>';
  list.appendChild(head);
  rows.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'nrow own';
    // hh:mm:ss en 24 h, igual en todos los navegadores: se teclean solo cifras y los dos puntos se ponen solos
    const mk = (k, label) => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'numeric';
      inp.maxLength = 8;
      inp.placeholder = 'hh:mm:ss';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.className = 'ntime';
      inp.value = r[k];
      inp.setAttribute('aria-label', label + ' de la franja ' + (i + 1));
      inp.addEventListener('input', () => {
        // el cursor se queda donde estaba (tras el mismo número de cifras), no salta al final al borrar o escribir en medio
        const pos = inp.selectionStart ?? inp.value.length, before = inp.value.slice(0, pos).replace(/\D/g, '').length;
        const d = inp.value.replace(/\D/g, '').slice(0, 6);
        const v = d.replace(/^(\d{2})(\d{1,2})?(\d{1,2})?$/, (m, a, b, c) => a + (b ? ':' + b : '') + (c ? ':' + c : ''));
        if (v === inp.value) return;
        inp.value = v;
        let at = 0;
        for (let n = 0; at < v.length && n < before; at++) if (/\d/.test(v[at])) n++;
        inp.setSelectionRange(at, at);
      });
      const mine = opt;   // al cambiar de opción se repinta y el campo, al perder el foco, puede avisar tarde: entonces ya no cuenta
      inp.addEventListener('change', () => { if (opt !== mine || !inp.isConnected) return; r[k] = inp.value; saveOwn(); });
      return inp;
    };
    el.append(mk('start', 'Inicio'), mk('end', 'Fin'));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ndel';
    del.textContent = '✕';
    del.title = 'Quitar franja';
    del.setAttribute('aria-label', 'Quitar la franja ' + (i + 1));
    del.hidden = rows.length < 2;
    del.addEventListener('click', () => { rows.splice(i, 1); saveOwn(); renderOwn(); });
    el.appendChild(del);
    list.appendChild(el);
  });
  addBtn.hidden = false;
  resetBtn.hidden = true;
}

// Opciones del selector: la SER guiada primero, luego las generalistas que pueden dar boletines (la SER, como lista manual)
function options() {
  // [NEO>
  let srcs = S.stations.filter(x => x.group !== 'musical' && x.newsSource);
  if (!srcs.length) srcs = S.stations.filter(x => x.group !== 'musical');   // ajustes antiguos, sin marcar ninguna
  // <NEO]
  if (station && !srcs.includes(station)) srcs = [station, ...srcs];        // la que está puesta, aunque no esté marcada
  const out = [];
  const ser = srcs.find(isSer);
  // [NEO>
  if (ser) out.push({ key: GUIDED, st: ser, name: ser.name + ' (guiada)' });
  for (const x of srcs) out.push({ key: x.id, st: x, name: isSer(x) ? x.name + ' (lista manual)' : x.name });
  // <NEO]
  return out;
}
function render() {
  sel.textContent = '';
  for (const o of options()) {
    const op = document.createElement('option');
    op.value = o.key;
    op.textContent = o.name;
    sel.appendChild(op);
  }
  sel.value = opt;
  if (opt === GUIDED) renderSer(); else renderOwn();
}

// Ajustes tal como están escritos (para "newsGuided" y "newsSaved", que solo usa esta pestaña)
function rawConfig() { try { const r = parseJsonc(S.configText || ''); return r && typeof r === 'object' ? r : {}; } catch (_) { return {}; } }

// Estado de partida, desde los ajustes que hay ahora
function load() {
  const raw = rawConfig();
  // [NEO>
  station = S.newsStation || S.stations.find(isSer) || S.stations.find(x => x.group !== 'musical') || null;
  opt = isSer(station) && raw.newsGuided !== false ? GUIDED : station ? station.id : '';
  // <NEO]
  const news = S.news || [];
  if (opt === GUIDED) {
    pick = serPick(news) || serPick(SER_DEFAULT);
    last = pick.map(p => Math.max(0, p));
  } else {
    rows = news.length ? news.map(n => ({ start: n.start, end: n.end })) : [{ start: '', end: '' }];
  }
}

// Cambio de opción: lo de la que se deja se guarda en "newsSaved" y la nueva recupera lo suyo (o empieza: la SER guiada con la selección de siempre, el resto con una fila vacía)
sel.addEventListener('change', () => {
  const o = options().find(x => x.key === sel.value);
  if (!o) return;
  if (S.newsOn || S.trans) { report(['No se pueden cambiar los boletines durante un boletín o una transición'], true); sel.value = opt; return; }
  const from = opt;
  const ok = editSettings(raw => {
    const saved = raw.newsSaved && typeof raw.newsSaved === 'object' && !Array.isArray(raw.newsSaved) ? raw.newsSaved : {};
    if (from) saved[from] = Array.isArray(raw.news) ? raw.news : [];
    let next = saved[o.key];
    delete saved[o.key];
    if (!Array.isArray(next)) next = o.key === GUIDED ? SER_DEFAULT : [];
    raw.news = next.map(n => ({ start: n.start, end: n.end }));
    raw.newsStation = o.st.id;   // [NEO]
    if (isSer(o.st) && o.key !== GUIDED) raw.newsGuided = false; else delete raw.newsGuided;
    if (Object.keys(saved).length) raw.newsSaved = saved; else delete raw.newsSaved;
  }, report);
  if (ok) clearMsg(); else sel.value = opt;
  load();
  render();
});
resetBtn.addEventListener('click', () => {   // SER guiada: la selección de siempre
  pick = serPick(SER_DEFAULT);
  last = pick.map(p => Math.max(0, p));
  saveSer();
  renderSer();
});
addBtn.addEventListener('click', () => {
  rows.push({ start: '', end: '' });
  renderOwn();
  const ins = list.querySelectorAll('input.ntime');
  if (ins.length) ins[ins.length - 2].focus();
});

panel.addEventListener('show', () => { clearMsg(); load(); render(); });   // [NEO]
