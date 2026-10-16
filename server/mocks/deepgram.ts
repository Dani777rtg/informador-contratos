import type { Server } from "node:http";
import { WebSocketServer, type RawData } from "ws";

const wait = () => new Promise((r) => setTimeout(r, Number(process.env.MOCK_LATENCY_MS_DEEPGRAM ?? 0)));

/**
 * Sustituto del Voice Agent: /__mock/deepgram/agent responde Welcome, SettingsApplied y, a cada
 * InjectUserMessage, la secuencia ConversationText -> AgentThinking -> AgentStartedSpeaking -> audio -> AgentAudioDone.
 */
export function attachDeepgramMock(server: Server): void {
  const agent = new WebSocketServer({ noServer: true });
  agent.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "Welcome", request_id: "mock" }));
    ws.on("message", async (d: RawData, bin) => {
      if (bin) return;
      let m: { type?: string; content?: string };
      try { m = JSON.parse(d.toString()) as typeof m; } catch { ws.close(1003, "json"); return; }
      if (m.type === "Settings") ws.send(JSON.stringify({ type: "SettingsApplied" }));
      else if (m.type === "InjectUserMessage") {
        await wait();
        ws.send(JSON.stringify({ type: "ConversationText", role: "user", content: m.content ?? "" }));
        ws.send(JSON.stringify({ type: "AgentThinking", content: "" }));
        ws.send(JSON.stringify({ type: "ConversationText", role: "assistant", content: "Encontré tres contratos de ejemplo. Puedes pedir más detalle." }));
        ws.send(JSON.stringify({ type: "AgentStartedSpeaking" }));
        ws.send(Buffer.alloc(3200), { binary: true });
        ws.send(JSON.stringify({ type: "AgentAudioDone" }));
      }
    });
  });
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/__mock/deepgram/agent") agent.handleUpgrade(req, socket, head, (ws) => agent.emit("connection", ws, req));
    else if (!req.url?.startsWith("/voice")) socket.destroy(); // ruta desconocida (la de /voice la atiende createVoice)
  });
}
