// T028: consultar (AC-13.12) y buscar_entidad (AC-13.13). Sin red.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Lru } from "../../server/cache";
import { ALIASES, aliasNit, buscarEntidad } from "../../server/data/entity-aliases";
import { runQuery } from "../../server/agent/query";
import { textTerms } from "../../server/tools/filters";

const entities = JSON.parse(readFileSync("data/entities.json", "utf8")) as { nit: string; name: string }[];

describe("entity-aliases", () => {
  it("al menos 60 siglas y nombres comunes, y cada NIT existe en data/entities.json", () => {
    expect(Object.keys(ALIASES).length).toBeGreaterThanOrEqual(60);
    const nits = new Set(entities.map((e) => e.nit));
    for (const [alias, nit] of Object.entries(ALIASES)) expect(nits.has(nit), `${alias} -> ${nit}`).toBe(true);
  });
  it("«Ministerio TIC» y variantes llegan al mismo NIT", () => {
    for (const t of ["Ministerio TIC", "MinTIC", "min tic", "Ministerio de Tecnología"]) expect(aliasNit(t), t).toBe("899999053");
    expect(buscarEntidad("contratos del ICBF", entities as never).candidatos[0].nit).toBe("899999239");
  });
});

describe("consultar", () => {
  const calls: URLSearchParams[] = [];
  const mk = () => ({ client: { base: "http://x", fetchFn: (async (u: string) => { calls.push(new URL(u).searchParams); return Response.json([{ valor_del_contrato: "5", s_valor_del_contrato: "10", n: "2", g: "2026-03-01T00:00:00.000", tipo_de_contrato: "Obra" }]); }) as unknown as typeof fetch }, cache: new Lru() }) as never;
  it("«Ministerio TIC» filtra por el NIT oficial", async () => {
    calls.length = 0;
    await runQuery({ filtros: { entidad: "Ministerio TIC" }, operacion: "contar" }, mk());
    expect(calls[0].get("$where")).toContain("nit_entidad = '899999053'");
  });
  it("menor valor: orden ascendente numérico y sin contratos de $0", async () => {
    calls.length = 0;
    await runQuery({ filtros: { municipio: "Tunja" }, operacion: "listar", orden: "asc" }, mk());
    expect(calls[0].get("$order")).toMatch(/^valor_del_contrato::number ASC/);
    expect(calls[0].get("$where")).toContain("valor_del_contrato::number >= 1");
  });
  it("por mes agrupa con date_trunc y promediar usa avg", async () => {
    calls.length = 0;
    const r = await runQuery({ filtros: { departamento: "Caldas" }, operacion: "promediar", agrupar: "mes" }, mk());
    expect(calls[0].get("$select")).toMatch(/date_trunc_ym\(fecha_de_firma\) as g.*avg\(/);
    expect(r.cards?.[0]).toMatchObject({ kind: "spend", category: expect.stringContaining("2026-03") });
  });
  it("agrupar por fuente devuelve tarjetas funding", async () => {
    const c = { client: { base: "http://x", fetchFn: (async () => Response.json([{ s_recursos_propios: "7", s_presupuesto_general_de_la_nacion_pgn: "3", n: "1" }])) as unknown as typeof fetch }, cache: new Lru() } as never;
    const r = await runQuery({ filtros: { departamento: "Caldas" }, operacion: "sumar", agrupar: "fuente" }, c);
    expect(r.cards?.every((x) => x.kind === "funding")).toBe(true);
  });
  it("columnas desconocidas al nivel superior se rechazan sin consultar", async () => {
    calls.length = 0;
    expect((await runQuery({ columna: "documento_proveedor", operacion: "listar" }, mk())).data).toMatchObject({ error: "parametro_invalido" });
    expect(calls).toHaveLength(0);
  });
  it("estado y modalidad conservan el texto tal cual y sus variantes", () => {
    expect(textTerms("En ejecución").split("|")).toEqual(expect.arrayContaining(["En ejecución", "En ejecucion", "EN EJECUCIÓN"]));
  });
});
