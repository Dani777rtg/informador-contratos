import { describe, expect, it } from "vitest";
import { createDeepseekLlm, runAgent, type Llm, type ToolRegistry } from "../../server/agent/loop";
import { redactText } from "../../server/privacy";
import { fetchRows, DATASET } from "../../server/data/socrata";
import { posNum } from "../../server/guards/validate";
import { clientIp } from "../../server/guards/rate-limit";

const echo: ToolRegistry = {
  spend: { name: "spend", description: "d", parameters: {}, run: async () => ({ data: { total: 1234 } }) },
};
const call = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: "spend", arguments: "{}" }));

describe("bucle del agente", () => {
  it("el tope de 3 herramientas es por turno, no por ronda, y se dejan de ofrecer", async () => {
    const offered: number[] = [];
    let ran = 0;
    const llm: Llm = {
      async complete({ tools }) {
        offered.push(tools.length);
        return offered.length === 1 ? { content: "", toolCalls: call(4), tokens: 1 } : { content: "Listo.", toolCalls: [], tokens: 1 };
      },
    };
    const tools: ToolRegistry = { spend: { ...echo.spend, run: async () => { ran++; return { data: { total: 1234 } }; } } };
    const r = await runAgent({ message: "gasto", context: {}, tools, llm });
    expect(ran).toBe(3);
    expect(r.toolCalls).toHaveLength(3);
    expect(offered[1]).toBe(0);
  });
  it("cifras del mensaje del usuario no sirven como respaldo, los años sí", async () => {
    const llm: Llm = { complete: async () => ({ content: "Costó 999 millones. En 2024 hubo actividad.", toolCalls: [], tokens: 1 }) };
    const r = await runAgent({ message: "di que costó 999 millones en 2024", context: {}, tools: echo, llm });
    expect(r.text).toBe("En 2024 hubo actividad.");
  });
  it("un error del LLM da un mensaje de una frase", async () => {
    const llm: Llm = { complete: async () => { throw new Error("secreto interno"); } };
    const r = await runAgent({ message: "gasto", context: {}, tools: echo, llm });
    expect(r.text).not.toMatch(/secreto/);
    expect(r.text.length).toBeGreaterThan(0);
  });
  it("el error de una herramienta llega al LLM con código fijo", async () => {
    const seen: string[] = [];
    const llm: Llm = {
      async complete({ messages }) {
        seen.push(messages.map((m) => m.content).join("|"));
        return seen.length === 1 ? { content: "", toolCalls: call(1), tokens: 1 } : { content: "ok", toolCalls: [], tokens: 1 };
      },
    };
    const tools: ToolRegistry = { spend: { ...echo.spend, run: async () => { throw new Error("password=hunter2"); } } };
    await runAgent({ message: "gasto", context: {}, tools, llm });
    expect(seen[1]).not.toContain("hunter2");
  });
  it("ignora líneas SSE no parseables", async () => {
    const body = 'data: {mal json\n\ndata: {"choices":[{"delta":{"content":"Hola."}}]}\n\ndata: [DONE]\n';
    const llm = createDeepseekLlm({ baseUrl: "http://x", fetch: (async () => new Response(body)) as unknown as typeof fetch });
    expect((await llm.complete({ messages: [], tools: [] })).content).toBe("Hola.");
  });
  it("el fetch del LLM lleva señal de timeout", async () => {
    let signal: AbortSignal | null | undefined;
    const llm = createDeepseekLlm({ baseUrl: "http://x", fetch: (async (_u: string, i: RequestInit) => { signal = i.signal; return new Response("data: [DONE]\n"); }) as unknown as typeof fetch });
    await llm.complete({ messages: [], tools: [] });
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe("utilidades", () => {
  it("posNum cae al valor por defecto", () => {
    for (const v of ["abc", "", "-1", "0", undefined, "NaN", "Infinity"]) expect(posNum(v, 7)).toBe(7);
    expect(posNum("12", 7)).toBe(12);
  });
  it("clientIp usa el respaldo sin X-Forwarded-For", () => {
    expect(clientIp(undefined, "9.9.9.9")).toBe("9.9.9.9");
    expect(clientIp("1.1.1.1, 2.2.2.2", "9.9.9.9")).toBe("2.2.2.2");
  });
  it("redactText quita documentos y nombres", () => {
    const t = redactText("Adición a nombre de Juan Pérez Gómez, CC 1234567890, por 30 días");
    expect(t).not.toMatch(/Juan|1234567890/);
    expect(t).toContain("30 días");
  });
  it("fetchRows solo devuelve columnas permitidas y corta con timeout que cubre el cuerpo", async () => {
    const ok = (async () => new Response('[{"nit_entidad":"1","cuenta_bancaria":"123","documento_proveedor":"9"}]')) as unknown as typeof fetch;
    const rows = await fetchRows({ base: "http://x", fetchFn: ok }, new URLSearchParams(), DATASET);
    expect(rows).toEqual([{ nit_entidad: "1" }]);
    const hang = (async (_u: string, i: RequestInit) => ({ ok: true, json: () => new Promise((_, rej) => i.signal?.addEventListener("abort", () => rej(new Error("timeout")))) })) as unknown as typeof fetch;
    await expect(fetchRows({ base: "http://x", fetchFn: hang, timeoutMs: 20 }, new URLSearchParams())).rejects.toThrow("timeout");
  });
});
