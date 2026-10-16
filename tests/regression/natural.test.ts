import { describe, expect, it } from "vitest";
import { roundAmounts, normalNames, toSpoken, spokenAmount } from "../../server/speech/spoken";
import { resolveFollowUp } from "../../server/session";
import { DECLINE_TOOL } from "../../server/agent/decline";

describe("voz y lenguaje llano (fallas reales)", () => {
  it("$2.700.000.000 se habla en palabras, nunca como '2.7 dólares'", () => {
    const s = toSpoken("El contrato vale $2.700.000.000 y se firmó el 2026-03-15.");
    expect(s).toBe("El contrato vale dos mil setecientos millones de pesos y se firmó el 15 de marzo de 2026.");
    expect(s).not.toMatch(/\$|\d\.\d/);
  });
  it("spokenAmount rangos", () => {
    expect(spokenAmount(2_700_000_000)).toBe("dos mil setecientos millones de pesos");
    expect(spokenAmount(350_000_000)).toBe("350 millones de pesos");
  });
  it("chat: monto redondeado y nombres normales", () => {
    expect(roundAmounts("Valor $27.123.456.789 firmado")).toBe("Valor $27.123 millones firmado");
    expect(normalNames("con CONSTRUCTORA ABC SAS y el PAE")).toBe("con Constructora Abc Sas y el PAE");
  });
});

describe("seguimientos sobre resultados del agente", () => {
  const ctx = { results: ["CO1.A", "CO1.B"] };
  it.each(["el detalle de ese contrato", "dame ese contrato", "el más grande", "abre el primero", "ábrelo"])("%s -> primer resultado", (m) => {
    expect(resolveFollowUp(m, ctx)).toBe("CO1.A");
  });
  it("una pregunta nueva no se confunde con seguimiento", () => {
    expect(resolveFollowUp("¿Cuáles son los contratos más grandes de la Alcaldía de Cali?", ctx)).toBeNull();
  });
  it("decline no es salida para datos faltantes", () => {
    expect(DECLINE_TOOL.function.description).toMatch(/NUNCA porque falte un dato/);
  });
});
