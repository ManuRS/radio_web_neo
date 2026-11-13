// Service worker mínimo: permite instalar la web como app y abrirla aunque no haya red (el audio sí la necesita).
// Estrategia "caché primero": lo guardado se usa sin preguntar a la red. Solo se vuelve a descargar la web cuando cambia este archivo,
// así que en cada versión nueva hay que subir el número de CACHE y, si hay módulos nuevos o quitados, revisar SHELL.
// Excepción: stations.json (los ajustes por defecto, con las URL de los streams, que cambian con el tiempo) y los archivos de bbdd/ (la base de datos de emisoras, para la búsqueda) van "red primero", con la caché de respaldo.
// Los sonidos y la imagen de la notificación (sounds/, img/) NO se gestionan aquí: la propia página los guarda en la caché "rn-sounds", que este archivo respeta.
// Los streams (otro origen) tampoco pasan por aquí.
const CACHE = 'rn-shell-109';
const NET_WAIT_MS = 3000;   // lo que se espera a la red por stations.json y bbdd/ antes de tirar de la copia guardada
const SHELL = [
  './', './css/styles.css', './favicon.ico', './favicon-32.png', './icon.svg', './stations.json', './bbdd/ser.json', './bbdd/los40.json', './bbdd/resto.json',
  './js/audio.js', './js/boletines.js', './js/clock.js', './js/custom.js', './js/deck.js', './js/dom.js', './js/importer.js', './js/main.js', './js/mediasession.js', './js/player.js', './js/presentation.js', './js/recorder.js', './js/rec-worker.js', './js/rec-worklet.js', './js/settings.js', './js/sounds.js', './js/state.js', './js/tdt.js', './js/stations.js', './js/transitions.js', './js/ui.js', './js/utils.js', './js/viz.js',
  './vendor/hls.light.min.js', './vendor/wasm-media-encoder.min.js', './vendor/mp3.wasm',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
];

self.addEventListener('install', e => {
  // allSettled: un archivo que falle no rompe la instalación entera; 'reload': sin pasar por la caché HTTP del navegador
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // solo se borran versiones antiguas de la propia carcasa; la caché de sonidos se conserva
      .then(keys => Promise.all(keys.filter(k => k.startsWith('rn-shell-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// Cloudflare Pages redirige /x/index.html a /x/: una respuesta redirigida no se puede servir a una navegación, se guarda una copia limpia
const clean = res => (res.redirected ? res.blob().then(b => new Response(b, { status: res.status, statusText: res.statusText, headers: res.headers })) : res);
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // los streams y otros orígenes: no se tocan
  if (url.pathname.includes('/sounds/') || url.pathname.includes('/img/')) return;   // sonidos e imagen van por la caché de la página
  if (url.pathname.endsWith('/stations.json') || url.pathname.includes('/bbdd/')) {
    // red primero, pero sin dejar la web esperando: si la red no responde en NET_WAIT_MS se sirve la copia guardada (la respuesta, cuando llegue, la renueva)
    const net = fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    });
    const slow = new Promise((_, reject) => setTimeout(reject, NET_WAIT_MS));
    e.respondWith(Promise.race([net, slow]).catch(() => caches.match(req).then(hit => hit || net)));
    e.waitUntil(net.catch(() => {}));
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(clean).catch(() => (req.mode === 'navigate' ? caches.match('./') : Response.error())))
  );
});
