// Estadística anónima: el servidor (functions/_stat.js) y el núcleo del cliente (js/stats.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { apuntar, diaApunte, diaEs, leer, mismoOrigen, SQL } from '../functions/_stat.js';
import { createStats } from '../js/stats.js';

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

// ---- servidor ----

test('leer: acepta el cuerpo válido y limita los segundos', () => {
  assert.deepEqual(leer(JSON.stringify({ a: 'rn', id: ID, s: 120 })), { a: 'rn', id: ID, s: 120, w: 0 });
  assert.deepEqual(leer(JSON.stringify({ a: 'rn', id: ID, s: 5, d: '2026-11-20', w: 1 })), { a: 'rn', id: ID, s: 5, d: '2026-11-20', w: 1 });
  assert.equal(leer(JSON.stringify({ a: 'rp', id: ID, s: 12.9 })).s, 12);
  assert.equal(leer(JSON.stringify({ a: 'rn', id: ID, s: 9e9 })).s, 86400);
});

test('leer: rechaza lo que no cuadra', () => {
  for (const mal of ['', 'no es json', 'null', '[]', JSON.stringify({ a: 'xx', id: ID, s: 1 }), JSON.stringify({ a: 'rn', id: 'corto', s: 1 }),
    JSON.stringify({ a: 'rn', id: ID.toUpperCase(), s: 1 }), JSON.stringify({ a: 'rn', id: ID, s: -1 }), JSON.stringify({ a: 'rn', id: ID, s: '5' }),
    JSON.stringify({ a: 'rn', id: ID, s: 1, x: 'x'.repeat(400) }), JSON.stringify({ a: 'rn', id: ID, s: 1, d: 'ayer' }),
    JSON.stringify({ a: 'rn', id: ID, s: 1, d: 20261120 }), JSON.stringify({ a: 'rn', id: ID, s: 1, w: true }), JSON.stringify({ a: 'rn', id: ID, s: 1, w: 2 })]) assert.equal(leer(mal), null, mal.slice(0, 40));
  assert.equal(leer(undefined), null);
});

test('mismoOrigen: solo la propia web (o sin Origin)', () => {
  const url = 'https://radioneo.pages.dev/api/stat';
  assert.equal(mismoOrigen('https://radioneo.pages.dev', url), true);
  assert.equal(mismoOrigen(null, url), true);
  assert.equal(mismoOrigen('https://otra.web', url), false);
  assert.equal(mismoOrigen('https://radioneo.pages.dev.otra.web', url), false);
  assert.equal(mismoOrigen('http://radioneo.pages.dev', url), false);
  assert.equal(mismoOrigen('null', url), false);
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
  assert.deepEqual(llamadas, [{ sql: SQL, v: ['2026-11-24', 'rn', ID, 30, 0] }]);
  await apuntar(db, JSON.stringify({ a: 'rn', id: ID, s: 60, d: '2026-11-22', w: 1 }), new Date('2026-11-23T23:30:00Z'));
  assert.deepEqual(llamadas[1].v, ['2026-11-22', 'rn', ID, 60, 1]);
  assert.equal(await apuntar(db, 'mal'), 400);
  assert.equal(llamadas.length, 2);
});

test('diaApunte: el día del aparato si es de la última semana (o mañana); si no, el de llegada', () => {
  const ahora = new Date('2026-11-24T10:00:00Z');
  assert.equal(diaApunte(undefined, ahora), '2026-11-24');
  assert.equal(diaApunte('2026-11-24', ahora), '2026-11-24');
  assert.equal(diaApunte('2026-11-17', ahora), '2026-11-17');
  assert.equal(diaApunte('2026-11-16', ahora), '2026-11-24');
  assert.equal(diaApunte('2026-11-25', ahora), '2026-11-25');
  assert.equal(diaApunte('2026-11-26', ahora), '2026-11-24');
  assert.equal(diaApunte('2026-13-40', ahora), '2026-11-24');
});

test('apuntar: si la base falla, 500 (el cliente lo reintenta)', async () => {
  const db = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('límite'); } }) }) };
  assert.equal(await apuntar(db, JSON.stringify({ a: 'rp', id: ID, s: 1 })), 500);
});

// ---- cliente ----

function entorno({ roto = false } = {}) {
  const mem = new Map();
  const e = {
    t: 0, dia: '2026-11-23', enviado: [], resultado: true, pwa: false,
    store: { get: k => (roto ? (() => { throw new Error('sin almacenamiento'); })() : mem.get(k) ?? null), set: (k, v) => { if (roto) throw new Error('sin almacenamiento'); mem.set(k, String(v)); } },
    mem,
  };
  e.nuevo = () => createStats({
    app: 'rn', store: e.store, now: () => e.t, today: () => e.dia, rand: () => ID, pwa: () => e.pwa,
    send: (body, beacon) => { e.enviado.push({ ...body, beacon }); return e.resultado; },
  });
  return e;
}

test('al abrir avisa una vez al día y no repite', async () => {
  const e = entorno(), s = e.nuevo();
  await s.flush();
  await s.flush();
  assert.deepEqual(e.enviado, [{ a: 'rn', id: ID, s: 0, d: '2026-11-23', w: 0, beacon: false }]);
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
  assert.deepEqual(e.enviado.at(-1), { a: 'rn', id: ID, s: 100, d: '2026-11-23', w: 0, beacon: false });
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
  assert.deepEqual(e.enviado.at(-1), { a: 'rn', id: ID, s: 60, d: '2026-11-23', w: 0, beacon: false });
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
  assert.deepEqual(e.enviado.at(-1), { a: 'rn', id: ID, s: 30, d: '2026-11-23', w: 0, beacon: true });
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

test('lo pendiente sale con el día en que se escuchó, aunque se mande otro día', async () => {
  const e = entorno(), s = e.nuevo();
  await s.flush();
  s.start(); e.t = 120000; s.tick();     // 120 s el 23
  e.dia = '2026-11-24';
  e.t = 150000; s.tick();                // pasada la medianoche: 30 s el 24
  e.resultado = false;
  await s.stop(true);                    // Android mata la página: no sale nada
  e.dia = '2026-11-26'; e.resultado = true;
  const otra = e.nuevo();
  await otra.flush();                    // se abre dos días después
  assert.deepEqual(e.enviado.slice(-3).map(b => [b.d, b.s]), [['2026-11-23', 120], ['2026-11-24', 30], ['2026-11-26', 0]]);
  assert.equal(Math.floor(otra.state().pending), 0);
  await otra.flush();
  assert.equal(e.enviado.length, 5);    // 1 aviso del 23 + el intento fallido + 3
});

test('si falla un día a medias, lo que no salió se conserva con su día', async () => {
  const e = entorno(), s = e.nuevo();
  await s.flush();
  e.resultado = false;
  s.start(); e.t = 50000; await s.stop();                  // 50 s el 23, no salen
  e.dia = '2026-11-24';
  s.start(); e.t = 70000; s.tick();                         // 20 s el 24
  let n = 0;
  const enviar = e.enviado.length;
  e.resultado = undefined;
  const t = createStats({ app: 'rn', store: e.store, now: () => e.t, today: () => e.dia, rand: () => ID,
    send: body => { e.enviado.push(body); return ++n === 1; } });   // sale el primero, falla el segundo
  await t.flush();
  assert.deepEqual(e.enviado.slice(enviar).map(b => [b.d, b.s]), [['2026-11-23', 50], ['2026-11-24', 20]]);
  assert.equal(Math.round(t.state().days['2026-11-24']), 20);
  assert.equal(t.state().days['2026-11-23'], undefined);
  e.resultado = false; await s.stop();                      // para el contador de la primera
});

test('el formato anterior (sin día) pasa al de hoy', async () => {
  const e = entorno();
  e.mem.set('rn_uid', ID);
  e.mem.set('rn_stat', JSON.stringify({ d: '2026-11-22', s: 45 }));
  const s = e.nuevo();
  await s.flush();
  assert.deepEqual(e.enviado.map(b => [b.d, b.s]), [['2026-11-23', 45]]);
});

test('instalada: w = 1', async () => {
  const e = entorno(); e.pwa = true;
  await e.nuevo().flush();
  assert.equal(e.enviado[0].w, 1);
});
