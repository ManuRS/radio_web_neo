// ==============
// == DECK (MOTOR) ==
// ==============
// Un "deck" es una emisora conectada: su <audio>, el hls.js si hace falta, la reconexión con espera creciente, el vigilante de progreso y el salto
// al directo. Cada deck estrena su propio <audio> (uno que ya pasó por Web Audio no puede volver a reproducir una emisora sin CORS), así que cambiar de
// emisora es abrir un deck nuevo en silencio y fundir uno con otro. Basado en el motor de Radio Web Fast (script-livesound.js), sin depender de la página.
// El deck no sabe nada del audio de la página: audio.js le conecta los nodos de Web Audio mediante los ganchos (hooks) que recibe.

import { S, LIVE_MARGIN_S, LIVE_RESUME_SLACK_S, LIVE_SLACK_S, RETRY_S, STALL_S } from './state.js';
import { log, toast } from './ui.js';

// ===========
// == HLS.JS ==
// ===========
// hls.js se copia dentro del repo (vendor/) y solo se carga la primera vez que hace falta una emisora HLS
let hlsPromise = null;
export function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsPromise) {
    hlsPromise = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'vendor/hls.light.min.js';
      s.onload = () => resolve(window.Hls || null);
      s.onerror = () => { hlsPromise = null; resolve(null); };
      document.head.appendChild(s);
    });
  }
  return hlsPromise;
}

const HLS_CODECS = { 'mp4a.40.2': 'AAC-LC', 'mp4a.40.5': 'HE-AAC', 'mp4a.40.29': 'HE-AACv2', 'mp4a.40.34': 'MP3', 'mp4a.6b': 'MP3', 'ac-3': 'AC-3', 'ec-3': 'E-AC-3' };
function hlsQuality(level) {
  if (!level) return '';
  const codec = String(level.audioCodec || '').toLowerCase();
  const name = HLS_CODECS[codec] || (codec ? codec : '');
  const kbps = level.bitrate ? Math.round(level.bitrate / 1000) + ' kb/s' : '';
  return ['HLS', name, kbps].filter(Boolean).join(' ');
}

// ====================================
// == EMISORAS SIN CORS (SE RECUERDAN) ==
// ====================================
// Si una emisora marcada con CORS no carga y sí lo hace sin él, se anota aquí (en este navegador) y a partir de entonces va en modo degradado.
// Se anota por emisora (su URL), no por cadena: una cadena puede reunir emisoras de servidores distintos, y que una no admita CORS no dice nada de las demás.
// Además de lo detectado, vale "cors": false en la cadena entera o en una de sus emisoras (ajustes)
const NOCORS_KEY = 'rn_nocors';
let noCors = {};
try { noCors = JSON.parse(localStorage.getItem(NOCORS_KEY)) || {}; } catch (_) {}
for (const k of Object.keys(noCors)) if (!/^https?:/i.test(k)) delete noCors[k];   // antes se anotaba por cadena (su id): esas notas ya no valen
const saveNoCors = () => { try { localStorage.setItem(NOCORS_KEY, JSON.stringify(noCors)); } catch (_) {} };
export const corsAllowed = (st, vi = 0) => { const u = st.urls[vi]; return st.cors !== false && !!u && u.cors !== false && !noCors[u.url]; };
export function forgetNoCors() { noCors = {}; saveNoCors(); }

// =========================================
// == BITRATE QUE ANUNCIA EL SERVIDOR (SE RECUERDA) ==
// =========================================
// Lo que respondió cada emisora a la consulta de calidad (cabecera icy-br; 0 = no la anuncia) se guarda una semana en este navegador: así no se abre
// una segunda conexión al stream en cada arranque y en cada reconexión. Pasada la semana se vuelve a preguntar (las emisoras mejoran o empeoran su stream)
const ICY_KEY = 'rn_icy';
const ICY_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
let icy = {};
try { icy = JSON.parse(localStorage.getItem(ICY_KEY)) || {}; } catch (_) {}
if (typeof icy !== 'object' || Array.isArray(icy)) icy = {};
const icyFresh = e => !!e && typeof e.t === 'number' && Date.now() - e.t < ICY_MAX_AGE_MS && Date.now() >= e.t;
const icyGet = url => (icyFresh(icy[url]) ? icy[url] : null);
function icySet(url, br) {
  for (const k of Object.keys(icy)) if (!icyFresh(icy[k])) delete icy[k];   // lo caducado se tira
  icy[url] = { t: Date.now(), br };
  try { localStorage.setItem(ICY_KEY, JSON.stringify(icy)); } catch (_) {}
}

// ==========
// == DECK ==
// ==========
let deckId = 0;

export class Deck {
  // opts: { giveUp: nº de fallos tras los que se renuncia (por defecto, nunca), direct: true = sin Web Audio }
  constructor(station, variant, hooks, opts = {}) {
    this.id = ++deckId;
    this.station = station;
    this.variant = variant % station.urls.length;
    this.hooks = hooks;               // { attach(deck), detach(deck) }: los pone audio.js (nodos de Web Audio)
    this.giveUp = opts.giveUp || Infinity;
    this.direct = !!opts.direct;
    this.cors = corsAllowed(station, this.variant) && !this.direct;   // con CORS el <audio> puede pasar por Web Audio
    this.state = 'idle';              // idle | loading | playing | failed | closed
    this.held = false;                // pausa retenida (el <audio> sigue, pero sin sonar)
    this.fadeV = 0;                   // nivel de fundido al que se ha mandado (audio.js)
    this.wa = false;                  // conectado a Web Audio (lo pone audio.js)
    this.fails = 0;                   // fallos seguidos
    this.hadTrouble = false;          // hay un fallo sin resolver (reintento pendiente): al volver la red se reconecta ya
    this.retryWait = false;           // hay un reintento programado: los demás avisos del mismo intento fallido no cuentan
    this.blocked = false;             // el navegador no dejó iniciar el audio (falta un gesto del usuario)
    this.everPlayed = false;
    this.triedDirect = false;
    this.quality = '';
    this.on = {};                     // gestores: playing(deck), failed(deck), retry(deck), quality(deck)
    this.el = null;
    this.hls = null;
    this.retryTimer = null;
    this.lastTime = 0;
    this.stuckS = 0;
    this.lagMin = Infinity;
    this.interrupted = false;
    this.token = 0;                   // cada carga nueva invalida las esperas de la anterior
    this.playedSince = 0;
    this.waiters = [];                // esperas de ready()
    this.build();
  }

  get url() { return this.station.urls[this.variant].url; }
  get kind() { return this.station.urls[this.variant].kind; }
  // Espera a que la emisora suene (true), falle o pase el tiempo (false)
  ready(ms) {
    if (this.state === 'playing') return Promise.resolve(true);
    if (this.state === 'closed' || this.state === 'failed') return Promise.resolve(false);
    return new Promise(res => {
      const w = { res, t: setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); res(false); }, ms) };
      this.waiters.push(w);
    });
  }
  settle(ok) {
    const ws = this.waiters;
    this.waiters = [];
    ws.forEach(w => { clearTimeout(w.t); w.res(ok); });
  }

  isPlaying() { return this.state === 'playing' && !this.held && !!this.el && !this.el.paused; }

  // (Re)crea el <audio> y lo conecta a Web Audio
  build() {
    this.teardownEl();
    const el = document.createElement('audio');
    el.preload = 'none';
    el.setAttribute('playsinline', '');
    if (this.cors) el.crossOrigin = 'anonymous';
    document.body.appendChild(el);
    this.el = el;
    this.hooks.attach(this);
    el.addEventListener('playing', () => this.onPlaying(el));
    el.addEventListener('error', () => this.onError(el));
    el.addEventListener('ended', () => { if (el === this.el && this.state !== 'closed') this.retrySoon('el stream terminó'); });
    el.addEventListener('pause', () => {
      // una pausa que no hemos pedido nosotros (otra app, el sistema): se anota y se reanuda al volver o con el play
      if (el !== this.el || this.state !== 'playing' || this.held || this.closing) return;
      this.interrupted = true;
      log('El audio de ' + this.station.name + ' se ha pausado desde fuera (otra app o el sistema)');
    });
  }

  teardownEl() {
    clearTimeout(this.retryTimer);
    if (this.hls) { try { this.hls.destroy(); } catch (_) {} this.hls = null; }
    if (this.el) {
      const el = this.el;
      this.closing = true;
      this.hooks.detach(this);
      try { el.pause(); } catch (_) {}
      el.removeAttribute('src');
      try { el.load(); } catch (_) {}
      el.remove();
      this.closing = false;
      this.el = null;
    }
  }

  // Empieza a cargar la emisora (el fundido lo controla quien llama)
  start() {
    if (this.state === 'closed') return;
    this.state = 'loading';
    this.held = false;
    this.retryWait = false;
    this.blocked = false;
    const token = ++this.token;
    const el = this.el;
    if (this.kind === 'hls') this.startHls(el, token); else this.startProgressive(el, token);
  }

  startProgressive(el, token) {
    el.src = this.url;
    const u = this.station.urls[this.variant];
    this.quality = u.kind.toUpperCase();   // de entrada, solo el formato (el nombre de la variante puede ser otra cosa, p. ej. "SER Madrid Norte"); si el servidor anuncia el bitrate, se completa en directo (readServerQuality)
    this.play(el);
    this.readServerQuality(token);
  }

  // Calidad en directo: si el servidor anuncia su bitrate (cabecera icy-br), se lee con una petición aparte que solo espera las cabeceras y se corta.
  // Hace falta CORS (y que el servidor exponga la cabecera); si no, se queda el formato sin más. La respuesta (también "no lo anuncia") vale una semana
  // para esa emisora (ver icyGet): mientras tanto no se abre la segunda conexión
  async readServerQuality(token) {
    if (!this.cors) return;
    const variant = this.variant, url = this.url, kind = this.kind;
    const apply = br => {
      if (!(br > 0) || token !== this.token || variant !== this.variant || this.state === 'closed') return;
      const q = String(kind || 'mp3').toUpperCase() + ' ' + br + ' kb/s';
      if (q !== this.quality) { this.quality = q; if (this.on.quality) this.on.quality(this); }
    };
    const known = icyGet(url);
    if (known) { apply(known.br); return; }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(url, { mode: 'cors', signal: ctl.signal, cache: 'no-store' });
      const br = parseInt(r.headers.get('icy-br'), 10);
      ctl.abort();
      icySet(url, br > 0 ? br : 0);   // solo si el servidor respondió: un fallo de red no dice nada
      apply(br);
    } catch (_) {
    } finally { clearTimeout(timer); }
  }

  async startHls(el, token) {
    const Hls = await loadHls();
    if (token !== this.token || el !== this.el || this.state === 'closed') return;
    this.quality = 'HLS';
    if (Hls && Hls.isSupported()) {
      const h = new Hls({ liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 10, lowLatencyMode: false, enableWorker: true });
      this.hls = h;
      let netTries = 0;
      h.on(Hls.Events.ERROR, (_, data) => {
        if (!data || !data.fatal || h !== this.hls) return;
        log('Error fatal de hls.js en ' + this.station.name + ': ' + (data.details || data.type));
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && netTries < 3) { netTries++; try { h.recoverMediaError(); } catch (_) {} }
        else this.onError(el, true);
      });
      const setQ = lv => { const q = hlsQuality(lv); if (q && q !== this.quality) { this.quality = q; if (this.on.quality) this.on.quality(this); } };
      h.on(Hls.Events.LEVEL_SWITCHED, (_, d) => setQ(h.levels && h.levels[d.level]));
      h.on(Hls.Events.MANIFEST_PARSED, () => setQ(h.levels && h.levels[0]));
      h.loadSource(this.url);
      h.attachMedia(el);
      this.play(el);
    } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = this.url;   // HLS nativo (Safari)
      this.play(el);
    } else {
      log('Este navegador no puede reproducir HLS: ' + this.station.name);
      this.fail('sin soporte HLS');
    }
  }

  play(el) {
    const p = el.play();
    if (p && p.catch) p.catch(err => {
      if (el !== this.el || this.state === 'closed') return;
      if (err && err.name === 'AbortError') return;   // la carga se ha cambiado mientras tanto
      log('No se pudo iniciar ' + this.station.name + ': ' + ((err && err.message) || err));
      if (err && err.name === 'NotAllowedError') {   // sin gesto del usuario: no se reintenta en bucle; quien abrió el deck decide (player.js)
        this.blocked = true;
        if (this.on.blocked) this.on.blocked(this);
        return;
      }
      this.onError(el, true);
    });
  }

  onPlaying(el) {
    if (el !== this.el || this.state === 'closed') return;
    if (S.audioCtx && S.audioCtx.state === 'suspended') S.audioCtx.resume().catch(() => {});
    const first = this.state !== 'playing';
    this.state = 'playing';
    this.hadTrouble = false;
    this.lastTime = el.currentTime;
    this.stuckS = 0;
    this.playedSince = Date.now();
    if (this.interrupted) { this.interrupted = false; log('Audio reanudado'); this.catchUp(LIVE_RESUME_SLACK_S, 'tras la interrupción'); }
    if (first) {
      this.everPlayed = true;
      // si funcionó sin CORS tras fallar con él, la emisora no lo admite: se recuerda
      if (this.triedDirect && corsAllowed(this.station, this.variant)) {
        noCors[this.url] = 1;
        saveNoCors();
        log(this.station.name + ' (' + this.station.urls[this.variant].label + ') no admite CORS: esa emisora pasa a modo degradado (sin ecualizador ni barras reales)');
      }
      if (this.on.playing) this.on.playing(this);
    }
    this.settle(true);
  }

  onError(el, fatal = false) {
    if (el !== this.el || this.state === 'closed' || this.closing) return;
    const code = el.error ? el.error.code : 0;
    // la primera carga con CORS ha fallado: se prueba sin él (si funciona, la emisora no tiene CORS)
    // (con la red caída no se prueba: el fallo no dice nada del CORS)
    // (grabando no se prueba: una emisora sin CORS no se podría grabar, ver recorder.js)
    if (this.cors && !this.everPlayed && !this.triedDirect && this.kind !== 'hls' && !(typeof navigator !== 'undefined' && navigator.onLine === false)) {
      if (S.recording) {   // no se insiste: se avisa y se renuncia (al cambiar de emisora, sigue sonando la anterior)
        toast('Esta emisora no se puede grabar');
        this.fail('falla con CORS; grabando no se prueba el modo degradado');
        return;
      }
      this.triedDirect = true;
      this.cors = false;
      log(this.station.name + ': falla con CORS, se prueba en modo degradado');
      this.build();
      this.start();
      return;
    }
    this.retrySoon('error ' + (code || (fatal ? 'fatal' : '')));
  }

  // Una emisora solo se da por "sin CORS" si funciona a la primera en modo directo justo después de fallar con CORS. Si el modo directo también falla (o hay que esperar y reintentar),
  // el fallo pudo ser de la red y no del CORS: se vuelve a probar con CORS, para no dejar degradada para siempre una emisora que sí lo admite
  retryWithCors() {
    if (!this.triedDirect || this.everPlayed) return;
    this.triedDirect = false;
    this.cors = corsAllowed(this.station, this.variant) && !this.direct;
  }

  fail(why) {
    this.state = 'failed';
    log('No se pudo conectar con ' + this.station.name + ' (' + why + ')');
    if (this.on.failed) this.on.failed(this);
    this.settle(false);
  }

  // Reconexión con espera creciente, siempre a la misma emisora (las demás de la cadena son otras emisoras, no copias de esta).
  // Un intento fallido puede avisar dos veces (el evento error y el rechazo de play()): con un reintento ya programado, lo demás no cuenta
  retrySoon(why) {
    if (this.state === 'closed' || this.held || this.retryWait) return;
    this.hadTrouble = true;
    // Sin red no se gastan intentos (ni se cambia de emisora por un corte de cobertura): se espera con la pausa más larga y, al volver la red, recoverIfStalled reconecta al instante
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!offline) {
      this.fails++;
      if (this.fails >= this.giveUp) { this.fail(why + ', se renuncia'); return; }
    }
    const wait = offline ? RETRY_S[RETRY_S.length - 1] : RETRY_S[Math.min(this.fails - 1, RETRY_S.length - 1)];
    log(this.station.name + ': ' + why + (offline ? '. Sin red: se espera a que vuelva' : '. Se reintenta en ' + wait + ' s'));
    if (this.state !== 'loading') this.state = 'loading';
    if (this.on.retry) this.on.retry(this);
    clearTimeout(this.retryTimer);
    this.retryWait = true;
    this.retryTimer = setTimeout(() => { this.retryWait = false; if (this.state !== 'closed' && !this.held) { this.retryWithCors(); this.build(); this.start(); } }, wait * 1000);
  }

  // Al volver la red o la página a primer plano: si la emisora está esperando un reintento, parada o sin datos, se reconecta ya (sin esperar a la pausa del reintento
  // y empezando de cero la cuenta de fallos). Si suena bien, no se toca. (Mismo patrón que recoverIfStalled / reconnectNow de Radio Web Fast)
  recoverIfStalled(reason) {
    if (this.state === 'closed' || this.state === 'failed' || this.held || !this.el) return false;
    const waiting = this.state === 'loading' && this.hadTrouble;
    const noData = this.state === 'playing' && ((this.el.paused && !this.interrupted) || this.el.readyState < 3);   // 3 = HAVE_FUTURE_DATA
    if (!waiting && !noData) return false;
    log(this.station.name + ': reconexión inmediata (' + reason + ')');
    clearTimeout(this.retryTimer);
    this.fails = 0;
    this.interrupted = false;
    this.retryWithCors();
    this.build();
    this.start();
    return true;
  }

  // Vigilante (una vez por segundo): si el reloj del audio no avanza, se reconecta; si hay demasiado búfer acumulado, se salta al directo
  watch() {
    if (this.state !== 'playing' || this.held || !this.el || this.el.paused) { this.stuckS = 0; return; }
    const t = this.el.currentTime;
    this.stuckS = t - this.lastTime < 0.05 ? this.stuckS + 1 : 0;
    this.lastTime = t;
    if (this.stuckS >= STALL_S) { this.stuckS = 0; this.retrySoon('sin avanzar ' + STALL_S + ' s'); return; }
    if (Date.now() - this.playedSince > 10000) this.fails = 0;   // llevaba rato sonando bien: los fallos anteriores ya no cuentan
    if (this.kind !== 'hls') this.catchUp(LIVE_SLACK_S, 'retraso acumulado');
  }

  // Segundos de audio en cola por detrás del directo
  bufferedAhead() {
    try {
      const b = this.el.buffered;
      return b.length ? Math.max(0, b.end(b.length - 1) - this.el.currentTime) : 0;
    } catch (_) { return 0; }
  }

  // El retraso normal de cada conexión es el más bajo que se ha visto; si lo supera en más de slack segundos (tras una pausa o un corte de red), salta al directo
  catchUp(slack, why) {
    if (!this.el || this.kind === 'hls') return;
    if (isFinite(this.el.duration)) return;                       // no es un directo (fichero con duración): no hay nada a lo que saltar
    if (Date.now() - (this.lastJump || 0) < 15000) return;        // tras un salto se espera, para no encadenar saltos si el navegador no lo atiende
    const lag = this.bufferedAhead();
    if (!this.el.paused && lag > 0) this.lagMin = Math.min(this.lagMin, lag);
    if (lag <= (isFinite(this.lagMin) ? this.lagMin : LIVE_MARGIN_S) + slack) return;
    this.lastJump = Date.now();
    try { this.el.currentTime = this.el.buffered.end(this.el.buffered.length - 1) - LIVE_MARGIN_S; } catch (_) { return; }
    log('Se salta al directo en ' + this.station.name + ' (' + why + ', ' + Math.round(lag) + ' s de retraso)');
  }

  // Pausa retenida: el <audio> se queda (así la notificación sigue viva) pero sin sonar ni gastar red
  hold() {
    if (this.state === 'closed') return;
    this.held = true;
    clearTimeout(this.retryTimer);
    this.retryWait = false;
    if (this.el) { try { this.el.pause(); } catch (_) {} }
  }

  // Con la pausa retenida, cambia la emisora a la que se volverá al reanudar (el <audio> en pausa se queda: la notificación sigue viva)
  retarget(station, variant) {
    if (this.state === 'closed' || !this.held) return;
    this.station = station;
    this.variant = variant % station.urls.length;
    this.cors = corsAllowed(station, this.variant) && !this.direct;
    this.everPlayed = false;
    this.triedDirect = false;
    this.fails = 0;
    this.lagMin = Infinity;
    this.quality = '';
  }

  // Reanuda en directo: se vuelve a conectar (el búfer acumulado durante la pausa se descarta)
  resumeLive() {
    if (this.state === 'closed') return;
    this.held = false;
    this.interrupted = false;
    this.fails = 0;
    this.build();
    this.start();
  }

  // Reanuda tras una pausa ajena (sin reconectar, saltando al directo)
  resumeInterrupted() {
    if (this.state !== 'playing' || this.held || !this.el || !this.el.paused) return;
    this.catchUp(LIVE_RESUME_SLACK_S, 'tras la pausa');
    if (S.audioCtx && S.audioCtx.state !== 'running') S.audioCtx.resume().catch(() => {});
    this.el.play().catch(err => log('No se pudo reanudar el audio: ' + err.message));
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.token++;
    this.settle(false);
    this.teardownEl();
  }
}
