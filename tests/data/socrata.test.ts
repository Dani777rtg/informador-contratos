import { describe, expect, it } from "vitest";
import { buildParams, lit, query, resolveEntity, toEntity } from "../../server/data/socrata";

describe("cliente Socrata", () => {
  it("escapa comillas y limita $limit a 100", () => {
    expect(lit("x' OR 1=1")).toBe("'x'' OR 1=1'");
    const p = buildParams({ where: [{ col: "proveedor_adjudicado", op: "=", value: "O'Neil" }], limit: 100000 });
    expect(p.get("$where")).toBe("proveedor_adjudicado = 'O''Neil'");
    expect(p.get("$limit")).toBe("100");
  });
  it("rechaza columnas fuera de la lista permitida", () => {
    expect(() => buildParams({ select: ["cuenta_bancaria" as never] })).toThrow();
  });
  it("envía X-App-Token, usa respuestas grabadas y falla por timeout", async () => {
    let hdr: unknown;
    const ok = (async (_u: string, i: RequestInit) => { hdr = i.headers; return new Response('[{"nit_entidad":"890399011"}]'); }) as unknown as typeof fetch;
    const rows = await query({ base: "http://x", token: "t", fetchFn: ok }, { limit: 1 });
    expect(rows[0].nit_entidad).toBe("890399011");
    expect(hdr).toEqual({ "X-App-Token": "t" });
    const slow = (() => new Promise(() => {})) as unknown as typeof fetch;
    await expect(query({ base: "http://x", fetchFn: slow, timeoutMs: 20 }, {})).rejects.toThrow("timeout");
  });
});

describe("índice de entidades y desambiguación", () => {
  const idx = [toEntity("1", "Alcaldía de Cali"), toEntity("2", "Alcaldía de Medellín"), toEntity("3", "Gobernación de Antioquia")];
  it("resuelve nombre completo sin tildes", () => {
    expect(resolveEntity("contratos de la alcaldia de cali", idx)).toMatchObject({ kind: "entity", entity: { nit: "1" } });
  });
  it("nombre genérico es ambiguo con opciones", () => {
    const r = resolveEntity("contratos de la Alcaldía", idx);
    expect(r.kind === "ambiguous" && r.options.length).toBe(2);
  });
  it("sin coincidencia", () => {
    expect(resolveEntity("hola", idx).kind).toBe("none");
  });
});
