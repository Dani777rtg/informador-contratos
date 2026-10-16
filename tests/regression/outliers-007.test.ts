import { describe, expect, it } from "vitest";
import { isOutlier, withoutOutliers } from "../../server/data/outliers";
import { buildParams } from "../../server/data/socrata";
import { spokenAmount } from "../../server/speech/spoken";
import { resolveFollowUp } from "../../server/session";

describe("T025 atípicos y escalas", () => {
  it("isOutlier", () => {
    expect(isOutlier(577e12)).toBe(true);
    expect(isOutlier(4.2e12)).toBe(false);
    expect(isOutlier(6e9, 10e9)).toBe(true);
  });
  it("el servidor compara y ordena valor_del_contrato como número", () => {
    const p = buildParams({ where: withoutOutliers([]), order: { col: "valor_del_contrato", desc: true } });
    expect(p.get("$where")).toBe("valor_del_contrato::number <= 10000000000000");
    expect(p.get("$order")).toBe("valor_del_contrato::number DESC");
  });
  it("spokenAmount sin error de escala", () => {
    expect(spokenAmount(944e9)).toBe("944 mil millones de pesos");
    expect(spokenAmount(1.2e12)).toBe("un billón doscientos mil millones de pesos");
    expect(spokenAmount(27e9)).toBe("27 mil millones de pesos");
    expect(spokenAmount(577e12)).toBe("577 billones de pesos");
  });
  it("seguimientos de detalle: ordinal, número, «el más grande», «ábrelo»", () => {
    const ctx = { results: ["A", "B", "C", "D", "E"] };
    expect(resolveFollowUp("dame el detalle del segundo", ctx)).toBe("B");
    expect(resolveFollowUp("abre el contrato 4", ctx)).toBe("D");
    expect(resolveFollowUp("el más grande", ctx)).toBe("A");
    expect(resolveFollowUp("ábrelo", ctx)).toBe("A");
    expect(resolveFollowUp("contratos de 2024", ctx)).toBeNull();
  });
});
