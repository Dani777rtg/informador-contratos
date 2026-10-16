import { describe, expect, it } from "vitest";
import { compact, runAgent, type Llm, type Tool } from "../../server/agent/loop";

const approx = (x: unknown) => Math.ceil(JSON.stringify(x).length / 4);
const big = Array.from({ length: 20 }, (_, i) => ({ kind: "contract", object: "x".repeat(300), value: `$${i}`, url: "https://x.co/" + "a".repeat(200) }));

describe("presupuesto de tokens por turno (AC-11.3)", () => {
  it("compacta: 5 filas, textos cortos, sin URLs", () => {
    const c = compact({ contratos: big }) as { contratos: Record<string, string>[] };
    expect(c.contratos).toHaveLength(5);
    expect(JSON.stringify(c)).not.toContain("http");
    expect(c.contratos[0].object.length).toBeLessThanOrEqual(61);
  });

  it("turno típico (2 rondas) ≤ 1500 tokens aprox. de entrada", async () => {
    const tool: Tool = { name: "consultar_contratos", description: "d", parameters: { type: "object" }, run: async () => ({ data: { contratos: big }, cards: [] }) };
    let calls = 0, total = 0;
    const llm: Llm = {
      async complete({ messages, tools }) {
        total += approx(messages) + approx(tools);
        return calls++ === 0 ? { content: "", toolCalls: [{ id: "1", name: "consultar_contratos", arguments: "{}" }], tokens: 0 } : { content: "Listo.", toolCalls: [], tokens: 0 };
      },
    };
    await runAgent({ message: "contratos de Cali", context: {}, tools: { [tool.name]: tool }, llm });
    expect(calls).toBe(2);
    expect(total).toBeLessThanOrEqual(1500);
  });
});
