// Estadística anónima: el servidor (functions/_stat.js) y el núcleo del cliente (js/stats.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { apuntar, diaEs, leer, SQL } from '../functions/_stat.js';
import { createStats } from '../js/stats.js';

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

// ---- servidor ----

test('leer: acepta el cuerpo válido y limita los segundos', () => {
  assert.deepEqual(leer(JSON.stringify({ a: 'rn', id: ID, s: 120 })), { a: 'rn', id: ID, s: 120 });
  assert.equal(leer(JSON.stringify({ a: 'rp', id: ID, s: 12.9 })).s, 12);
  assert.equal(leer(JSON.stringify({ a: 'rn', id: ID, s: 9e9 })).s, 86400);
});

test('leer: rechaza lo que no cuadra', () => {
  for (const mal of ['', 'no es json', 'null', '[]', JSON.stringify({ a: 'xx', id: ID, s: 1 }), JSON.stringify({ a: 'rn', id: 'corto', s: 1 }),
    JSON.stringify({ a: 'rn', id: ID.toUpperCase(), s: 1 }), JSON.stringify({ a: 'rn', id: ID, s: -1 }), JSON.stringify({ a: 'rn', id: ID, s: '5' }),
    JSON.stringify({ a: 'rn', id: ID, s: 1, x: 'x'.repeat(400) })]) assert.equal(leer(mal), null, mal.slice(0, 40));
  assert.equal(leer(undefined), null);
});

test('diaEs: AAAA-MM-DD con la hora de España', () => {
  assert.equal(diaEs(new Date('2026-11-23T23:30:00Z')), '2026-11-24');
  assert.equal(diaEs(new Date('2026-07-01T21:59:00Z')), '2026-07-01');
});

test('apuntar: sin base enlazada no falla; con base, una sola escritura con el día de España', async () => {
  assert.equal(await apuntar(undefined, 'lo que sea'), 204);
  const llamadas = [];
  const db = { prepare: sql => ({ bind: (...v) => ({ run: async () => { llamadas.push({ sql, v }); } }) }) };
  assert.equal(await apuntar(db, JSON.stringify({ a: 'rn', id: ID, s: 30 }), new Date('2026-11-23T23:30:00Z')), 204);
  assert.deepEqual(llamadas, [{ sql: SQL, v: ['2026-11-24', 'rn', ID, 30] }]);
  assert.equal(await apuntar(db, 'mal'), 400);
  assert.equal(llamadas.length, 1);
});

test('apuntar: si la base falla, 500 (el cliente lo reintenta)', async () => {
  const db = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('límite'); } }) }) };
  assert.equal(await apuntar(db, JSON.stringify({ a: 'rp', id: ID, s: 1 })), 500);
});

// ---- cliente ----

function entorno({ roto = false } = {}) {
  const mem = new Map();
  const e = {
    t: 0, dia: '2026-11-23', enviado: [], resultado: true,
    store: { get: k => (roto ? (() => { throw new Error('sin almacenamiento'); })() : mem.get(k) ?? null), set: (k, v) => { if (roto) throw new Error('sin almacenamiento'); mem.set(k, String(v)); } },
    mem,
  };
  e.nuevo = () => createStats({
    app: 'rn', store: e.store, now: () => e.t, today: () => e.dia, rand: () => ID,
    send: (body, beacon) => { e.enviado.push({ ...body, beacon }); return e.resultado; },
  });
  return e;
}

test('al abrir avisa una vez al día y no repite', async () => {
  const e = entorno(), s = e.nuevo();
  await s.flush();
  await s.flush();
  assert.deepEqual(e.enviado, [{ a: 'rn', id: ID, s: 0, beacon: false }]);
  e.dia = '2026-11-24';
  await s.flush();
  assert.equal(e.enviado.length, 2);
  assert.equal(e.mem.get('rn_uid'), ID);
});

test('escuchar y parar manda los segundos; el que ya sonó no se cuenta dos veces', async () => {
  const e = entorno(), s = e.nuevo();
  await s.flush();
  s.start(); e.t = 100000;       // 100 s
  await s.stop();
  assert.deepEqual(e.enviado.at(-1), { a: 'rn', id: ID, s: 100, beacon: false });
  assert.equal(Math.floor(s.state().pending), 0);
  await s.flush();
  assert.equal(e.enviado.length, 2);
});

test('si el envío falla, lo pendiente se conserva, sobrevive a cerrar la página y sale la siguiente vez', async () => {
  const e = entorno(), s = e.nuevo();
  e.resultado = false;
  s.start(); e.t = 60000;
  await s.stop();
  assert.equal(Math.floor(s.state().pending), 60);
  const otra = e.nuevo();            // la página se abrió de nuevo
  assert.equal(Math.floor(otra.state().pending), 60);
  e.resultado = true;
  await otra.flush();
  assert.deepEqual(e.enviado.at(-1), { a: 'rn', id: ID, s: 60, beacon: false });
  assert.equal(Math.floor(otra.state().pending), 0);
});

test('un salto largo (aparato dormido) no cuenta como escucha', async () => {
  const e = entorno(), s = e.nuevo();
  await s.flush();
  s.start(); e.t = 40000; s.tick();      // 40 s reales
  e.t = 40000 + 3 * 3600 * 1000; s.tick();   // 3 h de salto: se descartan
  await s.stop();
  assert.equal(e.enviado.at(-1).s, 40);
});

test('al cerrar la página se manda con beacon; sin almacenamiento no se cuenta nada', async () => {
  const e = entorno(), s = e.nuevo();
  await s.flush();
  s.start(); e.t = 30000;
  await s.stop(true);
  assert.deepEqual(e.enviado.at(-1), { a: 'rn', id: ID, s: 30, beacon: true });
  const sin = entorno({ roto: true }), t = sin.nuevo();
  t.start(); sin.t = 50000;
  await t.stop();
  assert.equal(sin.enviado.length, 0);
});

test('no se manda mientras suena: solo al abrir y al parar', async () => {
  const e = entorno(), s = e.nuevo();
  await s.flush();
  s.start();
  for (let i = 1; i <= 20; i++) { e.t = i * 30000; s.tick(); }
  assert.equal(e.enviado.length, 1);
  await s.stop();
  assert.equal(e.enviado.length, 2);
  assert.equal(e.enviado.at(-1).s, 600);
});
