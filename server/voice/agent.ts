import { WebSocket, type RawData } from "ws";
import { MISSION_PROMPT } from "../agent/mission.js";
import { TOOL_DEFS, runTool } from "../agent/tools.js";
import { decline, DECLINE_TOOL } from "../agent/decline.js";
import { PLACE_KEYTERMS } from "../data/places.js";
import { emptyContext, type Ctx } from "../session.js";
import { MAX_TOOLS_PER_TURN, posNum } from "../guards/validate.js";
import { normalNames, spokenAmount, toSpoken } from "../speech/spoken.js";

type Env = Record<string, string | undefined>;
type Json = Record<string, unknown>;
type Turn = { type: "History"; role: "user" | "assistant"; content: string };

export const AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";
export const KEYTERMS = ["SECOP", "NIT", "CDP", "contrato", "alcaldía", "gobernación", ...PLACE_KEYTERMS].slice(0, 100); // Deepgram rechaza más de 100 keyterms (FAILED_TO_START_LISTENING, verificado): departamentos primero y municipios por importancia
export const MAX_ASK_CHARS = 500;
const MAX_FRAME_BYTES = 64 * 1024;
const TOOL_NAMES = new Set(TOOL_DEFS.map((t) => t.name));
/** Lo único que llega del Voice Agent al navegador (además del audio binario). */
const FORWARD = new Set(["UserStartedSpeaking", "AgentThinking", "AgentStartedSpeaking", "AgentAudioDone"]);

/** Settings del Voice Agent. Lleva la clave de DeepSeek: solo se construye y envía desde el servidor (TM-15). */
export function buildSettings(env: Env, history: Turn[] = []): Json {
  const base = (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const key = env.DEEPSEEK_VOICE_API_KEY || env.DEEPSEEK_API_KEY || "";
  return {
    type: "Settings",
    audio: { input: { encoding: "linear16", sample_rate: 16000 }, output: { encoding: "linear16", sample_rate: 24000, container: "none" } },
    agent: {
      listen: { provider: { type: "deepgram", model: "nova-3", language: "es", keyterms: KEYTERMS } },
      think: {
        provider: { type: "open_ai", model: env.DEEPSEEK_MODEL ?? "deepseek-flash", temperature: 0.2 },
        endpoint: { url: `${base}/chat/completions`, headers: { authorization: `Bearer ${key}` } },
        prompt: MISSION_PROMPT,
        functions: [...TOOL_DEFS, DECLINE_TOOL.function], // decline debe existir: si no, el modelo la llama y el agente queda mudo (NON_EXISTENT_FUNCTION_CALLED)
      },
      speak: { provider: { type: "deepgram", model: env.TTS_VOICE ?? "aura-2-celeste-es" } },
      ...(history.length ? { context: { messages: history } } : {}),
    },
  };
}

const isMoney = /^\$\s?\d/;
const isoDate = /^\d{4}-\d{2}-\d{2}/;
const MONEY_KEY = /valor|total|monto|value|suma|gasto/i;
/** Resultado de herramienta -> modelo: montos en palabras, textos de SECOP cortos, sin saltos ni etiquetas, sin enlaces. */
export function forAgent(v: unknown, key = ""): unknown {
  if (typeof v === "number") return MONEY_KEY.test(key) && Math.abs(v) >= 1000 ? spokenAmount(v) : v;
  if (typeof v === "string") {
    const s = v.replace(/[\u0000-\u001f\u007f<>«»]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
    if (isMoney.test(s) || isoDate.test(s)) return toSpoken(s);
    // Nombres en mayúsculas de SECOP en formato normal para que el modelo no los lea letra a letra.
    return /^\p{Lu}{4,}$/u.test(s) ? s[0] + s.slice(1).toLowerCase() : normalNames(s);
  }
  if (Array.isArray(v)) return v.slice(0, 10).map((x) => forAgent(x, key));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "kind" && !/url/i.test(k)).map(([k, x]) => [k, forAgent(x, k)]));
  return v;
}

/** Cerca el resultado como datos para el modelo (el texto interior ya no puede traer «, » ni < >). */
export const fence = (payload: unknown): string => `«DATOS SECOP» ${JSON.stringify(payload)} «FIN DATOS SECOP»`;

export const validAsk = (t: unknown): t is string =>
  typeof t === "string" && t.length <= MAX_ASK_CHARS && t.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(t);

const withDeadline = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("deadline")), ms).unref())]);

export interface AgentHooks {
  run?: typeof runTool;
  /** Un turno hablado: ms de fin de turno a primer audio, herramientas y código de declinación. Sin contenido. */
  turn?(t: { latencyMs: number; tools: string[]; declineCode?: string; intent: string; placeMatched?: "si" | "no" | "confirmar"; resultCode: string }): void;
  /** Fin de sesión: motivo de cierre y duración. Sin contenido. */
  close?(c: { closeReason: string; ms: number; tools: string[]; errorType?: string }): void;
}

/** Una sesión de voz: puente entre el navegador y el Voice Agent de Deepgram con lista blanca en ambos sentidos. */
export function runAgentSession(client: WebSocket, url: string, env: Env, hooks: AgentHooks = {}): void {
  const run = hooks.run ?? runTool;
  const started = Date.now();
  const sessionMs = posNum(env.VOICE_SESSION_MAX_SECONDS, 1800) * 1000;
  const idleMs = posNum(env.VOICE_IDLE_MS, 60_000);
  const keepAliveMs = posNum(env.VOICE_KEEPALIVE_MS, 5000);
  const backoffMs = posNum(env.VOICE_RECONNECT_MS, 300);
  const maxAsks = posNum(env.VOICE_MAX_ASKS, 30);
  const maxFps = posNum(env.VOICE_MAX_FRAMES_PER_SEC, 100);
  const secrets = [env.DEEPSEEK_VOICE_API_KEY, env.DEEPSEEK_API_KEY, env.DEEPGRAM_API_KEY].filter((k): k is string => !!k && k.length > 8).concat(MISSION_PROMPT.slice(0, 60));
  let tokens = 5, refilled = Date.now(); // AskText: ráfaga de 5 y 2 por segundo
  let up: WebSocket | null = null;
  let ready = false, ended = false, attempts = 0, errorType: string | undefined;
  let ctx: Ctx = emptyContext();
  const history: Turn[] = [];
  const early: Buffer[] = []; // hasta 4 s de voz dicha mientras conecta (frames de 40 ms)
  const queued: string[] = [];
  const all: string[] = [];
  let turnTools: string[] = [], turnT0 = 0, declineCode: string | undefined, placeMatched: "si" | "no" | "confirmar" | undefined, resultCode = "ok";
  let lastFrame = Date.now(), winStart = Date.now(), frames = 0, asks = 0;

  const send = (o: Json) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(o)); };
  const toUp = (o: Json) => { if (up?.readyState === WebSocket.OPEN) up.send(JSON.stringify(o)); };
  const inject = (content: string) => { turnT0 = Date.now(); turnTools = []; declineCode = undefined; placeMatched = undefined; resultCode = "ok"; toUp({ type: "InjectUserMessage", content }); };

  const end = (code: number, reason: string) => {
    if (ended) return;
    ended = true;
    clearTimeout(limit); clearInterval(timer);
    if (client.readyState === WebSocket.OPEN) client.close(code, reason);
    up?.terminate(); up = null;
    hooks.close?.({ closeReason: reason, ms: Date.now() - started, tools: all, errorType });
  };
  const limit = setTimeout(() => { send({ type: "Notice", text: "Llegaste al tiempo máximo de voz de la sesión; seguimos por texto." }); end(4000, "session_time_limit"); }, sessionMs);
  // El agente cierra con 10 s sin audio ni KeepAlive; con el micrófono en pausa el cliente no manda audio.
  const timer = setInterval(() => {
    if (Date.now() - lastFrame > idleMs) end(4001, "idle");
    else toUp({ type: "KeepAlive" });
  }, keepAliveMs);
  timer.unref(); limit.unref();

  async function functions(m: { functions?: { id?: string; name?: string; arguments?: string; client_side?: boolean }[] }) {
    for (const f of m.functions ?? []) {
      if (!f.client_side || typeof f.name !== "string") continue;
      let args: Json = {};
      try { const p: unknown = JSON.parse(f.arguments || "{}"); if (p && typeof p === "object" && !Array.isArray(p)) args = p as Json; } catch { /* argumentos inválidos: vacíos */ }
      let content: string;
      if (f.name === "decline") {
        declineCode = String(args.code ?? "");
        turnTools.push("decline"); all.push("decline");
        content = `${decline(declineCode)}\nDi esto al usuario tal cual, sin añadir nada.`;
      } else if (!TOOL_NAMES.has(f.name) || turnTools.length >= MAX_TOOLS_PER_TURN) {
        content = fence({ error: "funcion_no_disponible" });
      } else {
        turnTools.push(f.name); all.push(f.name);
        const r = await withDeadline(run(f.name, args, undefined, ctx), 12_000).catch(() => ({ data: { error: "servicio_no_disponible" }, cards: [], context: undefined, note: undefined }));
        ctx = { ...ctx, ...r.context };
        const err = (r.data as { error?: unknown } | undefined)?.error;
        if (typeof err === "string") resultCode = err.slice(0, 40);
        if (args.municipio || args.departamento || args.ciudad) placeMatched = err === "lugar_desconocido" ? ((r.data as { confirmar?: unknown }).confirmar ? "confirmar" : "no") : "si";
        if (r.cards?.length) send({ type: "ToolResult", cards: r.cards });
        content = fence(forAgent(r.data)) + (r.note ? `\n${r.note}` : "");
      }
      toUp({ type: "FunctionCallResponse", id: f.id, name: f.name, content });
    }
  }

  function onUpstream(data: RawData, isBinary: boolean) {
    if (isBinary) { if (client.readyState === WebSocket.OPEN) client.send(data, { binary: true }); return; }
    let m: Json & { functions?: never };
    try { m = JSON.parse(data.toString()) as Json; } catch { return; }
    const type = m.type;
    if (type === "SettingsApplied") { ready = true; for (const t of queued.splice(0)) inject(t); }
    else if (type === "ConversationText" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
      // Si el agente refleja la configuración (clave o prompt), el texto no sale ni se guarda (TM-15).
      if (secrets.some((s) => (m.content as string).includes(s))) return;
      history.push({ type: "History", role: m.role, content: m.content.slice(0, 2000) });
      if (history.length > 40) history.shift();
      if (m.role === "user" && !turnT0) { turnT0 = Date.now(); turnTools = []; declineCode = undefined; placeMatched = undefined; resultCode = "ok"; }
      send({ type, role: m.role, content: m.content });
    } else if (typeof type === "string" && FORWARD.has(type)) {
      if (type === "AgentStartedSpeaking" && turnT0) { hooks.turn?.({ latencyMs: Date.now() - turnT0, tools: turnTools, declineCode, intent: declineCode ? "declinar" : turnTools.length ? "consulta" : "conversacion", placeMatched, resultCode }); turnT0 = 0; }
      send({ type });
    } else if (type === "FunctionCallRequest") void functions(m as never);
    else if (type === "Error") { errorType = String(m.code ?? "error").slice(0, 60); console.warn(JSON.stringify({ evt: "agent_error", code: errorType })); }
  }

  const connect = () => {
    const ws = new WebSocket(url, { headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY ?? ""}` }, handshakeTimeout: 10_000 });
    up = ws; ready = false;
    let openedAt = 0;
    ws.on("open", () => {
      openedAt = Date.now();
      ws.send(JSON.stringify(buildSettings(env, history.slice(-20))));
      for (const f of early.splice(0)) ws.send(f, { binary: true });
    });
    ws.on("message", onUpstream);
    ws.on("error", () => { /* el cierre que sigue decide */ });
    ws.on("close", (code: number, reason: Buffer) => {
      if (up !== ws) return;
      up = null; ready = false;
      console.warn(JSON.stringify({ evt: "agent_close", code, reason: reason.toString("utf8").slice(0, 120) }));
      if (ended) return;
      // Reintenta sin avisar; avisa solo si no se recupera (AC-05.5). Una conexión que vivió >2 s reinicia la cuenta.
      attempts = openedAt && Date.now() - openedAt > 2000 ? 1 : attempts + 1;
      if (attempts > 3) { errorType = "upstream_unrecovered"; send({ type: "Notice", text: "La voz no está disponible por ahora; seguimos por texto." }); end(1011, "upstream_unrecovered"); }
      else setTimeout(() => { if (!ended) connect(); }, backoffMs * 2 ** (attempts - 1)).unref();
    });
  };

  client.on("message", (data: RawData, isBinary: boolean) => {
    const now = Date.now();
    lastFrame = now;
    if (now - winStart >= 1000) { winStart = now; frames = 0; }
    if (++frames > maxFps) return end(1008, "rate");
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]);
      if (buf.length > MAX_FRAME_BYTES) return end(1009, "frame_too_big");
      if (up?.readyState === WebSocket.OPEN) up.send(buf, { binary: true });
      else if (early.length < 100) early.push(buf);
      return;
    }
    let msg: Json | null = null;
    try { const p: unknown = JSON.parse(data.toString()); msg = p && typeof p === "object" ? (p as Json) : null; } catch { /* inválido */ }
    if (msg?.type === "KeepAlive") return;
    if (msg?.type === "AskText") {
      if (!validAsk(msg.text)) { send({ type: "Notice", text: `Escribe un mensaje de hasta ${MAX_ASK_CHARS} caracteres.` }); return; }
      tokens = Math.min(5, tokens + ((now - refilled) / 1000) * 2); refilled = now;
      if (asks >= maxAsks || tokens < 1) return;
      asks++; tokens--;
      if (ready) inject(msg.text.trim()); else if (queued.length < 5) queued.push(msg.text.trim());
      return;
    }
    end(1008, "invalid_message"); // nunca se reenvía JSON del cliente: Settings, UpdatePrompt, UpdateThink, Function*…
  });
  client.on("close", () => end(1000, "client_closed"));
  client.on("error", () => end(1011, "client_error"));
  connect();
}
