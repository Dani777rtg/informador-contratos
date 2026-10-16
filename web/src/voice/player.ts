// Reproducción en cola del audio linear16 24 kHz del servidor; flush() calla de inmediato.
export function createPlayer(onIdle: () => void) {
  let ctx: AudioContext | null = null;
  let next = 0;
  const live = new Set<AudioBufferSourceNode>();
  return {
    push(buf: ArrayBuffer): void {
      ctx ??= new AudioContext({ sampleRate: 24000 });
      void ctx.resume();
      const n = Math.floor(buf.byteLength / 2);
      if (!n) return;
      const pcm = new Int16Array(buf, 0, n);
      const ab = ctx.createBuffer(1, n, 24000);
      const ch = ab.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = pcm[i]! / 32768;
      const src = ctx.createBufferSource();
      src.buffer = ab; src.connect(ctx.destination);
      next = Math.max(next, ctx.currentTime + 0.02);
      src.start(next); next += ab.duration;
      live.add(src);
      src.onended = () => { live.delete(src); if (!live.size) onIdle(); };
    },
    flush(): void {
      for (const s of live) { s.onended = null; try { s.stop(); } catch { /* ya parado */ } }
      live.clear(); next = 0; onIdle();
    },
    playing: () => live.size > 0,
    close(): void { this.flush(); void ctx?.close(); ctx = null; },
  };
}
