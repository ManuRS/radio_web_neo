// El código común de Neo y Proxy sigue igual que cuando se selló (ver comun.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { check, stripOwn } from './comun.mjs';

test('código común: los archivos iguales y paralelos no se han separado', () => {
  assert.deepEqual(check(), []);
});

test('marcas de lo propio: se quitan líneas y bloques, y se avisa de las mal puestas', () => {
  const src = ['a', 'b   // [NEO]', '  // [NEO>', '  c', '  // <NEO]', 'd'].join('\n');
  assert.deepEqual(stripOwn(src, 'NEO'), { text: 'a\nd', errors: [] });
  assert.equal(stripOwn(src, 'PROXY').errors.length, 3);                       // marcas de la otra app
  assert.equal(stripOwn('// [NEO>\nx', 'NEO').errors.length, 1);               // bloque sin cerrar
  assert.equal(stripOwn('x\n// <NEO]', 'NEO').errors.length, 1);               // cierre sin bloque
});
