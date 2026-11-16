// =====================================
// == AJUSTES EN JSON CON COMENTARIOS ==
// =====================================
// Los ajustes son un JSON que admite comentarios (// y /* */) y comas finales. Se guardan tal como se importan, con sus comentarios, y cuando la
// propia aplicación cambia algo (ecualizador, boletines, cadenas...) se reescribe solo el valor de la clave de primer nivel que ha cambiado:
// el resto del texto, comentarios incluidos, queda igual.

// Quita comentarios y comas finales (lo que JSON.parse no admite)
export function stripJsonComments(text) {
  return text
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n\r]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '')
    .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (m, str, tail) => str || tail);
}
export const parseJsonc = text => JSON.parse(stripJsonComments(text));

// Recorre el objeto de primer nivel y devuelve dónde está cada clave y su valor: { open, close, members: [{ key, start, valStart, valEnd, comma }] }
// (posiciones en el texto; comma = posición de la coma que sigue al valor, o -1). Si el texto no es un objeto, null
function scanTop(text) {
  const n = text.length;
  let i = 0, depth = 0, open = -1, close = -1, state = 'key', cur = null, lastSig = -1;
  const members = [];
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (open < 0) { if (c !== '{') return null; open = i; depth = 1; i++; continue; }
    if (c === '"') {   // cadena: se salta entera
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (depth === 1 && state === 'key') { cur = { key: JSON.parse(text.slice(i, j + 1)), start: i, valStart: -1, valEnd: -1, comma: -1 }; state = 'colon'; }
      else if (depth === 1 && state === 'value' && cur.valStart < 0) cur.valStart = i;
      lastSig = j + 1;
      i = j + 1;
      continue;
    }
    if (depth === 1 && c === ':' && state === 'colon') { state = 'value'; i++; continue; }
    if (depth === 1 && state === 'value' && cur.valStart < 0) cur.valStart = i;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        if (state === 'value' && cur) { cur.valEnd = lastSig; members.push(cur); }
        close = i;
        break;
      }
    } else if (c === ',' && depth === 1) {
      if (state === 'value' && cur) { cur.valEnd = lastSig; cur.comma = i; members.push(cur); cur = null; state = 'key'; }
      i++;
      continue;
    }
    lastSig = i + 1;
    i++;
  }
  if (open < 0 || close < 0) return null;
  return { open, close, members };
}

const fmt = v => JSON.stringify(v, null, 2).replace(/\n/g, '\n  ');   // valor con sangría para ir dentro del objeto de primer nivel

// Texto de los ajustes con los cambios de "after" respecto a "before" (los dos ya leídos): solo se reescriben las claves de primer nivel
// que cambian; las nuevas van al final y las quitadas desaparecen con su línea. Si algo no cuadra, el JSON entero (sin comentarios)
export function patchTop(text, before, after) {
  const whole = () => JSON.stringify(after, null, 2);
  const t = text && text.trim() ? scanTop(text) : null;
  if (!t || !before || typeof before !== 'object') return whole();
  const edits = [];
  const kept = [];
  for (const m of t.members) {
    if (m.valStart < 0 || m.valEnd < 0) return whole();
    if (!(m.key in after)) {
      const lineStart = text.lastIndexOf('\n', m.start - 1) + 1;
      const from = /^[ \t]*$/.test(text.slice(lineStart, m.start)) ? lineStart : m.start;
      let to = m.comma >= 0 ? m.comma + 1 : m.valEnd;
      const rest = /^[ \t]*\r?\n/.exec(text.slice(to));
      if (rest && from === lineStart) to += rest[0].length;   // la línea entera fuera
      edits.push({ from, to, str: '' });
      continue;
    }
    kept.push(m);
    if (JSON.stringify(before[m.key]) !== JSON.stringify(after[m.key])) edits.push({ from: m.valStart, to: m.valEnd, str: fmt(after[m.key]) });
  }
  const known = new Set(t.members.map(m => m.key));
  const added = Object.keys(after).filter(k => !known.has(k) && after[k] !== undefined);
  if (added.length) {
    const body = added.map(k => '  ' + JSON.stringify(k) + ': ' + fmt(after[k])).join(',\n');
    const last = kept[kept.length - 1];
    if (!last) edits.push({ from: t.open + 1, to: t.open + 1, str: '\n' + body + '\n' });
    else if (last.comma >= 0) edits.push({ from: last.comma + 1, to: last.comma + 1, str: '\n' + body + ',' });
    else edits.push({ from: last.valEnd, to: last.valEnd, str: ',\n' + body });
  }
  edits.sort((a, b) => b.from - a.from || b.to - a.to);
  const nl = text.includes('\r\n') ? '\r\n' : '\n';   // se respetan los saltos de línea del archivo (Windows o no)
  let out = text;
  for (const e of edits) out = out.slice(0, e.from) + e.str.replace(/\n/g, nl) + out.slice(e.to);
  try { if (JSON.stringify(parseJsonc(out)) === JSON.stringify(parseJsonc(whole()))) return out; } catch (_) {}
  return whole();
}
