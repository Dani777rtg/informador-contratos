import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { matchEntity, matchPlace, type Place } from "../../server/data/places";
import { toEntity } from "../../server/data/socrata";
import { withBudget } from "../../server/data/budget";
import { FORBIDDEN_KEY, fromSnapshot, sanitize, type Snapshot } from "../../server/fallback/snapshot";
import { roundAmounts } from "../../server/speech/spoken";
import { createQuestionLogger } from "../../server/log";

const places: Place[] = [["Manizales", "Caldas"], ["Rionegro", "Antioquia"], ["Rionegro", "Santander"], ["Bogotá", "Distrito Capital de Bogotá"]]
  .map(([ciudad, departamento]) => ({ ciudad, departamento, norm: ciudad.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() }));

describe("coincidencia aproximada", () => {
  it("tolera tildes y errores de STT", () => {
    expect(matchPlace("Manisales", places)).toEqual({ municipio: "Manizales", departamento: "Caldas", alcance: "municipio" });
    expect(matchPlace("bogota", places)).toMatchObject({ municipio: "Bogotá" });
  });
  it("municipio en dos departamentos: sugiere, o desambigua con el departamento", () => {
    expect(matchPlace("Rionegro", places)).toEqual({ sugerencias: ["Rionegro (Antioquia)", "Rionegro (Santander)"] });
    expect(matchPlace("Rionegro", places, "Santander")).toMatchObject({ departamento: "Santander" });
  });
  it("departamento y entidades", () => {
    expect(matchPlace("Antioquia", places)).toMatchObject({ departamento: "Antioquia", alcance: "departamento" });
    expect(matchEntity("alcaldia de manisales", [toEntity("1", "ALCALDIA DE MANIZALES"), toEntity("2", "ALCALDIA DE CALI")])).toMatchObject({ entity: { nit: "1" } });
  });
});

describe("presupuesto y respaldo", () => {
  it("withBudget aborta a los 6,5 s", () => {
    expect(withBudget({ base: "x" }, 5).signal).toBeInstanceOf(AbortSignal);
  });
  it("sanitize quita documentos y contactos de personas naturales", () => {
    const out = sanitize({ a: [{ documento_proveedor: "123", tipodocproveedor: "CC", telefono: "3", proveedor_adjudicado: "Juan" }] });
    expect(JSON.stringify(out)).toBe('{"a":[{"proveedor_adjudicado":"Juan"}]}');
  });
  it("el respaldo versionado no contiene claves de documentos ni de contacto", () => {
    const snap = JSON.parse(gunzipSync(readFileSync("server/fallback/snapshot.json.gz")).toString()) as Snapshot;
    const keys = [...JSON.stringify(snap.top).matchAll(/"([\w]+)":/g)].map((m) => m[1]);
    expect(keys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
    expect(snap.agg.length).toBeGreaterThan(100);
  });
  it("fromSnapshot respeta territorio y año", () => {
    const s: Snapshot = { generatedAt: "2026-01-01T00:00:00Z", agg: [["Caldas", "Manizales", 2025, "Obra", 2_000_000_000, 3], ["Caldas", "Manizales", 2024, "Obra", 9, 1]], top: {} };
    expect(fromSnapshot(s, "gasto_total", { municipio: "Manizales", anio: 2025 }, 5)?.cards[0]).toMatchObject({ total: "$2.000.000.000 COP", count: 3 });
    expect(fromSnapshot(s, "gasto_total", { municipio: "Pasto" }, 5)).toBeNull();
  });
});

describe("montos y log", () => {
  it("texto en millones de pesos; la tarjeta COP se redondea", () => {
    expect(roundAmounts("Vale $2.700.123.456 COP")).toBe("Vale $2.700 millones de pesos");
  });
  it("el log acepta los campos nuevos y no escribe contenido", () => {
    let line = "";
    createQuestionLogger((l) => { line = l; })({ tokens: 1, latencyMs: 2, channel: "texto", intent: "gasto", route: "agente", tools: ["gasto_total"], declineCode: "NO-06", errorType: "x", closeReason: "ok" });
    expect(JSON.parse(line)).toMatchObject({ intent: "gasto", route: "agente", tools: ["gasto_total"], declineCode: "NO-06", closeReason: "ok" });
  });
});
