import { describe, expect, it } from "vitest";
import { DEPARTAMENTOS, matchPlace, PLACE_KEYTERMS, type Place } from "../../server/data/places.js";
import { buildSettings, KEYTERMS } from "../../server/voice/agent.js";
import { MISSION_PROMPT } from "../../server/agent/mission.js";
import { createQuestionLogger } from "../../server/log.js";

const places: Place[] = [{ ciudad: "Tunja", departamento: "Boyacá", norm: "tunja", n: 50 }, { ciudad: "Pasto", departamento: "Nariño", norm: "pasto", n: 80 }];

describe("AC-13.10 lugares", () => {
  it("keyterms: 32 departamentos y >= 100 municipios, dentro del límite de ~500 tokens", () => {
    expect(DEPARTAMENTOS).toHaveLength(32);
    expect(PLACE_KEYTERMS.length).toBeGreaterThanOrEqual(132);
    expect(PLACE_KEYTERMS).toEqual(expect.arrayContaining(["Antioquia", "Tunja", "Pasto"]));
    expect(KEYTERMS.join(" ").length / 3).toBeLessThan(500);
  });
  it("coincidencia dudosa pide confirmar en vez de 'no hay datos'", () => {
    expect(matchPlace("Manisales", [...places, { ciudad: "Manizales", departamento: "Caldas", norm: "manizales", n: 9 }])).toMatchObject({ municipio: "Manizales" });
    expect(matchPlace("Tnnxa", places)).toMatchObject({ confirmar: "¿Dijiste Tunja, en Boyacá?" });
  });
});

describe("AC-13.5 / AC-05.8 voz", () => {
  it("decline está entre las funciones del agente y KEYTERMS lleva los lugares", () => {
    const s = buildSettings({}) as { agent: { think: { functions: { name: string }[] }; listen: { provider: { keyterms: string[] } } } };
    expect(s.agent.think.functions.map((f) => f.name)).toContain("decline");
    expect(s.agent.listen.provider.keyterms).toContain("Boyacá");
  });
  it("la misión tutea y saluda con calidez", () => {
    expect(MISSION_PROMPT).toMatch(/tutea/);
    expect(MISSION_PROMPT).toMatch(/saluda/);
  });
});

describe("AC-07.4 registro por turno en voz", () => {
  it("lleva intent, placeMatched y resultCode, sin texto", () => {
    const lines: string[] = [];
    createQuestionLogger((l) => lines.push(l))({ tokens: 0, latencyMs: 900, channel: "voz", route: "voz", tools: ["gasto_total"], intent: "consulta", placeMatched: "confirmar", resultCode: "lugar_desconocido" });
    expect(JSON.parse(lines[0])).toMatchObject({ channel: "voz", intent: "consulta", placeMatched: "confirmar", resultCode: "lugar_desconocido", latencyMs: 900 });
  });
});
