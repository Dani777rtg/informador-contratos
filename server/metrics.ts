export interface MetricEvent { channel: string; tokens: number; latencyMs: number; firstTokenMs?: number; cold?: boolean }

// Nearest-rank percentile.
export const pct = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const stats = (xs: number[]) => ({ p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99) });

/** In-memory metrics: never stores question content. Cold starts are kept apart. */
export function createMetrics() {
  const warm: MetricEvent[] = [];
  const cold: MetricEvent[] = [];
  return {
    record(e: MetricEvent) { (e.cold ? cold : warm).push(e); },
    report() {
      const channels: Record<string, ReturnType<typeof stats> & { count: number; avgTokens: number; firstToken: ReturnType<typeof stats> }> = {};
      for (const ch of new Set(warm.map((e) => e.channel))) {
        const es = warm.filter((e) => e.channel === ch);
        channels[ch] = {
          ...stats(es.map((e) => e.latencyMs)),
          count: es.length,
          avgTokens: es.reduce((a, e) => a + e.tokens, 0) / es.length,
          firstToken: stats(es.flatMap((e) => (e.firstTokenMs === undefined ? [] : [e.firstTokenMs]))),
        };
      }
      return { channels, cold: cold.map((e) => ({ channel: e.channel, latencyMs: e.latencyMs, tokens: e.tokens })) };
    },
  };
}
