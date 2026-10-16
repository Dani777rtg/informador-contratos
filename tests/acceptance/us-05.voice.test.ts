/**
 * US-05 Conversación por voz manos libres (cambio 006: Deepgram Voice Agent). AC-05.1 .. AC-05.9.
 *
 * Todo corre en local: un sustituto `ws` imita agent/v1/agent/converse (DEEPGRAM_AGENT_URL) y otro http imita DeepSeek.
 * Contrato (docs/changes/006): startServer({ port, env }) -> { port, close() }; POST /session -> { token };
 * WS /voice?token= con Origin permitido; cliente -> servidor: audio binario, {type:"KeepAlive"}, {type:"AskText", text};
 * servidor -> cliente: audio, ConversationText, UserStartedSpeaking, AgentThinking, AgentStartedSpeaking, AgentAudioDone,
 * {type:"ToolResult"}, {type:"Notice", text}. Topes por env: VOICE_SESSION_MAX_SECONDS, VOICE_DAILY_MAX_MINUTES.
 * AC-05.9: `server/speech/spoken.ts` exporta toSpoken y spokenAmount.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const ORIGIN = "http://localhost:5173";
const REPLY = "Encontré tres contratos de ejemplo. Puedes pedir más detalle.";
const MARKER = "zafiro-secreto-4471";

interface Agent {
  url: string; conns: WebSocket[]; got: any[]; binFrames: number; delayMs: number; dropFirst: boolean;
  send(o: unknown, i?: number): void; close(): Promise<void>;
}
async function startAgent(o: { delayMs?: number; dropFirst?: boolean } = {}): Promise<Agent> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  const a = { conns: [], got: [], binFrames: 0, delayMs: o.delayMs ?? 0, dropFirst: !!o.dropFirst } as unknown as Agent;
  wss.on("connection", (ws) => {
    a.conns.push(ws);
    ws.send(JSON.stringify({ type: "Welcome", request_id: "r1" }));
    ws.on("message", (d, isBinary) => {
      if (isBinary) { a.binFrames++; return; }
      let m: any; try { m = JSON.parse(d.toString()); } catch { return; }
      a.got.push(m);
      if (m.type === "Settings") {
        if (a.dropFirst && a.conns.length === 1) return void ws.terminate();
        ws.send(JSON.stringify({ type: "SettingsApplied" }));
      }
      if (m.type === "InjectUserMessage") setTimeout(() => {
        ws.send(JSON.stringify({ type: "ConversationText", role: "user", content: m.content }));
        ws.send(JSON.stringify({ type: "AgentThinking", content: "x" }));
        ws.send(JSON.stringify({ type: "ConversationText", role: "assistant", content: REPLY }));
        ws.send(JSON.stringify({ type: "AgentStartedSpeaking" }));
        ws.send(Buffer.alloc(3200), { binary: true });
        ws.send(JSON.stringify({ type: "AgentAudioDone" }));
      }, a.delayMs);
    });
  });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  a.url = `ws://127.0.0.1:${(wss.address() as any).port}/v1/agent/converse`;
  a.send = (obj, i = 0) => a.conns[i].send(JSON.stringify(obj));
  a.close = async () => { a.conns.forEach((c) => c.terminate()); wss.close(); };
  return a;
}
// DeepSeek sustituto (solo para el chat de solo texto).
async function startLlm(): Promise<{ url: string; close(): void }> {
  const llm: Server = createServer((req, res) => {
    let body = ""; req.on("data", (d) => (body += d));
    req.on("end", () => {
      const stream = (() => { try { return JSON.parse(body).stream; } catch { return false; } })();
      if (!stream) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content: REPLY }, finish_reason: "stop" }], usage: { total_tokens: 50 } }));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: REPLY } }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { total_tokens: 50 } })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((r) => llm.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(llm.address() as any).port}`, close: () => { llm.closeAllConnections(); llm.close(); } };
}

let agent: Agent;
let llm: { url: string; close(): void };
let app: { port: number; close(): Promise<void> | void };
let sockets: WebSocket[] = [];
let frames: { t: number; binary: boolean; data: Buffer }[] = [];

async function boot(env: Record<string, string> = {}, agentOpts: { delayMs?: number; dropFirst?: boolean } = {}) {
  agent = await startAgent(agentOpts); llm = await startLlm();
  const { startServer } = await import("../../server/index");
  app = await startServer({ port: 0, env: {
    DEEPGRAM_API_KEY: "test-key", DEEPSEEK_API_KEY: "test-key", DEEPGRAM_AGENT_URL: agent.url, DEEPSEEK_BASE_URL: llm.url,
    ALLOWED_ORIGINS: ORIGIN, ...env,
  } });
}
async function connect(): Promise<WebSocket> {
  const r = await fetch(`http://127.0.0.1:${app.port}/session`, { method: "POST", headers: { origin: ORIGIN } });
  const { token } = (await r.json()) as { token: string };
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/voice?token=${encodeURIComponent(token)}`, { headers: { origin: ORIGIN } });
  ws.on("message", (d, isBinary) => frames.push({ t: Date.now(), binary: isBinary, data: d as Buffer }));
  sockets.push(ws);
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
  return ws;
}
const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timeout esperando condición"); await new Promise((r) => setTimeout(r, 10)); }
};
const textFrames = () => frames.filter((f) => !f.binary).map((f) => f.data.toString());
const audioFrames = () => frames.filter((f) => f.binary);
const sent = (type: string) => agent.got.filter((m) => m.type === type);
const settings = () => sent("Settings")[0];
const notice = (re: RegExp) => textFrames().some((t) => /"Notice"/.test(t) && re.test(t));

beforeEach(() => { frames = []; sockets = []; });
afterEach(async () => { sockets.forEach((s) => s.terminate()); await app?.close(); await agent?.close(); llm?.close(); vi.restoreAllMocks(); });

describe("US-05 voz manos libres (Voice Agent)", () => {
  it("AC-05.1 fin de turno lo decide el Voice Agent (nova-3 es con keyterms); el audio fluye sin enviar nada más y llega la respuesta en voz", async () => {
    await boot();
    const ws = await connect();
    await until(() => sent("Settings").length > 0);
    const l = settings().agent.listen.provider;
    expect(l).toMatchObject({ type: "deepgram", model: "nova-3", language: "es" });
    expect(l.keyterms.length).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) ws.send(Buffer.alloc(2560));
    await until(() => agent.binFrames >= 5);
    // el agente declara el fin de turno y responde; el cliente no manda ningún otro mensaje
    agent.send({ type: "ConversationText", role: "user", content: "¿Qué contratos tiene la alcaldía de Medellín?" });
    agent.send({ type: "AgentStartedSpeaking" });
    agent.conns[0].send(Buffer.alloc(3200), { binary: true });
    await until(() => audioFrames().length > 0);
    expect(sent("InjectUserMessage")).toHaveLength(0);
  });

  it("AC-05.2 think = DeepSeek deepseek-flash a 0,2 por endpoint tipo OpenAI, speak = aura-2-celeste-es, y el mismo contenido en pantalla", async () => {
    await boot();
    const ws = await connect();
    await until(() => sent("Settings").length > 0);
    const think = settings().agent.think;
    expect(think.provider).toMatchObject({ type: "open_ai", model: "deepseek-flash", temperature: 0.2 });
    expect(think.endpoint.url).toMatch(/\/chat\/completions$/);
    expect(settings().agent.speak.provider.model).toBe("aura-2-celeste-es");
    ws.send(JSON.stringify({ type: "AskText", text: "hola" }));
    await until(() => textFrames().some((t) => t.includes("ConversationText") && t.includes("Encontré tres contratos")));
    await until(() => audioFrames().length > 0);
  });

  it("AC-05.3 UserStartedSpeaking llega al cliente de inmediato (menos de 200 ms) para vaciar el audio en cola", async () => {
    await boot();
    await connect();
    await until(() => sent("Settings").length > 0);
    const t0 = Date.now();
    agent.send({ type: "UserStartedSpeaking" });
    await until(() => textFrames().some((t) => t.includes("UserStartedSpeaking")), 200);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it("AC-05.4 sin acuse ni saludo de relleno (ni texto ni audio) aunque el agente tarde 1500 ms", async () => {
    await boot({}, { delayMs: 1500 });
    const ws = await connect();
    await until(() => sent("Settings").length > 0);
    expect(settings().agent.greeting).toBeUndefined();
    ws.send(JSON.stringify({ type: "AskText", text: "¿Qué contratos tiene Medellín?" }));
    await new Promise((r) => setTimeout(r, 1200));
    expect(audioFrames()).toHaveLength(0);
    expect(textFrames().join("\n")).not.toMatch(/d[eé]jame buscar|un momento|claro,|hola, soy/i);
    await until(() => textFrames().some((t) => t.includes("Encontré tres contratos")), 3000);
  });

  it("AC-05.5 si la sesión del agente se corta la reintenta y NO avisa mientras se recupera", async () => {
    await boot({ VOICE_RECONNECT_MS: "50" }, { dropFirst: true });
    const ws = await connect();
    await until(() => sent("Settings").length >= 2, 4000); // segunda sesión con su Settings
    ws.send(JSON.stringify({ type: "AskText", text: "hola" }));
    await until(() => textFrames().some((t) => t.includes("Encontré tres contratos")));
    expect(notice(/no est[aá] disponible|no disponible/i)).toBe(false);
  });

  it("AC-05.5 si no se puede recuperar avisa que la voz no está disponible y el chat por texto sigue funcionando", async () => {
    await boot({ DEEPGRAM_AGENT_URL: "ws://127.0.0.1:1/v1/agent/converse", VOICE_RECONNECT_MS: "50" });
    await connect();
    await until(() => notice(/voz/i) && notice(/no est[aá] disponible|no disponible/i), 6000);
    const r = await fetch(`http://127.0.0.1:${app.port}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hola" }) });
    expect(r.status).toBe(200);
  });

  it("AC-05.6 docs/VOZ.md documenta el desglose del Voice Agent (fin de turno, herramienta, primer audio), p95 < 1 s, meta ~2 s p50, una sola llamada a datos, < 1.500 tokens, fuentes y decisiones", () => {
    const path = join(__dirname, "../../docs/VOZ.md");
    expect(existsSync(path)).toBe(true);
    const md = readFileSync(path, "utf8");
    for (const etapa of [/voice agent/i, /fin de turno/i, /herramienta/i, /primer audio/i]) expect(md).toMatch(etapa);
    expect(md).not.toMatch(/flux-general-multi/i);
    expect(md).toMatch(/p95/i);
    expect(md).toMatch(/p50/i);
    expect(md).toMatch(/~?\s*2\s*s/i);
    expect(md).toMatch(/una sola llamada|1 llamada|una llamada/i);
    expect(md).toMatch(/1[.,]?500\s*tokens/i);
    expect(md).toMatch(/https?:\/\//);
    expect(md).toMatch(/decisi[oó]n|decisiones/i);
  });

  it("AC-05.7 no guarda audio ni transcripciones en disco ni en logs", async () => {
    const logged: string[] = [];
    const capture = (c: any) => { logged.push(typeof c === "string" ? c : Buffer.from(c).toString()); return true; };
    vi.spyOn(process.stdout, "write").mockImplementation(capture as any);
    vi.spyOn(process.stderr, "write").mockImplementation(capture as any);
    for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: any[]) => { logged.push(a.map(String).join(" ")); });
    const before = new Set(readdirSync(tmpdir()));
    await boot();
    const ws = await connect();
    await until(() => sent("Settings").length > 0);
    ws.send(Buffer.alloc(2560, 7));
    ws.send(JSON.stringify({ type: "AskText", text: `${MARKER} ¿qué contratos hay?` }));
    await until(() => audioFrames().length > 0);
    await new Promise((r) => setTimeout(r, 200));
    expect(logged.join("\n")).not.toContain(MARKER);
    for (const name of readdirSync(tmpdir())) {
      if (before.has(name)) continue;
      const p = join(tmpdir(), name);
      try { if (statSync(p).isFile() && readFileSync(p).includes(MARKER)) throw new Error(`fuga en ${p}`); } catch (e: any) { if (/fuga/.test(e.message)) throw e; }
    }
  });

  it("AC-05.9 spokenAmount habla las cifras en palabras", async () => {
    const { spokenAmount } = await import("../../server/speech/spoken");
    expect(spokenAmount(27_000_000_000)).toBe("27 mil millones de pesos");
    expect(spokenAmount(944_000_000_000)).toBe("944 mil millones de pesos");
    expect(spokenAmount(1_200_000_000_000)).toBe("un billón doscientos mil millones de pesos");
    expect(spokenAmount(944_000_000_000)).not.toMatch(/billones/i);
    expect(spokenAmount(1_200_000_000)).toMatch(/^mil doscientos millones de pesos$/);
    for (const n of [27_000_000_000, 1_200_000_000, 350_000_000]) expect(spokenAmount(n)).not.toMatch(/[$.]|\d{4}/);
  });

  it("AC-05.9 toSpoken: sin $, puntos de miles, códigos, mayúsculas crudas y máximo 2 frases", async () => {
    const { toSpoken } = await import("../../server/speech/spoken");
    const raw = "La ALCALDÍA DE CALI firmó el contrato CO1.PCCNTR.123 por $27.000.000.000 con CONSTRUCTORA ABC SAS. Es el más grande. Hay otros cuatro. Pregunta por cualquiera.";
    const out = toSpoken(raw);
    expect(out).not.toContain("$");
    expect(out).not.toMatch(/\d\.\d{3}/);
    expect(out).not.toMatch(/CO1|PCCNTR/);
    expect(out).not.toMatch(/\b[A-ZÁÉÍÓÚÑ]{3,}\b/);
    expect(out).toMatch(/27 mil millones/);
    expect((out.match(/[.!?](\s|$)/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("AC-05.8 al superar los 30 min de sesión (tope ajustable, por defecto 1800 s) pasa a texto con aviso claro", async () => {
    await boot({ VOICE_SESSION_MAX_SECONDS: "1" });
    await connect();
    await until(() => notice(/texto/i) && notice(/(l[ií]mite|tiempo|m[aá]ximo|tope)/i), 4000);
  });

  it("AC-05.8 el tope de sesión por defecto es 1800 s (30 min)", () => {
    const src = readFileSync(join(__dirname, "../../server/voice/agent.ts"), "utf8");
    expect(src).toMatch(/VOICE_SESSION_MAX_SECONDS,\s*1800\)/);
  });

  it("AC-05.8 al superar el tope diario de minutos de voz no abre voz y avisa que sigue por texto", async () => {
    await boot({ VOICE_DAILY_MAX_MINUTES: "0" });
    await connect();
    await until(() => notice(/texto/i), 3000);
    await new Promise((r) => setTimeout(r, 200));
    expect(agent.conns).toHaveLength(0); // no se gastó voz de Deepgram
  });
});
