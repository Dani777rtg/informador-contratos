import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Static checks only: load tests run locally against stand-ins, never here.
const root = join(__dirname, "..", "..");
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : "");
const has = (t: string, ...res: RegExp[]) => res.forEach((r) => expect(t).toMatch(r));

describe("US-12 carga local y documentos de entrega", () => {
  it("AC-12.1 loadtest scripts exist and the report covers steps and metrics", () => {
    const dir = join(root, "loadtest");
    expect(existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".ts"))).toBe(true);
    const r = read("docs/CARGA.md");
    expect(r.length).toBeGreaterThan(0);
    has(r, /\b10\b/, /\b100\b/, /1\.?000/, /p50/i, /p95/i, /error/i, /quiebre/i, /cuello de botella/i, /costo/i);
    has(r, /DeepSeek/i, /Deepgram/i, /datos\.gov\.co/i, /WhatsApp/i);
    has(r, /local/i);
  });

  it("AC-12.2 report states 0 outbound external calls and documents published limits", () => {
    const r = read("docs/CARGA.md");
    has(r, /0\s+llamadas\s+salientes/i, /l[ií]mites?\s+publicados?/i);
  });

  it("AC-12.3 DESIGN.md covers colors, typography, components, states, do/don't, with citations", () => {
    const d = read("docs/DESIGN.md");
    expect(d.length).toBeGreaterThan(0);
    has(d, /colores?/i, /tipograf[ií]a/i, /componentes?/i, /estados?/i, /qu[eé] hacer/i, /qu[eé] no/i);
    has(d, /DIS-02|Fuente|p[aá]gina|secci[oó]n/i);
  });

  it("AC-12.4 demo script exists with questions and screenshots for mobile and desktop", () => {
    const d = read("docs/DEMO.md");
    expect(d.length).toBeGreaterThan(0);
    has(d, /pregunta/i, /\b[3-5]\s*(a|-|–)?\s*[3-5]?\s*min/i);
    const dir = join(root, "docs", "capturas");
    const files = existsSync(dir) ? readdirSync(dir) : [];
    expect(files.some((f) => /m[oó]vil|mobile/i.test(f))).toBe(true);
    expect(files.some((f) => /escritorio|desktop/i.test(f))).toBe(true);
  });
});
