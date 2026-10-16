import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { emptyContext, type Ctx, type createSessionCodec } from "../session.js";
import type { createAsker } from "../agent/ask.js";
import { issueSessionToken, verifyUpgrade } from "../guards/ws-auth.js";

type Env = Record<string, string | undefined>;

const ACK = "Claro, déjame buscar eso.";
const ACK_MS = 500;
const NO_VOICE = "La voz no está disponible por ahora; seguimos por texto.";

/** Voz (Flux STT + Aura TTS) sobre WebSocket. Sin persistencia: ni audio ni transcripciones tocan disco ni logs. */
export function createVoice(env: Env, ask: ReturnType<typeof createAsker>, codec: ReturnType<typeof createSessionCodec>) {
  const secret = env.SESSION_SECRET ?? randomBytes(32).toString("hex");
  const origins = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const sessionMax = Number(env.VOICE_SESSION_MAX_SECONDS ?? 600) * 1000;
  const dailyMax = Number(env.VOICE_DAILY_MAX_MINUTES ?? 120) * 60_000;
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
  const wss = new WebSocketServer({ noServer: true });

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
    const getTts = () => ttsPending ??= open(ttsUrl, { model: voice, encoding: "linear16", sample_rate: "24000" }).then((ws) => {
      ws.on("message", (d: RawData, bin) => { if (bin && !muted && client.readyState === WebSocket.OPEN) client.send(d, { binary: true }); });
      ws.on("close", () => { tts = null; ttsPending = null; });
      ws.on("error", () => {});
      return (tts = ws);
    }).catch(() => { voiceDown(); return null; });

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
      let spokenAny = false;
      const ack = spoken ? setTimeout(() => { if (my === gen && !spokenAny) { spokenAny = true; void speak(ACK, true); } }, ACK_MS) : null;
      try {
        const r = await ask(message, context, "voz", (s) => {
          if (my !== gen) return;
          timing.firstToken ??= Date.now() - t0;
          if (ack) clearTimeout(ack);
          if (spoken) { spokenAny = true; void speak(s, true); }
        });
        if (ack) clearTimeout(ack);
        if (my !== gen) return;
        context = r.context;
        send({ type: "message", text: r.text, cards: r.cards, timing, state: codec.sign(context) });
      } catch {
        if (ack) clearTimeout(ack);
        if (my === gen) send({ type: "message", text: "No pude responder en este momento. Intenta de nuevo." });
      }
    }

    const stop = () => {
      if (ended) return;
      ended = true;
      if (voiceOn || stt) daily.ms += Date.now() - started;
      voiceOn = false;
      clearTimeout(limit);
      stt?.close(); tts?.send(JSON.stringify({ type: "Close" })); tts?.close();
    };
    const limit = setTimeout(() => {
      if (!voiceOn) return;
      daily.ms += Date.now() - started; voiceOn = false;
      send({ type: "notice", text: "Llegaste al tiempo máximo de voz de la sesión; seguimos por texto." });
      stt?.close(); tts?.close();
    }, sessionMax);

    client.on("message", (d: RawData, bin) => {
      if (bin) { if (voiceOn && stt?.readyState === WebSocket.OPEN) stt.send(d, { binary: true }); return; }
      try {
        const m = JSON.parse(d.toString()) as { type?: string; text?: unknown; state?: unknown };
        // Estado firmado del chat: voz y texto comparten una sola conversación; inválido -> conversación nueva.
        if (m.type === "state") context = codec.verify((m as { state?: unknown }).state) ?? emptyContext();
        else if (m.type === "message" && typeof m.text === "string" && m.text.trim()) void turn(m.text, false);
      } catch { /* mensaje inválido: se ignora */ }
    });
    client.on("close", stop);
    client.on("error", stop);

    // Arranque de voz: tope diario, luego STT.
    if (used() >= dailyMax) { send({ type: "notice", text: "Alcanzaste el tope diario de voz; seguimos por texto." }); return; }
    void open(sttUrl, { model: "flux-general-multi", language_hint: "es", encoding: "linear16", sample_rate: "16000", eot_threshold: "0.7", eager_eot_threshold: "0.5" })
      .then((ws) => {
        if (ended) return ws.close();
        stt = ws; voiceOn = true;
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
        ws.on("close", () => { stt = null; voiceDown(); });
      })
      .catch(() => send({ type: "notice", text: NO_VOICE }));
  }

  return {
    newToken: () => issueSessionToken({ secret }),
    originAllowed: (o?: string) => !!o && origins.includes(o),
    attach(server: Server) {
      server.on("upgrade", (req: IncomingMessage, socket, head) => {
        const u = new URL(req.url ?? "/", "http://x");
        if (u.pathname !== "/voice") return;
        const v = verifyUpgrade({ origin: req.headers.origin, token: u.searchParams.get("token") ?? undefined }, { allowedOrigins: origins, secret });
        if (!v.ok) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (ws) => session(ws));
      });
    },
  };
}
