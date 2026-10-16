import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { createVoice } from "../../server/voice/index";
import { createSessionCodec } from "../../server/session";

const codec = createSessionCodec({ keys: { 1: "k".repeat(32) }, currentKeyVersion: 1 });
const ask = (async () => ({ text: "", cards: [], context: {} })) as never;
const servers: Server[] = [];
afterEach(() => { servers.splice(0).forEach((s) => { s.close(); s.closeAllConnections(); }); });
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Sustituto de Deepgram: cierra con 1011 si pasan idleMs sin recibir NINGÚN dato (audio o KeepAlive). */
async function fakeDeepgram(idleMs: number, onConn?: (ws: WebSocket) => void) {
  const srv = createServer(); servers.push(srv);
  const wss = new WebSocketServer({ server: srv });
  const seen = { conns: 0, keepAlives: 0, closes: [] as number[] };
  wss.on("connection", (ws) => {
    seen.conns++;
    let t = setTimeout(() => ws.close(1011, "NET-0001"), idleMs);
    ws.on("message", (d, bin) => {
      clearTimeout(t); t = setTimeout(() => ws.close(1011, "NET-0001"), idleMs);
      if (bin) seen.keepAlives++; // Flux rechaza el KeepAlive de texto: la señal de vida es silencio PCM
      else expect(JSON.parse(d.toString()).type).not.toBe("KeepAlive");
    });
    ws.on("close", (c) => { clearTimeout(t); seen.closes.push(c); });
    onConn?.(ws);
  });
  await new Promise<void>((ok) => srv.listen(0, ok));
  return { seen, url: `ws://127.0.0.1:${(srv.address() as AddressInfo).port}` };
}

async function connect(sttUrl: string) {
  const v = createVoice({ ALLOWED_ORIGINS: "http://o.test", SESSION_SECRET: "s".repeat(32), DEEPGRAM_STT_URL: sttUrl, VOICE_KEEPALIVE_MS: "100", VOICE_RECONNECT_MS: "20" }, ask, codec);
  const srv = createServer(); servers.push(srv);
  v.attach(srv);
  await new Promise<void>((ok) => srv.listen(0, ok));
  const ws = new WebSocket(`ws://127.0.0.1:${(srv.address() as AddressInfo).port}/voice?token=${encodeURIComponent(v.newToken())}`, { headers: { origin: "http://o.test" } });
  const notices: string[] = [];
  ws.on("message", (d, bin) => { if (!bin) { const m = JSON.parse(d.toString()); if (m.type === "notice") notices.push(m.text); } });
  await new Promise((ok) => ws.once("open", ok));
  return { ws, notices };
}

describe("voz: Deepgram cierra por inactividad (1011 / NET-0001)", () => {
  it("el KeepAlive de texto mantiene viva la conexion STT mientras el cliente esta en pausa", async () => {
    const dg = await fakeDeepgram(400);
    const { ws, notices } = await connect(dg.url);
    await sleep(100);
    ws.send(Buffer.alloc(2560)); // 80 ms de silencio PCM
    await sleep(1500); // pausa > idle de Deepgram
    expect(dg.seen.closes).toEqual([]);
    expect(dg.seen.conns).toBe(1);
    expect(dg.seen.keepAlives).toBeGreaterThan(3);
    expect(notices).toEqual([]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("si Deepgram cierra igual, reconecta sin avisar al usuario", async () => {
    let first = true;
    const dg = await fakeDeepgram(60_000, (s) => { if (first) { first = false; setTimeout(() => s.close(1011, "NET-0001"), 300); } });
    const { ws, notices } = await connect(dg.url);
    await sleep(1200);
    expect(dg.seen.conns).toBe(2);
    expect(notices).toEqual([]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("solo avisa cuando fallan los reintentos", async () => {
    const { ws, notices } = await connect("ws://127.0.0.1:1");
    await sleep(1500);
    expect(notices).toEqual(["La voz no está disponible por ahora; seguimos por texto."]);
    ws.close();
  });
});
