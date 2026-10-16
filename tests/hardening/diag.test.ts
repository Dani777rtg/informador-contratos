import { describe, expect, it } from "vitest";
import { diagLog, isDiagnostic, redact } from "../../server/diag";
import { MISSION_PROMPT } from "../../server/agent/mission";

const env = { DIAG_CODE: "codigo-secreto-123" };

describe("modo diagnóstico (TM-17)", () => {
  it("fail-closed sin DIAG_CODE y con código incorrecto", () => {
    expect(isDiagnostic("x", "o1", {})).toBe(false);
    expect(isDiagnostic("", "o1", env)).toBe(false);
    expect(isDiagnostic("otro", "o2", env)).toBe(false);
    expect(isDiagnostic(env.DIAG_CODE, "o3", env)).toBe(true);
  });
  it("bloquea al origen tras 5 intentos fallidos, incluso con el código correcto", () => {
    for (let i = 0; i < 5; i++) isDiagnostic("mal", "abusivo", env);
    expect(isDiagnostic(env.DIAG_CODE, "abusivo", env)).toBe(false);
    expect(isDiagnostic(env.DIAG_CODE, "abusivo", env, Date.now() + 11 * 60_000)).toBe(true);
  });
  it("redacta correos, teléfonos y cédulas, trunca y no escribe el código", () => {
    expect(redact("soy a@b.co, cel +57 300 123 4567, cc 1.020.304.050")).toBe("soy [correo], cel [número], cc [número]");
    const out: string[] = [];
    diagLog({ pregunta: "x".repeat(2000), n: 3 }, (l) => out.push(l));
    const j = JSON.parse(out[0]);
    expect(j.log).toBe("diag");
    expect(j.pregunta.length).toBe(600);
    expect(out[0]).not.toContain(env.DIAG_CODE);
  });
});

describe("misión", () => {
  it("corta y nombra las herramientas", () => {
    expect(MISSION_PROMPT.length).toBeLessThan(3600); // < 900 tokens
    for (const t of ["consultar", "buscar_entidad", "detalle_contrato", "NO-16"]) expect(MISSION_PROMPT).toContain(t);
  });
});
