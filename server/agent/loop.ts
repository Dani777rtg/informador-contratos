import { SYSTEM_PROMPT, wrapData } from "./system-prompt";
import { decline, DECLINE_TOOL } from "./decline";
import { dropForbidden, prefilter } from "./guardrails";
import { allowedNumbers, verifyNumbers, yearNumbers } from "./verify-numbers";
import { MAX_TOOLS_PER_TURN } from "../guards/validate";

export { MAX_TOOLS_PER_TURN };
const LLM_TIMEOUT_MS = 30_000;
const MAX_ROUNDS = 2; // ronda 1 con herramientas, ronda 2 solo redacta
const MAX_ROWS = 5;
const MAX_STR = 60;

/** Versión compacta de un resultado para el LLM: ≤5 filas, textos cortos, sin URLs. Las tarjetas completas no pasan por aquí. */
export function compact(v: unknown): unknown {
  if (typeof v === "string") return v.length > MAX_STR ? v.slice(0, MAX_STR) + "…" : v;
  if (Array.isArray(v)) return v.slice(0, MAX_ROWS).map(compact);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "kind" && !/url/i.test(k)).map(([k, x]) => [k, compact(x)]));
  return v;
}

import type { Ctx } from "../session";
export type { Ctx };
export type Card = { kind: string } & Record<string, unknown>;

export interface ToolResult {
  /** Datos estructurados: única fuente de cifras para el texto. */
  data: unknown;
  cards?: Card[];
  /** Cambios al contexto (entidad, periodo, contrato en foco, resultados). */
  context?: Partial<Ctx>;
}
/** Registro de herramientas: el LLM elige nombre y parámetros tipados, nunca SoQL. */
export interface Tool {
  name: string;
  description: string;
  /** JSON Schema de los parámetros. */
  parameters: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: Ctx): Promise<ToolResult>;
}
export type ToolRegistry = Record<string, Tool>;

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}
export interface LlmToolCall { id: string; name: string; arguments: string }
export interface Llm {
  complete(req: {
    messages: LlmMessage[];
    tools: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
    onToken?: (t: string) => void;
  }): Promise<{ content: string; toolCalls: LlmToolCall[]; tokens: number }>;
}

export interface AgentResult {
  text: string;
  cards: Card[];
  toolCalls: { name: string; args: Record<string, unknown> }[];
  tokens: number;
  context: Ctx;
  /** Respuesta de respaldo por fallo: no se guarda en caché. */
  degraded?: boolean;
}

// Modo sin razonamiento explícito (API: thinking.type = "disabled"): más rápido y con tool_calls estructuradas.
const DSML = /DSML|<｜/;
/** Quita del texto del modelo cualquier bloque de datos internos que haya copiado (<datos_secop>…</datos_secop>, JSON crudo). */
export const scrub = (t: string): string =>
  t.replace(/<datos_secop>[\s\S]*?(<\/datos_secop>|$)/g, "").replace(/<\/?datos_secop>/g, "").replace(/^\s*\{[\s\S]*?\}\s*$/gm, "").trim();
/** DeepSeek a veces devuelve la llamada a herramienta como texto con su marcado interno (DSML). Se convierte en tool_calls. */
export function parseDsml(content: string): LlmToolCall[] {
  const out: LlmToolCall[] = [];
  const inv = /invoke\s+name="([\w-]+)"\s*>([\s\S]*?)<\/[^>]*invoke>/g;
  for (const [, name, body] of content.matchAll(inv)) {
    const args: Record<string, string> = {};
    for (const [, k, v] of body.matchAll(/parameter\s+name="([\w-]+)"[^>]*>([\s\S]*?)<\/[^>]*parameter>/g)) args[k] = v.trim();
    out.push({ id: `dsml_${out.length}`, name, arguments: JSON.stringify(args) });
  }
  return out;
}
/** Cliente OpenAI-compatible de DeepSeek (stream:true). Modelo solo por DEEPSEEK_MODEL. */
export function createDeepseekLlm(o: { baseUrl?: string; apiKey?: string; model?: string; fetch?: typeof fetch } = {}): Llm {
  const baseUrl = (o.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const model = o.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-flash";
  const apiKey = o.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "";
  const doFetch = o.fetch ?? fetch;
  return {
    async complete({ messages, tools, onToken }) {
      const res = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, tools: tools.length ? tools : undefined, thinking: { type: "disabled" }, stream: true, stream_options: { include_usage: true } }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      if (!res.ok || !res.body) throw new Error(`LLM HTTP ${res.status}`);
      let content = "";
      let tokens = 0;
      const calls: LlmToolCall[] = [];
      const dec = new TextDecoder();
      let buf = "";
      const handle = (line: string) => {
        if (!line.startsWith("data:")) return;
        const d = line.slice(5).trim();
        if (!d || d === "[DONE]") return;
        type Chunk = {
          choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
          usage?: { total_tokens?: number };
        };
        let j: Chunk;
        try { j = JSON.parse(d) as Chunk; } catch { return; } // línea SSE no parseable: se ignora
        if (!j || typeof j !== "object") return;
        tokens = j.usage?.total_tokens ?? tokens;
        const delta = j.choices?.[0]?.delta;
        if (delta?.content) { content += delta.content; if (!DSML.test(content)) onToken?.(delta.content); }
        for (const tc of delta?.tool_calls ?? []) {
          const c = (calls[tc.index ?? 0] ??= { id: "", name: "", arguments: "" });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.arguments += tc.function.arguments;
        }
      };
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += dec.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        lines.forEach(handle);
      }
      handle(buf);
      const toolCalls = calls.filter(Boolean);
      if (!toolCalls.length && DSML.test(content)) return { content: "", toolCalls: parseDsml(content), tokens };
      return { content, toolCalls, tokens };
    },
  };
}

/** Emite por onToken solo frases ya verificadas (el texto crudo del LLM nunca sale). */
function makeGate(onToken: ((t: string) => void) | undefined, allowed: () => number[]) {
  let pending = "";
  const emit = (s: string) => {
    const text = dropForbidden(verifyNumbers(scrub(s), allowed()).text);
    if (text) onToken?.(text + " ");
  };
  return {
    push(t: string) {
      pending += t;
      const parts = pending.split(/(?<=[.!?])\s+/);
      pending = parts.pop() ?? "";
      parts.forEach(emit);
    },
    flush() { if (pending) emit(pending); pending = ""; },
  };
}

export async function runAgent(a: {
  message: string;
  context: Ctx;
  tools: ToolRegistry;
  llm: Llm;
  onToken?: (t: string) => void;
}): Promise<AgentResult> {
  let context: Ctx = { ...a.context };
  const cards: Card[] = [];
  const toolCalls: AgentResult["toolCalls"] = [];
  const results: unknown[] = [];
  let tokens = 0;
  let text = "";
  const defs = [...Object.values(a.tools).map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })), DECLINE_TOOL];
  // Cifras permitidas: solo resultados de herramientas; mensaje y contexto aportan únicamente años y fechas.
  const allowed = () => [...allowedNumbers(results), ...yearNumbers(a.message, context)];
  let used = 0; // herramientas ya ejecutadas en este turno (todas las rondas)
  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Contexto actual: ${JSON.stringify(context)}` },
    { role: "user", content: a.message },
  ];

  const pre = prefilter(a.message);
  if (pre) {
    const t = decline(pre);
    a.onToken?.(t);
    return { text: t, cards, toolCalls: [{ name: "decline", args: { code: pre } }], tokens, context };
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const gate = makeGate(a.onToken, allowed);
    const last = round === MAX_ROUNDS - 1;
    let r: Awaited<ReturnType<Llm["complete"]>>;
    try {
      r = await a.llm.complete({ messages, tools: last || used >= MAX_TOOLS_PER_TURN ? [] : defs, onToken: gate.push });
    } catch {
      return { text: "No pude consultar el modelo en este momento. Intenta de nuevo en unos minutos.", cards, toolCalls, tokens, context, degraded: true };
    }
    gate.flush();
    tokens += r.tokens;
    if (!r.toolCalls.length) { text = r.content; break; }
    const dc = r.toolCalls.find((c) => c.name === "decline");
    if (dc) {
      let code = "";
      try { code = String((JSON.parse(dc.arguments || "{}") as { code?: unknown }).code ?? ""); } catch { /* código inválido: plantilla genérica */ }
      return { text: decline(code), cards: [], toolCalls: [{ name: "decline", args: { code } }], tokens, context };
    }
    const run = r.toolCalls.slice(0, MAX_TOOLS_PER_TURN - used);
    used += run.length;
    if (!run.length) continue;
    messages.push({
      role: "assistant", content: r.content || null,
      tool_calls: run.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
    });
    for (const c of run) {
      let out: string;
      try {
        const tool = a.tools[c.name];
        if (!tool) throw new Error("herramienta desconocida");
        const parsed: unknown = JSON.parse(c.arguments || "{}");
        const args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        toolCalls.push({ name: c.name, args });
        const res = await tool.run(args, context);
        const slim = compact(res.data);
        results.push(slim);
        cards.push(...(res.cards ?? []));
        context = { ...context, ...res.context };
        out = wrapData(slim);
      } catch {
        out = wrapData({ error: "tool_error" });
      }
      messages.push({ role: "tool", tool_call_id: c.id, content: out });
    }
  }
  // Nunca se muestra ni se habla marcado interno del modelo.
  if (DSML.test(text)) return { text: "No pude completar esa consulta. Intenta preguntarlo de otra forma, por ejemplo con el nombre de la entidad.", cards, toolCalls, tokens, context, degraded: true };
  return { text: dropForbidden(verifyNumbers(scrub(text), allowed()).text), cards, toolCalls, tokens, context };
}
