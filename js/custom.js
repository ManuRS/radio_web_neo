// ===========================================
// == SCRIPT DE PERSONALIZACIÓN (personalizar.js) ==
// ===========================================
// El usuario puede subir un JS (en Ajustes > General). Se guarda en la caché del navegador (solo en este navegador, nada va a la red) y,
// en cada carga de la web, se ejecuta lo último de todo para que pueda tocar lo que quiera de la página. Subir un archivo vacío lo quita.

import { log } from './ui.js';

const CUSTOM_CACHE = 'rn-custom';
const CUSTOM_KEY = 'personalizar.js';
const MAX_BYTES = 1024 * 1024;

const open = () => caches.open(CUSTOM_CACHE);

// Texto del script guardado ('' si no hay o el navegador no tiene caché)
export async function loadCustom() {
  try {
    const hit = await (await open()).match(CUSTOM_KEY);
    return hit ? await hit.text() : '';
  } catch (_) { return ''; }
}

// Guarda el script; un texto vacío lo quita. Devuelve el tamaño guardado en bytes (0 = quitado)
export async function saveCustom(text) {
  const bytes = new Blob([text]).size;
  if (bytes > MAX_BYTES) throw new Error('el archivo pesa más de ' + (MAX_BYTES / 1024) + ' kB');
  let c;
  try { c = await open(); } catch (_) { throw new Error('este navegador no tiene caché (solo funciona en páginas https)'); }
  if (!text.trim()) { await c.delete(CUSTOM_KEY); return 0; }
  await c.put(CUSTOM_KEY, new Response(text, { headers: { 'content-type': 'text/javascript' } }));
  return bytes;
}

// Ejecuta el script guardado como un script normal de la página; un fallo suyo se anota en el registro y no afecta al resto
export async function runCustom() {
  const code = await loadCustom();
  if (!code.trim()) return;
  const onError = e => log('Error en personalizar.js: ' + (e.message || e));
  window.addEventListener('error', onError);
  try {
    const s = document.createElement('script');
    s.textContent = code + '\n//# sourceURL=personalizar.js';
    document.head.appendChild(s);
    log('personalizar.js ejecutado');
  } catch (err) { onError(err); }
  setTimeout(() => window.removeEventListener('error', onError), 5000);
}
