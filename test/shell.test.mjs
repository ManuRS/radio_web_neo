// La carcasa que guarda el service worker (sw.js) cuadra con los archivos: si falta un módulo en SHELL, la app instalada no abre sin red
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');
const sw = read('sw.js');
const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL'))).matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
const NOT_IN_SHELL = ['boot.js'];   // Proxy: el cargador con licencia solo existe publicado; lo añade build.mjs

test('todos los módulos de js/ están en SHELL', () => {
  const missing = readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && !NOT_IN_SHELL.includes(f) && !shell.includes('js/' + f));
  assert.deepEqual(missing, []);
});

test('todo lo que lista SHELL existe, sin repetidos', () => {
  assert.deepEqual(shell.filter(f => !existsSync(path.join(ROOT, f))), []);
  assert.equal(new Set(shell).size, shell.length);
});

test('la caché de sw.js lleva la versión de la app (APP_VERSION)', () => {
  const ver = read('js/state.js').match(/export const APP_VERSION = (\d+)/)[1];
  const id = read('js/state.js').match(/export const APP_ID = '(\w+)'/)[1];
  assert.match(sw.match(/const CACHE = '([^']+)'/)[1], new RegExp('^' + id + '-shell-' + ver + '-\\d+$'));
});

test('lo que carga index.html existe y cada módulo importa archivos que existen', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/(?:src|href)="([^"#?:]+)(?:\?[^"]*)?"/g)) assert.ok(existsSync(path.join(ROOT, m[1])), 'index.html: falta ' + m[1]);
  for (const f of readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))) {
    for (const m of read('js/' + f).matchAll(/(?:from|import)\s*\(?'(\.\/[^']+)'/g)) assert.ok(existsSync(path.join(ROOT, 'js', m[1])), f + ': importa ' + m[1] + ', que no existe');
  }
});
