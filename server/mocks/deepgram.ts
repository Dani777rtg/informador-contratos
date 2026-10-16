import type { Server } from "node:http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

/**
 * Sustituto de Deepgram: /__mock/deepgram/stt (v2/listen) cuenta audio y emite TurnInfo al recibir
 * {"type":"__EndOfTurn","transcript":...}; /__mock/deepgram/tts (v1/speak) responde audio a Speak/Flush.
 */
/** JSON de red: si no parsea, se cierra con 1003 en vez de lanzar. */
function parse<T>(d: RawData, ws: WebSocket): T | null {
  try { const v = JSON.parse(d.toString()); if (v && typeof v === "object") return v as T; } catch { /* cae al cierre */ }
  ws.close(1003, "json");
  return null;
}

export function attachDeepgramMock(server: Server): void {
  const stt = new WebSocketServer({ noServer: true });
  const tts = new WebSocketServer({ noServer: true });
  stt.on("connection", (ws) => ws.on("message", (d: RawData, bin) => {
    if (bin) return;
    const m = parse<{ type?: string; transcript?: string }>(d, ws);
    if (!m) return;
    if (m.type === "__EndOfTurn") ws.send(JSON.stringify({ type: "TurnInfo", event: "EndOfTurn", transcript: m.transcript ?? "", end_of_turn_confidence: 0.9 }));
  }));
  tts.on("connection", (ws) => ws.on("message", (d: RawData, bin) => {
    if (bin) return;
    const m = parse<{ type?: string }>(d, ws);
    if (!m) return;
    if (m.type === "Speak" || m.type === "Flush") ws.send(Buffer.alloc(3200), { binary: true });
    if (m.type === "Flush") ws.send(JSON.stringify({ type: "Flushed" }));
  }));
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const wss = path === "/__mock/deepgram/stt" ? stt : path === "/__mock/deepgram/tts" ? tts : null;
    if (wss) wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    else if (!req.url?.startsWith("/voice")) socket.destroy(); // ruta desconocida (la de /voice la atiende createVoice)
  });
}
