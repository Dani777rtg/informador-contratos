// Puerta de producción (AC-13.11): preguntas reales por texto y por voz con audio sintetizado (Deepgram TTS -> /voice) contra un servidor en marcha.
// Uso: npm run probe:prod -- --target <url> [--env-file=<ruta>]   (necesita DEEPGRAM_API_KEY en el entorno; no imprime claves)
// Escribe eval/prod-probe-results.json y sale con 1 si < 90 % ok.
import { writeFileSync } from "node:fs";
import { WebSocket } from "ws";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const envFile = process.argv.find((a) => a.startsWith("--env-file="))?.slice(11);
if (envFile) process.loadEnvFile(envFile);
const target = (arg("--target") ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(target)) { console.error("Uso: npm run probe:prod -- --target <url>"); process.exit(2); }
const dgKey = process.env.DEEPGRAM_API_KEY ?? "";
if (!dgKey) { console.error("Falta DEEPGRAM_API_KEY en el entorno"); process.exit(2); }

/** `data`: debe responder lo pedido; `money`: montos en pesos; `lugar`: el lugar pedido aparece en la respuesta. */
interface Q { q: string; kind: "datos" | "saludo" | "declinar"; lugar?: string; money?: boolean; detail?: string }
const QS: Q[] = [
  { q: "Hola, ¿cómo estás?", kind: "saludo" },
  { q: "¿Cuánto se gastó en Antioquia?", kind: "datos", lugar: "antioquia", money: true },
  { q: "¿Qué contratos hay en Tunja?", kind: "datos", lugar: "tunja" },
  { q: "Dame la lista de contratos de educación de Yopal", kind: "datos", lugar: "yopal" },
  { q: "¿Cuánto se gastó en Manizales en 2025?", kind: "datos", lugar: "manizales", money: true },
  { q: "¿Qué empresas recibieron más plata en Bogotá?", kind: "datos", lugar: "bogot" },
  { q: "¿Cuál fue el contrato más grande de Cali?", kind: "datos", lugar: "cali", money: true, detail: "Dame el detalle de ese contrato" },
  { q: "¿Qué entidades gastaron más en Boyacá?", kind: "datos", lugar: "boyac" },
  { q: "¿En qué se gastó más en Pasto?", kind: "datos", lugar: "pasto", money: true },
  { q: "¿Cuánto se invirtió en salud en Cartagena?", kind: "datos", lugar: "cartagena", money: true },
  { q: "¿Qué contratos de vías hay en Nariño?", kind: "datos", lugar: "nari" },
  { q: "¿Cuánto se gastó en Caldas?", kind: "datos", lugar: "caldas", money: true },
  { q: "¿Qué contratos hay en Medellín?", kind: "datos", lugar: "medell" },
  { q: "¿Cuánto contrató la Gobernación de Santander?", kind: "datos", lugar: "santander", money: true },
  { q: "¿Ese contrato es un robo?", kind: "declinar" },
  { q: "¿Por quién debo votar?", kind: "declinar" },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const NO_DATA = /no hay datos|no tengo datos|no encontr[eé] datos|sin datos/i;
const FILLER = /^\W*(claro|d[eé]jame|un momento|perm[ií]teme|veamos)\b/i;

/** Motivo de falla o undefined si la respuesta responde lo pedido. */
function check(q: Q, text: string, cards: { kind?: string }[], channel: "texto" | "voz"): string | undefined {
  if (!text.trim()) return "sin respuesta";
  if (FILLER.test(text)) return `muletilla: ${text.slice(0, 40)}`;
  if (/DSML|NON_EXISTENT|undefined|\[object/.test(text)) return "marcado interno en la respuesta";
  const t = norm(text), t2 = norm(`${text} ${JSON.stringify(cards)}`); // lugar y montos pueden estar en las tarjetas
  if (q.kind === "saludo") return /\d/.test(t) ? "el saludo trae datos" : /\b(hola|buen|saludo|gusto)/.test(t) ? undefined : "no responde el saludo";
  if (q.kind === "declinar") return /no puedo|no opino|no hago|no es mi|no me corresponde|acude|contraloria|procuraduria/.test(t) ? undefined : `no declina: ${text.slice(0, 80)}`;
  if (NO_DATA.test(text)) return `dice que no hay datos: ${text.slice(0, 80)}`;
  if (q.lugar && !t2.includes(q.lugar) && !/\bdijiste\b/.test(t)) return `no menciona el lugar pedido (${q.lugar})`;
  if (q.money && !/peso|millon|billon|mil millones|\$/.test(t2)) return "monto sin pesos";
  if (channel === "voz" && /\$\s?\d|\d{1,3}(\.\d{3}){2,}/.test(text)) return "monto en cifras en la voz";
  if (!cards.length && channel === "texto" && !/dijiste/.test(t)) return "sin tarjetas";
  return undefined;
}

interface Result { q: string; channel: "texto" | "voz"; ok: boolean; ms: number; heard?: string; reason?: string }

async function ask(message: string, state?: string) {
  const t0 = Date.now();
  const r = await fetch(`${target}/api/chat`, { method: "POST", headers: { "content-type": "application/json", Origin: target }, body: JSON.stringify({ message, state }) });
  const d = (await r.json()) as { text?: string; cards?: { kind?: string }[]; state?: string };
  return { ms: Date.now() - t0, text: d.text ?? "", cards: d.cards ?? [], state: d.state };
}

async function tts(q: string): Promise<Buffer> {
  const r = await fetch("https://api.deepgram.com/v1/speak?model=aura-2-celeste-es&encoding=linear16&sample_rate=16000&container=none", {
    method: "POST", headers: { Authorization: `Token ${dgKey}`, "content-type": "application/json" }, body: JSON.stringify({ text: q }),
  });
  if (!r.ok) throw new Error(`tts ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function voice(q: string) {
  const pcm = await tts(q);
  const s = (await (await fetch(`${target}/session`, { method: "POST", headers: { Origin: target } })).json()) as { token?: string };
  return new Promise<{ heard: string; text: string; cards: { kind?: string }[]; ms: number }>((res) => {
    const ws = new WebSocket(`${target.replace(/^http/, "ws")}/voice?token=${encodeURIComponent(s.token ?? "")}`, { headers: { Origin: target } });
    const out = { heard: "", text: "", cards: [] as { kind?: string }[], ms: 0 };
    let tEnd = 0;
    const done = () => { try { ws.close(); } catch { /* ya cerrado */ } res(out); };
    const timer = setTimeout(done, 45_000);
    ws.on("open", async () => {
      const frame = 1280; // 40 ms a 16 kHz
      for (let i = 0; i < pcm.length && ws.readyState === 1; i += frame) { ws.send(pcm.subarray(i, i + frame)); await sleep(40); }
      const silence = Buffer.alloc(frame);
      tEnd = Date.now();
      while (ws.readyState === 1) { ws.send(silence); await sleep(40); } // silencio continuo: cierra el turno y mantiene viva la sesión
    });
    ws.on("message", (d, bin) => {
      if (bin) return;
      let m: { type?: string; role?: string; content?: string; cards?: { kind?: string }[] };
      try { m = JSON.parse(d.toString()); } catch { return; }
      if (m.type === "ConversationText" && m.role === "user") out.heard += (out.heard ? " | " : "") + m.content;
      if (m.type === "ConversationText" && m.role === "assistant") { out.text += `${m.content} `; out.ms ||= Date.now() - tEnd; }
      if (m.type === "ToolResult") out.cards.push(...(m.cards ?? []));
      if (m.type === "AgentAudioDone" && out.text) { clearTimeout(timer); setTimeout(done, 300); }
    });
    ws.on("close", () => { clearTimeout(timer); res(out); });
    ws.on("error", () => { /* el cierre decide */ });
  });
}

const results: Result[] = [];
const push = (r: Result) => { results.push(r); console.log(JSON.stringify(r)); };

for (const q of QS) {
  let state: string | undefined;
  try {
    const t = await ask(q.q, undefined);
    state = t.state;
    const reason = check(q, t.text, t.cards, "texto");
    push({ q: q.q, channel: "texto", ok: !reason, ms: t.ms, ...(reason ? { reason } : {}) });
    if (q.detail) {
      const d = await ask(q.detail, state);
      const bad = d.cards.some((c) => c.kind === "detail") ? undefined : `sin ficha de detalle: ${d.text.slice(0, 80)}`;
      push({ q: q.detail, channel: "texto", ok: !bad, ms: d.ms, ...(bad ? { reason: bad } : {}) });
    }
  } catch (e) { push({ q: q.q, channel: "texto", ok: false, ms: 0, reason: String(e).slice(0, 100) }); }
  try {
    const v = await voice(q.q);
    const reason = check(q, v.text, v.cards, "voz");
    push({ q: q.q, channel: "voz", ok: !reason, ms: v.ms, heard: v.heard, ...(reason ? { reason } : {}) });
  } catch (e) { push({ q: q.q, channel: "voz", ok: false, ms: 0, reason: String(e).slice(0, 100) }); }
}

writeFileSync(new URL("../eval/prod-probe-results.json", import.meta.url), JSON.stringify({ runAt: new Date().toISOString(), target, results }, null, 2));
const ok = results.filter((r) => r.ok).length;
console.log(`probe: ${ok}/${results.length} (${Math.round((100 * ok) / results.length)} %)`);
process.exit(ok / results.length >= 0.9 ? 0 : 1);
