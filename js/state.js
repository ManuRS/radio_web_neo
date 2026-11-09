// =========================
// == ESTADO Y CONSTANTES ==
// =========================
// Constantes y estado compartido entre módulos (objeto S). Lo que solo usa un módulo vive en ese módulo.

// ========================
// == TEXTOS POR DEFECTO ==
// ========================
export const APP_TITLE = 'Radio Web Neo';   // nombre de la aplicación (cabecera, pestaña y notificación): fijo, no va en los ajustes

// ==============================
// == CONSTANTES (NO PRIVADAS) ==
// ==============================
export const SOUND_CACHE = 'rn-sounds';   // caché del navegador donde se guardan los sonidos para no descargarlos cada vez
export const FADE_S = 0.5;       // fundido de salida y de entrada al cambiar de emisora a mano (s)
export const CROSS_S = 1.2;      // fundido cruzado entre dos emisoras al cambiar a mano (s)
export const NEWS_FADE_S = 1;    // fundidos del modo boletines (s)
export const NEWS_IN_OVERLAP_S = 1;    // al entrar en noticias: el fundido de entrada empieza esto antes de que acabe el sonido local (s)
export const NEWS_OUT_OVERLAP_S = 2;   // al volver a la música: idem (el fundido de entrada dura lo mismo, así acaba con el sonido)
export const HIT_DB = 6;         // con "hit": "auto", el golpe final es el último instante a menos de estos dB del nivel máximo
export const SILENCE_DB = -40;   // por debajo de este nivel (dB) el final de un sonido local se considera silencio: los solapes se miden desde el último instante audible
// Carga de emisoras: una emisora nueva se prepara en silencio antes de entrar; si no suena en este tiempo se renuncia al cambio
export const LOAD_TIMEOUT_S = 15;
export const NEWS_LOAD_MARGIN_S = 4;   // si la emisora de noticias aún no suena al empezar la transición, margen extra que se añade a la antelación (s)
// Directo: el audio no puede ir muy por detrás de la emisión (tras una pausa o un corte de red se salta al directo)
export const LIVE_MARGIN_S = 1.5;       // al saltar se deja este colchón de audio por delante (s)
export const LIVE_RESUME_SLACK_S = 1;   // tras una pausa ajena se salta si el retraso supera el normal en más de esto (s)
export const LIVE_SLACK_S = 3;          // sonando, se salta si el retraso supera el normal en más de esto (s)
// Reconexión de una emisora que se corta: esperas crecientes (s), tiempo sin avanzar que se da por colgado (s) y cambios de variante
export const RETRY_S = [2, 4, 8, 10];
export const STALL_S = 8;
export const VARIANT_AFTER_FAILS = 3;   // tras tantos fallos seguidos se prueba la siguiente variante de la emisora (si la tiene)
// Normalización del volumen: lo que llega bajo se sube hasta un nivel de referencia (solo sube, con tope). Niveles en dB (RMS)
export const NORM_TARGET_DB = -16;    // nivel de referencia al que se lleva todo lo que llega
export const NORM_MAX_BOOST_DB = 24;  // subida máxima (dB)
export const NORM_MAX_CUT_DB = 8;     // bajada máxima (dB): lo que llega muy alto también se rebaja
export const NORM_TAU_S = 8;          // lo que tarda en adaptarse el nivel medido (s)
export const NORM_SILENCE_DB = -55;   // por debajo de este nivel se considera silencio y no cuenta
// Modo boletines: la emisora de noticias se conecta en silencio con esta antelación (s) sobre la hora de entrada (como en Radio Web Fast).
// Chrome solo despierta una página silenciosa una vez por minuto: con 90 s siempre hay un despertar dentro del margen
export const NEWS_PRECONNECT_S = 90;
export const DEFAULT_DELAY_S = 32;    // retraso estimado entre la emisión real y el stream de internet (s), si la emisora no indica otro

// ===========================
// == RELOJ LOCAL CORREGIDO ==
// ===========================
export const clockNow = () => Date.now() + S.clockDelayMs;

// ================================================
// == ESTADO COMPARTIDO ENTRE MÓDULOS (OBJETO S) ==
// ================================================
// Lo que cambia y usan varios módulos vive aquí (S.current, S.newsOn...). Lo que solo usa un módulo es una variable de ese módulo.
export const S = {
  // ---- ajustes (por defecto vienen de stations.json; lo guardado en el navegador los sustituye) ----
  eq: { modes: [] }, // ecualizador de los ajustes (sin bloque "eq": sin modos y todo plano)
  artwork: '', // imagen de fondo de la notificación del reproductor (URL)
  accent: '', // color de énfasis general ("#rrggbb"; vacío = el verde por defecto)
  stationColors: true, // ajuste del navegador (rn_stcolor; activado por defecto): hacer caso a "color" de cada emisora o usar siempre el color general
  stations: [], // [{ id, name, short (nombre corto del botón), group: 'general' | 'musical', urls: [{ label (nombre de la variante; por defecto el formato), url, kind }], cors, news, color }]
  defaultDelayS: DEFAULT_DELAY_S, // retraso (s) del stream de la emisora de noticias respecto a la emisión real; solo sirve para calcular la hora de las franjas
  newsStation: null, // emisora a la que se cambia durante las noticias (objeto de S.stations)
  news: [], // [{ start: 'hh:mm:ss', end: 'hh:mm:ss' }] (horas reales de emisión, hora de Madrid)
  pending: false, // se ha pedido una emisora y aún no se ha confirmado el cambio: el panel sigue con la anterior, parpadeando
  configLoaded: false, // hay unos ajustes válidos aplicados (si no, el reloj no se pinta)
  configText: '', // ajustes guardados, tal como se muestran en la ventana
  clockDelayMs: 0, // retraso del reloj local (ms): hora real = hora local + retraso
  // ---- reproducción ----
  session: 'off', // 'off' (nada suena) o 'music' (hay una emisora sonando o conectando); con el modo boletines activado y 'off' se espera a las noticias
  held: false, // pausa desde la notificación: la emisora está retenida y el play vuelve a conectar en directo
  volMode: 'music', // nivel de volumen activo: 'music' (Volumen) o 'news' (Noticias, mientras suenan los boletines)
  audioCtx: null, // contexto de Web Audio (se crea al pulsar Reproducir)
  current: null, // emisora elegida (la que suena o a la que se está entrando); durante las noticias, la de noticias
  variant: 0, // variante (URL) de la emisora actual
  degraded: false, // la emisora que suena no pasa por Web Audio: sin ecualizador, normalización ni barras reales
  quality: '', // calidad del audio de la emisora actual (por ejemplo "MP3 128 kb/s"; vacío = desconocida)
  lastStation: null, // última emisora elegida (para reanudar al pulsar Reproducir)
  lastVariant: 0,
  lastPick: null, // última emisora pulsada (los botones de su grupo se resaltan con ella)
  // ---- modo boletines y transiciones ----
  newsMode: false, // interruptor del modo boletines activado
  newsOn: false, // ahora mismo suenan las noticias por el modo automático
  prevStation: null, // emisora a la que hay que volver al terminar (null = no había música)
  prevVariant: 0,
  newsSlot: null, // franja en curso: { idx, startAbs, endAbs } (ms absolutos, ya con el retraso del stream)
  skippedSlot: -1, // franja que el usuario ha abandonado a mano (no se vuelve a entrar en ella)
  trans: null, // transición en curso
};

// Deja el modo boletines sin noticias en curso (no toca el interruptor ni la franja abandonada)
export function endNewsState() {
  S.newsOn = false;
  S.prevStation = null;
  S.prevVariant = 0;
  S.newsSlot = null;
}
