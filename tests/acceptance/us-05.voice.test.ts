/**
 * US-05 Conversación por voz manos libres. Pruebas de aceptación (AC-05.1 .. AC-05.8).
 *
 * Todo corre en local: Deepgram (Flux STT + TTS WebSocket) y DeepSeek son sustitutos
 * definidos en este archivo, en puertos efímeros de 127.0.0.1. No hay llamadas externas.
 *
 * Contrato mínimo que asumen estas pruebas del servidor (documentado en el reporte de QA):
 *  - `server/index.ts` exporta `startServer({ port, env })` -> `{ port, close() }`.
 *  - `POST /session` devuelve `{ token }`; el WebSocket de voz es `/voice?token=...` con Origin permitido.
 *  - Cliente -> servidor: audio PCM como frames binarios; texto como JSON `{type:"message", text}`.
 *  - Servidor -> cliente: audio como frames binarios; el resto JSON (texto con la respuesta en algún campo).
 *  - URLs de los sustitutos por env: DEEPGRAM_STT_URL, DEEPGRAM_TTS_URL, DEEPSEEK_BASE_URL.
 *  - Topes por env: VOICE_SESSION_MAX_SECONDS, VOICE_DAILY_MAX_MINUTES.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, WebSocket, type RawData } from "ws";

const ORIGIN = "http://localhost:5173";
const REPLY = "Encontré tres contratos de ejemplo. Puedes pedir más detalle.";
const MARKER = "zafiro-secreto-4471"; // texto único de la "transcripción" para buscar fugas

interface Fakes {
  sttUrl: string; ttsUrl: string; llmUrl: string;
  sttQuery: URLSearchParams | null; ttsQuery: URLSearchParams | null;
  ttsMsgs: { t: number; msg: any }[];
  llmDelayMs: number;
  stt: WebSocket | null;
  sttAudioFrames: number;
  fireEndOfTurn(text: string): void;
  fireStartOfTurn(): void;
  close(): Promise<void>;
}

async function startFakes(opts: { llmDelayMs?: number } = {}): Promise<Fakes> {
  const f = { ttsMsgs: [], sttQuery: null, ttsQuery: null, stt: null, sttAudioFrames: 0, llmDelayMs: opts.llmDelayMs ?? 0 } as any as Fakes;
  const sttWss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  const ttsWss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  sttWss.on("connection", (ws, req) => {
    f.sttQuery = new URL(req.url!, "http://x").searchParams; f.stt = ws;
    ws.on("message", (_d, isBinary) => { if (isBinary) f.sttAudioFrames++; });
  });
  ttsWss.on("connection", (ws, req) => {
    f.ttsQuery = new URL(req.url!, "http://x").searchParams;
    ws.on("message", (d: RawData, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(d.toString());
      f.ttsMsgs.push({ t: Date.now(), msg });
      if (msg.type === "Speak" || msg.type === "Flush") {
        ws.send(Buffer.alloc(3200), { binary: true });
        if (msg.type === "Flush") ws.send(JSON.stringify({ type: "Flushed" }));
      }
    });
  });
  const llm: Server = createServer((req, res) => {
    req.resume();
    req.on("end", () => setTimeout(() => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (c: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`;
      res.write(chunk(REPLY.split(". ")[0] + ". "));
      res.write(chunk(REPLY.split(". ")[1]));
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { total_tokens: 50 } })}\n\ndata: [DONE]\n\n`);
    }, f.llmDelayMs));
  });
  await new Promise<void>((r) => llm.listen(0, "127.0.0.1", r));
  const p = (w: WebSocketServer) => (w.address() as any).port;
  f.sttUrl = `ws://127.0.0.1:${p(sttWss)}/v2/listen`;
  f.ttsUrl = `ws://127.0.0.1:${p(ttsWss)}/v1/speak`;
  f.llmUrl = `http://127.0.0.1:${(llm.address() as any).port}`;
  f.fireEndOfTurn = (text) => f.stt!.send(JSON.stringify({ type: "TurnInfo", event: "EndOfTurn", transcript: text, end_of_turn_confidence: 0.9 }));
  f.fireStartOfTurn = () => f.stt!.send(JSON.stringify({ type: "TurnInfo", event: "StartOfTurn", transcript: "" }));
  f.close = async () => { sttWss.close(); ttsWss.close(); llm.close(); };
  return f;
}

let fakes: Fakes;
let app: { port: number; close(): Promise<void> | void };
let socket: WebSocket | null;
let frames: { t: number; binary: boolean; data: Buffer }[];

async function boot(env: Record<string, string> = {}, fakeOpts: { llmDelayMs?: number } = {}, overrides: Partial<Record<"DEEPGRAM_STT_URL", string>> = {}) {
  fakes = await startFakes(fakeOpts);
  const { startServer } = await import("../../server/index");
  app = await startServer({
    port: 0,
    env: {
      DEEPGRAM_API_KEY: "test-key", DEEPSEEK_API_KEY: "test-key",
      DEEPGRAM_STT_URL: fakes.sttUrl, DEEPGRAM_TTS_URL: fakes.ttsUrl, DEEPSEEK_BASE_URL: fakes.llmUrl,
      ALLOWED_ORIGINS: ORIGIN, ...env, ...overrides,
    },
  });
}

async function connect(): Promise<WebSocket> {
  const r = await fetch(`http://127.0.0.1:${app.port}/session`, { method: "POST", headers: { origin: ORIGIN } });
  const { token } = (await r.json()) as { token: string };
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/voice?token=${encodeURIComponent(token)}`, { headers: { origin: ORIGIN } });
  frames = [];
  ws.on("message", (d, isBinary) => frames.push({ t: Date.now(), binary: isBinary, data: d as Buffer }));
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
  socket = ws;
  return ws;
}

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timeout esperando condición"); await new Promise((r) => setTimeout(r, 10)); }
};
const textFrames = () => frames.filter((f) => !f.binary).map((f) => f.data.toString());
const audioFrames = () => frames.filter((f) => f.binary);
const speakTexts = () => fakes.ttsMsgs.filter((m) => m.msg.type === "Speak").map((m) => String(m.msg.text));

beforeEach(() => { frames = []; socket = null; });
afterEach(async () => { socket?.terminate(); await app?.close(); await fakes?.close(); vi.restoreAllMocks(); });

describe("US-05 voz manos libres", () => {
  it("AC-05.1 fin de turno automático con Flux flux-general-multi, language_hint=es, y respuesta en voz sin más pasos", async () => {
    await boot();
    const ws = await connect();
    await until(() => fakes.stt !== null);
    expect(fakes.sttQuery!.get("model")).toBe("flux-general-multi");
    expect(fakes.sttQuery!.get("language_hint")).toBe("es");
    // el usuario habla: el audio llega a Flux mientras habla (transcribe en paralelo)
    for (let i = 0; i < 5; i++) ws.send(Buffer.alloc(2560));
    await until(() => fakes.sttAudioFrames >= 5);
    // Flux declara el fin de turno; no se envía ningún otro mensaje del cliente
    fakes.fireEndOfTurn("¿Qué contratos tiene la alcaldía de Medellín?");
    await until(() => audioFrames().length > 0);
    expect(speakTexts().join(" ")).toContain("Encontré tres contratos");
  });

  it("AC-05.2 habla con la primera frase útil (streaming por frases), una conexión TTS, voz fija aura-2, y el mismo contenido en pantalla", async () => {
    await boot();
    const ws = await connect();
    await until(() => fakes.stt !== null);
    fakes.fireEndOfTurn("hola");
    await until(() => speakTexts().length >= 1);
    // la primera frase se envía al TTS sin esperar a la respuesta completa
    expect(speakTexts()[0]).toContain("Encontré tres contratos");
    expect(["aura-2-celeste-es", "aura-2-gloria-es"]).toContain(fakes.ttsQuery!.get("model"));
    // un segundo turno reutiliza la misma conexión TTS (una por conversación)
    const q = fakes.ttsQuery;
    fakes.fireEndOfTurn("y en 2024?");
    await until(() => speakTexts().length >= 3);
    expect(fakes.ttsQuery).toBe(q);
    // el mismo contenido llega como texto al cliente
    await until(() => textFrames().some((t) => t.includes("Encontré tres contratos")));
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it("AC-05.3 al hablar encima del agente calla el audio en menos de 200 ms y escucha", async () => {
    await boot();
    await connect();
    await until(() => fakes.stt !== null);
    fakes.fireEndOfTurn("hola");
    await until(() => audioFrames().length > 0);
    const t0 = Date.now();
    fakes.fireStartOfTurn();
    await until(() => fakes.ttsMsgs.some((m) => m.msg.type === "Clear" && m.t >= t0), 200);
    expect(Date.now() - t0).toBeLessThan(200);
    // tras interrumpir, no llega más audio viejo al cliente
    const n = audioFrames().length;
    await new Promise((r) => setTimeout(r, 300));
    expect(audioFrames().length).toBe(n);
  });

  it("AC-05.4 si la consulta tarda más de 500 ms dice un acuse breve en lugar de silencio", async () => {
    await boot({}, { llmDelayMs: 1500 });
    await connect();
    await until(() => fakes.stt !== null);
    const t0 = Date.now();
    fakes.fireEndOfTurn("¿Qué contratos tiene Medellín?");
    // antes de que el LLM responda (1500 ms) ya se habló algo
    await until(() => speakTexts().length > 0, 1400);
    const firstSpoken = speakTexts()[0];
    expect(firstSpoken.length).toBeGreaterThan(0);
    expect(firstSpoken).not.toContain("Encontré tres contratos");
    expect(Date.now() - t0).toBeLessThan(1400);
  });

  it("AC-05.5 si el servicio de voz no responde avisa que la voz no está disponible y el chat por texto sigue funcionando", async () => {
    await boot({}, {}, { DEEPGRAM_STT_URL: "ws://127.0.0.1:1/v2/listen" }); // puerto cerrado
    const ws = await connect();
    await until(() => textFrames().some((t) => /voz/i.test(t) && /(no est[aá] disponible|no disponible)/i.test(t)));
    ws.send(JSON.stringify({ type: "message", text: "¿Qué contratos tiene Medellín?" }));
    await until(() => textFrames().some((t) => t.includes("Encontré tres contratos")));
  });

  it("AC-05.6 documenta en docs/VOZ.md el desglose de latencia, objetivos p95 < 1 s y p50 ~500 ms, fuentes y decisiones", () => {
    const path = join(__dirname, "../../docs/VOZ.md");
    expect(existsSync(path)).toBe(true);
    const md = readFileSync(path, "utf8");
    for (const etapa of [/fin de turno/i, /STT final/i, /primer token/i, /datos/i, /TTS/i, /primer audio/i]) expect(md).toMatch(etapa);
    expect(md).toMatch(/p95/i);
    expect(md).toMatch(/p50/i);
    expect(md).toMatch(/https?:\/\//); // fuentes citadas
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
    await until(() => fakes.stt !== null);
    ws.send(Buffer.alloc(2560, 7));
    fakes.fireEndOfTurn(`${MARKER} ¿qué contratos hay?`);
    await until(() => audioFrames().length > 0);
    await new Promise((r) => setTimeout(r, 200));
    expect(logged.join("\n")).not.toContain(MARKER);
    // ningún archivo nuevo en el directorio temporal contiene la transcripción
    for (const name of readdirSync(tmpdir())) {
      if (before.has(name)) continue;
      const p = join(tmpdir(), name);
      try { if (statSync(p).isFile() && readFileSync(p).includes(MARKER)) throw new Error(`fuga en ${p}`); } catch (e: any) { if (/fuga/.test(e.message)) throw e; }
    }
  });

  it("AC-05.8 al superar los 10 min de sesión (tope ajustable) pasa a texto con aviso claro", async () => {
    await boot({ VOICE_SESSION_MAX_SECONDS: "1" });
    const ws = await connect();
    await until(() => textFrames().some((t) => /texto/i.test(t) && /(l[ií]mite|tiempo|m[aá]ximo|tope)/i.test(t)), 4000);
    ws.send(JSON.stringify({ type: "message", text: "hola" }));
    await until(() => textFrames().some((t) => t.includes("Encontré tres contratos")));
  });

  it("AC-05.8 al superar el tope diario de minutos de voz no abre voz y avisa que sigue por texto", async () => {
    await boot({ VOICE_DAILY_MAX_MINUTES: "0" });
    const ws = await connect();
    await until(() => textFrames().some((t) => /texto/i.test(t)), 3000);
    ws.send(JSON.stringify({ type: "message", text: "hola" }));
    await until(() => textFrames().some((t) => t.includes("Encontré tres contratos")));
    expect(fakes.stt).toBeNull(); // no se gastó voz de Deepgram
  });
});
