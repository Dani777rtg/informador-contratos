import { describe, expect, it } from "vitest";
import { createTopicGuard } from "../../server/session-topic";
import { toEntity } from "../../server/data/socrata";

const entities = [
  toEntity("890801054", "ALCALDIA DE MANIZALES"),
  toEntity("890000464", "ALCALDIA DE ARMENIA"),
  toEntity("890399011", "x"), // Alcaldía de Santiago de Cali (aka Cali)
  toEntity("800000001", "GOBERNACION DEL QUINDIO"),
];
const guard = createTopicGuard(entities);
const ctx = { entity: { nit: "890801054", name: "Alcaldía de Manizales" }, period: { from: "2024-01-01", to: "2024-12-31" }, contract: "C1", results: ["C1", "C2"], turns: 2 };

describe("cambio de tema por turno (texto y voz)", () => {
  it("nombrar otro municipio limpia el contexto y conserva turns", () => {
    expect(guard("Armenia", ctx)).toEqual({ turns: 2 });
    expect(guard("¿y en Cali?", ctx)).toEqual({ turns: 2 });
    expect(guard("y la gobernación del Quindío", ctx)).toEqual({ turns: 2 });
  });
  it("nombrar otro NIT o tema limpia el contexto", () => {
    expect(guard("contratos del NIT 899999999", ctx)).toEqual({ turns: 2 });
    expect(guard("¿y de alumbrado público?", ctx)).toEqual({ turns: 2 });
  });
  it("un seguimiento sin entidad nueva conserva el contexto", () => {
    expect(guard("¿y en 2024?", ctx)).toBe(ctx);
    expect(guard("cuáles son los más grandes de Manizales", ctx)).toBe(ctx);
  });
});
