// Estadística anónima: lo que recibe POST /api/stat y cómo se apunta en D1 (la tabla está en db/stats.sql). Común a Neo y Proxy.
// El cliente es js/stats.js. Sin base de datos enlazada (variable STATS) no hace nada y responde 204, así que la web funciona igual.

const APPS = ['rn', 'rp'];
const MAX_BODY = 300;
const MAX_SEG_DIA = 86400;   // nadie escucha más de 24 h en un día: tope por si alguien manda datos inventados
const DIAS_ATRAS = 7;        // lo escuchado hace más días (o con un día raro) se apunta en el de llegada

// Un usuario y un día: una fila; los segundos se suman y pwa queda a 1 si ese día la usó instalada alguna vez
export const SQL = 'INSERT INTO uso (dia, app, id, seg, pwa) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (dia, app, id) DO UPDATE SET seg = MIN(seg + excluded.seg, ' + MAX_SEG_DIA + '), pwa = MAX(pwa, excluded.pwa)';

// Quien escribe tiene que ser la propia web: el navegador manda Origin en los POST y no deja que otra página lo falsee.
// No frena a quien use curl (ahí Origin lo pone él), solo a páginas ajenas que usen nuestro contador. Sin Origin se acepta.
export const mismoOrigen = (origin, url) => !origin || origin === new URL(url).origin;

export const diaEs = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });   // AAAA-MM-DD

// Valida el cuerpo { a: app, id: 32 hex, s: segundos, d: día AAAA-MM-DD (opcional), w: 1 si va instalada (opcional) }; null si no vale.
// Sin d ni w (versiones anteriores de la app) vale igual: día de llegada y w = 0
export function leer(texto) {
  if (typeof texto !== 'string' || texto.length > MAX_BODY) return null;
  let b;
  try { b = JSON.parse(texto); } catch { return null; }
  if (!b || typeof b !== 'object' || !APPS.includes(b.a) || typeof b.id !== 'string' || !/^[0-9a-f]{32}$/.test(b.id)) return null;
  if (typeof b.s !== 'number' || !Number.isFinite(b.s) || b.s < 0) return null;
  if (b.d !== undefined && (typeof b.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.d))) return null;
  if (b.w !== undefined && b.w !== 0 && b.w !== 1) return null;
  const r = { a: b.a, id: b.id, s: Math.min(Math.floor(b.s), MAX_SEG_DIA), w: b.w === 1 ? 1 : 0 };
  if (b.d !== undefined) r.d = b.d;
  return r;
}

// Día en que se apunta: el que manda el aparato si es de los últimos DIAS_ATRAS (o mañana, por los relojes adelantados); si no, el de llegada
export function diaApunte(d, ahora = new Date()) {
  const hoy = diaEs(ahora);
  if (!d) return hoy;
  const desde = diaEs(new Date(ahora.getTime() - DIAS_ATRAS * 86400000)), hasta = diaEs(new Date(ahora.getTime() + 86400000));
  return d >= desde && d <= hasta ? d : hoy;
}

// Devuelve el código HTTP de la respuesta
export async function apuntar(db, texto, ahora = new Date()) {
  if (!db) return 204;
  const b = leer(texto);
  if (!b) return 400;
  try { await db.prepare(SQL).bind(diaApunte(b.d, ahora), b.a, b.id, b.s, b.w).run(); } catch { return 500; }
  return 204;
}
