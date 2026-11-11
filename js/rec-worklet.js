// =====================================
// == GRABACIÓN: TOMA DE AUDIO (WORKLET) ==
// =====================================
// Corre en el hilo de audio. Recibe lo que sale del ecualizador (ver recorder.js) y lo manda en bloques al worker que lo pasa a MP3,
// por un canal directo (sin pasar por la página, que en segundo plano puede ir a tirones). Si no llega nada (entrada desconectada), manda silencio:
// así la grabación no se desfasa del tiempo real.

const BLOCK = 4096;   // muestras por canal en cada envío (~85 ms a 48 kHz)

class RecTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null;
    this.on = true;
    this.l = new Float32Array(BLOCK);
    this.r = new Float32Array(BLOCK);
    this.n = 0;
    this.port.onmessage = e => {
      const m = e.data || {};
      if (m.port) this.out = m.port;
      if (m.stop) {   // fin: se manda lo que quede y se avisa al worker
        this.flush();
        if (this.out) this.out.postMessage({ end: true });
        this.on = false;
      }
    };
  }
  flush() {
    if (!this.n || !this.out) return;
    const l = this.l.slice(0, this.n), r = this.r.slice(0, this.n);
    this.out.postMessage({ l, r }, [l.buffer, r.buffer]);
    this.n = 0;
  }
  process(inputs) {
    if (!this.on) return false;
    const inp = inputs[0] || [];
    const a = inp[0], b = inp[1] || inp[0];
    const len = a ? a.length : 128;
    for (let i = 0; i < len; i++) {
      this.l[this.n] = a ? a[i] : 0;
      this.r[this.n] = b ? b[i] : 0;
      if (++this.n === BLOCK) this.flush();
    }
    return true;
  }
}

registerProcessor('rn-rec-tap', RecTap);
