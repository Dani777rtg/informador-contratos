// Evaluación con datos reales (datos.gov.co + DeepSeek). Uso: npm run eval:real -- --env-file=<ruta al .env>
// Escribe eval/real-results.json {runAt, results:[{id, ok, text, source, ms, tokens, reason?}]} y sale con 1 si < 90 % ok.
import { readFileSync, writeFileSync } from "node:fs";
import { createApp } from "../server/index";
import { normalize } from "../server/data/socrata";

interface Expect { entity?: string; ciudad?: string; departamento?: string; tema?: string; kind?: string }
interface Q { id: string; question: string; after?: string; channel?: "voz" | "texto"; expect: Expect }
interface Card { kind: string; entity?: string; city?: string; department?: string; object?: string; name?: string }
interface Reply { text: string; spoken?: string; cards: Card[]; state?: string; source?: { dataset: string; queriedAt: string }; tokens?: number; filters?: Record<string, string | undefined> }

const envFile = process.argv.find((a) => a.startsWith("--env-file="))?.slice(11);
if (envFile) process.loadEnvFile(envFile);
const questions = JSON.parse(readFileSync(new URL("./real-questions.json", import.meta.url), "utf8")) as Q[];
const { chat } = createApp({ ...process.env, RATE_LIMIT_PER_MIN: "1000" });
const rx = (s: string) => new RegExp(s, "i"); // patrones sin tildes y en minúscula; el texto comparado va normalizado
const ROW_KINDS = new Set(["contract", "top"]);

/** Motivo de falla o undefined si la respuesta corresponde a la entidad/territorio/tema/intención pedidos. */
function check(r: Reply, e: Expect): string | undefined {
  const raw = JSON.stringify(r);
  if (/DSML|｜/.test(raw)) return "marcado interno DSML en la respuesta";
  if (!r.source?.dataset || !r.source.queriedAt) return "sin fuente";
  if (/\$\d{1,3}(\.\d{3}){2,}/.test(r.text)) return `el texto trae un monto exacto en vez de la cifra redondeada: ${r.text.slice(0, 100)}`;
  if (!r.cards?.length) return `sin tarjetas: ${r.text.slice(0, 120)}`;
  if (e.kind && !r.cards.some((c) => c.kind === e.kind)) return `se esperaba tarjetas "${e.kind}" y llegó ${[...new Set(r.cards.map((c) => c.kind))].join(",")}`;
  const rows = r.cards.filter((c) => ROW_KINDS.has(c.kind));
  const scope = normalize(`${JSON.stringify(r.filters ?? {})} ${r.text}`);
  for (const [i, c] of rows.entries()) {
    if (e.ciudad && normalize(c.city ?? "") !== normalize(e.ciudad)) return `tarjeta ${i + 1}: ciudad "${c.city}" != ${e.ciudad}`;
    if (e.departamento && normalize(c.department ?? "") !== normalize(e.departamento)) return `tarjeta ${i + 1}: departamento "${c.department}" != ${e.departamento}`;
    if (e.entity && !rx(e.entity).test(normalize(c.entity ?? ""))) return `tarjeta ${i + 1}: entidad "${c.entity}" no coincide con ${e.entity}`;
    if (e.tema && !rx(e.tema).test(normalize(c.object ?? c.name ?? ""))) return `tarjeta ${i + 1}: objeto no menciona ${e.tema}`;
  }
  // Tarjetas agregadas no traen territorio: el alcance declarado (filtros usados + texto) debe nombrarlo.
  if (!rows.length) {
    for (const k of ["ciudad", "departamento", "entity", "tema"] as const) if (e[k] && !(k === "ciudad" || k === "departamento" ? scope.includes(normalize(e[k]!)) : rx(e[k]!).test(scope))) return `el alcance declarado no menciona ${k}=${e[k]} (filtros: ${JSON.stringify(r.filters)})`;
  }
  return undefined;
}

/** Texto hablado: sin "$", sin cifras agrupadas ni decimales, sin muletillas, sin mayúsculas crudas, máximo 2 frases. */
function checkSpoken(s?: string): string | undefined {
  if (!s) return "sin texto hablado";
  if (/\$|\d{1,3}([.,]\d{3})+|\d[.,]\d/.test(s)) return `spoken con cifras sin palabras: ${s.slice(0, 120)}`;
  if (/d[eé]jame buscar|claro,|un momento|no la puedo atender|no puedo atender/i.test(s)) return `spoken con muletilla o rechazo: ${s.slice(0, 120)}`;
  if (/\b[A-ZÁÉÍÓÚÑ]{3,}\b/.test(s) && !/\b(SECOP|NIT)\b/.test(s)) return `spoken con mayúsculas crudas: ${s.slice(0, 120)}`;
  if ((s.match(/[.!?](\s|$)/g) ?? []).length > 2) return "spoken con más de 2 frases";
  return undefined;
}
const pct =(xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const states = new Map<string, string | undefined>();
const results: { id: string; ok: boolean; text: string; spoken?: string; source: Reply["source"]; ms: number; tokens: number; reason?: string }[] = [];
for (const q of questions) {
  const t0 = Date.now();
  let r: Reply = { text: "", cards: [] };
  let reason: string | undefined;
  try {
    r = (await chat(q.question, q.after ? states.get(q.after) : undefined, q.channel === "voz" ? "voz" : "texto")) as unknown as Reply;
    states.set(q.id, r.state);
    reason = check(r, q.expect) ?? (q.channel === "voz" ? checkSpoken(r.spoken) : undefined);
  } catch (e) { reason = `excepción: ${e instanceof Error ? e.message : String(e)}`; }
  const ms = Date.now() - t0, tokens = r.tokens ?? 0;
  results.push({ id: q.id, ok: !reason, text: r.text, ...(q.channel === "voz" ? { spoken: r.spoken } : {}), source: r.source, ms, tokens, ...(reason ? { reason } : {}) });
  console.log(`${reason ? "FALLA" : "ok   "} ${q.id.padEnd(24)} ${String(ms).padStart(6)} ms ${String(tokens).padStart(6)} tok${reason ? `  ${reason}` : ""}`);
}
writeFileSync(new URL("./real-results.json", import.meta.url), JSON.stringify({ runAt: new Date().toISOString(), results }, null, 1));
const ok = results.filter((x) => x.ok).length, ms = results.map((x) => x.ms);
const agent = results.filter((x) => x.tokens > 0);
console.log(`\neval:real ${ok}/${results.length} ok (${Math.round((100 * ok) / results.length)} %) | p50 ${pct(ms, 0.5)} ms, p95 ${pct(ms, 0.95)} ms | tokens medios (agente) ${agent.length ? Math.round(agent.reduce((a, x) => a + x.tokens, 0) / agent.length) : 0}`);
process.exit(ok / results.length >= 0.9 ? 0 : 1);
