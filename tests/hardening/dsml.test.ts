import { describe, expect, it } from "vitest";
import { parseDsml, runAgent, type Llm } from "../../server/agent/loop.js";

// Respuesta real de DeepSeek en producción (2026-10-16): la llamada a herramienta llegó como texto DSML.
const REAL = '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="consultar_contratos">\n<｜｜DSML｜｜ parameter name="entidad" string="true">Alcaldía de Manizales</｜｜DSML｜｜ parameter>\n<｜｜DSML｜｜ parameter name="tipo" string="true">mayores</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>';

describe("DSML de DeepSeek", () => {
  it("convierte el marcado DSML en una llamada a herramienta", () => {
    const [c] = parseDsml(REAL);
    expect(c.name).toBe("consultar_contratos");
    expect(JSON.parse(c.arguments)).toEqual({ entidad: "Alcaldía de Manizales", tipo: "mayores" });
  });
  it("nunca devuelve ni emite marcado DSML como respuesta", async () => {
    const llm: Llm = { async complete({ onToken }) { onToken?.(REAL); return { content: REAL, toolCalls: [], tokens: 10 }; } };
    const said: string[] = [];
    const r = await runAgent({ message: "contrato más grande en Manizales", context: {}, tools: {}, llm, onToken: (t) => said.push(t) });
    expect(r.text).not.toMatch(/DSML|｜/);
    expect(r.degraded).toBe(true);
  });
});
