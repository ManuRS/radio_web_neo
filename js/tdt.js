// ================================
// == LISTAS DE TDTCHANNELS (DATOS) ==
// ================================
// Descarga las listas de radio y de televisión de tdtchannels.com, se queda solo con lo que se puede escuchar aquí y las guarda en el navegador
// (Cache API, como los sonidos). Solo se vuelven a descargar cuando la copia guardada tiene más de una semana; si la descarga falla, sigue valiendo la anterior.
//
// Formato de origen: { countries: [{ name, ambits: [{ name, channels: [{ name, options: [{ format, url, ... }], extra_info? }] }] }] }
// Radio: se aceptan aac, mp3, m3u8 y stream (enlace directo de audio). Televisión: solo m3u8 (HLS: se escucha solo el audio, como La 1);
// youtube, twitch y los enlaces que son una página no son audio y se descartan.
// Además del origen externo, el proyecto lleva su propia base de datos (los archivos de bbdd/, independientes de los ajustes por defecto stations.json): así las cadenas
// y emisoras conocidas siguen disponibles en la búsqueda aunque no estén en los ajustes. Sus canales llevan k: 'neo', las URL con el nombre (l) de cada emisora y, de la cadena, short, tipo (t) y color (c).
// Lo que se guarda por canal: { n: nombre, a: ámbito, k: 'radio' | 'tv', g: 1 si es solo para España (GEO), o: [{ f: formato, u: url }] }

export const TDT_URLS = {
  radio: 'https://www.tdtchannels.com/lists/radio.json',
  tv: 'https://www.tdtchannels.com/lists/tv.json',
};
// Respaldo: el catálogo en Markdown del repositorio de TDTChannels en GitHub (mismos datos), que se puede leer desde cualquier web
export const TDT_MD_URLS = {
  radio: 'https://raw.githubusercontent.com/LaQuay/TDTChannels/master/RADIO.md',
  tv: 'https://raw.githubusercontent.com/LaQuay/TDTChannels/master/TELEVISION.md',
};
export const TDT_CACHE = 'rn-tdt';
export const TDT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;   // una semana
const FORMATS = { radio: ['aac', 'mp3', 'm3u8', 'stream'], tv: ['m3u8'] };
const TIMEOUT_MS = 25000;

// Sin Cache API (páginas no https) las listas valen solo mientras la página siga abierta
const memory = {};

// Del JSON completo a la lista reducida (nombre, ámbito y las opciones que se pueden escuchar)
export function trimList(json, kind) {
  const ok = FORMATS[kind];
  const out = [];
  const countries = json && Array.isArray(json.countries) ? json.countries : [];
  for (const country of countries) {
    for (const ambit of (country && country.ambits) || []) {
      for (const ch of (ambit && ambit.channels) || []) {
        if (!ch || typeof ch.name !== 'string' || !ch.name.trim()) continue;
        const seen = new Set();
        const o = [];
        for (const opt of ch.options || []) {
          const f = String((opt && opt.format) || '').toLowerCase();
          const u = opt && typeof opt.url === 'string' ? opt.url.trim() : '';
          if (!ok.includes(f) || !/^https?:\/\//i.test(u) || seen.has(u)) continue;
          seen.add(u);
          o.push({ f, u });
        }
        if (!o.length) continue;
        const item = { n: ch.name.trim(), a: String((ambit && ambit.name) || '').trim(), k: kind, o };
        if (Array.isArray(ch.extra_info) ? ch.extra_info.includes('GEO') : /\bGEO\b/.test(String(ch.extra_info || ''))) item.g = 1;
        out.push(item);
      }
    }
  }
  return out;
}

const keyOf = kind => new Request(location.origin + '/__tdt/' + kind);

async function readStored(kind) {
  try {
    if (typeof caches !== 'undefined') {
      const c = await caches.open(TDT_CACHE);
      const r = await c.match(keyOf(kind));
      if (r) return await r.json();
    }
  } catch (_) {}
  return memory[kind] || null;
}

async function store(kind, data) {
  memory[kind] = data;
  try {
    if (typeof caches === 'undefined') return;
    const c = await caches.open(TDT_CACHE);
    await c.put(keyOf(kind), new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }));
  } catch (_) {}
}

async function fetchWith(url, as) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return as === 'text' ? await res.text() : await res.json();
  } finally { clearTimeout(timer); }
}

// Del Markdown (TELEVISION.md / RADIO.md) a la misma estructura que el JSON, para pasar por trimList.
// Cada ámbito es un título (## o ###) y cada canal una fila de tabla:
//   | Canal | [m3u8 # GEO # HD](url) - [youtube](url) | [web](url) | [logo](url) | EPG | GEO,EMB |
export function parseMarkdown(md) {
  const ambits = [];
  let cur = null;
  const LINK = /\[([a-z0-9]+)((?: # [^\]]*?)?)\]\((.*?)\)(?= - \[|$)/g;
  String(md).split('\n').forEach(raw => {
    const line = raw.replace(/\r$/, '');
    const h = /^(#{2,3}) (.+)$/.exec(line);
    if (h) { cur = { name: h[2].trim(), channels: [] }; ambits.push(cur); return; }
    if (!cur || !line.startsWith('| ') || line.startsWith('| -') || /^\| (Canal|Emisoras) \|/.test(line)) return;
    const cells = (line.endsWith(' |') ? line.slice(2, -2) : line.slice(2)).split(' | ').map(c => c.trim());
    if (cells.length < 6) return;
    const [name, opts, , , , info] = cells;
    const options = [];
    if (opts !== '-') for (const m of opts.matchAll(LINK)) options.push({ format: m[1], url: m[3] });
    cur.channels.push({ name, options, extra_info: info === '-' ? [] : info.split(',') });
  });
  return { countries: [{ name: 'TDTChannels', ambits: ambits.filter(a => a.channels.length) }] };
}

// Primero el JSON de tdtchannels.com; si no se puede leer (su servidor no siempre deja que otra web lo pida), el Markdown de su GitHub
async function download(kind) {
  let items;
  try { items = trimList(await fetchWith(TDT_URLS[kind], 'json'), kind); }
  catch (err) {
    try { items = trimList(parseMarkdown(await fetchWith(TDT_MD_URLS[kind], 'text')), kind); } catch (_) { throw err; }
    if (!items.length) throw err;
  }
  return { t: Date.now(), items };
}

// Guarda una lista cargada a mano (archivo) como si se hubiera descargado
export async function importFile(kind, text) {
  const data = { t: Date.now(), items: trimList(JSON.parse(text), kind) };
  if (!data.items.length) throw new Error('el archivo no tiene canales que se puedan escuchar');
  await store(kind, data);
  return data;
}

// Devuelve { items, errors: {radio?, tv?}, oldest (ms de la copia más antigua), refreshed: [tipos que se acaban de descargar] }
// Cada lista: la copia guardada si tiene menos de una semana; si no, se descarga; si falla, se usa la vieja (si hay)
export async function loadLists(force = false) {
  const errors = {}, refreshed = [], missing = [];
  let items = [], oldest = Infinity;
  await Promise.all(['radio', 'tv'].map(async kind => {
    let data = await readStored(kind);
    if (force || !data || Date.now() - data.t > TDT_MAX_AGE_MS) {
      try { data = await download(kind); await store(kind, data); refreshed.push(kind); }
      catch (err) { errors[kind] = (err && err.message) || String(err); }
    }
    if (data) { items = items.concat(data.items); oldest = Math.min(oldest, data.t); }
    else missing.push(kind);
  }));
  return { items, errors, missing, oldest: isFinite(oldest) ? oldest : 0, refreshed };
}

// Catálogo interno del proyecto: la base de datos de la carpeta bbdd/ (junto a la página), un archivo por tema. Cada archivo es { chains: [{ name, short?, group, color?, urls: [{ label, url, kind }] }] }.
// Si un archivo no se puede leer, no pasa nada: se usan los demás y las listas de TDTChannels
const CATALOG_FILES = [['bbdd/ser.json', true], ['bbdd/los40.json', true], ['bbdd/resto.json', false]];   // [archivo, ¿cadenas por comunidad?]: en las de comunidad se ve siempre la tarjeta entera, aunque tengan una sola emisora
let catalog = null;
async function readCatalogFile([path, byRegion]) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return (json.chains || []).filter(c => c && typeof c.name === 'string' && Array.isArray(c.urls)).map(c => ({
      n: c.name.trim(), a: '', k: 'neo', r: byRegion, short: c.short || '', t: c.group === 'musical' ? 'musical' : 'general', c: c.color || '',
      o: c.urls.filter(u => u && /^https?:\/\//i.test(u.url)).map(u => ({ f: u.kind === 'hls' ? 'm3u8' : String(u.kind || 'mp3').toLowerCase(), u: u.url, l: String(u.label || '').trim() })),
    })).filter(c => c.o.length);
  } catch (_) { return []; }
}
export async function loadCatalog() {
  if (catalog) return catalog;
  catalog = (await Promise.all(CATALOG_FILES.map(readCatalogFile))).flat();
  return catalog;
}

// =============
// == BÚSQUEDA ==
// =============
// Sin mayúsculas ni tildes; se buscan todas las palabras escritas dentro del nombre ("ser alg" encuentra "SER Algeciras")
export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function search(items, query, httpOk = false) {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const q = words.join(' ');
  const hits = [];
  items.forEach((it, idx) => {
    const name = it._n || (it._n = norm(it.n));
    const nw = name.split(' ');
    // en el catálogo interno también se busca por el nombre de cada emisora ("Radio Madrid", "SER Madrid Norte")
    const text = it.k === 'neo' ? (it._t || (it._t = norm(it.n + ' ' + it.o.map(o => o.l).join(' ')))) : name;
    // cada palabra buscada empieza una palabra del nombre; las de 3 letras o más valen también dentro de una palabra ("ser" en "Aserradero"), las cortas no ("la" en "Estella")
    const inName = words.every(w => nw.some(x => x.startsWith(w)) || (w.length >= 3 && name.includes(w)));
    if (!inName && !(it.k === 'neo' && words.every(w => text.includes(w)))) return;
    const opts = httpOk ? it.o.slice() : it.o.filter(o => /^https:/i.test(o.u));   // en una web https el navegador bloquea los enlaces http
    if (!opts.length) return;
    // si la coincidencia no está en el nombre de la cadena (sino en el de sus emisoras: "zamora"), solo se ven las emisoras que coinciden, no toda la cadena;
    // si está en el nombre de la cadena ("ser"), se ven todas
    if (it.k === 'neo' && !inName) {
      const mine = opts.filter(o => { const t = norm(it.n + ' ' + o.l); return words.every(w => t.includes(w)); });
      if (!mine.length) return;
      opts.length = 0;
      opts.push(...mine);
    }
    // (una coincidencia solo por el nombre de una emisora del catálogo interno cuenta como 1)
    // 0 = nombre exacto; 1 = las palabras buscadas son palabras enteras del nombre ("ser" en "Cadena SER" y en "SER Algeciras", no en "Serie");
    // 2 = empiezan una palabra; 3 = aparecen dentro de una
    const rank = !inName ? 1 : name === q ? 0 : words.every(w => nw.includes(w)) ? 1 : words.every(w => nw.some(x => x.startsWith(w))) ? 2 : 3;
    hits.push({ ...it, o: opts, _all: it.o.length, _rank: rank, _idx: idx });   // _all: cuántas opciones tiene el canal (no solo las que se ven)
  });
  // primero las más parecidas; a igualdad, el orden de la lista (el catálogo interno primero, luego radio antes que televisión y las nacionales antes que las locales)
  hits.sort((a, b) => a._rank - b._rank || a._idx - b._idx);
  return hits;
}

// Etiqueta de una opción de TDTChannels: su formato (aac, mp3, hls) y, si el canal tiene varias del mismo, su número ("aac 2"). Va siempre, también con una sola opción;
// el catálogo interno no lleva ninguna (ahí el nombre de la emisora ya lo dice todo). Un enlace sin formato ("stream") solo se numera si hay varias
export function optionSuffix(ch, i) {
  if (ch.k === 'neo') return '';
  const o = ch.o[i];
  const f = o.f === 'm3u8' ? 'hls' : o.f === 'stream' ? '' : o.f;
  const same = ch.o.filter(x => x.f === o.f);
  const suffix = [f, same.length > 1 ? same.indexOf(o) + 1 : ''].filter(Boolean).join(' ');
  return suffix || (ch.o.length > 1 ? String(i + 1) : '');
}

// Nombre propuesto para una opción: en el catálogo interno, el de la emisora; en TDTChannels, el del canal con su etiqueta entre paréntesis: "Cadena SER (aac 2)".
// El nombre de una emisora admite 30 caracteres: si no cabe, se acorta el nombre del canal y se conserva el paréntesis
export function optionName(ch, i) {
  if (ch.k === 'neo' && ch.o[i].l) return ch.o[i].l.slice(0, 30);
  const suffix = optionSuffix(ch, i);
  const room = 30 - (suffix ? suffix.length + 3 : 0);
  const base = ch.n.length > room ? ch.n.slice(0, room).trim() : ch.n;
  return suffix ? base + ' (' + suffix + ')' : base;
}


// Quita de las listas de TDTChannels las opciones cuyo enlace ya está en el catálogo interno (o en otra opción anterior): cada enlace sale una sola vez,
// en el primer apartado donde está. Un canal que se queda sin opciones desaparece. El enlace se compara sin http/https, sin www., sin barra final y sin el parámetro ?dist=…
const urlKey = u => String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/#.*$/, '')
  .replace(/([?&])dist=[^&]*&?/, '$1').replace(/[?&]$/, '').replace(/\/+$/, '');   // el parámetro ?dist=… (de dónde viene la petición) no cambia el stream
export function dedupe(catalogItems, tdtItems) {
  const seen = new Set();
  for (const c of catalogItems) for (const o of c.o) seen.add(urlKey(o.u));
  const out = [];
  for (const c of tdtItems) {
    const o = c.o.filter(x => { const k = urlKey(x.u); if (seen.has(k)) return false; seen.add(k); return true; });
    if (o.length) out.push(o.length === c.o.length ? c : { ...c, o });
  }
  return out;
}
