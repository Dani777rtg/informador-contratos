import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { emptyContext, type Ctx, type createSessionCodec } from "../session.js";
import type { createAsker } from "../agent/ask.js";
import { posNum } from "../guards/validate.js";
import { clientIp, type createRateLimiter } from "../guards/rate-limit.js";
import type { createDemandGuard } from "../guards/demand.js";
import { toSpoken } from "../speech/spoken.js";
import { logClose, openWithRetry, startKeepAlive } from "./keepalive.js";
import { issueSessionToken, verifyUpgrade } from "../guards/ws-auth.js";

type Env = Record<string, string | undefined>;

const NO_VOICE = "La voz no está disponible por ahora; seguimos por texto.";

/** Voz (Flux STT + Aura TTS) sobre WebSocket. Sin persistencia: ni audio ni transcripciones tocan disco ni logs. */
export function createVoice(env: Env, ask: ReturnType<typeof createAsker>, codec: ReturnType<typeof createSessionCodec>,
  guards: { limiter?: ReturnType<typeof createRateLimiter>; demand?: ReturnType<typeof createDemandGuard> } = {},
  /** Mismo flujo que el chat de texto (atajos, agente, seguimientos). Sin él, solo el agente. */
  chat?: (message: string, context: Ctx) => Promise<Record<string, unknown> & { text: string; state: string }>) {
  const respond = chat ?? (async (m: string, c: Ctx) => { const r = await ask(m, c, "voz"); return { text: r.text, cards: r.cards, state: codec.sign(r.context) }; });
  const secret = env.SESSION_SECRET ?? randomBytes(32).toString("hex");
  const origins = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const sessionMax = posNum(env.VOICE_SESSION_MAX_SECONDS, 600) * 1000;
  const dailyMax = (env.VOICE_DAILY_MAX_MINUTES === "0" ? 0 : posNum(env.VOICE_DAILY_MAX_MINUTES, 120)) * 60_000;
  // ponytail: tope diario en memoria y global (se pierde al reiniciar); persistirlo si hay varias instancias.
  const daily = { day: "", ms: 0 };
  const used = () => {
    const d = new Date().toISOString().slice(0, 10);
    if (daily.day !== d) { daily.day = d; daily.ms = 0; }
    return daily.ms;
  };
  const sttUrl = env.DEEPGRAM_STT_URL ?? "wss://api.deepgram.com/v2/listen";
  const ttsUrl = env.DEEPGRAM_TTS_URL ?? "wss://api.deepgram.com/v1/speak";
  const voice = env.TTS_VOICE ?? "aura-2-celeste-es";
  const auth = { Authorization: `Token ${env.DEEPGRAM_API_KEY ?? ""}` };
  const keepAliveMs = posNum(env.VOICE_KEEPALIVE_MS, 5000); // Deepgram cierra a los 10 s sin audio ni KeepAlive
  const backoffMs = posNum(env.VOICE_RECONNECT_MS, 300);
  const STT_PARAMS = { model: "flux-general-multi", language_hint: "es", encoding: "linear16", sample_rate: "16000", eot_threshold: "0.7", eager_eot_threshold: "0.5" };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  const open = (url: string, params: Record<string, string>) =>
    new Promise<WebSocket>((ok, fail) => {
      const u = new URL(url);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      const ws = new WebSocket(u, { headers: auth });
      ws.once("open", () => ok(ws));
      ws.once("error", fail);
    });

  function session(client: WebSocket) {
    const started = Date.now();
    const send = (o: unknown) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(o)); };
    let stt: WebSocket | null = null;
    let tts: WebSocket | null = null;
    let ttsPending: Promise<WebSocket | null> | null = null;
    let muted = false;
    let dirty = false; // hay audio por reproducir en el cliente
    let gen = 0; // turno vigente; un barge-in lo invalida
    let flushes: number[] = [];
    let voiceOn = false;
    let context: Ctx = emptyContext();
    let ended = false;

    const voiceDown = () => { if (voiceOn) { voiceOn = false; send({ type: "notice", text: NO_VOICE }); } };
    // TTS se reabre bajo demanda (el cierre por inactividad no es un fallo); solo avisa si fallan los 3 intentos.
    const getTts = () => ttsPending ??= openWithRetry(() => open(ttsUrl, { model: voice, encoding: "linear16", sample_rate: "24000" }), () => !ended, 3, backoffMs).then((ws) => {
      if (!ws) { ttsPending = null; voiceDown(); return null; }
      ws.on("message", (d: RawData, bin) => { if (bin && !muted && client.readyState === WebSocket.OPEN) client.send(d, { binary: true }); });
      ws.on("close", (code: number, reason: Buffer) => { logClose("tts", code, reason); tts = null; ttsPending = null; });
      ws.on("error", () => {});
      return (tts = ws);
    });
    const keep = startKeepAlive(() => stt, keepAliveMs);

    const speak = async (text: string, flush: boolean) => {
      if (!voiceOn) return;
      const ws = await getTts();
      if (!ws) return;
      muted = false; dirty = true;
      for (let i = 0; i < text.length; i += 2000) ws.send(JSON.stringify({ type: "Speak", text: text.slice(i, i + 2000) }));
      const now = Date.now();
      flushes = flushes.filter((t) => now - t < 60_000);
      if (flush && flushes.length < 18) { flushes.push(now); ws.send(JSON.stringify({ type: "Flush" })); }
    };

    const interrupt = () => {
      gen++;
      if (!dirty) return;
      muted = true; dirty = false;
      tts?.send(JSON.stringify({ type: "Clear" }));
      send({ type: "interrupt" });
    };

    async function turn(message: string, spoken: boolean) {
      const my = ++gen;
      const t0 = Date.now();
      const timing: Record<string, number> = {};
      try {
        // Sin acuse ni relleno: mientras busca solo hay estado visual; lo primero que se oye es la respuesta real, en palabras y en máximo 2 frases.
        const r = await respond(message, context);
        timing.total = Date.now() - t0;
        if (my !== gen) return;
        context = codec.verify(r.state) ?? context;
        const say = toSpoken(r.text);
        if (spoken) for (const part of say.split(/(?<=[.!?])\s+/).filter(Boolean)) void speak(part + " ", true);
        send({ type: "message", ...r, spoken: say, timing });
      } catch {
        if (my === gen) send({ type: "message", text: "No pude responder en este momento. Intenta de nuevo." });
      }
    }

    const stop = () => {
      if (ended) return;
      ended = true;
      if (voiceOn || stt) daily.ms += Date.now() - started;
      voiceOn = false;
      clearTimeout(limit); keep.stop();
      stt?.close(); tts?.send(JSON.stringify({ type: "Close" })); tts?.close();
    };
    const limit = setTimeout(() => {
      if (!voiceOn) return;
      daily.ms += Date.now() - started; voiceOn = false; keep.stop();
      send({ type: "notice", text: "Llegaste al tiempo máximo de voz de la sesión; seguimos por texto." });
      stt?.close(); tts?.close();
    }, sessionMax);

    client.on("message", (d: RawData, bin) => {
      if (bin) { if (voiceOn && stt?.readyState === WebSocket.OPEN) { stt.send(d, { binary: true }); keep.audio(); } return; }
      try {
        const m = JSON.parse(d.toString()) as { type?: string; text?: unknown; state?: unknown };
        // Estado firmado del chat: voz y texto comparten una sola conversación; inválido -> conversación nueva.
        if (m.type === "state") context = codec.verify((m as { state?: unknown }).state) ?? emptyContext();
        else if (m.type === "message" && typeof m.text === "string" && m.text.trim()) void turn(m.text, false);
      } catch { /* mensaje inválido: se ignora */ }
    });
    client.on("close", stop);
    client.on("error", stop);

    // Arranque de voz: tope diario, luego STT. Si Deepgram cierra solo (p. ej. 1011 por inactividad), se reconecta sin avisar.
    if (used() >= dailyMax) { send({ type: "notice", text: "Alcanzaste el tope diario de voz; seguimos por texto." }); return; }
    let quickCloses = 0;
    const connectStt = async (first: boolean) => {
      const ws = await openWithRetry(() => open(sttUrl, STT_PARAMS), () => !ended, 3, backoffMs);
      if (ended) { ws?.close(); return; }
      if (!ws) { if (first) send({ type: "notice", text: NO_VOICE }); else voiceDown(); return; }
      stt = ws; voiceOn = true;
      const openedAt = Date.now();
      ws.on("message", (d: RawData, bin) => {
        if (bin) return;
        try {
          const m = JSON.parse(d.toString()) as { type?: string; event?: string; transcript?: string };
          if (m.type !== "TurnInfo") return;
          if (m.event === "StartOfTurn") interrupt();
          // ponytail: sin borrador en EagerEndOfTurn; añadirlo si p95 > 1 s.
          else if (m.event === "EndOfTurn" && m.transcript?.trim()) {
            send({ type: "transcript", text: m.transcript });
            void turn(m.transcript, true);
          }
        } catch { /* ignorar */ }
      });
      ws.on("error", () => {});
      ws.on("close", (code: number, reason: Buffer) => {
        logClose("stt", code, reason);
        if (stt === ws) stt = null;
        if (ended || !voiceOn) return;
        quickCloses = Date.now() - openedAt < 2000 ? quickCloses + 1 : 0;
        if (quickCloses >= 3) voiceDown(); else void connectStt(false);
      });
    };
    void connectStt(true);
  }

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
        const rl = guards.limiter?.check(clientIp(req.headers["x-forwarded-for"] as string | undefined, req.socket.remoteAddress ?? "unknown"));
        if (rl && !rl.allowed) { reject("429 Too Many Requests", rl.message ?? ""); return; }
        const d = guards.demand?.admit("voice");
        if (d && !d.allowed) { reject("503 Service Unavailable", d.message ?? ""); return; }
        wss.handleUpgrade(req, socket, head, (ws) => session(ws));
      });
    },
  };
}
