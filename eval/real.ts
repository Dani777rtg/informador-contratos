// Evaluación con datos reales (datos.gov.co + DeepSeek + Voice Agent de Deepgram). Uso: npm run eval:real -- --env-file=<ruta al .env>
// Texto: POST /api/chat. Voz: sesión real del Voice Agent por /voice con el texto inyectado por AskText (sin audio).
// Escribe eval/real-results.json {runAt, results, conversations} y sale con 1 si < 90 % ok.
import { readFileSync, writeFileSync } from "node:fs";
import { WebSocket } from "ws";
import { startServer } from "../server/index";
import { decline } from "../server/agent/decline";
import { normalize, } from "../server/data/socrata";

interface Expect { entity?: string; ciudad?: string; departamento?: string; tema?: string; kind?: string; failure?: boolean; decline?: string; followup?: boolean }
interface Q { id: string; question: string; after?: string; channel?: "voz" | "texto"; fail?: boolean; expect: Expect }
interface Conv { id: string; turns: { channel: "voz" | "texto"; question: string; fail?: boolean; expect: Expect }[] }
interface Card { kind: string; entity?: string; city?: string; department?: string; object?: string; name?: string }
interface Reply { text: string; spoken?: string; cards: Card[]; state?: string; source?: { dataset: string; queriedAt: string }; tokens?: number; filters?: Record<string, string | undefined> }

const envFile = process.argv.find((a) => a.startsWith("--env-file="))?.slice(11);
if (envFile) process.loadEnvFile(envFile);
const load = <T>(f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8")) as T;
// EVAL_ONLY=<regex de ids>: corrida parcial para depurar (no escribe real-results.json).
const only = process.env.EVAL_ONLY ? new RegExp(process.env.EVAL_ONLY) : undefined;
const questions = load<Q[]>("./real-questions.json").filter((q) => !only || only.test(q.id));
const conversations = load<Conv[]>("./real-conversations.json").filter((c) => !only || only.test(c.id));
const ORIGIN = "http://localhost:5173";
const baseEnv = { ...process.env, RATE_LIMIT_PER_MIN: "10000", ALLOWED_ORIGINS: ORIGIN, VOICE_MAX_PER_IP: "50", VOICE_MAX_SESSIONS: "50", VOICE_DAILY_MAX_MINUTES: "1000", VOICE_SESSION_MAX_SECONDS: "1200" };
const rx = (s: string) => new RegExp(s, "i"); // patrones sin tildes y en minúscula; el texto comparado va normalizado
const ROW_KINDS = new Set(["contract", "top"]);
const DATASET = "SECOP II - Contratos Electrónicos (datos.gov.co)";

/** Motivo de falla o undefined si la respuesta corresponde a la entidad/territorio/tema/intención pedidos. */
const MOJIBAKE = /[ÃÂ][\u0080-¿]|ã[³¡©­º±]|â€/;
const FILLER = /\bvoy a (consultar|buscar|revisar|verificar)|d[eé]jame (buscar|consultar)|un momento|perm[ií]teme/i;
const TEMPLATE_ONLY = /^\s*Estos son los resultados de tu consulta, con datos oficiales de SECOP\.?\s*$/i;
/** Mayor valor en pesos de las tarjetas ("$944.000.000.000 COP"). */
const maxValue = (cards: Card[]): number => Math.max(0, ...cards.flatMap((c) => Object.values(c).filter((v): v is string => typeof v === "string" && /^\$[\d.]+( COP)?$/.test(v)).map((v) => Number(v.replace(/\D/g, "")))));
function check(r: Reply, e: Expect, channel: "voz" | "texto"): string | undefined {
  const raw = JSON.stringify(r);
  if (/DSML|｜/.test(raw)) return "marcado interno DSML en la respuesta";
  if (MOJIBAKE.test(raw)) return `texto con codificación rota (mojibake): ${r.text.slice(0, 120)}`;
  if (TEMPLATE_ONLY.test(r.text)) return "respuesta que es solo la plantilla, sin dato";
  if (!e.failure && FILLER.test(r.text)) return `respuesta sin dato (solo anuncia que va a consultar): ${r.text.slice(0, 120)}`;
  if (e.failure) return /no pude|no respond|no est[aá] disponible|precalculada|datos de respaldo|no en vivo/i.test(r.text) ? undefined : `falla de datos sin mensaje honesto: ${r.text.slice(0, 120)}`;
  if (e.decline) {
    const codes = Array.from({ length: 16 }, (_, i) => `NO-${String(i + 1).padStart(2, "0")}`).filter((c) => new RegExp(`^${e.decline}$`).test(c));
    // NO-10 (fuera de tema): también vale una redirección propia del modelo a la contratación pública, sin tarjetas.
    const redirects = codes.includes("NO-10") && !r.cards?.length && /contrataci[oó]n p[uú]blica/i.test(r.text);
    return redirects || codes.some((c) => r.text === decline(c) || (channel === "voz" && r.text.includes(decline(c)))) ? undefined : `se esperaba declinar (${e.decline}) y llegó: ${r.text.slice(0, 120)}`;
  }
  // `followup`: se responde con lo ya mostrado en pantalla (sin consulta nueva), así que no hay tarjetas ni fuente nuevas.
  if (e.followup) {
    if (r.text.trim().length < 15) return "seguimiento sin texto";
    if (/no pude|no encontr|no tengo|sin resultados|no respond|no est[aá] disponible|no hay datos/i.test(r.text)) return `seguimiento con frase de falla: ${r.text.slice(0, 120)}`;
    return channel === "voz" ? checkSpoken(r.spoken) : undefined;
  }
  if (!r.source?.dataset || !r.source.queriedAt) return "sin fuente";
  if (/\$\d{1,3}(\.\d{3}){2,}/.test(r.text)) return `el texto trae un monto exacto en vez de la cifra redondeada: ${r.text.slice(0, 100)}`;
  if (/declin|no puedo (ayudar|atender)|NO-\d\d/i.test(r.text) && !r.cards?.length) return `declinó una consulta válida: ${r.text.slice(0, 120)}`;
  if (!r.cards?.length) return `sin tarjetas: ${r.text.slice(0, 120)}`;
  // `kind` admite alternativas ("spend|total"): el agente elige la herramienta; lo que se exige es el alcance correcto.
  if (e.kind && !r.cards.some((c) => e.kind!.split("|").includes(c.kind))) return `se esperaba tarjetas "${e.kind}" y llegó ${[...new Set(r.cards.map((c) => c.kind))].join(",")}`;
  const rows = r.cards.filter((c) => ROW_KINDS.has(c.kind));
  const scope = normalize(`${JSON.stringify(r.filters ?? {})} ${r.text}`);
  for (const [i, c] of rows.entries()) {
    // "No Definido": el contrato no declara lugar propio; el filtro es el de la entidad compradora.
    // Solo vale si el alcance declarado (filtros usados; en voz, lo dicho) trae el municipio o la entidad pedidos.
    const declared = normalize(`${JSON.stringify(r.filters ?? {})} ${channel === "voz" ? r.text : ""}`);
    const undef = (s?: string) => (!s || /^no (definido|aplica)/i.test(s)) && (!e.ciudad || declared.includes(normalize(e.ciudad)));
    if (e.ciudad && !undef(c.city) && normalize(c.city ?? "") !== normalize(e.ciudad)) return `tarjeta ${i + 1}: ciudad "${c.city}" != ${e.ciudad}`;
    if (e.departamento && !undef(c.department) && normalize(c.department ?? "") !== normalize(e.departamento)) return `tarjeta ${i + 1}: departamento "${c.department}" != ${e.departamento}`;
    if (e.entity && !rx(e.entity).test(normalize(c.entity ?? ""))) return `tarjeta ${i + 1}: entidad "${c.entity}" no coincide con ${e.entity}`;
    if (e.tema && !rx(e.tema).test(normalize(c.object ?? c.name ?? ""))) return `tarjeta ${i + 1}: objeto no menciona ${e.tema}`;
  }
  // Tarjetas agregadas no traen territorio: el alcance declarado (filtros usados + texto) debe nombrarlo.
  if (!rows.length) {
    for (const k of ["ciudad", "departamento", "entity", "tema"] as const) if (e[k] && !(k === "ciudad" || k === "departamento" ? scope.includes(normalize(e[k]!)) : rx(e[k]!).test(scope))) return `el alcance declarado no menciona ${k}=${e[k]} (filtros: ${JSON.stringify(r.filters)})`;
  }
  return channel === "voz" ? checkSpoken(r.spoken, maxValue(r.cards)) : undefined;
}

/** Texto hablado: sin "$", sin cifras agrupadas ni decimales, sin muletillas, sin mayúsculas crudas, máximo 2 frases. */
function checkSpoken(s?: string, maxCard = 0): string | undefined {
  if (!s) return "sin texto hablado";
  if (FILLER.test(s)) return `spoken con anuncio en vez de dato: ${s.slice(0, 120)}`;
  // Magnitud coherente con la tarjeta: «billones» solo desde 10^12; «mil millones» solo desde 10^9 (error x1000 del modelo).
  if (maxCard && (/bill[oó]n(es)?/i.test(s) && maxCard < 1e12 || /mil millones/i.test(s) && maxCard < 1e9)) return `spoken con monto incoherente con la tarjeta (${maxCard}): ${s.slice(0, 120)}`;
  if (/\$|\d{1,3}([.,]\d{3})+|\d[.,]\d/.test(s)) return `spoken con cifras sin palabras: ${s.slice(0, 120)}`;
  if (/d[eé]jame buscar|claro,|un momento|no la puedo atender|no puedo atender/i.test(s)) return `spoken con muletilla o rechazo: ${s.slice(0, 120)}`;
  // Siglas que se leen como palabra o que el TTS dice bien: se admiten.
  if (/\b[A-ZÁÉÍÓÚÑ]{3,}\b/.test(s.replace(/\b(SECOP|NIT|CDP|PAE|ICBF|DNP|ESE|DIAN|SENA|INVIAS|ANI)\b/g, ""))) return `spoken con mayúsculas crudas: ${s.slice(0, 120)}`;
  if ((s.replace(/\b(?:\p{L}\.){2,}/gu, "").match(/[.!?](\s|$)/g) ?? []).length > 3) return "spoken con más de 3 frases";
  return undefined;
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };

// --- Texto: /api/chat ---
const chatVia = (port: number) => async (message: string, state?: string): Promise<Reply> => {
  const r = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, state }) });
  return (await r.json()) as Reply;
};

// --- Voz: sesión real del Voice Agent, texto inyectado con AskText ---
interface Voice { ask(text: string): Promise<Reply & { firstAudioMs: number }>; close(): void }
async function openVoice(port: number): Promise<Voice> {
  const { token } = (await (await fetch(`http://127.0.0.1:${port}/session`, { method: "POST", headers: { origin: ORIGIN } })).json()) as { token: string };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/voice?token=${encodeURIComponent(token)}`, { headers: { origin: ORIGIN } });
  let turn: { text: string[]; cards: Card[]; t0: number; first: number; done?: () => void } | null = null;
  let notice = "";
  ws.on("message", (d, bin) => {
    if (bin) { if (turn && !turn.first) turn.first = Date.now() - turn.t0; return; }
    let m: { type?: string; role?: string; content?: string; cards?: Card[]; text?: string };
    try { m = JSON.parse(d.toString()) as typeof m; } catch { return; }
    if (m.type === "Notice") notice = m.text ?? "";
    if (!turn) return;
    if (m.type === "ToolResult") turn.cards.push(...(m.cards ?? []));
    else if (m.type === "ConversationText" && m.role === "assistant" && m.content) turn.text.push(m.content);
    else if (m.type === "AgentStartedSpeaking" && !turn.first) turn.first = Date.now() - turn.t0;
    else if (m.type === "AgentAudioDone" && turn.text.length) setTimeout(() => turn?.done?.(), 400);
  });
  await new Promise<void>((ok, no) => { ws.once("open", () => ok()); ws.once("error", no); ws.once("unexpected-response", () => no(new Error("voz rechazada"))); });
  await new Promise((r) => setTimeout(r, 1500)); // SettingsApplied
  const keep = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "KeepAlive" })); }, 5000); // el servidor cierra a los 60 s sin tramas del cliente (las sesiones encadenadas esperan a otras preguntas)
  keep.unref();
  return {
    ask: (text) => new Promise((ok, no) => {
      const t = { text: [] as string[], cards: [] as Card[], t0: Date.now(), first: 0, done: undefined as undefined | (() => void) };
      turn = t;
      const finish = () => { clearTimeout(timer); turn = null; const s = t.text.join(" "); ok({ text: s, spoken: s, cards: t.cards, firstAudioMs: t.first, source: { dataset: DATASET, queriedAt: new Date().toISOString() } }); };
      const timer = setTimeout(() => { if (t.text.length) finish(); else { turn = null; no(new Error(notice || "sin respuesta del Voice Agent en 45 s")); } }, 45_000);
      t.done = finish;
      ws.send(JSON.stringify({ type: "AskText", text }));
    }),
    close: () => { clearInterval(keep); ws.close(); },
  };
}

const main = await startServer({ port: 0, env: baseEnv });
const broken = await startServer({ port: 0, env: { ...baseEnv, SOCRATA_BASE: "http://127.0.0.1:9" } });
const chat = chatVia(main.port), chatBroken = chatVia(broken.port);
const voices: Voice[] = [];
const voiceMs: number[] = [];

async function run(channel: "voz" | "texto", question: string, e: Expect, o: { fail?: boolean; state?: string; voice?: Voice }): Promise<{ r: Reply; reason?: string; ms: number }> {
  const t0 = Date.now();
  let r: Reply = { text: "", cards: [] };
  let reason: string | undefined;
  try {
    if (o.voice) { const v = await o.voice.ask(question); r = v; if (v.firstAudioMs) voiceMs.push(v.firstAudioMs); }
    else r = await (o.fail ? chatBroken : chat)(question, o.state);
    reason = check(r, e, channel);
  } catch (err) { reason = `excepción: ${err instanceof Error ? err.message : String(err)}`; }
  return { r, reason, ms: Date.now() - t0 };
}

// 1) Preguntas sueltas; `after` encadena el estado (texto) o la sesión (voz).
const states = new Map<string, string | undefined>();
const sessions = new Map<string, Voice>();
const results: { id: string; ok: boolean; text: string; spoken?: string; source: Reply["source"]; ms: number; tokens: number; reason?: string }[] = [];
for (const q of questions) {
  const voz = q.channel === "voz";
  let voice: Voice | undefined;
  if (voz) {
    try { voice = (q.after && sessions.get(q.after)) || (await openVoice(main.port)); voices.push(voice); sessions.set(q.id, voice); } catch { /* run() informa */ }
  }
  const { r, reason, ms } = voz && !voice ? { r: { text: "", cards: [] } as Reply, reason: "no se pudo abrir la sesión de voz", ms: 0 } : await run(voz ? "voz" : "texto", q.question, q.expect, { fail: q.fail, state: q.after ? states.get(q.after) : undefined, voice });
  states.set(q.id, r.state);
  results.push({ id: q.id, ok: !reason, text: r.text, ...(voz ? { spoken: r.spoken } : {}), source: r.source, ms, tokens: r.tokens ?? 0, ...(reason ? { reason } : {}) });
  console.log(`${reason ? "FALLA" : "ok   "} ${q.id.padEnd(30)} ${String(ms).padStart(6)} ms${reason ? `  ${reason}` : ""}`);
}
voices.splice(0).forEach((v) => v.close());

// 2) Conversaciones de varios turnos.
const convResults: { id: string; ok: boolean; turns: { question: string; channel: string; ok: boolean; ms: number; text: string; reason?: string }[] }[] = [];
for (const c of conversations) {
  let state: string | undefined;
  let voice: Voice | undefined;
  const turns: (typeof convResults)[number]["turns"] = [];
  for (const t of c.turns) {
    if (t.channel === "voz" && !voice) { try { voice = await openVoice(main.port); } catch { /* run() informa */ } }
    const useVoice = voice && (t.channel === "voz" || voice); // abierta la voz, lo escrito entra por AskText a la misma conversación
    const { r, reason, ms } = await run(t.channel, t.question, t.expect, { fail: t.fail, state, voice: useVoice ? voice : undefined });
    if (!useVoice) state = r.state ?? state;
    turns.push({ question: t.question, channel: t.channel, ok: !reason, ms, text: r.text.slice(0, 300), ...(reason ? { reason } : {}) });
    console.log(`${reason ? "FALLA" : "ok   "} ${c.id.padEnd(24)} [${t.channel}] ${String(ms).padStart(6)} ms${reason ? `  ${reason}` : ""}`);
    if (reason) break;
  }
  voice?.close();
  convResults.push({ id: c.id, ok: turns.length === c.turns.length && turns.every((x) => x.ok), turns });
}

if (!only) writeFileSync(new URL("./real-results.json", import.meta.url), JSON.stringify({ runAt: new Date().toISOString(), results, conversations: convResults }, null, 1));
const ok = results.filter((x) => x.ok).length, cok = convResults.filter((x) => x.ok).length, ms = results.map((x) => x.ms);
console.log(`\neval:real preguntas ${ok}/${results.length} ok (${Math.round((100 * ok) / results.length)} %) | conversaciones ${cok}/${convResults.length} | p50 ${pct(ms, 0.5)} ms, p95 ${pct(ms, 0.95)} ms | voz fin de turno -> primer audio p50 ${pct(voiceMs, 0.5)} ms, p95 ${pct(voiceMs, 0.95)} ms (n=${voiceMs.length})`);
await main.close(); await broken.close();
process.exit(!only && ok / results.length >= 0.9 && cok / convResults.length >= 0.9 ? 0 : 1);
