// Datos reales de datos.gov.co (solo con REAL_DATA=1): lista y total de un tema cuadran; atípicos fuera; detalle de contratos mostrados.
import { describe, expect, it } from "vitest";
import { Lru } from "../../server/cache";
import { runTool } from "../../server/agent/tools";

const real = process.env.REAL_DATA === "1";
const ctx = () => ({ client: { base: "https://www.datos.gov.co", token: process.env.DATOSGOV_APP_TOKEN }, cache: new Lru() }) as never;
const num = (s: unknown) => Number(String(s).replace(/\D/g, ""));

describe.skipIf(!real)("T025 con datos reales", () => {
  it("educación en Yopal: el mayor de la lista no supera el total y con/sin tilde coinciden", async () => {
    const c = ctx();
    const a: any = await runTool("gasto_total", { municipio: "Yopal", tema: "educación", anio: 2025 }, c);
    const b: any = await runTool("gasto_total", { municipio: "Yopal", tema: "educacion", anio: 2025 }, c);
    expect(JSON.stringify(a.cards)).toBe(JSON.stringify(b.cards));
    const l: any = await runTool("buscar_contratos", { municipio: "Yopal", tema: "educación", anio: 2025, limite: 5 }, c);
    const total = num(a.cards[0].total);
    const vals = l.cards.map((x: any) => num(x.value));
    expect(vals).toEqual([...vals].sort((x, y) => y - x));
    expect(vals[0]).toBeLessThanOrEqual(total);
    expect(a.cards[0].count).toBeGreaterThanOrEqual(l.cards.length);
  }, 30_000);

  it("Bogotá: el contratista con más valor no es el atípico y el mayor contrato lo deja aparte", async () => {
    const c = ctx();
    const r: any = await runTool("contratos_mayores", { municipio: "Bogotá", desde: "2026-01-01" }, c);
    expect(r.cards.filter((x: any) => !x.atipico).every((x: any) => num(x.value) <= 1e13)).toBe(true);
  }, 30_000);

  it("detalle completo de ≥ 5 contratos mostrados", async () => {
    const c = ctx();
    const l: any = await runTool("contratos_mayores", { municipio: "Yopal", anio: 2025, limite: 5 }, c);
    expect(l.data.ids.length).toBeGreaterThanOrEqual(5);
    for (const id of l.data.ids.slice(0, 5)) {
      const d: any = await runTool("detalle_contrato", { id_contrato: id }, c);
      const card = d.cards.find((x: any) => x.kind === "detail");
      for (const k of ["object", "entity", "contractor", "value", "signedAt", "startAt", "endAt", "status", "modality", "paid", "invoiced", "pending", "additions", "url"]) expect(card, k).toHaveProperty(k);
      expect(card.object).not.toBe("");
      expect(String(d.data.resumen)).toMatch(/ por .+\. Se ha pagado .+ pendientes .+\.$/);
    }
  }, 120_000);
});
