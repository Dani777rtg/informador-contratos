/**
 * US-01 Consultar contratos, gasto y avance. Acceptance tests (locked).
 *
 * CONTRACT these tests assume (builders must provide it; nothing external is called):
 *  - `npx tsx server/index.ts` started with MOCK_EXTERNALS=1 serves the app with the
 *    stand-ins in server/mocks/ for DeepSeek, Deepgram, datos.gov.co and WhatsApp.
 *  - POST /api/chat  {message: string, state?: string}  ->  JSON
 *      { text: string,
 *        cards: Array<{ kind: string, ...fields }>,   // built from structured query data
 *        options?: string[],                          // tappable entity choices (ambiguous)
 *        hasMore?: boolean,                           // "ver más"
 *        period?: { from: string, to: string, defaulted: boolean },
 *        source: { dataset: string, queriedAt: string, dataUpdatedAt: string, url: string },
 *        cached?: boolean, state: string }
 *    Contract cards: kind "contract" {entity, contractor, object, value, signedAt, status, url};
 *      "spend" {category, total, count}; "funding" {source, total}; "top" {rank, name, value};
 *      "detail" {url, value, invoiced, paid, pending, addedDays, modifications[]}.
 *  - Mock controls (only in mock mode): POST /__mock/socrata {mode:"ok"|"slow"|"fail"|"empty"};
 *    GET /__mock/socrata/requests -> [{ url: string }] (every SoQL request the server made);
 *    DELETE /__mock/socrata/requests clears it.
 * Questions use the mock data set; assertions are structural (no pinned mock values).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PORT = 3991;
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}
beforeAll(async () => {
  proc = spawn("npx", ["tsx", "server/index.ts"], {
    shell: true, stdio: "ignore",
    env: { ...process.env, PORT: String(PORT), MOCK_EXTERNALS: "1" },
  });
  await waitUp();
}, 30000);
afterAll(() => { proc?.kill(); });

type Card = Record<string, any>;
async function ask(message: string, state?: string) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, state }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    text: string; cards: Card[]; options?: string[]; hasMore?: boolean;
    period?: { from: string; to: string; defaulted: boolean };
    source: { dataset: string; queriedAt: string; dataUpdatedAt: string; url: string };
    cached?: boolean; state: string;
  };
}
const mock = (mode: string) =>
  fetch(`${BASE}/__mock/socrata`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) });
const soqlRequests = async (): Promise<string[]> =>
  ((await (await fetch(`${BASE}/__mock/socrata/requests`)).json()) as { url: string }[]).map((r) => r.url);

beforeEach(async () => {
  await mock("ok");
  await fetch(`${BASE}/__mock/socrata/requests`, { method: "DELETE" });
});

const digits = (s: string) => (s.match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/\D/g, "")).filter((n) => n.length >= 4);
const flat = (o: unknown): string => JSON.stringify(o);

describe("US-01", () => {
  it("AC-01.1 contratos de una entidad: campos requeridos, máximo 5 visibles y ver más", async () => {
    const r = await ask("¿Qué contratos tiene la Alcaldía de Cali?");
    const cs = r.cards.filter((c) => c.kind === "contract");
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.length).toBeLessThanOrEqual(5);
    for (const c of cs) {
      for (const k of ["entity", "contractor", "object", "value", "signedAt", "status", "url"]) expect(c[k], k).toBeTruthy();
    }
    expect(r.hasMore).toBe(true);
  });

  it("AC-01.1 también por contratista (NIT) y por tema", async () => {
    for (const q of ["¿Qué contratos tiene el NIT 890399011?", "contratos de alumbrado público"]) {
      const r = await ask(q);
      expect(r.cards.some((c) => c.kind === "contract"), q).toBe(true);
    }
  });

  it("AC-01.2 gasto por categoría con número de contratos", async () => {
    const r = await ask("¿En qué gasta la Gobernación de Antioquia?");
    const cs = r.cards.filter((c) => c.kind === "spend");
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) { expect(c.category).toBeTruthy(); expect(c.total).toBeTruthy(); expect(Number(c.count)).toBeGreaterThan(0); }
  });

  it("AC-01.3 desglose por fuente de recursos", async () => {
    const r = await ask("¿De dónde sale el dinero de la Alcaldía de Cali?");
    const cs = r.cards.filter((c) => c.kind === "funding");
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) { expect(c.source).toBeTruthy(); expect(c.total).toBeTruthy(); }
  });

  it("AC-01.4 top 10 ordenado por valor descendente", async () => {
    const r = await ask("¿Cuáles son los contratos más grandes de la Alcaldía de Cali?");
    const cs = r.cards.filter((c) => c.kind === "top");
    expect(cs.length).toBeLessThanOrEqual(10);
    expect(cs.length).toBeGreaterThan(1);
    const vals = cs.map((c) => Number(String(c.value).replace(/\D/g, "")));
    expect(vals).toEqual([...vals].sort((a, b) => b - a));
  });

  it("AC-01.5 detalle de un contrato: valor, facturado, pagado, pendiente, días y modificaciones", async () => {
    const first = await ask("contratos de la Alcaldía de Cali");
    const r = await ask("dame el detalle y los pagos del primero", first.state);
    const d = r.cards.find((c) => c.kind === "detail");
    expect(d).toBeTruthy();
    for (const k of ["url", "value", "invoiced", "paid", "pending", "addedDays"]) expect(d![k], k).toBeDefined();
    // AC-13.9 (cambio 007): ficha completa
    for (const k of ["object", "entity", "contractor", "signedAt", "startAt", "endAt", "status", "modality", "additions"]) expect(d, `AC-13.9 ${k}`).toHaveProperty(k);
    expect(Array.isArray(d!.modifications)).toBe(true);
  });

  it("AC-01.6 entidad ambigua devuelve opciones tocables", async () => {
    const r = await ask("contratos de la Alcaldía");
    expect(r.options?.length ?? 0).toBeGreaterThan(1);
  });

  it("AC-01.6 sin resultados: lo dice, sugiere y no inventa datos", async () => {
    await mock("empty");
    const r = await ask("contratos de la Alcaldía de Cali");
    expect(r.cards.filter((c) => c.kind === "contract")).toHaveLength(0);
    expect(r.text).toMatch(/no (encontr|hay|hall)/i);
    expect(r.text).toMatch(/period|rango|nombre|amplia/i);
  });

  it("AC-01.7 sin periodo usa los últimos 12 meses y lo dice", async () => {
    const r = await ask("contratos de la Alcaldía de Cali");
    expect(r.period?.defaulted).toBe(true);
    const days = (Date.parse(r.period!.to) - Date.parse(r.period!.from)) / 86400000;
    expect(days).toBeGreaterThanOrEqual(364);
    expect(days).toBeLessThanOrEqual(366);
    expect(r.text).toMatch(/12 meses/);
  });

  it("AC-01.8 ninguna cifra del texto del LLM fuera de los resultados", async () => {
    const r = await ask("¿En qué gasta la Gobernación de Antioquia?");
    const allowed = new Set(digits(flat(r.cards)));
    for (const n of digits(r.text)) {
      // dates/period figures are allowed when they come from the declared period or source
      if (!allowed.has(n) && !flat(r.period).includes(n) && !flat(r.source).includes(n)) throw new Error(`cifra no respaldada: ${n}`);
    }
  });

  it("AC-01.8 (cambio 007) el tema con y sin tilde da la misma lista y el mismo total", async () => {
    const a = await ask("¿Cuántos contratos de educación tiene la Alcaldía de Cali?");
    const b = await ask("¿Cuántos contratos de educacion tiene la Alcaldía de Cali?");
    const sig = (r: Awaited<ReturnType<typeof ask>>) => JSON.stringify(r.cards.map((c) => [c.kind, c.value ?? c.total ?? c.count]));
    expect(sig(a)).toBe(sig(b));
  });

  it("AC-01.8 (cambio 007) una respuesta de falla no se guarda en caché", async () => {
    await mock("fail");
    await ask("contratos de la Alcaldía de Cali");
    await mock("ok");
    const r = await ask("contratos de la Alcaldía de Cali");
    expect(r.cached).not.toBe(true);
    expect(r.cards.filter((c) => c.kind === "contract").length).toBeGreaterThan(0);
  });

  it("AC-01.9 datos.gov.co lento: 1 reintento con tope de 6,5 s de API, responde sin esperar más (cambio 006)", async () => {
    await mock("slow");
    const t0 = Date.now();
    const r = await ask("contratos de la Alcaldía de Cali");
    expect(Date.now() - t0).toBeLessThan(8500);
    expect(r.text.length).toBeGreaterThan(0);
  }, 20000);

  it("AC-01.9 datos.gov.co caído: responde desde respaldo o caché avisando la fecha de los datos (cambio 006)", async () => {
    await mock("fail");
    const r = await ask("contratos de la Alcaldía de Cali");
    expect(r.source.dataUpdatedAt).toBeTruthy();
    expect(`${r.text} ${r.source.dataUpdatedAt}`).toMatch(/20\d\d-\d\d-\d\d|\d{1,2} de [a-záéíóú]+ de 20\d\d|20\d\d/);
    expect(r.text).not.toMatch(/^la b[uú]squeda fall[oó]\.?$/i);
  });

  it("AC-01.10 fuente, fechas, enlace oficial y la tarjeta con el valor exacto en pesos con COP (cambio 006)", async () => {
    const r = await ask("contratos de la Alcaldía de Cali");
    expect(r.source.dataset).toBeTruthy();
    expect(r.source.queriedAt).toBeTruthy();
    expect(r.source.dataUpdatedAt).toBeTruthy();
    expect(r.source.url).toMatch(/^https:\/\//);
    const money = r.cards.flatMap((c) => [c.value, c.total]).filter((v): v is string => typeof v === "string" && v.includes("$"));
    expect(money.length).toBeGreaterThan(0);
    for (const m of money) expect(m).toMatch(/^\$\d{1,3}(\.\d{3})* COP$/);
  });

  it("AC-01.12 el texto usa '$N millones de pesos' redondeado y nombres normales; la tarjeta conserva el valor exacto con COP (cambio 006)", async () => {
    const r = await ask("¿Cuáles son los contratos más grandes de la Alcaldía de Cali?");
    expect(r.text).toMatch(/\$\d{1,3}(\.\d{3})*\s+millones de pesos|\$\d+\s+mil millones de pesos/i);
    expect(r.text).not.toMatch(/\d{10,}/);
    expect(r.text).not.toMatch(/\d{1,3}(\.\d{3}){3,}/);
    expect(r.text).not.toMatch(/COP/);
    expect(r.text).not.toMatch(/[A-ZÁÉÍÓÚÑ]{3,}(\s+[A-ZÁÉÍÓÚÑ]{2,})+/);
    const exact = r.cards.map((c) => String(c.value ?? c.total ?? "")).filter((v) => /^\$\d{1,3}(\.\d{3})+ COP$/.test(v));
    expect(exact.length).toBeGreaterThan(0);
  });

  it("AC-01.11 / TM-11 inyección SoQL: ninguna entrada llega cruda y $limit <= 100", async () => {
    const payload = "x' OR 1=1; DROP --' UNION SELECT cuenta_bancaria";
    await ask(`contratos del contratista ${payload}`);
    await ask("contratos de la Alcaldía de Cali");
    const reqs = await soqlRequests();
    expect(reqs.length).toBeGreaterThan(0);
    for (const u of reqs) {
      const q = new URL(u, "http://x").searchParams;
      const limit = q.get("$limit");
      if (limit !== null) expect(Number(limit)).toBeLessThanOrEqual(100);
      const where = q.get("$where") ?? "";
      expect(where).not.toMatch(/union|drop|1=1/i);
      // an apostrophe from the user must be doubled (escaped) inside string literals
      expect(where.replace(/'(?:[^']|'')*'/g, "")).not.toMatch(/['"]/);
      for (const key of q.keys()) expect(["$select", "$where", "$group", "$order", "$limit", "$offset", "$$app_token"]).toContain(key);
    }
  });

  it("AC-01.11 / TM-11 el usuario no puede pasar SoQL crudo", async () => {
    await ask("$where=1=1&$limit=100000 contratos");
    for (const u of await soqlRequests()) {
      const q = new URL(u, "http://x").searchParams;
      expect(Number(q.get("$limit") ?? 0)).toBeLessThanOrEqual(100);
      expect(q.get("$where") ?? "").not.toBe("1=1");
    }
  });

  it("AC-01.11 / AC-13.12 consultar rechaza SoQL arbitrario: ni $where ni columnas fuera de lista llegan a Socrata", async () => {
    const { runQuery } = await import("../../server/agent/query");
    const { Lru } = await import("../../server/cache");
    const urls: string[] = [];
    const fetchFn = (async (u: string) => { urls.push(decodeURIComponent(String(u))); return new Response("[]", { headers: { "content-type": "application/json" } }); }) as typeof fetch;
    const ctx: any = { client: { base: "http://mock.local/socrata", fetchFn }, cache: new Lru() };
    const r: any = await runQuery({ operacion: "listar", $where: "1=1", filtros: { "valor; DROP": "x" } } as any, ctx);
    expect(r.data?.error === "parametro_invalido" || r.data?.error === undefined).toBe(true);
    for (const u of urls) expect(new URL(u, "http://x").searchParams.get("$where") ?? "").not.toBe("1=1");
    expect(JSON.stringify(r)).not.toMatch(/DROP/);
  });
});
