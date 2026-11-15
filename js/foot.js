// ======================================
// == PIE: FRASES QUE SE VAN ALTERNANDO ==
// ======================================
// La primera línea del pie alterna sus frases cada 30 s con una transición. Al aparecer cada frase hay un efecto: si lleva emojis, los
// emojis dan un bote; si es solo texto, lo recorre un brillo del color de énfasis. Nada de esto ocurre con el pie fuera de la pantalla
// (o la página oculta): si toca cambiar entonces, se espera a que se vea. Con "reducir movimiento", cambia sin animaciones ni efectos.

const SWAP_MS = 30000;
const EMOJI = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*)/u;
const box = document.getElementById('footPhrase');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let phrases = [], cur = 0, due = 0, visible = false, played = false, timer = 0, waitTimer = 0;

// Una frase: el texto, con cada emoji en su propio elemento (para el bote, uno detrás de otro)
function render(text) {
  const el = document.createElement('span');
  el.className = 'fp';
  let k = 0;
  text.split(EMOJI).forEach((part, i) => {
    if (!part) return;
    if (i % 2) {
      const e = document.createElement('span');
      e.className = 'fe';
      e.style.setProperty('--k', k++);
      e.textContent = part;
      el.appendChild(e);
    } else el.appendChild(document.createTextNode(part));
  });
  el.classList.add(k ? 'fp-emoji' : 'fp-text');
  return el;
}

const shown = () => visible && !document.hidden;

// Efecto de entrada de la frase que se ve (una vez por frase)
function play() {
  played = true;
  if (reduce.matches) return;
  const el = box.querySelector('.fp:not(.out)');
  if (!el || el.classList.contains('in')) return;   // la que está entrando hace el efecto al terminar de entrar
  el.classList.remove('play');
  void el.offsetWidth;
  el.classList.add('play');
  const last = el.classList.contains('fp-emoji') ? [...el.querySelectorAll('.fe')].pop() : el;
  last.addEventListener('animationend', () => el.classList.remove('play'), { once: true });
}

function swap() {
  cur = (cur + 1) % phrases.length;
  due = Date.now() + SWAP_MS;
  played = true;
  const old = box.querySelector('.fp:not(.out)'), next = render(phrases[cur]);
  if (reduce.matches || !old) { box.replaceChildren(next); played = true; return; }
  old.classList.add('out');
  old.addEventListener('animationend', e => { if (e.animationName === 'fp-out') old.remove(); });
  next.classList.add('in');
  next.addEventListener('animationend', function done(e) {
    if (e.animationName !== 'fp-in') return;
    next.removeEventListener('animationend', done);
    next.classList.remove('in');
    play();
  });
  box.appendChild(next);
}

function check() {
  if (!phrases.length || !shown()) return;
  if (phrases.length > 1 && Date.now() >= due) { swap(); return; }
  if (!played) play();
}

// Frases del pie (una o dos; vacío = sin frases)
export function setFootPhrases(list) {
  phrases = (list || []).filter(Boolean);
  cur = 0;
  played = false;
  due = Date.now() + SWAP_MS;
  box.replaceChildren(...(phrases.length ? [render(phrases[0])] : []));
  clearInterval(timer);
  if (phrases.length) timer = setInterval(check, 1000);
  check();
}

// Se ve cuando al menos la mitad del pie está en pantalla; al aparecer, se deja un momento antes de cambiar o del efecto (para que se vea)
if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(entries => {
    visible = entries[entries.length - 1].isIntersecting;
    clearTimeout(waitTimer);
    if (visible) waitTimer = setTimeout(check, 450);
  }, { threshold: 0.5 }).observe(box.parentElement);
} else visible = true;
document.addEventListener('visibilitychange', () => { clearTimeout(waitTimer); if (!document.hidden) waitTimer = setTimeout(check, 450); });
