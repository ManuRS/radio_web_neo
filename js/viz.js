// ============================
// == VISUALIZADOR DE BARRAS ==
// ============================
// Dibuja barras que se mueven con el sonido. Se alimenta de un AnalyserNode (ver attach) y no conoce nada más de la aplicación.
// Estéreo (setStereo, solo mientras lo pide el Radial): el analizador pasa a medir el canal izquierdo y uno segundo, el derecho; al quitarlo,
// el segundo se destruye y todo vuelve a un único analizador. levelsL y levelsR tienen siempre valor (sin estéreo, iguales a levels).
// Con una emisora que no pasa por Web Audio (modo degradado, ver setSynthetic) no hay nada que analizar: las barras se mueven con un movimiento
// orgánico sintético, como en Radio Web Fast.

// Colores por defecto de las barras (el verde de siempre); con setAccent se sustituyen por los del color de énfasis
const DEF_TOP = '#58dfa3';
const DEF_BOTTOM = '#2f9e74';
const HEX6 = /^#[0-9a-f]{6}$/i;
const ACCENT_FADE_MS = 600;
const SMOOTH_TAU = 0.07;   // segundos que tarda una barra en acercarse al nivel nuevo cuando el suavizado está activo
// Mezcla dos "#rrggbb" (k = 0 el primero, k = 1 el segundo)
export const mix = (a, b, k) => '#' + [1, 3, 5].map(i => {
  const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16);
  return Math.round(x + (y - x) * k).toString(16).padStart(2, '0');
}).join('');
// Oscurece un "#rrggbb" multiplicando sus canales (la base de las barras es el mismo color, más oscuro)
export const shade = (hex, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');

export function createVisualizer(canvas, isPaused) {
  const ctx2d = canvas.getContext('2d');
  const BARS = 36;
  const barLevels = new Array(BARS).fill(0), levelsL = new Array(BARS).fill(0), levelsR = new Array(BARS).fill(0);
  let audioCtx = null, analyser = null, freqData = null, binRanges = null, src = null;
  let stereoOn = false, up = null, split = null, anR = null, freqR = null;   // estéreo: nodos que solo existen mientras está activo
  let running = false, looping = false;
  let colTop = DEF_TOP, colBottom = DEF_BOTTOM, fadeId = 0, first = true;
  let synth = false, smooth = false, tSyn = 0, lastT = 0;
  const synPhase = Array.from({ length: BARS }, () => Math.random() * 6.283), synSpeed = Array.from({ length: BARS }, () => 1.2 + Math.random() * 2.6);

  // Niveles sintéticos: cada barra oscila a su ritmo (más fuerte en graves) y un pulso lento mueve los graves
  function organic(dt) {
    tSyn += dt;
    const beat = Math.pow(Math.max(0, Math.sin(tSyn * 2.1)), 4);
    for (let i = 0; i < BARS; i++) {
      const f = i / (BARS - 1);
      const n = 0.25 * (Math.sin(tSyn * synSpeed[i] + synPhase[i]) + Math.sin(tSyn * synSpeed[i] * 0.37 + synPhase[i] * 1.7)) + 0.5;
      const target = Math.min(1, (0.75 - 0.45 * f) * (0.25 + 0.75 * n) + (i < 8 ? 0.25 * beat * (1 - f * 3) : 0));
      barLevels[i] = target > barLevels[i] ? target : Math.max(target, barLevels[i] - 0.035);
    }
  }

  // reparte los "bins" de la FFT en BARS franjas de frecuencia (escala logarítmica)
  function computeBinRanges() {
    const nyq = audioCtx.sampleRate / 2, bins = analyser.frequencyBinCount;
    const fmin = 45, fmax = 15000; // rango útil de la señal
    binRanges = [];
    for (let i = 0; i < BARS; i++) {
      const f0 = fmin * Math.pow(fmax / fmin, i / BARS);
      const f1 = fmin * Math.pow(fmax / fmin, (i + 1) / BARS);
      const b0 = Math.floor(f0 / nyq * bins);
      let b1 = Math.ceil(f1 / nyq * bins);
      if (b1 <= b0) b1 = b0 + 1;
      binRanges.push([b0, Math.min(b1, bins)]);
    }
  }
  // Estéreo: src → up (una emisora mono pasa a dos canales iguales; el divisor no sabe hacerlo) → divisor → izquierdo al analizador de siempre y
  // derecho a uno segundo. Al quitarlo se desmonta todo y src vuelve a ir directo al analizador
  function wireStereo(on) {
    if (on && !split && src && analyser && audioCtx) {
      try {
        up = audioCtx.createGain();
        up.channelCount = 2; up.channelCountMode = 'explicit'; up.channelInterpretation = 'speakers';
        split = audioCtx.createChannelSplitter(2);
        anR = audioCtx.createAnalyser();
        anR.fftSize = analyser.fftSize; anR.smoothingTimeConstant = analyser.smoothingTimeConstant;
        anR.minDecibels = analyser.minDecibels; anR.maxDecibels = analyser.maxDecibels;
        freqR = new Uint8Array(anR.frequencyBinCount);
        src.disconnect(analyser);
        src.connect(up); up.connect(split); split.connect(analyser, 0); split.connect(anR, 1);
      } catch (_) { wireStereo(false); }
    } else if (!on && split) {
      try { src.disconnect(up); } catch (_) {}
      for (const n of [up, split, anR]) { try { n.disconnect(); } catch (_) {} }
      up = split = anR = freqR = null;
      try { src.connect(analyser); } catch (_) {}
    }
  }
  // nivel (0 a 1) de la franja i con los datos de un analizador
  function band(data, i) {
    const [b0, b1] = binRanges[i];
    let sum = 0;
    for (let b = b0; b < b1; b++) sum += data[b];
    return Math.min(1, (sum / (b1 - b0)) / 255 * (0.9 + 0.7 * i / (BARS - 1)));   // compensa la caída natural de agudos
  }
  // El degradado solo se recrea si cambia el alto o el color
  let grad = null, gradH = 0;
  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, w, h);
    if (!grad || gradH !== h) {
      grad = ctx2d.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, colBottom);
      grad.addColorStop(1, colTop);
      gradH = h;
    }
    const gap = 3, bw = (w - gap * (BARS - 1)) / BARS;
    // dos pasadas (barras con sonido y barras en reposo), cada una con un único trazo
    [true, false].forEach(active => {
      ctx2d.fillStyle = active ? grad : '#2a3441';
      ctx2d.beginPath();
      for (let i = 0; i < BARS; i++) {
        const lvl = barLevels[i];
        if ((lvl > 0.01) !== active) continue;
        const bh = Math.max(3, lvl * h);
        const x = i * (bw + gap), y = h - bh;
        if (ctx2d.roundRect) ctx2d.roundRect(x, y, bw, bh, Math.min(2, bw / 2));
        else ctx2d.rect(x, y, bw, bh);
      }
      ctx2d.fill();
    });
  }
  // Calcula los niveles (sin dibujar). Lo hace cada fotograma; con la página oculta el navegador no da fotogramas, y entonces lo llama la imagen en imagen (tick)
  let rafAt = 0;   // último fotograma del navegador
  function update(now) {
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016;
    lastT = now || 0;
    const live = !synth && analyser && audioCtx && audioCtx.state === 'running' && !isPaused() && binRanges;
    if (synth && !isPaused()) {
      organic(dt);
    } else if (live) {
      analyser.getByteFrequencyData(freqData);
      const rise = 1 - Math.exp(-dt / SMOOTH_TAU);
      // suavizado: la subida se acerca al nivel nuevo en vez de saltar a él (el analizador se actualiza a golpes cuando el móvil procesa el audio por bloques grandes)
      const step = (cur, target) => target > cur ? (smooth ? cur + (target - cur) * rise : target) : Math.max(target, cur - 0.035);
      if (anR) {
        // estéreo: cada canal por su lado; levels (para el resto de la presentación y la página) es la media de los dos
        anR.getByteFrequencyData(freqR);
        for (let i = 0; i < BARS; i++) {
          levelsL[i] = step(levelsL[i], band(freqData, i));
          levelsR[i] = step(levelsR[i], band(freqR, i));
          barLevels[i] = (levelsL[i] + levelsR[i]) / 2;
        }
      } else {
        for (let i = 0; i < BARS; i++) barLevels[i] = step(barLevels[i], band(freqData, i));
      }
    } else {
      for (let i = 0; i < BARS; i++) barLevels[i] = Math.max(0, barLevels[i] - 0.05);
    }
    if (!anR || !live) for (let i = 0; i < BARS; i++) levelsL[i] = levelsR[i] = barLevels[i];   // sin estéreo, los dos lados son el mismo
  }
  function frame(now) {
    rafAt = performance.now();
    update(now);
    draw();
    if (running || barLevels.some(l => l > 0.01)) requestAnimationFrame(frame);
    else looping = false;
  }
  return {
    // conecta el analizador (cuando se crea el grafo de audio)
    // src: el nodo que alimenta al analizador (hace falta para separar los canales en el estéreo)
    attach(ac, an, s) {
      up = split = anR = freqR = null;   // los nodos del estéreo eran del grafo anterior
      audioCtx = ac; analyser = an; src = s || null;
      freqData = new Uint8Array(an.frequencyBinCount);
      computeBinRanges();
      if (stereoOn) wireStereo(true);
    },
    // true = mide los dos canales por separado (levelsL, levelsR); false = un solo analizador, como siempre
    setStereo(on) { stereoOn = !!on; wireStereo(stereoOn); },
    // color de énfasis ("#rrggbb"); vacío o no válido = el verde por defecto
    // Cambia el color de las barras con una transición suave (misma duración que la de --accent en el CSS)
    setAccent(hex) {
      const top = typeof hex === 'string' && HEX6.test(hex) ? hex : DEF_TOP;
      const from = colTop, t0 = first ? -ACCENT_FADE_MS : performance.now();   // el primer color (el de los ajustes al cargar) se pone sin transición
      first = false;
      cancelAnimationFrame(fadeId);
      const step = now => {
        const k = Math.max(0, Math.min(1, (now - t0) / ACCENT_FADE_MS));   // el sello de rAF puede ser algo anterior a t0
        colTop = mix(from, top, k);
        colBottom = shade(colTop, 0.7);
        grad = null;
        if (!looping) draw();
        if (k < 1) fadeId = requestAnimationFrame(step);
      };
      fadeId = requestAnimationFrame(step);
    },
    // true = la emisora no pasa por Web Audio: barras sintéticas en vez de las del analizador
    setSynthetic(on) { synth = !!on; },
    get synthetic() { return synth; },
    // true = suaviza la subida de las barras reales (móviles con emisoras que no son HLS)
    setSmooth(on) { smooth = !!on; },
    // empieza a animar (al conectar) / deja que las barras bajen y se paren (al desconectar)
    start() { running = true; if (!looping) { looping = true; requestAnimationFrame(frame); } },
    stop() { running = false; },
    tick(now) { if (now - rafAt > 100) update(now); },   // niveles al día sin fotogramas del navegador (página oculta, ventana flotante abierta); si los hay, no hace nada
    draw,
    get looping() { return looping; },
    levels: barLevels,                       // nivel actual de cada barra (0 a 1), para otras vistas como el modo presentación
    levelsL, levelsR,                        // lo mismo por canal (con el estéreo activo; si no, iguales a levels)
    get analyser() { return analyser; },     // analizador del audio (para vistas que usan la forma de onda)
    get accent() { return colTop; },         // color actual de las barras ("#rrggbb", con la transición ya aplicada)
  };
}
