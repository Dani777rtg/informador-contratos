// Captura de micrófono: AudioWorklet que remuestrea a 16 kHz y emite PCM linear16 en bloques de 80 ms (2560 bytes).
const WORKLET = `
class Down extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(1280); this.n = 0; this.pos = 0; this.last = 0; this.sum = 0; }
  process(inputs) {
    const x = inputs[0][0];
    if (!x) return true;
    const step = sampleRate / 16000;
    // ponytail: interpolación lineal sin filtro paso bajo; la cancelación de ruido del navegador cubre el aliasing en voz.
    while (this.pos < x.length) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const a = i === 0 ? this.last : x[i - 1], b = x[i];
      const v = Math.max(-1, Math.min(1, i === 0 ? this.last + (x[0] - this.last) * f : a + (b - a) * f));
      this.buf[this.n++] = v * 32767; this.sum += v * v;
      if (this.n === 1280) {
        this.port.postMessage({ pcm: this.buf.buffer, level: Math.sqrt(this.sum / 1280) }, [this.buf.buffer]);
        this.buf = new Int16Array(1280); this.n = 0; this.sum = 0;
      }
      this.pos += step;
    }
    this.pos -= x.length; this.last = x[x.length - 1];
    return true;
  }
}
registerProcessor("down", Down);`;

export interface Capture { setPaused(p: boolean): void; stop(): void }

export async function startCapture(onChunk: (pcm: ArrayBuffer) => void, onLevel: (l: number) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  const node = new AudioWorkletNode(ctx, "down");
  let paused = false;
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
    if (paused) { onLevel(0); return; }
    onLevel(e.data.level);
    onChunk(e.data.pcm);
  };
  ctx.createMediaStreamSource(stream).connect(node);
  return {
    setPaused: (p) => { paused = p; },
    stop: () => { stream.getTracks().forEach((t) => t.stop()); void ctx.close(); },
  };
}
