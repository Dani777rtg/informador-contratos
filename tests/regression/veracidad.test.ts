import { describe, expect, it } from "vitest";
import { createApp } from "../../server/index";
import { createTools } from "../../server/agent/tools";
import { compact } from "../../server/agent/loop";
import { Lru } from "../../server/cache";
import { buildParams, resolveEntity, toEntity, type Row } from "../../server/data/socrata";
import { findPlace, type Place } from "../../server/data/places";
import { buildWhere, matching } from "../../server/tools/filters";

// Valores reales de ciudad/departamento en datos.gov.co (jbjy-vk9h), consultados en octubre de 2026.
const places: Place[] = [
  ["Manizales", "Caldas"], ["Cartagena", "Bolívar"], ["Cartagena Del Chairá", "Caquetá"], ["Pasto", "Nariño"],
  ["Medellín", "Antioquia"], ["Bogotá", "Distrito Capital de Bogotá"], ["Santa Marta", "Magdalena"],
].map(([ciudad, departamento]) => ({ ciudad, departamento, norm: ciudad.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() }));
const period = { from: "2025-10-16", to: "2026-10-16", defaulted: true };

describe("territorio (O-1: nunca datos de otro lugar)", () => {
  it("Manizales se resuelve a ciudad y departamento reales", () => {
    expect(findPlace("¿Cuál es el contrato más grande que se ha firmado en Manizales?", places)).toEqual({ ciudad: "Manizales", departamento: "Caldas" });
  });
  it("Cartagena no es Cartagena del Chairá; Bogotá y tildes funcionan", () => {
    expect(findPlace("¿Cuánto se ha gastado en salud en Cartagena?", places).departamento).toBe("Bolívar");
    expect(findPlace("contratos en Medellin", places).ciudad).toBe("Medellín");
    expect(findPlace("salud en bogota", places).ciudad).toBe("Bogotá");
  });
  it("solo departamento cuando no hay municipio", () => {
    expect(findPlace("¿Qué empresa tiene más contratos de vías en Antioquia este año?", places)).toEqual({ departamento: "Antioquia" });
  });
  it("tema + territorio filtra por territorio en $where; sin territorio usa $q", () => {
    const p = buildParams({ where: buildWhere({ ciudad: "Cartagena", departamento: "Bolívar", tema: "salud", period }) });
    expect(p.get("$q")).toBeNull();
    expect(p.get("$where")).toContain("ciudad = 'Cartagena'");
    expect(p.get("$where")).toContain("upper(objeto_del_contrato) like '%SALUD%'");
    // AC-01.8 (007): un solo criterio de tema, con o sin territorio.
    const nat = buildParams({ where: buildWhere({ tema: "educación", period }) });
    expect(nat.get("$q")).toBeNull();
    expect(nat.get("$where")).toMatch(/like '%EDUCACIÓN%' OR upper\(objeto_del_contrato\) like '%EDUCACION%'/);
  });
  it("matching descarta filas de otro territorio o tema (extintores de Santa Marta no responden vías en Antioquia)", () => {
    const rows: Row[] = [
      { nombre_entidad: "POLICIA SANTA MARTA", ciudad: "Santa Marta", departamento: "Magdalena", objeto_del_contrato: "Compra de extintores" },
      { nombre_entidad: "MUNICIPIO DE MONTEBELLO", ciudad: "Montebello", departamento: "Antioquia", objeto_del_contrato: "Mantenimiento de las VÍAS del municipio" },
    ];
    expect(matching(rows, { departamento: "Antioquia", tema: "vías" }).map((r) => r.ciudad)).toEqual(["Montebello"]);
    expect(matching(rows, { ciudad: "Montebello", tema: "vías" }).map((r) => r.ciudad)).toEqual(["Montebello"]); // el tema lo filtra el servidor (007)
  });
});

describe("entidades", () => {
  const idx = [toEntity("899999001", "MINISTERIO DE EDUCACION NACIONAL (MEN)"), toEntity("830114475", "MINISTERIO DEL INTERIOR"), toEntity("899999055", "MINISTERIO DE TRANSPORTE"), toEntity("800000001", "SUBRED INTEGRADA DE SERVICIOS DE SALUD SUR E.S.E")];
  it("Ministerio de Educación se resuelve", () => {
    expect(resolveEntity("¿Quién es el contratista que más recibe del Ministerio de Educación?", idx)).toMatchObject({ kind: "entity", entity: { nit: "899999001" } });
  });
  it("Ministerio ausente del índice no lista ministerios ajenos", () => {
    expect(resolveEntity("¿En qué gasta el Ministerio de Salud?", idx).kind).toBe("none");
  });
});

describe("herramientas del agente", () => {
  const calls: URLSearchParams[] = [];
  const fetchFn = (async (u: string) => { calls.push(new URL(u).searchParams); return Response.json([{ proveedor_adjudicado: "VERONICA DEL PILAR GOMEZ RODRIGUEZ", s_valor_del_contrato: "1500000", n: "2" }]); }) as unknown as typeof fetch;
  const tools = createTools({ client: { base: "http://x", fetchFn }, cache: new Lru<Row[]>() }, [toEntity("899999001", "MINISTERIO DE EDUCACION NACIONAL (MEN)"), toEntity("800000001", "SUBRED INTEGRADA DE SERVICIOS DE SALUD SUR E.S.E")], async () => places);

  it("top_contratistas agrupa por proveedor con ciudad en $where y nombre completo", async () => {
    calls.length = 0;
    const r = await tools.consultar.run({ filtros: { municipio: "Manizales" }, operacion: "sumar", agrupar: "contratista" }, {});
    expect(calls[0].get("$group")).toBe("proveedor_adjudicado");
    expect(calls[0].get("$select")).not.toContain("documento");
    expect(calls[0].get("$where")).toContain("ciudad = 'Manizales'");
    expect(r.cards?.[0]).toMatchObject({ kind: "contractor", name: "VERONICA DEL PILAR GOMEZ RODRIGUEZ", count: 2 });
    expect(JSON.stringify(compact(r.data))).toContain("VERONICA DEL PILAR GOMEZ RODRIGUEZ");
  });
  it("municipio o entidad desconocidos: error explícito, sin consultar otra cosa", async () => {
    calls.length = 0;
    expect((await tools.consultar.run({ filtros: { municipio: "Atlantis" }, operacion: "listar" }, { entity: { nit: "1", name: "X" } })).data).toMatchObject({ error: "lugar_desconocido" });
    expect(calls).toHaveLength(0);
    // Entidad fuera del índice: se busca por nombre y, sin resultados, se devuelven sugerencias en vez de datos de otra entidad.
    const empty = createTools({ client: { base: "http://x", fetchFn: (async () => Response.json([])) as unknown as typeof fetch }, cache: new Lru<Row[]>() }, [toEntity("899999001", "MINISTERIO DE EDUCACION NACIONAL (MEN)")], async () => places);
    expect((await empty.consultar.run({ filtros: { entidad: "Superintendencia Qwzxv" }, operacion: "listar" }, {})).data).toMatchObject({ error: "sin_resultados", sugerencias: expect.any(Array) });
  });
  it("sin coincidencias lo dice", async () => {
    const empty = createTools({ client: { base: "http://x", fetchFn: (async () => Response.json([])) as unknown as typeof fetch }, cache: new Lru<Row[]>() }, [], async () => places);
    expect((await empty.consultar.run({ filtros: { municipio: "Pasto", tema: "vías" }, operacion: "listar" }, {})).data).toHaveProperty("sinResultados");
  });
  it("un seguimiento con ciudad nueva no hereda la entidad del contexto", async () => {
    calls.length = 0;
    await tools.consultar.run({ filtros: { municipio: "Pasto" }, operacion: "sumar", agrupar: "categoria" }, { entity: { nit: "899999001", name: "MEN" } });
    expect(calls[0].get("$where")).not.toContain("nit_entidad");
  });
});

describe("sin atajos: las preguntas de datos van al agente", () => {
  const { app } = createApp({ MOCK_EXTERNALS: "1" });
  const ask = async (message: string) => (await app.request("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) })).json() as Promise<{ filters?: unknown; cards: { kind: string }[] }>;
  it.each([
    "¿Cuál es el contrato más grande que se ha firmado en Manizales?",
    "¿Qué empresa tiene más contratos de vías en Antioquia este año?",
    "¿Cuánto se ha gastado en salud en Cartagena?",
    "¿Quién es el contratista que más recibe de la Alcaldía de Cali?",
    "¿Cuáles son los contratos más grandes de la Alcaldía de Cali?",
  ])("va al agente: %s", async (q) => { expect(await ask(q)).toHaveProperty("filters"); });
  it("entidad clara + intención clara: el agente devuelve el ranking de contratos", async () => {
    const r = await ask("¿Cuáles son los contratos más grandes de la Alcaldía de Cali?");
    expect(r.cards.some((c) => c.kind === "top")).toBe(true);
  });
});
