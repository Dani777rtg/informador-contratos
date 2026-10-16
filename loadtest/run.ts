// Prueba de carga LOCAL (nunca en la nube): backend en este proceso con MOCK_EXTERNALS=1.
// Uso: npm run loadtest:local  [escalones separados por coma, p. ej. 10,100]
import net from "node:net";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

// Latencias representativas de los sustitutos (ms); sobreescribibles por env.
process.env.MOCK_LATENCY_MS_SOCRATA ??= "150";
process.env.MOCK_LATENCY_MS_DEEPSEEK ??= "800";
process.env.MOCK_LATENCY_MS_DEEPGRAM ??= "100";
process.env.MOCK_LATENCY_MS_WHATSAPP ??= "300";

// AC-12.2: contador de salidas a hosts que no son loopback (fetch, WebSocket y sockets TCP).
let outbound = 0;
const local = (h: string) => /^(localhost|127\.0\.0\.1|\[?::1\]?|mock\.local)$/.test(h);
const hostOf = (u: string | URL | Request) => { try { return new URL(typeof u === "string" || u instanceof URL ? u : u.url, "http://localhost").hostname; } catch { return "?"; } };
const realFetch = globalThis.fetch;
globalThis.fetch = ((u: Parameters<typeof fetch>[0], i?: RequestInit) => { if (!local(hostOf(u))) outbound++; return realFetch(u, i); }) as typeof fetch;
const RealWS = globalThis.WebSocket;
globalThis.WebSocket = class extends RealWS { constructor(u: string | URL, p?: string | string[]) { if (!local(hostOf(u))) outbound++; super(u, p); } } as typeof WebSocket;
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...a: unknown[]) {
  const o = a[0] as { host?: string; path?: string } | number | string;
  const host = typeof o === "object" && o ? o.host : typeof a[1] === "string" ? a[1] : undefined;
  if (host && !local(host)) outbound++;
  return (realConnect as (...x: unknown[]) => net.Socket).apply(this, a);
} as typeof net.Socket.prototype.connect;

const { startServer } = await import("../server/index.js");
const srv = await startServer({ port: 0, env: { MOCK_EXTERNALS: "1", RATE_LIMIT_PER_MIN: "100000000" } });
const base = `http://127.0.0.1:${srv.port}`;
const QUESTIONS = ["contratos de la Alcaldía de Cali", "¿en qué gasta la Gobernación de Antioquia?", "contratos más grandes de la Alcaldía de Medellín", "alumbrado publico", "de donde vienen los recursos de la Alcaldía de Bogotá"];
const kinds: Record<string, number> = {}; const PER_USER = 5, pct = (a: number[], p: number) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

async function step(users: number) {
  const lat: number[] = []; let errors = 0, reqs = 0;
  const h = monitorEventLoopDelay(); h.enable();
  const cpu0 = process.cpuUsage(), t0 = performance.now();
  await Promise.all(Array.from({ length: users }, async (_, u) => {
    for (let k = 0; k < PER_USER; k++) {
      const s = performance.now(); reqs++;
      try {
        const r = await realFetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: QUESTIONS[(u + k) % QUESTIONS.length] }), signal: AbortSignal.timeout(30_000) });
        await r.text(); if (!r.ok) { errors++; kinds["HTTP " + r.status] = (kinds["HTTP " + r.status] ?? 0) + 1; }
      } catch (e) { errors++; kinds[String((e as Error).cause && ((e as {cause:{code?:string}}).cause.code) || (e as Error).name)] = (kinds[String((e as Error).cause && ((e as {cause:{code?:string}}).cause.code) || (e as Error).name)] ?? 0) + 1; }
      lat.push(performance.now() - s);
    }
  }));
  const wall = (performance.now() - t0) / 1000, c = process.cpuUsage(cpu0); h.disable();
  const cpuS = (c.user + c.system) / 1e6;
  lat.sort((a, b) => a - b);
  // Costo Cloud Run estimado (precios de lista us-central1, a verificar): 0,000024 USD/vCPU-s, 0,0000025 USD/GiB-s (0,5 GiB), 0,40 USD/millón de peticiones.
  const cost = cpuS * 0.000024 + wall * 0.5 * 0.0000025 + reqs * 0.4e-6;
  return { users, reqs, errors, errorRate: errors / reqs, p50: pct(lat, 0.5), p95: pct(lat, 0.95), rps: reqs / wall, cpuUtil: cpuS / wall, loopLagP95: h.percentile(95) / 1e6, costUsd: cost };
}

const steps = (process.argv[2] ?? "10,100,500,1000").split(",").map(Number);
const out: Awaited<ReturnType<typeof step>>[] = [];
let breaking: number | null = null;
for (const n of steps) {
  const r = await step(n); out.push(r);
  console.log(`${n} usuarios: p50 ${r.p50.toFixed(0)} ms, p95 ${r.p95.toFixed(0)} ms, errores ${r.errors}/${r.reqs}, ${r.rps.toFixed(0)} req/s, CPU ${(r.cpuUtil * 100).toFixed(0)}%, lag bucle p95 ${r.loopLagP95.toFixed(0)} ms, costo ~USD ${r.costUsd.toFixed(5)}`, JSON.stringify(kinds));
  if (r.errorRate > 0.01 || r.p95 > 5000) { breaking ??= n; }
}
await srv.close();
const res = { outboundCalls: outbound, breakingPoint: breaking, mocks: { socrata: process.env.MOCK_LATENCY_MS_SOCRATA, deepseek: process.env.MOCK_LATENCY_MS_DEEPSEEK, deepgram: process.env.MOCK_LATENCY_MS_DEEPGRAM, whatsapp: process.env.MOCK_LATENCY_MS_WHATSAPP }, steps: out };
writeFileSync(new URL("./resultado.json", import.meta.url), JSON.stringify(res, null, 2));
console.log(`llamadas salientes a servicios externos: ${outbound}; punto de quiebre: ${breaking ?? "no alcanzado"}`);
process.exit(outbound === 0 ? 0 : 1);
