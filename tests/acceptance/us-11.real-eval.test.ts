/**
 * AC-11.5 (cambio 004): evaluacion con preguntas ciudadanas reales.
 * Sin red; solo lee artefactos del repo.
 *
 * Formato minimo asumido:
 *  eval/real-questions.json: [{ id, question, expect: { ...entidad/territorio/tema } }]
 *    (tambien se acepta { questions: [...] })
 *  eval/real-results.json: { runAt, results: [{ id, ok, text, source, ms, tokens, reason? }] }
 *  Cambio 005: preguntas habladas llevan `channel:"voz"` y su resultado trae `spoken`;
 *    un seguimiento de contrato lleva `followUp` (o `previous`/`after`) y la palabra "contrato" en la pregunta.
 *    source: objeto o texto con dataset y fecha (se exige no vacio).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const arr = (j: any): any[] => (Array.isArray(j) ? j : j?.questions ?? []);

describe("AC-11.5 evaluacion con preguntas reales", () => {
  it("AC-11.5 real-questions.json tiene >= 55 preguntas (cambio 006: ~60) con texto y chequeo esperado", () => {
    expect(existsSync(resolve(root, "eval/real-questions.json"))).toBe(true);
    const qs = arr(read("eval/real-questions.json"));
    expect(qs.length).toBeGreaterThanOrEqual(55);
    for (const q of qs) {
      expect(typeof q.question).toBe("string");
      expect(q.question.trim().length).toBeGreaterThan(0);
      expect(q.expect && Object.keys(q.expect).length).toBeGreaterThan(0);
    }
  });

  it("AC-11.5 real-results.json tiene fecha, una entrada por pregunta y >= 90 % ok", () => {
    expect(existsSync(resolve(root, "eval/real-results.json"))).toBe(true);
    const r = read("eval/real-results.json");
    const qs = arr(read("eval/real-questions.json"));
    expect(Number.isNaN(Date.parse(r.runAt))).toBe(false);
    expect(r.results.map((x: any) => x.id).sort()).toEqual(qs.map((q) => q.id).sort());
    const ok = r.results.filter((x: any) => x.ok === true).length;
    expect(ok / r.results.length).toBeGreaterThanOrEqual(0.9);
  });

  it("AC-11.5 ninguna respuesta contiene marcado interno del modelo", () => {
    const r = read("eval/real-results.json");
    expect(r.results.length).toBeGreaterThan(0);
    for (const x of r.results) {
      expect(String(x.text ?? "")).not.toContain("DSML");
      expect(String(x.text ?? "")).not.toContain("｜");
    }
  });

  it("AC-11.5 cada respuesta ok trae fuente", () => {
    const r = read("eval/real-results.json");
    const oks = r.results.filter((x: any) => x.ok === true);
    expect(oks.length).toBeGreaterThan(0);
    for (const x of oks) {
      expect(x.source).toBeTruthy();
      expect(JSON.stringify(x.source).length).toBeGreaterThan(2);
    }
  });

  it("AC-11.5 hay preguntas habladas (channel voz) con spoken limpio y un seguimiento de contrato ok (cambio 005)", () => {
    const qs = arr(read("eval/real-questions.json"));
    const voz = qs.filter((q) => q.channel === "voz");
    expect(voz.length).toBeGreaterThan(0);
    const res = read("eval/real-results.json").results as any[];
    const byId = new Map(res.map((x) => [x.id, x]));
    for (const q of voz) {
      const s = String(byId.get(q.id)?.spoken ?? "");
      expect(s.length, q.id).toBeGreaterThan(0);
      expect(s, q.id).not.toContain("$");
      expect(s, q.id).not.toMatch(/\d{1,3}([.,]\d{3})+/);
      expect(s, q.id).not.toMatch(/d[eé]jame buscar|claro,|un momento/i);
    }
    const seguimiento = qs.filter((q) => /contrato/i.test(q.question) && (q.followUp || q.followup || q.previous || q.after));
    expect(seguimiento.length).toBeGreaterThan(0);
    expect(seguimiento.some((q) => byId.get(q.id)?.ok === true)).toBe(true);
  });

  it("AC-11.5 (cambio 006) real-conversations.json tiene ~10 conversaciones de varios turnos, texto y voz, con falla de datos.gov.co", () => {
    expect(existsSync(resolve(root, "eval/real-conversations.json"))).toBe(true);
    const raw = read("eval/real-conversations.json");
    const cs: any[] = Array.isArray(raw) ? raw : raw?.conversations ?? [];
    expect(cs.length).toBeGreaterThanOrEqual(8);
    for (const c of cs) {
      expect(c.id).toBeTruthy();
      expect(c.turns.length, c.id).toBeGreaterThanOrEqual(2);
      for (const t of c.turns) {
        expect(["texto", "voz"]).toContain(t.channel);
        expect(String(t.question).trim().length).toBeGreaterThan(0);
        expect(t.expect && Object.keys(t.expect).length).toBeGreaterThan(0);
      }
    }
    const canales = new Set(cs.flatMap((c) => c.turns.map((t: any) => t.channel)));
    expect(canales.has("texto") && canales.has("voz")).toBe(true);
    expect(JSON.stringify([cs, arr(read("eval/real-questions.json"))])).toMatch(/falla|ca[ií]d|respaldo|datosgov_down|fail/i);
  });

  it("AC-11.5 (cambio 006) real-results.json trae las conversaciones, una entrada por conversación y >= 90 % ok", () => {
    const r = read("eval/real-results.json");
    const raw = read("eval/real-conversations.json");
    const cs: any[] = Array.isArray(raw) ? raw : raw?.conversations ?? [];
    expect(Array.isArray(r.conversations)).toBe(true);
    expect(r.conversations.map((x: any) => x.id).sort()).toEqual(cs.map((c) => c.id).sort());
    const ok = r.conversations.filter((x: any) => x.ok === true).length;
    expect(ok / r.conversations.length).toBeGreaterThanOrEqual(0.9);
  });

  it("AC-11.5 (cambio 007) conserva las preguntas originales 'en Nariño' y 'en Caldas'", () => {
    const txt = arr(read("eval/real-questions.json")).map((q) => String(q.question)).join(" ");
    expect(txt).toMatch(/en Nari[ñn]o/i);
    expect(txt).toMatch(/en Caldas/i);
  });

  it("AC-11.5 (cambio 007) los chequeos no son triviales: cada expect declara algo comprobable (no solo ok:true)", () => {
    for (const q of arr(read("eval/real-questions.json"))) {
      const keys = Object.keys(q.expect ?? {}).filter((k) => !/^(ok|any|skip)$/i.test(k));
      expect(keys.length, q.id).toBeGreaterThan(0);
    }
  });

  it("AC-13.11 existe scripts/prod-probe.ts y el script npm probe:prod", () => {
    expect(existsSync(resolve(root, "scripts/prod-probe.ts"))).toBe(true);
    expect(read("package.json").scripts?.["probe:prod"]).toMatch(/prod-probe/);
  });

  it("AC-13.11 eval/prod-probe-results.json: >= 15 resultados con texto y voz, >= 90 % ok", () => {
    expect(existsSync(resolve(root, "eval/prod-probe-results.json"))).toBe(true);
    const r = read("eval/prod-probe-results.json");
    expect(Number.isNaN(Date.parse(r.runAt))).toBe(false);
    expect(typeof r.target).toBe("string");
    expect(r.results.length).toBeGreaterThanOrEqual(15);
    const canales = new Set(r.results.map((x: any) => x.channel));
    expect(canales.has("texto") && canales.has("voz")).toBe(true);
    for (const c of ["texto", "voz"]) {
      const rs = r.results.filter((x: any) => x.channel === c);
      expect(rs.length, c).toBeGreaterThanOrEqual(15);
      expect(rs.filter((x: any) => x.ok === true).length / rs.length, c).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("AC-11.5 package.json tiene el script eval:real", () => {
    expect(read("package.json").scripts?.["eval:real"]).toBeTruthy();
  });
});
