// ==========================================
// == CÓDIGO COMÚN DE NEO Y PROXY (CONTROL) ==
// ==========================================
// Radio Web Neo y Radio Proxy Web comparten buena parte del código. Este archivo (el mismo en los dos repositorios) vigila que no se separe sin querer.
// En test/comun.json hay dos listas, idénticas en los dos repositorios:
//   - "iguales":   archivos que son idénticos byte a byte en las dos apps. Lo propio de cada una entra por APP_ID (state.js).
//   - "paralelos": archivos con el mismo código salvo trozos propios de cada app, que van MARCADOS:
//         una línea:    ...código...   // [NEO]        (o // [PROXY])
//         un bloque:    // [NEO>   ...líneas...   // <NEO]
//     Quitando lo marcado, el archivo es idéntico en las dos apps. En Neo solo hay marcas NEO y en Proxy solo PROXY.
// El resto de archivos son propios de cada app (audio.js, settings.js, boletines.js, main.js, state.js, ui.js, css, index.html...).
//
// Uso (desde la raíz del repositorio):
//   node test/comun.mjs                      comprueba este repositorio contra comun.json (lo mismo hacen las pruebas: node --test "test/*.test.mjs")
//   node test/comun.mjs --comparar <ruta>    compara con el otro repositorio (carpeta local) y dice qué archivo se ha separado
//   node test/comun.mjs --sellar             tras cambiar a propósito un archivo común EN LAS DOS apps: apunta las huellas nuevas en comun.json
//                                            (hay que sellar en los dos repositorios; comun.json debe quedar igual en ambos)

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'test', 'comun.json');
const sha = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const read = (root, rel) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// Qué app es un repositorio: por su APP_ID
export function appTag(root = ROOT) {
  const m = read(root, 'js/state.js').match(/export const APP_ID = '(\w+)'/);
  if (!m) throw new Error('state.js no tiene APP_ID');
  return m[1] === 'rn' ? 'NEO' : 'PROXY';
}

// Quita de un archivo paralelo lo marcado como propio. Devuelve { text, errors }
export function stripOwn(text, tag) {
  const out = [], errors = [];
  let open = 0;   // línea donde se abrió el bloque (0 = fuera)
  text.split('\n').forEach((line, i) => {
    const other = line.match(/\/\/ (?:\[(NEO|PROXY)[\]>]|<(NEO|PROXY)\])/);
    if (other && (other[1] || other[2]) !== tag) errors.push('línea ' + (i + 1) + ': marca de la otra app');
    if (new RegExp('^\\s*// \\[' + tag + '>').test(line)) { if (open) errors.push('línea ' + (i + 1) + ': bloque dentro de otro'); open = i + 1; return; }
    if (new RegExp('^\\s*// <' + tag + '\\]').test(line)) { if (!open) errors.push('línea ' + (i + 1) + ': cierre sin bloque'); open = 0; return; }
    if (open) return;
    if (new RegExp('// \\[' + tag + '\\]\\s*$').test(line)) return;
    out.push(line);
  });
  if (open) errors.push('línea ' + open + ': bloque sin cerrar');
  return { text: out.join('\n'), errors };
}

export const loadManifest = (root = ROOT) => JSON.parse(read(root, 'test/comun.json'));

// Huellas actuales de un repositorio para las listas del manifiesto
export function fingerprints(root = ROOT, manifest = loadManifest(root)) {
  const tag = appTag(root), out = { iguales: {}, paralelos: {} }, errors = [];
  for (const rel of Object.keys(manifest.iguales)) out.iguales[rel] = sha(read(root, rel));
  for (const rel of Object.keys(manifest.paralelos)) {
    const r = stripOwn(read(root, rel), tag);
    r.errors.forEach(e => errors.push(rel + ', ' + e));
    out.paralelos[rel] = sha(r.text);
  }
  return { prints: out, errors };
}

// Problemas de este repositorio frente a su manifiesto (lista vacía = todo bien)
export function check(root = ROOT) {
  const manifest = loadManifest(root), { prints, errors } = fingerprints(root, manifest);
  for (const kind of ['iguales', 'paralelos']) {
    for (const rel in manifest[kind]) {
      if (prints[kind][rel] !== manifest[kind][rel]) {
        errors.push(rel + ': ha cambiado' + (kind === 'paralelos' ? ' fuera de lo marcado' : '') + '. Si es a propósito, lleva el cambio a la otra app y sella las dos (node test/comun.mjs --sellar)');
      }
    }
  }
  return errors;
}

// Diferencias con el otro repositorio
export function compare(otherRoot, root = ROOT) {
  const mine = loadManifest(root), a = fingerprints(root, mine), b = fingerprints(otherRoot, mine);
  const errors = [...a.errors, ...b.errors.map(e => '(el otro) ' + e)];
  for (const kind of ['iguales', 'paralelos']) for (const rel in mine[kind]) if (a.prints[kind][rel] !== b.prints[kind][rel]) errors.push(rel + ': distinto en las dos apps');
  if (read(root, 'test/comun.json') !== read(otherRoot, 'test/comun.json')) errors.push('test/comun.json: distinto en las dos apps');
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === '--sellar') {
    const manifest = loadManifest(), { prints, errors } = fingerprints(ROOT, manifest);
    if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
    writeFileSync(MANIFEST, JSON.stringify({ ...manifest, ...prints }, null, 2) + '\n');
    console.log('Sellado: ' + Object.keys(prints.iguales).length + ' iguales, ' + Object.keys(prints.paralelos).length + ' paralelos');
  } else {
    const errors = cmd === '--comparar' ? compare(path.resolve(arg || '')) : check();
    if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
    console.log(cmd === '--comparar' ? 'Las dos apps coinciden' : 'Código común: sin cambios');
  }
}
