import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface MissionInput {
  timesMs: { p50: number; p95: number; p99?: number };
  tokens: { avg: number };
  tests: { passed: number; failed: number };
  lint: { errors: number };
  vulnerabilities: { high: number; critical: number };
  limits: Record<string, string>;
}

export function buildMissionReport(i: MissionInput): string {
  return [
    "# Informe de la misión",
    "",
    `- Tiempos (ms): p50 ${i.timesMs.p50}, p95 ${i.timesMs.p95}${i.timesMs.p99 === undefined ? "" : `, p99 ${i.timesMs.p99}`}`,
    `- Tokens por pregunta (media): ${i.tokens.avg}`,
    `- Pruebas: ${i.tests.passed} pasan, ${i.tests.failed} fallan`,
    `- Lint: ${i.lint.errors} errores`,
    `- Vulnerabilidades: ${i.vulnerabilities.high} altas, ${i.vulnerabilities.critical} críticas`,
    `- Resultados de límites: ${Object.entries(i.limits).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    "",
  ].join("\n");
}

// Usage: tsx scripts/mission-report.ts <input.json>  (assembled from metrics report, vitest --reporter=json, npm audit --json, docs/metrics.md)
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2]) {
  console.log(buildMissionReport(JSON.parse(readFileSync(process.argv[2], "utf8"))));
}
