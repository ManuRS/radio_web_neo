// Estadística anónima: lo que recibe POST /api/stat y cómo se apunta en D1 (la tabla está en db/stats.sql). Común a Neo y Proxy.
// El cliente es js/stats.js. Sin base de datos enlazada (variable STATS) no hace nada y responde 204, así que la web funciona igual.

const APPS = ['rn', 'rp'];
const MAX_BODY = 300;
const MAX_SEG_DIA = 86400;   // nadie escucha más de 24 h en un día: tope por si alguien manda datos inventados

// Un usuario y un día: una fila; los segundos se suman
export const SQL = 'INSERT INTO uso (dia, app, id, seg) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (dia, app, id) DO UPDATE SET seg = MIN(seg + excluded.seg, ' + MAX_SEG_DIA + ')';

export const diaEs = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });   // AAAA-MM-DD

// Valida el cuerpo { a: app, id: 32 hex, s: segundos }; null si no vale
export function leer(texto) {
  if (typeof texto !== 'string' || texto.length > MAX_BODY) return null;
  let b;
  try { b = JSON.parse(texto); } catch { return null; }
  if (!b || typeof b !== 'object' || !APPS.includes(b.a) || typeof b.id !== 'string' || !/^[0-9a-f]{32}$/.test(b.id)) return null;
  if (typeof b.s !== 'number' || !Number.isFinite(b.s) || b.s < 0) return null;
  return { a: b.a, id: b.id, s: Math.min(Math.floor(b.s), MAX_SEG_DIA) };
}

// Devuelve el código HTTP de la respuesta
export async function apuntar(db, texto, ahora = new Date()) {
  if (!db) return 204;
  const b = leer(texto);
  if (!b) return 400;
  try { await db.prepare(SQL).bind(diaEs(ahora), b.a, b.id, b.s).run(); } catch { return 500; }
  return 204;
}
