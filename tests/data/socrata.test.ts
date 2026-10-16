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
    const slow = ((_u: string, i: RequestInit) => new Promise((_, rej) => i.signal?.addEventListener("abort", () => rej(i.signal?.reason)))) as unknown as typeof fetch;
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

describe("nombres reales del índice (con basura y alias)", () => {
  const idx = [
    toEntity("890900286", "DEPARTAMENTO DE ANTIOQUIA//"), toEntity("891800498", "GOBERNACIÓN DE BOYACÁ"),
    toEntity("890480059", "GOBERNACIÓN DE BOLÍVAR//"), toEntity("891480085", "GOBERNACIÓN DE RISARALDA**"),
    toEntity("890399011", "ALCALDIA DE CALI"), toEntity("890905211", "ALCALDÍA DE MEDELLÍN"), toEntity("899999061", "ALCALDÍA MAYOR DE BOGOTÁ (D.C.)"),
  ];
  it("gobernación de X equivale a departamento de X", () => {
    expect(resolveEntity("¿Cuánto ha contratado la Gobernación de Antioquia en 2025?", idx)).toMatchObject({ kind: "entity", entity: { nit: "890900286" } });
  });
  it("alcaldías", () => {
    expect(resolveEntity("Alcaldía de Medellín", idx)).toMatchObject({ kind: "entity", entity: { nit: "890905211" } });
    expect(resolveEntity("contratos del municipio de Cali", idx)).toMatchObject({ kind: "entity", entity: { nit: "890399011" } });
  });
  it("Bogotá con lugar gana a la genérica", () => {
    expect(resolveEntity("alcaldia de bogota", idx)).toMatchObject({ kind: "entity", entity: { nit: "899999061" } });
  });
  it("genérica sola da opciones", () => {
    expect(resolveEntity("gobernación", idx).kind).toBe("ambiguous");
  });
  it("buildParams usa $q sin meterlo en $where", () => {
    const p = buildParams({ where: [{ col: "objeto_del_contrato", op: "q", value: "alimentación' escolar" }, { col: "departamento", op: "=", value: "Boyacá" }] });
    expect(p.get("$q")).toBe("alimentación escolar");
    expect(p.get("$where")).toBe("departamento = 'Boyacá'");
  });
});

describe("alcaldía clara y nombre de presentación", () => {
  const idx = [
    toEntity("890399011", "SANTIAGO DE CALI DISTRITO ESPECIAL - SECRETARIA DEL DEPORTE Y LA RECREACIÓN"),
    toEntity("805003895", "PERSONERIA DISTRITAL DE SANTIAGO DE CALI"),
    toEntity("805013033", "FONDO ESPECIAL DE VIVIENDA DEL MUNICIPIO DE SANTIAGO DE CALI"),
  ];
  it("Alcaldía de Cali elige el distrito de Santiago de Cali, no las dependencias", () => {
    expect(resolveEntity("contratos más grandes de la Alcaldía de Cali", idx)).toMatchObject({ kind: "entity", entity: { nit: "890399011" } });
  });
  it("displayName limpia //, *, paréntesis y mayúsculas", () => {
    expect(toEntity("1", "DEPARTAMENTO DE ANTIOQUIA//").name).toBe("Departamento de Antioquia");
    expect(toEntity("2", "SUBRED INTEGRADA DE SERVICIOS DE SALUD SUR E.S.E.**").name).toBe("Subred Integrada de Servicios de Salud Sur E.S.E");
    expect(toEntity("3", "(Secretaría Distrital de Integración Social)").name).toBe("Secretaría Distrital de Integración Social");
    expect(toEntity("4", "MUNICIPIO DE PEREIRA- OFICIAL").name).toBe("Municipio de Pereira- Oficial");
  });
});
