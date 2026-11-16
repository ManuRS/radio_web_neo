// Los ajustes por defecto (stations.json) y la base de datos del buscador (bbdd/) tienen la forma que espera la app
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseJsonc } from '../js/jsonc.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KINDS = ['mp3', 'aac', 'hls'];
const okUrl = u => u && typeof u.url === 'string' && /^https:\/\/\S+$/.test(u.url) && KINDS.includes(u.kind);

test('stations.json: cadenas con id único, tipo, y emisoras con enlace https y formato', () => {
  const cfg = parseJsonc(readFileSync(path.join(ROOT, 'stations.json'), 'utf8'));
  assert.ok(Array.isArray(cfg.stations) && cfg.stations.length > 0);
  const ids = cfg.stations.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos');
  for (const s of cfg.stations) {
    assert.ok(s.id && s.name, 'cadena sin id o nombre');
    assert.ok(['general', 'musical'].includes(s.group), s.id + ': tipo');
    assert.ok(Array.isArray(s.urls) && s.urls.length > 0 && s.urls.every(okUrl), s.id + ': emisoras');
    assert.ok(s.urls.every(u => !u.label || u.label.length <= 30), s.id + ': nombre de emisora de más de 30 caracteres');
    if (s.color) assert.match(s.color, /^#[0-9a-f]{6}$/i, s.id + ': color');
    if (s.newsSource) assert.equal(s.group, 'general', s.id + ': solo las generalistas dan boletines');
  }
  if (cfg.newsStation) assert.ok(ids.includes(cfg.newsStation), 'newsStation no existe');
  const links = cfg.stations.flatMap(s => s.urls.map(u => u.url));
  assert.equal(new Set(links).size, links.length, 'enlaces repetidos');
});

test('bbdd/: cada cadena con nombre, tipo y emisoras válidas', () => {
  for (const f of readdirSync(path.join(ROOT, 'bbdd')).filter(f => f.endsWith('.json'))) {
    const db = JSON.parse(readFileSync(path.join(ROOT, 'bbdd', f), 'utf8'));
    assert.ok(Array.isArray(db.chains) && db.chains.length > 0, f);
    for (const c of db.chains) {
      assert.ok(c.name, f + ': cadena sin nombre');
      assert.ok(Array.isArray(c.urls) && c.urls.length > 0 && c.urls.every(okUrl), f + ', ' + c.name + ': emisoras');
    }
  }
});
