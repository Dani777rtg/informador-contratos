import { runAgent, type AgentResult, type Llm, type ToolRegistry } from "./loop.js";
import { cacheKey, createAnswerCache } from "./answer-cache.js";
import type { Ctx } from "../session.js";
import type { createMetrics } from "../metrics.js";
import type { QuestionLog } from "../log.js";

export interface AskDeps {
  tools: ToolRegistry;
  llm: Llm;
  metrics: ReturnType<typeof createMetrics>;
  log: (q: QuestionLog) => void;
  demand: { record(tokens: number): void };
  /** Descarta el contexto cuando el mensaje cambia de tema (ver session-topic.ts). */
  topicGuard?: (message: string, ctx: Ctx) => Ctx;
}
export type Asked = AgentResult & { cached: boolean };

/** Agente + caché de respuestas + métricas, log sin contenido y tope diario de tokens: un solo punto para texto y voz. */
export function createAsker(d: AskDeps) {
  const full = new Map<string, AgentResult>();
  const jobs = new Map<string, () => Promise<AgentResult>>();
  const cache = createAnswerCache(async (q, context) => {
    const k = cacheKey(q, context);
    const r = await jobs.get(k)!();
    full.set(k, r);
    return { text: r.text, tokens: r.tokens, cache: !r.degraded && !r.toolCalls.length } // con datos de herramientas cambian: solo se guardan las respuestas sin consulta;
  });
  return async function ask(message: string, prev: Ctx, channel: "texto" | "voz", onToken?: (t: string) => void): Promise<Asked> {
    const context = d.topicGuard ? d.topicGuard(message, prev) : prev; // el mensaje manda sobre el contexto
    const t0 = Date.now();
    let firstTokenMs: number | undefined;
    const ctxKey = JSON.stringify([context.entity?.nit, context.period, context.contract, context.results, context.filtros]);
    const k = cacheKey(message, ctxKey);
    jobs.set(k, () => runAgent({ message, context, tools: d.tools, llm: d.llm, onToken: (t) => { firstTokenMs ??= Date.now() - t0; onToken?.(t); } }));
    try {
      const a = await cache.ask(message, ctxKey);
      const r = full.get(k)!;
      if (a.cached) onToken?.(r.text);
      const latencyMs = Date.now() - t0;
      d.demand.record(a.tokens);
      d.metrics.record({ channel, tokens: a.tokens, latencyMs, firstTokenMs });
      const dc = r.toolCalls.find((t) => t.name === "decline");
      d.log({ tokens: a.tokens, latencyMs, channel, route: r.degraded ? "respaldo" : "agente", tools: r.toolCalls.map((t) => t.name), declineCode: dc ? String(dc.args.code ?? "") : undefined });
      return { ...r, tokens: a.tokens, cached: a.cached };
    } catch (e) {
      d.log({ tokens: 0, latencyMs: Date.now() - t0, channel, errorCode: "agent_error", route: "agente", errorType: e instanceof Error ? e.name : "unknown" });
      throw e;
    } finally { jobs.delete(k); }
  };
}
