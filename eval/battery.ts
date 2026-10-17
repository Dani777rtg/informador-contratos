// Batería de ~200 preguntas ciudadanas juzgadas por DeepSeek (eval/judge.ts).
// Uso: npm run eval:battery -- --model <deepseek-flash|deepseek-v4-pro> [--target <url>] [--env-file=<ruta>] [--concurrency N] [--only <regex de ids>]
// Sin --target levanta el servidor local con ese modelo; con --target consulta esa URL (el modelo lo fija esa instancia; --model solo etiqueta y tarifa).
// Escribe eval/battery-results-<modelo>.json { runAt, model, results, okRate, p50, p95, costPerQ }.
import { readFileSync, writeFileSync } from "node:fs";
import { judge } from "./judge";

interface Q { id: string; question: string; after?: string; expect: unknown }
interface Reply { period?: unknown; text?: string; cards?: unknown[]; state?: string; tokens?: number; filters?: unknown; toolCalls?: { name: string; args: unknown }[]; error?: string }
interface Result { id: string; question: string; ok: boolean; motivo: string; ms: number; tokens: number; text: string }

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3); };
const envFile = arg("env-file");
if (envFile) process.loadEnvFile(envFile);
const model = arg("model") ?? "deepseek-flash";
const target = arg("target")?.replace(/\/$/, "");
const concurrency = Number(arg("concurrency") ?? 4);
const only = arg("only") ? new RegExp(arg("only")!) : undefined;
// Tarifa USD por 1M tokens (https://api-docs.deepseek.com/quick_start/pricing, hora pico, cache miss).
// El servidor solo informa tokens totales: se asume 90 % entrada / 10 % salida (el prompt y los datos dominan).
const RATES: Record<string, { in: number; out: number }> = { "deepseek-flash": { in: 0.3, out: 1.2 }, "deepseek-v4-pro": { in: 1.32, out: 3.96 } };
const rate = RATES[model] ?? RATES["deepseek-flash"]!;
const usdPerToken = (0.9 * rate.in + 0.1 * rate.out) / 1e6;

const questions = (JSON.parse(readFileSync(new URL("./battery.json", import.meta.url), "utf8")) as Q[]).filter((q) => !only || only.test(q.id));
const ORIGIN = "http://localhost:5173";
let close = async (): Promise<void> => {};
let base = target;
if (!base) {
  const { startServer } = await import("../server/index");
  const s = await startServer({ port: 0, env: { ...process.env, DEEPSEEK_MODEL: model, RATE_LIMIT_PER_MIN: "100000", ALLOWED_ORIGINS: ORIGIN } as Record<string, string> });
  base = `http://127.0.0.1:${s.port}`;
  close = () => s.close();
}

const states = new Map<string, Promise<string | undefined>>();
async function runOne(q: Q, publish: (s: string | undefined) => void): Promise<Result> {
  const state = q.after ? await states.get(q.after) : undefined;
  const t0 = Date.now();
  let r: Reply = {};
  let failure = "";
  try {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: q.question, state }), signal: AbortSignal.timeout(120_000) });
    r = (await res.json()) as Reply;
    if (!res.ok) failure = `HTTP ${res.status}`;
  } catch (e) { failure = `excepción: ${e instanceof Error ? e.message : String(e)}`; }
  const ms = Date.now() - t0;
  publish(r.state);
  const text = r.text ?? "";
  const v = failure ? { ok: false, motivo: failure } : await judge({ question: q.question, expect: q.expect, toolCalls: r.toolCalls ?? [], data: { cards: r.cards ?? [], filters: r.filters, period: r.period }, answer: text });
  return { id: q.id, question: q.question, ok: v.ok, motivo: v.motivo, ms, tokens: r.tokens ?? 0, text };
}

// Cola con concurrencia moderada; una pregunta con `after` espera a su anterior (ya en curso o terminada).
const results: Result[] = [];
const queue = [...questions];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
  for (let q = queue.shift(); q; q = queue.shift()) {
    // La cola respeta el orden del archivo: el padre (`after`) ya salió antes, y `states` lo espera.
    let publish!: (s: string | undefined) => void;
    states.set(q.id, new Promise((ok) => { publish = ok; }));
    const r = await runOne(q, publish);
    results.push(r);
    console.log(`${r.ok ? "ok   " : "FALLA"} ${r.id.padEnd(5)} ${String(r.ms).padStart(6)} ms  ${r.question}${r.ok ? "" : `  -> ${r.motivo}`}`);
  }
}));

const order = new Map(questions.map((q, i) => [q.id, i]));
results.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const ms = results.map((r) => r.ms);
const okRate = results.filter((r) => r.ok).length / Math.max(1, results.length);
const costPerQ = (results.reduce((n, r) => n + r.tokens, 0) / Math.max(1, results.length)) * usdPerToken;
const out = { runAt: new Date().toISOString(), model, target: target ?? "local", results, okRate, p50: pct(ms, 0.5), p95: pct(ms, 0.95), costPerQ };
writeFileSync(new URL(`./battery-results-${model}.json`, import.meta.url), JSON.stringify(out, null, 1));
console.log(`\neval:battery ${model}: ${results.filter((r) => r.ok).length}/${results.length} ok (${Math.round(100 * okRate)} %) | p50 ${out.p50} ms, p95 ${out.p95} ms | ~USD ${costPerQ.toFixed(5)} por pregunta`);
await close();
process.exit(0);
