// POST /api/stat — estadística anónima (usuarios por día y segundos de escucha). Ver ../_stat.js y js/stats.js
import { apuntar, mismoOrigen } from '../_stat.js';

export async function onRequestPost({ request, env }) {
  if (!mismoOrigen(request.headers.get('Origin'), request.url)) return new Response(null, { status: 403 });
  const texto = await request.text().catch(() => '');
  return new Response(null, { status: await apuntar(env.STATS, texto) });
}

export const onRequestGet = () => new Response('Usa POST', { status: 405 });
