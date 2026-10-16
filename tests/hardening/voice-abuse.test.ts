import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createVoice } from "../../server/voice/index";
import { createRateLimiter } from "../../server/guards/rate-limit";
import { createSessionCodec } from "../../server/session";
import { createApp } from "../../server/index";

const env = { ALLOWED_ORIGINS: "http://o.test", SESSION_SECRET: "s".repeat(32) };
const codec = createSessionCodec({ keys: { 1: "k".repeat(32) }, currentKeyVersion: 1 });
const ask = (async () => ({ text: "", cards: [], context: {} })) as never;

async function boot(guards: Parameters<typeof createVoice>[3]) {
  const v = createVoice(env, ask, codec, guards);
  const srv = createServer();
  v.attach(srv);
  await new Promise<void>((ok) => srv.listen(0, ok));
  const url = `ws://127.0.0.1:${(srv.address() as AddressInfo).port}/voice?token=${encodeURIComponent(v.newToken())}`;
  return { srv, url };
}
const tryConnect = (url: string) =>
  new Promise<"open" | "rejected">((ok) => {
    const ws = new WebSocket(url, { headers: { origin: "http://o.test" } });
    ws.on("open", () => { ws.close(); ok("open"); });
    ws.on("error", () => ok("rejected"));
    ws.on("unexpected-response", () => ok("rejected"));
  });

describe("abuso de voz", () => {
  it("el upgrade respeta el limite por IP", async () => {
    const { srv, url } = await boot({ limiter: createRateLimiter({ limit: 1 }) });
    expect(await tryConnect(url)).toBe("open");
    expect(await tryConnect(url)).toBe("rejected");
    srv.close(); srv.closeAllConnections();
  });
  it("sin demanda disponible se rechaza el upgrade", async () => {
    const { srv, url } = await boot({ demand: { record() {}, admit: () => ({ allowed: false, message: "Hay mucha demanda" }) } });
    expect(await tryConnect(url)).toBe("rejected");
    srv.close(); srv.closeAllConnections();
  });
  it("un mensaje mayor de 64 KB cierra la conexion", async () => {
    const { srv, url } = await boot({});
    const code = await new Promise<number>((ok) => {
      const ws = new WebSocket(url, { headers: { origin: "http://o.test" } });
      ws.on("open", () => ws.send("x".repeat(70_000)));
      ws.on("close", (c) => ok(c));
      ws.on("error", () => {});
    });
    expect(code).toBe(1009);
    srv.close(); srv.closeAllConnections();
  });
  it("POST /session tiene limite por IP", async () => {
    const { app } = createApp({ MOCK_EXTERNALS: "1", RATE_LIMIT_PER_MIN: "2", ALLOWED_ORIGINS: "http://o.test" });
    const post = () => app.request("/session", { method: "POST", headers: { origin: "http://o.test", "x-forwarded-for": "9.9.9.9" } });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(429);
  });
});
