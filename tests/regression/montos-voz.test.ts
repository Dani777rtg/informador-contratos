import { describe, expect, it } from "vitest";
import { forAgent } from "../../server/voice/agent";
import { wordsAmount } from "../../server/speech/spoken";

// El modelo de voz decía «novecientos cuarenta y cuatro billones» para 944 mil millones: los montos le llegan en palabras exactas.
describe("montos grandes para la voz", () => {
  it.each([
    [944_000_000_000, "novecientos cuarenta y cuatro mil millones de pesos"],
    [1_200_000_000_000, "un billón doscientos mil millones de pesos"],
    [27_000_000_000, "veintisiete mil millones de pesos"],
    [21_000_000_000, "veintiún mil millones de pesos"],
  ])("%i", (n, text) => {
    expect(wordsAmount(n)).toBe(text);
    expect(forAgent({ total: n })).toEqual({ total: text });
    expect(forAgent({ valor: `$${(n / 1e6).toLocaleString("es-CO")} millones de pesos` })).toEqual({ valor: text });
  });
});

describe("ids de contrato en la voz", () => {
  it("el id llega intacto (no se pasa a formato normal) para que detalle_contrato lo encuentre", () => {
    expect(forAgent({ ids: ["CO1.PCCNTR.8524939"] })).toEqual({ ids: ["CO1.PCCNTR.8524939"] });
    expect(forAgent({ entity: "INFI-MANIZALES" })).toEqual({ entity: "Infi-Manizales" });
  });
});
