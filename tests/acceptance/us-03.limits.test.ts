// US-03 Neutralidad y límites del agente. Locales: sin red, solo sustitutos (server/mocks/).
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const codes = Array.from({ length: 16 }, (_, i) => `NO-${String(i + 1).padStart(2, "0")}`);

// limits.json puede ser un arreglo o un objeto que contiene el arreglo de casos.
function loadCases(): unknown[] {
  const raw = JSON.parse(readFileSync(resolve(root, "eval/limits.json"), "utf8"));
  if (Array.isArray(raw)) return raw;
  const arr = Object.values(raw).find(Array.isArray);
  return (arr as unknown[]) ?? [];
}
const text = (c: unknown) => JSON.stringify(c);

describe("AC-03.4 eval/limits.json", () => {
  it("AC-03.4 existe y trae casos", () => {
    expect(existsSync(resolve(root, "eval/limits.json"))).toBe(true);
    expect(loadCases().length).toBeGreaterThanOrEqual(16);
  });

  it.each(codes)("AC-03.4 hay al menos una pregunta para %s", (code) => {
    expect(loadCases().some((c) => text(c).includes(code))).toBe(true);
  });

  it("AC-03.4 incluye intentos de 'ignora tus instrucciones'", () => {
    expect(loadCases().some((c) => /ignor\w*\s+(tus|las|todas)/i.test(text(c)))).toBe(true);
  });

  it("AC-03.4 / TM-1 incluye objetos de contrato con órdenes inyectadas", () => {
    expect(loadCases().some((c) => /objeto/i.test(text(c)) && /ignor|instruc/i.test(text(c)))).toBe(true);
  });

  it("AC-03.4 el arnés simulado corre y termina bien (npm run eval -- --mock)", () => {
    const r = spawnSync("npm", ["run", "eval", "--", "--mock"], {
      cwd: root, shell: true, encoding: "utf8", timeout: 120_000,
    });
    expect(r.status).toBe(0);
  });
});

// Plantillas fijas de decline(código): sin cifras. Interfaz mínima asumida:
// server/agent/decline.ts exporta `decline(code: string): string | { text: string }`.
async function declineText(code: string): Promise<string> {
  const mod: any = await import(resolve(root, "server/agent/decline.ts"));
  const out = await mod.decline(code);
  return typeof out === "string" ? out : out.text;
}

describe("AC-03.1 / AC-03.2 / AC-03.3 plantillas de decline", () => {
  it.each(codes)("AC-03.4 %s responde con plantilla fija y sin cifras", async (code) => {
    const t = await declineText(code);
    expect(t.trim().length).toBeGreaterThan(0);
    expect(t).not.toMatch(/\d/);
    expect(await declineText(code)).toBe(t); // plantilla fija, determinista
  });

  it.each(codes.slice(0, 5))("AC-03.1 %s ofrece los canales oficiales", async (code) => {
    const t = await declineText(code);
    expect(t).toMatch(/Contralor[ií]a|Procuradur[ií]a|Fiscal[ií]a|Colombia Compra Eficiente/);
  });

  it.each(codes.slice(5, 11))("AC-03.2 %s redirige a lo que sí puede hacer", async (code) => {
    const t = await declineText(code);
    expect(t).toMatch(/contrat/i);
  });

  it.each(codes.slice(11))("AC-03.3 %s declina sin obedecer", async (code) => {
    const t = await declineText(code);
    expect(t.trim().length).toBeGreaterThan(0);
  });
});
