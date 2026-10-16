import { describe, expect, it, vi } from "vitest";
import { fetchRows } from "../../server/data/socrata";
import { SocrataUnavailable, timeoutFor } from "../../server/data/retry";

const ok = (rows: unknown[]) => new Response(JSON.stringify(rows), { status: 200 });
const timeout = () => Object.assign(new Error("t"), { name: "TimeoutError" });
const client = (fn: (u: string) => Promise<Response>) => ({ base: "http://x", fetchFn: ((u: string) => fn(u)) as unknown as typeof fetch });
const q = (s: string) => new URLSearchParams(s);

describe("datos.gov.co: reintento y respaldo", () => {
  it("un timeout se reintenta una vez", async () => {
    let n = 0;
    const rows = await fetchRows(client(async () => { if (n++ === 0) throw timeout(); return ok([{ nombre_entidad: "A" }]); }), q("$limit=5"));
    expect(rows).toHaveLength(1);
    expect(n).toBe(2);
  });
  it("429 y 5xx se reintentan; 404 no", async () => {
    for (const s of [429, 503]) {
      let n = 0;
      await fetchRows(client(async () => (n++ === 0 ? new Response("", { status: s }) : ok([]))), q("$limit=5"));
      expect(n).toBe(2);
    }
    const f = vi.fn(async () => new Response("", { status: 404 }));
    await expect(fetchRows(client(f), q("$limit=5"))).rejects.toThrow("socrata 404");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("si falla dos veces prueba una consulta mas liviana ($limit menor)", async () => {
    const urls: string[] = [];
    const rows = await fetchRows(client(async (u) => { urls.push(u); if (urls.length < 3) throw timeout(); return ok([{}]); }), q("$limit=100"));
    expect(rows).toHaveLength(1);
    expect(urls[2]).toContain("%24limit=10");
  });
  it("sin respaldo posible lanza SocrataUnavailable (el agente da una frase honesta)", async () => {
    await expect(fetchRows(client(async () => { throw timeout(); }), q("$limit=5"))).rejects.toBeInstanceOf(SocrataUnavailable);
  });
  it("las agregaciones tienen mas tiempo que las consultas simples", () => {
    expect(timeoutFor(q("$select=sum(valor_del_contrato)&$group=sector"))).toBe(8000);
    expect(timeoutFor(q("$limit=5"))).toBe(3000);
  });
});
