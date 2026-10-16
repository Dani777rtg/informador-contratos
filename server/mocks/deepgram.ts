import type { Server } from "node:http";
import { WebSocketServer, type RawData } from "ws";

/**
 * Sustituto de Deepgram: /__mock/deepgram/stt (v2/listen) cuenta audio y emite TurnInfo al recibir
 * {"type":"__EndOfTurn","transcript":...}; /__mock/deepgram/tts (v1/speak) responde audio a Speak/Flush.
 */
export function attachDeepgramMock(server: Server): void {
  const stt = new WebSocketServer({ noServer: true });
  const tts = new WebSocketServer({ noServer: true });
  stt.on("connection", (ws) => ws.on("message", (d: RawData, bin) => {
    if (bin) return;
    const m = JSON.parse(d.toString()) as { type?: string; transcript?: string };
    if (m.type === "__EndOfTurn") ws.send(JSON.stringify({ type: "TurnInfo", event: "EndOfTurn", transcript: m.transcript ?? "", end_of_turn_confidence: 0.9 }));
  }));
  tts.on("connection", (ws) => ws.on("message", (d: RawData, bin) => {
    if (bin) return;
    const m = JSON.parse(d.toString()) as { type?: string };
    if (m.type === "Speak" || m.type === "Flush") ws.send(Buffer.alloc(3200), { binary: true });
    if (m.type === "Flush") ws.send(JSON.stringify({ type: "Flushed" }));
  }));
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const wss = path === "/__mock/deepgram/stt" ? stt : path === "/__mock/deepgram/tts" ? tts : null;
    if (wss) wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
}
