import { describe, expect, it } from "vitest";
import { Lru } from "../../server/cache";
import { topContractors } from "../../server/tools/spend";
import { matchPlace } from "../../server/data/places";

const rows = [
  { proveedor_adjudicado: "CALDAS MEDICAS S.A.S.", s_valor_del_contrato: "100", n: "40" },
  { proveedor_adjudicado: "Computar", s_valor_del_contrato: "90", n: "59" },
  { proveedor_adjudicado: "CALDAS MEDICAS SAS", s_valor_del_contrato: "50", n: "26" },
];

describe("regresiones de datos", () => {
  it("el mismo contratista escrito de dos formas suma una sola fila", async () => {
    const fetchFn = (async () => new Response(JSON.stringify(rows))) as unknown as typeof fetch;
    const r = await topContractors({ client: { base: "http://x", fetchFn }, cache: new Lru() }, [], "count");
    expect(r.cards).toHaveLength(2);
    expect(r.cards[0]).toMatchObject({ name: "CALDAS MEDICAS S.A.S.", count: 66, total: "$150 COP" });
  });

  it("«Caldas» o «Nariño» a secas es el departamento, no el municipio homónimo", () => {
    const places = [{ ciudad: "Caldas", departamento: "Antioquia", norm: "caldas", n: 10 }, { ciudad: "Manizales", departamento: "Caldas", norm: "manizales", n: 100 }];
    expect(matchPlace("Caldas", places)).toMatchObject({ departamento: "Caldas", alcance: "departamento" });
    expect(matchPlace("Caldas", places, "Antioquia")).toMatchObject({ municipio: "Caldas", alcance: "municipio" });
  });
});
