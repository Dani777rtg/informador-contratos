import { describe, expect, it } from "vitest";
import demo from "../../server/fallback/demo-answers.json" with { type: "json" };
import { createApp } from "../../server/index";
import { resolveEntity, toEntity } from "../../server/data/socrata";

describe("respaldo precalculado del demo", () => {
  it("el JSON cubre las preguntas del demo con fecha de datos", () => {
    const keys = Object.keys(demo);
    for (const k of ["nit:890900286|spend|2025", "nit:890900286|contracts|2024", "nit:890399011|contracts|12m", "nit:899999001|spend|12m", "nit:890399011|top|12m"]) expect(keys).toContain(k);
    for (const e of Object.values(demo) as { updatedAt: string; queriedAt: string }[]) expect(Date.parse(e.updatedAt)).toBeGreaterThan(0);
  });

  it("si datos.gov.co vence el timeout, responde la copia por clave con su fecha", async () => {
    const { app } = createApp({ SOCRATA_BASE: "http://127.0.0.1:9", ALLOWED_ORIGINS: "" });
    const res = await app.request("/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "¿Qué contratos tiene el NIT 890399011?" }),
    });
    const j = (await res.json()) as { text: string; cached: boolean; cards: unknown[]; source: { dataUpdatedAt: string } };
    const e = (demo as Record<string, { updatedAt: string }>)["nit:890399011|contracts|12m"];
    expect(j.cached).toBe(true);
    expect(j.cards.length).toBeGreaterThan(0);
    expect(j.source.dataUpdatedAt).toBe(e.updatedAt);
    expect(j.text).toContain(e.updatedAt.slice(0, 10));
  });

  it("NIT 890399011 se presenta como Alcaldía de Santiago de Cali y 'Alcaldía de Cali' lo resuelve", () => {
    const idx = [toEntity("890399011", "SANTIAGO DE CALI DISTRITO ESPECIAL - SECRETARIA DEL DEPORTE Y LA RECREACIÓN"), toEntity("805003895", "PERSONERIA DISTRITAL DE SANTIAGO DE CALI")];
    expect(idx[0].name).toBe("Alcaldía de Santiago de Cali");
    expect(resolveEntity("contratos de la Alcaldía de Cali", idx)).toMatchObject({ kind: "entity", entity: { nit: "890399011" } });
  });
});
