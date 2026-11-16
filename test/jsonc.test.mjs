// Ajustes en JSON con comentarios (js/jsonc.js): leerlos y reescribir solo lo que cambia
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonc, patchTop, stripJsonComments } from '../js/jsonc.js';

test('se quitan comentarios y comas finales, sin tocar las cadenas', () => {
  const text = '{\n  // comentario\n  "a": "http://x//y", /* otro */ "b": [1, 2,],\n  "c": "con /* dentro */",\n}';
  assert.deepEqual(parseJsonc(text), { a: 'http://x//y', b: [1, 2], c: 'con /* dentro */' });
  assert.equal(stripJsonComments('"// no es comentario"'), '"// no es comentario"');
});

test('patchTop: solo cambia el valor de la clave que cambia y conserva los comentarios', () => {
  const text = '{\n  // servidores\n  "servers": [1],\n  "eq": { "a": 1 }, // modos\n  "news": []\n}';
  const before = parseJsonc(text), after = { ...before, eq: { a: 2 } };
  const out = patchTop(text, before, after);
  assert.deepEqual(parseJsonc(out), after);
  assert.ok(out.includes('// servidores') && out.includes('// modos'));
  assert.ok(out.includes('"servers": [1]'));
});

test('patchTop: claves nuevas al final y claves quitadas con su línea', () => {
  const text = '{\n  "a": 1,\n  "b": 2 // dos\n}';
  const before = parseJsonc(text);
  const added = patchTop(text, before, { a: 1, b: 2, c: [3] });
  assert.deepEqual(parseJsonc(added), { a: 1, b: 2, c: [3] });
  assert.ok(added.includes('// dos'));
  const removed = patchTop(text, before, { b: 2 });
  assert.deepEqual(parseJsonc(removed), { b: 2 });
  assert.ok(!removed.includes('"a"'));
});

test('patchTop: sin cambios devuelve el mismo texto; si el texto no vale, el JSON entero', () => {
  const text = '{ "a": 1 /* uno */ }';
  assert.equal(patchTop(text, { a: 1 }, { a: 1 }), text);
  assert.deepEqual(JSON.parse(patchTop('no es json', { a: 1 }, { a: 2 })), { a: 2 });
  assert.deepEqual(JSON.parse(patchTop('', null, { a: 2 })), { a: 2 });
});

test('patchTop: respeta los saltos de línea de Windows', () => {
  const text = '{\r\n  "a": 1,\r\n  "b": { "x": 1 }\r\n}';
  const out = patchTop(text, parseJsonc(text), { a: 1, b: { x: 2, y: 3 } });
  assert.deepEqual(parseJsonc(out), { a: 1, b: { x: 2, y: 3 } });
  assert.ok(!/[^\r]\n/.test(out));
});
