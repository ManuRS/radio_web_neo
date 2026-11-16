// Utilidades sin interfaz (js/utils.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../js/utils.js';

test('soundKey: el nombre de la cadena se compara sin mayúsculas, tildes ni espacios', () => {
  assert.equal(U.soundKey('Los 40'), U.soundKey('LOS40'));
  assert.equal(U.soundKey('Cadena Dial'), 'cadenadial');
  assert.equal(U.soundKey('Melodía FM'), 'melodiafm');
  assert.equal(U.soundKey('Los 40 Classic'), 'classic');
  assert.equal(U.soundKey(null), '');
});

test('parseNumber y toSeconds', () => {
  assert.equal(U.parseNumber(' 1,5 '), 1.5);
  assert.equal(U.parseNumber('x'), null);
  assert.equal(U.parseNumber(null), null);
  assert.equal(U.toSeconds('01:02:03'), 3723);
});

test('soundName: sin ruta, versión ni extensión', () => {
  assert.equal(U.soundName('sounds/los40_a.mp3?v=3'), 'los40_a');
});

test('pickWeighted: respeta los pesos y la lista vacía', () => {
  assert.equal(U.pickWeighted([]), null);
  const list = [{ id: 'a', weight: 1 }, { id: 'b', weight: 0.0001 }];
  let a = 0;
  for (let i = 0; i < 200; i++) if (U.pickWeighted(list).id === 'a') a++;
  assert.ok(a > 190);
});

test('fmtFreq: un decimal, o dos si hacen falta', () => {
  assert.equal(U.fmtFreq(89), '89.0');
  assert.equal(U.fmtFreq(100.5), '100.5');
  assert.equal(U.fmtFreq(98.45), '98.45');
});

test('mp3Info: reconoce un MP3 de 128 kb/s a 44,1 kHz y no se inventa nada con ruido', () => {
  const frame = 417, b = new Uint8Array(frame * 2 + 8);   // MPEG 1 capa III, 128 kb/s, 44100 Hz, estéreo: tramas de 417 bytes
  for (const at of [3, 3 + frame]) b.set([0xFF, 0xFB, 0x90, 0x00], at);
  assert.deepEqual(U.mp3Info(b), { layer: 3, kbps: 128, rate: 44100, ch: 0 });
  assert.equal(U.mp3Info(new Uint8Array(2000).fill(0x55)), null);
  assert.equal(U.mp3Info(b.subarray(0, 200)), null);       // falta la trama siguiente para confirmarlo
});

test('emisoraName: con una sola emisora o nombre genérico, el de la cadena', () => {
  const una = { name: 'Cadena COPE', short: 'COPE', urls: [{ label: 'Lo que sea' }] };
  const varias = { name: 'Cadena SER', short: 'SER', urls: [{ label: 'Señal central' }, { label: 'Radio Madrid' }] };
  assert.equal(U.emisoraName(una, 0), 'Cadena COPE');
  assert.equal(U.emisoraName(una, 0, true), 'COPE');
  assert.equal(U.emisoraName(varias, 0), 'Cadena SER');
  assert.equal(U.emisoraName(varias, 1), 'Radio Madrid');
  assert.equal(U.emisoraSub(varias, true), '2 emisoras');
  assert.equal(U.emisoraSub(una, true), '');
});
