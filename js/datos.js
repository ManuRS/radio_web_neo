// ===============================================
// == DATOS: CAMBIOS DEL USUARIO Y ARCHIVOS CIFRADOS ==
// ===============================================
// Lo de por defecto (default/ y, en Proxy, bbdd/) va en la app. En el navegador y en el archivo exportado solo van los cambios del usuario:
// diff() los saca y merge() los vuelve a poner encima de lo de por defecto. Así, lo que cambie por defecto llega a quien no lo ha tocado.
//   - Listas con identificador (lists: clave -> función que da el id de cada elemento): elemento a elemento, con añadidos (add),
//     eliminados (del), campos cambiados (mod) y orden (order, solo si no es el que sale solo). Un elemento nuevo por defecto que no
//     estaba al guardar el orden va detrás del que lo precede en la lista por defecto.
//   - Objetos de primer nivel: clave a clave (obj). Lo demás, entero (set). Claves quitadas: del.
// Los archivos (exportar e importar; en Proxy, también la licencia) van cifrados con AES-256-GCM y una clave de la propia app: no se leen
// a simple vista y un carácter cambiado basta para que no se abran. La clave va en el código: frena a quien edita a mano, nada más.

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const sorted = v => Array.isArray(v) ? v.map(sorted) : isObj(v) ? Object.keys(v).sort().reduce((o, k) => { o[k] = sorted(v[k]); return o; }, {}) : v;
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));   // sin que importe el orden de las claves
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Cambios de un objeto, clave a clave: { set, del } o null si no hay
function fieldDiff(a, b) {
  if (!isObj(a) || !isObj(b)) return same(a, b) ? null : { val: clone(b) };
  const out = {};
  for (const k of Object.keys(b)) if (!same(a[k], b[k])) (out.set = out.set || {})[k] = clone(b[k]);
  for (const k of Object.keys(a)) if (!has(b, k)) (out.del = out.del || []).push(k);
  return Object.keys(out).length ? out : null;
}
function applyFields(a, d) {
  if (has(d, 'val')) return clone(d.val);
  const r = isObj(a) ? clone(a) : {};
  for (const k of d.del || []) delete r[k];
  for (const k in d.set || {}) r[k] = clone(d.set[k]);
  return r;
}

function mergeList(def, p, idOf) {
  const id = x => String(idOf(x));
  const del = new Set(p.del || []), mod = p.mod || {};
  const items = def.filter(x => !del.has(id(x))).map(x => (has(mod, id(x)) ? applyFields(x, mod[id(x)]) : clone(x)));
  const seen = new Set(items.map(id));
  for (const x of p.add || []) if (!seen.has(id(x))) { items.push(clone(x)); seen.add(id(x)); }
  if (!Array.isArray(p.order)) return items;
  const byId = new Map(items.map(x => [id(x), x])), out = [], placed = new Set();
  for (const k of p.order) if (byId.has(k) && !placed.has(k)) { out.push(byId.get(k)); placed.add(k); }
  items.forEach((x, i) => {
    if (placed.has(id(x))) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const q = out.indexOf(items[j]); if (q >= 0) { at = q + 1; break; } }
    out.splice(at, 0, x);
    placed.add(id(x));
  });
  return out;
}

function diffList(def, cur, idOf) {
  const id = x => String(idOf(x));
  const dm = new Map(def.map(x => [id(x), x])), cm = new Map(cur.map(x => [id(x), x]));
  const out = {};
  const del = [...dm.keys()].filter(k => !cm.has(k));
  const add = cur.filter(x => !dm.has(id(x)));
  const mod = {};
  for (const [k, x] of cm) if (dm.has(k)) { const d = fieldDiff(dm.get(k), x); if (d) mod[k] = d; }
  if (del.length) out.del = del;
  if (add.length) out.add = clone(add);
  if (Object.keys(mod).length) out.mod = mod;
  const ids = cur.map(id);
  if (!same(mergeList(def, out, idOf).map(id), ids)) out.order = ids;
  return Object.keys(out).length ? out : null;
}

// Cambios de cur respecto a def ({} si no hay ninguno)
export function diff(def, cur, lists = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(def), ...Object.keys(cur)])) {
    const a = def[k], b = cur[k];
    if (same(a, b)) continue;
    if (b === undefined) (out.del = out.del || []).push(k);
    else if (lists[k] && Array.isArray(a) && Array.isArray(b)) { const d = diffList(a, b, lists[k]); if (d) (out.list = out.list || {})[k] = d; }
    else if (isObj(a) && isObj(b)) { const d = fieldDiff(a, b); if (d) (out.obj = out.obj || {})[k] = d; }
    else (out.set = out.set || {})[k] = clone(b);
  }
  return out;
}

// Lo de por defecto con los cambios encima
export function merge(def, p, lists = {}) {
  const r = clone(def) || {};
  if (!isObj(p)) return r;
  for (const k of Array.isArray(p.del) ? p.del : []) delete r[k];
  for (const k in isObj(p.set) ? p.set : {}) r[k] = clone(p.set[k]);
  for (const k in isObj(p.obj) ? p.obj : {}) r[k] = applyFields(r[k], p.obj[k]);
  for (const k in isObj(p.list) ? p.list : {}) if (lists[k]) r[k] = mergeList(Array.isArray(r[k]) ? r[k] : [], p.list[k], lists[k]);
  return r;
}

export const isEmpty = p => !isObj(p) || !Object.keys(p).length;

// ==========================
// == ARCHIVOS CIFRADOS ==
// ==========================
// Archivo: { "<campo>": base64url(vector inicial + cifrado) }. kind va como dato asociado: un archivo de un tipo no se abre como otro
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const utf8 = s => new TextEncoder().encode(s);
const aesKey = (key, use) => crypto.subtle.importKey('raw', b64uBytes(key), 'AES-GCM', false, [use]);

// Texto del archivo con value cifrado
export async function sealFile(field, value, key, kind) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(kind) }, await aesKey(key, 'encrypt'), utf8(JSON.stringify(value))));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv);
  all.set(ct, iv.length);
  return JSON.stringify({ [field]: b64u(all) }) + '\n';
}

// Lo que lleva un archivo: { ok, value } o { ok: false, missing } (missing: el archivo no tiene ese campo; si no, está dañado o no es de este tipo)
export async function openFile(text, field, key, kind) {
  let o;
  try { o = JSON.parse(text); } catch (_) { return { ok: false, missing: true }; }
  if (!isObj(o) || typeof o[field] !== 'string') return { ok: false, missing: true };
  try {
    const all = b64uBytes(o[field]);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12), additionalData: utf8(kind) }, await aesKey(key, 'decrypt'), all.slice(12));
    return { ok: true, value: JSON.parse(new TextDecoder().decode(pt)) };
  } catch (_) { return { ok: false, missing: false }; }
}
