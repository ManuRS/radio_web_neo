// ==========================
// == ESTADÍSTICA ANÓNIMA ==
// ==========================
// Cuenta cuánta gente usa la app, sin datos personales: un identificador aleatorio por navegador (sin IP, sin cuenta, sin relación con nada más)
// y los segundos de escucha. Cada dispositivo cuenta como un usuario.
// Solo se manda cuando hace falta: al abrir (una vez al día), al parar y al cerrar la página. Mientras suena, los segundos se van apuntando en el
// propio aparato y, si la página se cierra sin avisar (Android la mata), salen en la siguiente apertura.
// Lo recibe functions/api/stat.js (base de datos D1, ver db/). Sin él (otra web, en local, sin red) no pasa nada: lo pendiente se guarda y se reintenta.
// Igual en Neo y en Proxy; "escuchando" es la clase "playing" de <html> (ui.js).

const TICK_MS = 30000;   // cada cuánto se apuntan en el aparato los segundos escuchados (sin red)
const MAX_GAP_S = 300;   // un salto mayor entre dos medidas es que el aparato durmió o la página estuvo congelada: no se cuenta

// Núcleo sin navegador (así se prueba): store {get, set}, now() en ms, today() "AAAA-MM-DD", rand() (32 hex) y send(cuerpo, beacon) → true si salió
export function createStats({ app, store, now, today, rand, send }) {
  const K_ID = app + '_uid', K_ST = app + '_stat';
  let id = null;
  try {
    id = store.get(K_ID);
    if (!/^[0-9a-f]{32}$/.test(id || '')) { id = rand(); store.set(K_ID, id); if (store.get(K_ID) !== id) id = null; }
  } catch { id = null; }   // sin almacenamiento no hay manera de reconocer al usuario: no se cuenta (cada apertura parecería uno nuevo)

  let st = { d: '', s: 0 };   // d: último día avisado; s: segundos de escucha aún sin enviar
  try {
    const v = JSON.parse(store.get(K_ST) || 'null');
    if (v && typeof v.d === 'string' && typeof v.s === 'number' && v.s >= 0 && Number.isFinite(v.s)) st = { d: v.d, s: v.s };
  } catch {}

  let since = null, timer = null, busy = false;
  const save = () => { try { store.set(K_ST, JSON.stringify(st)); } catch {} };

  // pasa lo escuchado desde la última medida a "pendiente"
  function tick() {
    if (since !== null) {
      const t = now(), gap = (t - since) / 1000;
      since = t;
      if (gap > 0 && gap <= MAX_GAP_S) st.s += gap;
    }
    save();
  }

  // manda lo pendiente (y avisa del día si aún no se ha hecho). beacon: al cerrar la página, que no espera respuesta
  async function flush(beacon = false) {
    if (!id || busy) return;
    tick();
    const day = today(), sec = Math.min(Math.floor(st.s), 86400);
    if (sec < 1 && st.d === day) return;
    busy = true;
    try {
      const body = { a: app, id, s: sec };
      const ok = beacon ? send(body, true) : await send(body, false);
      if (ok) { st.s -= sec; st.d = day; }
    } finally { busy = false; save(); }
  }

  function start() {
    if (!id || since !== null) return;
    since = now();
    timer = setInterval(tick, TICK_MS);
    flush(false);
  }

  function stop(beacon = false) {
    tick();
    since = null;
    if (timer) { clearInterval(timer); timer = null; }
    return flush(beacon);
  }

  return { start, stop, flush, tick, state: () => ({ id, pending: st.s, day: st.d, listening: since !== null }) };
}

// Conexión con la página: avisa al abrir, al empezar y parar de escuchar y al cerrar
export function initStats(app) {
  if (typeof document === 'undefined' || location.protocol !== 'https:') return null;   // en local y sin https no se cuenta
  const url = new URL('api/stat', document.baseURI).href;
  const s = createStats({
    app,
    store: { get: k => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) },
    now: () => performance.now(),
    today: () => new Date().toLocaleDateString('en-CA'),
    rand: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join(''),
    send: (body, beacon) => {
      const data = JSON.stringify(body);
      if (beacon && navigator.sendBeacon) { try { return navigator.sendBeacon(url, data); } catch { return false; } }
      return fetch(url, { method: 'POST', body: data, keepalive: true }).then(r => r.ok, () => false);
    },
  });
  const root = document.documentElement;
  let on = false;
  const sync = () => {
    const now = root.classList.contains('playing');
    if (now === on) return;
    on = now;
    if (now) s.start(); else s.stop(false);
  };
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
  addEventListener('pagehide', () => s.stop(true));
  addEventListener('pageshow', e => { if (e.persisted) { on = false; sync(); } });   // volver con atrás/adelante: si sigue sonando, se retoma la cuenta
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') s.tick(); });
  s.flush(false);   // aviso del día al abrir (y lo que quedara pendiente de la vez anterior)
  sync();
  return s;
}
