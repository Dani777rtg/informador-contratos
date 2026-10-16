import { describe, expect, it } from "vitest";
import { createDeepseekLlm, runAgent, type Ctx, type ToolRegistry } from "../../server/agent/loop";
import { allowedNumbers, verifyNumbers } from "../../server/agent/verify-numbers";
import { createDeepseekMock } from "../../server/mocks/deepseek";

const spend = { name: "spend", description: "gasto", parameters: { type: "object", properties: {} } };
const tools = (calls: string[] = []): ToolRegistry => ({
  spend: {
    ...spend,
    run: async (args, ctx) => {
      calls.push(JSON.stringify([args, ctx]));
      return { data: [{ total: "$1.234.567", count: 3 }], cards: [{ kind: "spend", total: "$1.234.567", count: 3 }], context: { period: { from: "2024-01-01", to: "2024-12-31" } } };
    },
  },
});
const llmFor = (text: string) => {
  const app = createDeepseekMock(text);
  return createDeepseekLlm({ baseUrl: "http://mock/v1", fetch: ((u: string, i: RequestInit) => app.request(u, i)) as unknown as typeof fetch });
};

describe("verifyNumbers", () => {
  const ok = allowedNumbers({ v: 1234567, b: "1.200.000.000.000" });
  it("normaliza formatos", () => {
    expect(verifyNumbers("Son $1.234.567. Y 1234567 también. Casi 1,2 billones.", ok).dropped).toEqual([]);
  });
  it("descarta frases con cifras inventadas", () => {
    const r = verifyNumbers("Son $1.234.567. Fueron $9.999.999 en total. Fin.", ok);
    expect(r.text).toBe("Son $1.234.567. Fin.");
  });
});

describe("runAgent", () => {
  it("usa herramientas, streamea solo frases verificadas y filtra cifras", async () => {
    const calls: string[] = [];
    const streamed: string[] = [];
    const ctx: Ctx = { entity: { nit: "1", name: "Cali" } };
    const r = await runAgent({
      message: "¿y en 2024?", context: ctx, tools: tools(calls), llm: llmFor("El total es $1.234.567. Hubo $8.888.888 extra. Listo."),
      onToken: (t) => streamed.push(t),
    });
    expect(r.text).toBe("El total es $1.234.567. Listo.");
    expect(streamed.join("").trim()).toBe(r.text);
    expect(r.cards).toHaveLength(1);
    expect(r.toolCalls.map((t) => t.name)).toEqual(["spend"]);
    expect(r.tokens).toBe(100);
    expect(r.context.entity).toEqual(ctx.entity); // seguimiento conserva entidad
    expect(r.context.period?.from).toBe("2024-01-01");
    expect(calls[0]).toContain("Cali");
  });
});
