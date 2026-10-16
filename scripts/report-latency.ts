import { readFileSync } from "node:fs";
import { createMetrics } from "../server/metrics";

// Usage: tsx scripts/report-latency.ts <question-log.jsonl>  (lines from createQuestionLogger)
const m = createMetrics();
for (const l of readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean)) {
  const e = JSON.parse(l);
  m.record({ channel: e.channel, tokens: e.tokens, latencyMs: e.latencyMs, firstTokenMs: e.firstTokenMs, cold: e.cold });
}
console.log(JSON.stringify(m.report(), null, 2));
