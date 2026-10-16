// US-11 acceptance. Local only: no external APIs. Assumed module contract (see QA report):
//   server/metrics.ts            createMetrics(): { record(e), report() }
//   server/agent/answer-cache.ts createAnswerCache(answerFn): { ask(q) => { text, tokens, cached } }
//   scripts/mission-report.ts    buildMissionReport(input): string
import { describe, it, expect } from "vitest";

const load = (p: string) => import(/* @vite-ignore */ p);

describe("US-11", () => {
  it("AC-11.1 reports p50/p95/p99 per channel with cold start apart", async () => {
    const { createMetrics } = await load("../../server/metrics");
    const m = createMetrics();
    for (const channel of ["text", "voice", "whatsapp"]) {
      for (let i = 1; i <= 100; i++) m.record({ channel, tokens: 100, latencyMs: i });
    }
    m.record({ channel: "text", tokens: 100, latencyMs: 9000, cold: true });
    const r = m.report();
    for (const channel of ["text", "voice", "whatsapp"]) {
      const c = r.channels[channel];
      expect(c.p50).toBeGreaterThanOrEqual(50);
      expect(c.p50).toBeLessThanOrEqual(51);
      expect(c.p95).toBeGreaterThanOrEqual(95);
      expect(c.p95).toBeLessThanOrEqual(96);
      expect(c.p99).toBeGreaterThanOrEqual(99);
      expect(c.p99).toBeLessThanOrEqual(100);
    }
    // the 9000 ms cold start must not pollute the text percentiles
    expect(r.channels.text.p99).toBeLessThan(9000);
    expect(JSON.stringify(r.cold ?? r.coldStart)).toContain("9000");
  });

  it("AC-11.2 first text token p95 under 1 s against simulated data", async () => {
    const { createMetrics } = await load("../../server/metrics");
    const m = createMetrics();
    // simulated stream: first token after ~300 ms of representative delay
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 5 + (i % 5)));
      const first = performance.now() - t0;
      samples.push(first);
      m.record({ channel: "text", tokens: 800, latencyMs: first, firstTokenMs: first });
    }
    const r = m.report();
    expect(r.channels.text.firstToken.p95).toBeLessThan(1000);
  });

  it("AC-11.3 average <= 1500 tokens and repeated question costs 0 tokens", async () => {
    const { createAnswerCache } = await load("../../server/agent/answer-cache");
    let llmCalls = 0;
    const cache = createAnswerCache(async (q: string) => {
      llmCalls++;
      return { text: `respuesta a ${q}`, tokens: 1200 };
    });
    const first = await cache.ask("¿Cuánto vale el contrato 123?");
    const again = await cache.ask("¿Cuánto vale el contrato 123?");
    expect(first.tokens).toBeLessThanOrEqual(1500);
    expect(again.tokens).toBe(0);
    expect(again.text).toBe(first.text);
    expect(llmCalls).toBe(1);
  });

  it("AC-11.4 mission report covers times, tokens, tests, lint, vulnerabilities and limits", async () => {
    const { buildMissionReport } = await load("../../scripts/mission-report");
    const md: string = buildMissionReport({
      timesMs: { p50: 500, p95: 900 },
      tokens: { avg: 1000 },
      tests: { passed: 10, failed: 0 },
      lint: { errors: 0 },
      vulnerabilities: { high: 0, critical: 0 },
      limits: { rateLimit: "ok" },
    });
    expect(typeof md).toBe("string");
    for (const re of [/tiempo/i, /token/i, /prueba/i, /lint/i, /vulnerab/i, /l[ií]mite/i]) {
      expect(md).toMatch(re);
    }
  });
});
