import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createApp, startServer } from "../../server/index";
import { createSessionCodec } from "../../server/session";

const env = { MOCK_EXTERNALS: "1", HMAC_SECRET: "s".repeat(32) };
const post = (app: ReturnType<typeof createApp>["app"], body: string, headers: Record<string, string> = {}) =>
  app.request("/api/chat", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

describe("/api/chat endurecido", () => {
  const { app } = createApp(env);
  it("cuerpo null o no-objeto da 400, no 500", async () => {
    for (const b of ["null", "5", "[]", "\"x\"", "no es json"]) expect((await post(app, b)).status, b).toBe(400);
  });
  it("cuerpo mayor de 8 KB da 413", async () => {
    expect((await post(app, JSON.stringify({ message: "a", pad: "x".repeat(9000) }))).status).toBe(413);
  });
  it("state desmesurado se ignora (conversación nueva)", async () => {
    const r = await post(app, JSON.stringify({ message: "contratos de la alcaldia de cali", state: "a".repeat(5000) }));
    expect(r.status).toBe(200);
  });
  it("límite de 30 turnos derivado del estado firmado", async () => {
    const codec = createSessionCodec({ keys: { 1: env.HMAC_SECRET }, currentKeyVersion: 1 });
    const r = await post(app, JSON.stringify({ message: "hola", state: codec.sign({ turns: 30 }) }));
    expect(r.status).toBe(400);
    const ok = await post(app, JSON.stringify({ message: "contratos de la alcaldia de cali", state: codec.sign({ turns: 29 }) }));
    expect(ok.status).toBe(200);
    const next = codec.verify(((await ok.json()) as { state: string }).state);
    expect(next?.turns).toBe(30);
  });
});

it("se niega a arrancar con MOCK_EXTERNALS=1 en producción", () => {
  expect(() => createApp({ ...env, NODE_ENV: "production" })).toThrow(/MOCK_EXTERNALS/);
});

it("el mock de Deepgram sobrevive a frames no-JSON y a rutas desconocidas", async () => {
  const s = await startServer({ port: 0, env });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/__mock/deepgram/stt`);
    await new Promise((ok) => ws.once("open", ok));
    const closed = new Promise<number>((ok) => ws.once("close", ok));
    ws.send("esto no es json");
    expect(await closed).toBe(1003);
    const bad = new WebSocket(`ws://127.0.0.1:${s.port}/nada`);
    await new Promise((ok) => bad.once("error", ok));
    expect((await fetch(`http://127.0.0.1:${s.port}/health`)).ok).toBe(true);
  } finally { await s.close(); }
});
