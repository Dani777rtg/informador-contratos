import { SYSTEM_PROMPT, wrapData } from "./system-prompt";
import { allowedNumbers, verifyNumbers } from "./verify-numbers";

export const MAX_TOOLS_PER_TURN = 3;
const MAX_ROUNDS = 3;

/** Contexto acumulado entre turnos (T009 lo firma y lo persiste). */
export interface Ctx {
  entity?: { nit: string; name: string };
  period?: { from: string; to: string };
  contract?: string;
  results?: string[];
}
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
}

/** Cliente OpenAI-compatible de DeepSeek (stream:true, sin razonamiento). Modelo solo por DEEPSEEK_MODEL. */
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
        body: JSON.stringify({ model, messages, tools: tools.length ? tools : undefined, stream: true, stream_options: { include_usage: true } }),
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
        const j = JSON.parse(d) as {
          choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
          usage?: { total_tokens?: number };
        };
        tokens = j.usage?.total_tokens ?? tokens;
        const delta = j.choices?.[0]?.delta;
        if (delta?.content) { content += delta.content; onToken?.(delta.content); }
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
      return { content, toolCalls: calls.filter(Boolean), tokens };
    },
  };
}

/** Emite por onToken solo frases ya verificadas (el texto crudo del LLM nunca sale). */
function makeGate(onToken: ((t: string) => void) | undefined, allowed: () => number[]) {
  let pending = "";
  const emit = (s: string) => {
    const { text } = verifyNumbers(s, allowed());
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
  const defs = Object.values(a.tools).map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
  // Cifras permitidas: resultados de herramientas, contexto y lo que el propio usuario dijo.
  const allowed = () => allowedNumbers(results, context, a.message);
  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Contexto actual: ${JSON.stringify(context)}` },
    { role: "user", content: a.message },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const gate = makeGate(a.onToken, allowed);
    const last = round === MAX_ROUNDS - 1;
    const r = await a.llm.complete({ messages, tools: last ? [] : defs, onToken: gate.push });
    gate.flush();
    tokens += r.tokens;
    if (!r.toolCalls.length) { text = r.content; break; }
    const run = r.toolCalls.slice(0, MAX_TOOLS_PER_TURN);
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
        results.push(res.data);
        cards.push(...(res.cards ?? []));
        context = { ...context, ...res.context };
        out = wrapData(res.data);
      } catch (e) {
        out = wrapData({ error: e instanceof Error ? e.message : "error" });
      }
      messages.push({ role: "tool", tool_call_id: c.id, content: out });
    }
  }
  return { text: verifyNumbers(text, allowed()).text, cards, toolCalls, tokens, context };
}
