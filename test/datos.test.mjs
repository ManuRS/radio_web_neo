// Cambios del usuario sobre lo de por defecto (diff y merge) y archivos cifrados (js/datos.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { diff, isEmpty, merge, openFile, sealFile } from '../js/datos.js';

const LISTS = { items: x => x.id };
const DEF = {
  n: 32, news: [{ start: '08:00:00', end: '08:05:00' }], colors: { a: '#111111', b: '#222222' },
  items: [{ id: 'a', name: 'A', urls: [1] }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
};
const roundTrip = cur => { const p = diff(DEF, cur, LISTS); assert.deepEqual(merge(DEF, JSON.parse(JSON.stringify(p)), LISTS), cur); return p; };
const copy = v => JSON.parse(JSON.stringify(v));

test('sin cambios no hay nada que guardar', () => {
  assert.ok(isEmpty(diff(DEF, copy(DEF), LISTS)));
  const reordered = copy(DEF);
  reordered.colors = { b: '#222222', a: '#111111' };   // mismas claves en otro orden: no es un cambio
  assert.ok(isEmpty(diff(DEF, reordered, LISTS)));
});

test('cada cambio se guarda solo y vuelve igual', () => {
  const cur = copy(DEF);
  cur.n = 10;
  cur.colors.a = '#333333'; delete cur.colors.b; cur.colors.z = '#444444';
  cur.items[0].name = 'A2'; delete cur.items[1].name;
  cur.items.push({ id: 'd', name: 'D' });
  const p = roundTrip(cur);
  assert.deepEqual(p.set, { n: 10 });
  assert.deepEqual(p.list.items.add, [{ id: 'd', name: 'D' }]);
  assert.equal(p.list.items.move, undefined, 'añadir al final no mueve nada');
  assert.ok(!JSON.stringify(p).includes('urls'), 'no lleva lo que no ha cambiado');
});

test('eliminar, reordenar y quitar claves', () => {
  const cur = copy(DEF);
  cur.items = [cur.items[2], cur.items[0]];
  delete cur.news;
  const p = roundTrip(cur);
  assert.deepEqual(p.list.items.del, ['b']);
  assert.equal(p.list.items.move.length, 1);
  assert.deepEqual(p.del, ['news']);
});

test('mover un elemento apunta solo ese', () => {
  const def = { items: Array.from({ length: 30 }, (_, i) => ({ id: 'c' + i })) };
  const cur = copy(def);
  cur.items.splice(2, 0, cur.items.splice(20, 1)[0]);   // la 20 pasa detrás de la 1
  const p = diff(def, cur, LISTS);
  assert.deepEqual(p.list.items.move, [['c20', 'c1']]);
  assert.deepEqual(merge(def, p, LISTS), cur);
  const many = copy(def);
  many.items.reverse();
  assert.deepEqual(merge(def, diff(def, many, LISTS), LISTS), many);
});

test('lo que cambia por defecto llega a quien no lo ha tocado', () => {
  const cur = copy(DEF);
  cur.items[0].name = 'Mía';
  cur.items = [cur.items[1], cur.items[0], cur.items[2]];
  const p = diff(DEF, cur, LISTS);
  const def2 = copy(DEF);
  def2.items[0].urls = [2];                                   // cambio por defecto en un campo que el usuario no tocó
  def2.items.splice(1, 0, { id: 'x', name: 'Nueva' });        // cadena nueva por defecto, detrás de "a"
  def2.n = 40;
  const r = merge(def2, p, LISTS);
  assert.deepEqual(r.items.map(x => x.id), ['b', 'a', 'x', 'c']);
  assert.deepEqual(r.items[1], { id: 'a', name: 'Mía', urls: [2] });
  assert.equal(r.n, 40);
});

test('los cambios dañados o de otra forma no rompen lo de por defecto', () => {
  assert.deepEqual(merge(DEF, null, LISTS), DEF);
  assert.deepEqual(merge(DEF, 'x', LISTS), DEF);
  assert.deepEqual(merge(DEF, { list: { otra: { add: [{ id: 'q' }] } } }, LISTS), DEF);
});

test('archivo cifrado: se abre con su clave y su tipo, y no si se toca', async () => {
  const key = Buffer.alloc(32, 7).toString('base64url'), other = Buffer.alloc(32, 8).toString('base64url');
  const text = await sealFile('config', { a: 1 }, key, 'prueba');
  assert.ok(!text.includes('"a"'), 'no se lee a simple vista');
  assert.deepEqual(await openFile(text, 'config', key, 'prueba'), { ok: true, value: { a: 1 } });
  assert.equal((await openFile(text, 'config', key, 'otro')).ok, false);
  assert.equal((await openFile(text, 'config', other, 'prueba')).ok, false);
  const v = JSON.parse(text).config;
  const touched = JSON.stringify({ config: v.slice(0, 20) + (v[20] === 'A' ? 'B' : 'A') + v.slice(21) });
  assert.deepEqual(await openFile(touched, 'config', key, 'prueba'), { ok: false, missing: false });
  assert.deepEqual(await openFile('{ "otra": 1 }', 'config', key, 'prueba'), { ok: false, missing: true });
  assert.deepEqual(await openFile('no es json', 'config', key, 'prueba'), { ok: false, missing: true });
});
