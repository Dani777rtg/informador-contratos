import { WebSocket } from "ws";

const SILENCE = Buffer.alloc(2560); // 80 ms de PCM16 a 16 kHz
/** Deepgram cierra con 1011 (NET-0001) tras 10 s sin audio. Flux (/v2/listen) rechaza el mensaje KeepAlive
 *  (UNPARSABLE_CLIENT_MESSAGE, verificado), así que se envían 80 ms de silencio cada `ms` mientras no llegue audio. */
export function startKeepAlive(get: () => WebSocket | null, ms: number): { audio(): void; stop(): void } {
  let lastSend = Date.now();
  const timer = setInterval(() => {
    const ws = get();
    if (ws?.readyState === WebSocket.OPEN && Date.now() - lastSend >= ms - 50) { ws.send(SILENCE, { binary: true }); lastSend = Date.now(); }
  }, ms);
  timer.unref();
  return { audio: () => { lastSend = Date.now(); }, stop: () => clearInterval(timer) };
}

/** Código y motivo de cierre de Deepgram, sin contenido de la conversación. */
export const logClose = (which: "stt" | "tts", code: number, reason: Buffer) =>
  console.warn(JSON.stringify({ evt: "deepgram_close", which, code, reason: reason.toString("utf8").slice(0, 120) }));

/** Reintenta `open` hasta `tries` veces con backoff exponencial; devuelve null si todos fallan. */
export async function openWithRetry<T>(open: () => Promise<T>, alive: () => boolean, tries = 3, baseMs = 300): Promise<T | null> {
  for (let i = 0; i < tries && alive(); i++) {
    try { return await open(); } catch { await new Promise((ok) => setTimeout(ok, baseMs * 2 ** i)); }
  }
  return null;
}
