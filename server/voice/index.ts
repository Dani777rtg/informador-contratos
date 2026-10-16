import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer } from "ws";
import { posNum } from "../guards/validate.js";
import { clientIp, type createRateLimiter } from "../guards/rate-limit.js";
import type { createDemandGuard } from "../guards/demand.js";
import { issueSessionToken, verifyUpgrade } from "../guards/ws-auth.js";
import { AGENT_URL, runAgentSession, type AgentHooks } from "./agent.js";

type Env = Record<string, string | undefined>;

/** Voz por el Voice Agent de Deepgram: este módulo solo admite la conexión y la entrega a `runAgentSession`. Sin persistencia. */
export function createVoice(env: Env, guards: { limiter?: ReturnType<typeof createRateLimiter>; demand?: ReturnType<typeof createDemandGuard> } = {}, hooks: AgentHooks = {}) {
  const secret = env.SESSION_SECRET ?? randomBytes(32).toString("hex");
  const origins = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const dailyMax = (env.VOICE_DAILY_MAX_MINUTES === "0" ? 0 : posNum(env.VOICE_DAILY_MAX_MINUTES, 120)) * 60_000;
  const perIpMax = posNum(env.VOICE_MAX_PER_IP, 3);
  const globalMax = posNum(env.VOICE_MAX_SESSIONS, 30);
  // ponytail: contadores en memoria por instancia (se pierden al reiniciar); persistirlos si hay varias instancias.
  const daily = { day: "", ms: 0 };
  const used = () => {
    const d = new Date().toISOString().slice(0, 10);
    if (daily.day !== d) { daily.day = d; daily.ms = 0; }
    return daily.ms;
  };
  const byIp = new Map<string, number>();
  let active = 0;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  return {
    newToken: () => issueSessionToken({ secret }),
    originAllowed: (o?: string) => !!o && origins.includes(o),
    attach(server: Server) {
      server.on("upgrade", (req: IncomingMessage, socket, head) => {
        let u: URL;
        try { u = new URL(req.url ?? "/", "http://x"); } catch { socket.destroy(); return; }
        if (u.pathname !== "/voice") { if (!u.pathname.startsWith("/__mock/")) socket.destroy(); return; }
        const v = verifyUpgrade({ origin: req.headers.origin, token: u.searchParams.get("token") ?? undefined }, { allowedOrigins: origins, secret });
        if (!v.ok) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
        const reject = (status: string, text: string) => {
          socket.write(`HTTP/1.1 ${status}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${text}`);
          socket.destroy();
        };
        const ip = clientIp(req.headers["x-forwarded-for"] as string | undefined, req.socket.remoteAddress ?? "unknown");
        const rl = guards.limiter?.check(ip);
        if (rl && !rl.allowed) { reject("429 Too Many Requests", rl.message ?? ""); return; }
        if ((byIp.get(ip) ?? 0) >= perIpMax || active >= globalMax) { reject("429 Too Many Requests", "Hay demasiadas sesiones de voz abiertas; intenta en un momento."); return; }
        const d = guards.demand?.admit("voice");
        if (d && !d.allowed) { reject("503 Service Unavailable", d.message ?? ""); return; }
        if (used() >= dailyMax) {
          wss.handleUpgrade(req, socket, head, (ws) => { ws.send(JSON.stringify({ type: "Notice", text: "Alcanzaste el tope diario de voz; seguimos por texto." })); ws.close(1000, "daily_cap"); });
          return;
        }
        const url = env.DEEPGRAM_AGENT_URL ?? (env.MOCK_EXTERNALS === "1" ? `ws://${req.headers.host}/__mock/deepgram/agent` : AGENT_URL);
        wss.handleUpgrade(req, socket, head, (ws) => {
          active++; byIp.set(ip, (byIp.get(ip) ?? 0) + 1);
          const started = Date.now();
          ws.once("close", () => {
            active--; const n = (byIp.get(ip) ?? 1) - 1; if (n > 0) byIp.set(ip, n); else byIp.delete(ip);
            used(); daily.ms += Date.now() - started;
          });
          runAgentSession(ws, url, env, hooks);
        });
      });
    },
  };
}
