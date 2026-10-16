/**
 * US-13 Agente con criterio (cambio 009). AC-13.1, AC-13.2, AC-13.3, AC-13.12 .. AC-13.16, AC-07.4, AC-11.5, TM-17, TM-18.
 * Sin red real ni nube; puertos dinámicos. Contrato: docs/changes/009-agente-con-criterio.md "Contratos de interfaz".
 *  - server/agent/query.ts: runQuery(args, dataCtx) -> { data, cards, ... }; errores sin lanzar en data.error.
 *  - server/data/entity-aliases.ts: ALIASES; buscar_entidad(texto) -> { candidatos: [{ nit, nombre, confianza }] }.
 *  - server/diag.ts: isDiagnostic(req), diagLog(entry); log "diag".
 *  - eval/battery.json, eval/judge.ts, npm run eval:battery, eval/battery-results-<modelo>.json, docs/MODELO.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const readJson = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8"));

// ---------- datos.gov.co local ----------
interface Socrata { url: string; requests: string[]; close(): Promise<void> }
async function startSocrata(): Promise<Socrata> {
  const s = { requests: [] } as unknown as Socrata;
  const srv: Server = createServer((req, res) => {
    s.requests.push(decodeURIComponent(req.url!));
    const row = {
      nombre_entidad: "Alcaldía de Manizales", nit_entidad: "890801000", proveedor_adjudicado: "Constructora Andes SAS",
      objeto_del_contrato: "Mantenimiento de vías", valor_del_contrato: "5000000", fecha_de_firma: "2026-03-10T00:00:00.000",
      estado_contrato: "Activo", modalidad_de_contratacion: "Licitación pública", urlproceso: "https://community.secop.gov.co/x",
      ciudad: "Manizales", departamento: "Caldas", id_contrato: "CO1.PCCNTR.9001", tipo_de_contrato: "Obra", total: "5000000", n: "4", promedio: "2500000", mes: "2026-03",
    };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify([row, { ...row, id_contrato: "CO1.PCCNTR.9002" }]));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  s.url = `http://127.0.0.1:${(srv.address() as any).port}`;
  s.close = async () => { srv.closeAllConnections(); srv.close(); };
  return s;
}
let soc: Socrata;
beforeEach(async () => { soc = await startSocrata(); });
afterEach(async () => { await soc.close(); vi.restoreAllMocks(); });

const runQuery = async (args: Record<string, unknown>): Promise<any> => {
  const { runQuery: rq } = await import("../../server/agent/query");
  const { Lru } = await import("../../server/cache");
  return rq(args as any, { client: { base: soc.url }, cache: new Lru() } as any);
};
const params = () => soc.requests.map((u) => new URL(u, "http://x").searchParams);
const allSoql = () => params().map((q) => `${q.get("$select") ?? ""} | ${q.get("$where") ?? ""} | ${q.get("$group") ?? ""} | ${q.get("$order") ?? ""}`).join("\n");

describe("AC-13.12 consultar: consulta flexible con parámetros cerrados", () => {
  it("AC-13.12 'menor valor' se resuelve con orden ascendente por valor", async () => {
    const r = await runQuery({ filtros: { municipio: "Manizales" }, operacion: "listar", orden: "asc", limite: 5 });
    expect(r.data?.error).toBeUndefined();
    expect(params().some((q) => /valor_del_contrato\s+asc/i.test(q.get("$order") ?? ""))).toBe(true);
  });

  it("AC-13.12 promediar usa un promedio calculado por el servidor", async () => {
    const r = await runQuery({ filtros: { departamento: "Caldas" }, operacion: "promediar" });
    expect(r.data?.error).toBeUndefined();
    expect(params().some((q) => /avg\(/i.test(q.get("$select") ?? ""))).toBe(true);
  });

  it("AC-13.12 sumar, contar, mínimo y máximo son operaciones válidas", async () => {
    for (const operacion of ["sumar", "contar", "minimo", "maximo"]) {
      const r = await runQuery({ filtros: { departamento: "Caldas" }, operacion });
      expect(r.data?.error, operacion).toBeUndefined();
    }
  });

  it("AC-13.12 agrupar por mes agrupa por la fecha de firma", async () => {
    const r = await runQuery({ filtros: { departamento: "Caldas", desde: "2026-01-01", hasta: "2026-12-31" }, operacion: "sumar", agrupar: "mes" });
    expect(r.data?.error).toBeUndefined();
    expect(params().some((q) => /fecha_de_firma/i.test(`${q.get("$group") ?? ""} ${q.get("$select") ?? ""}`) && !!q.get("$group"))).toBe(true);
  });

  it("AC-13.12 filtros de estado, modalidad, fechas y valor llegan a la consulta", async () => {
    await runQuery({
      filtros: { municipio: "Manizales", estado: "Activo", modalidad: "Licitación pública", desde: "2026-01-01", hasta: "2026-06-30", valorMin: 1000000, valorMax: 9000000 },
      operacion: "listar",
    });
    const w = params().map((q) => q.get("$where") ?? "").join("\n");
    expect(w).toMatch(/Activo/);
    expect(w).toMatch(/Licitaci/i);
    expect(w).toMatch(/2026-01-01/);
    expect(w).toMatch(/2026-06-30/);
    expect(w).toMatch(/1000000/);
    expect(w).toMatch(/9000000/);
  });

  it("AC-13.12 límite 1000 se recorta a 10 en el servidor", async () => {
    const r = await runQuery({ filtros: { municipio: "Manizales" }, operacion: "listar", limite: 1000 });
    expect(r.data?.error).toBeUndefined();
    expect(params().length).toBeGreaterThan(0);
    for (const q of params()) expect(Number(q.get("$limit") ?? 0)).toBeLessThanOrEqual(10);
  });

  it("AC-13.12 las comillas de los filtros se escapan (duplicadas) y no rompen el literal", async () => {
    await runQuery({ filtros: { entidad: "O'Brien' OR '1'='1", contratista: "x'; DROP TABLE y; --" }, operacion: "listar" });
    expect(params().length).toBeGreaterThan(0);
    for (const q of params()) {
      const where = q.get("$where") ?? "";
      expect(where.replace(/'(?:[^']|'')*'/g, "")).not.toMatch(/['"]/);
      expect(where).not.toMatch(/'\s*OR\s*'1'\s*=\s*'1(?!')/i);
    }
  });

  it("AC-13.12 una columna fuera de la lista se rechaza con parametro_invalido y no consulta", async () => {
    const r = await runQuery({ filtros: { cuenta_bancaria: "123" }, operacion: "listar", orden: "asc", columna: "documento_proveedor" });
    expect(r.data?.error).toBe("parametro_invalido");
    expect(soc.requests).toHaveLength(0);
  });

  it("AC-13.12 una operación o agrupación fuera de la lista se rechaza con parametro_invalido", async () => {
    expect((await runQuery({ operacion: "borrar" })).data?.error).toBe("parametro_invalido");
    expect((await runQuery({ operacion: "sumar", agrupar: "documento_proveedor" })).data?.error).toBe("parametro_invalido");
    expect(soc.requests).toHaveLength(0);
  });

  it("AC-13.12 / TM-18 agrupar por contratista o entidad a nivel nacional sin filtro: respaldo o consulta_muy_amplia, no una agregación nacional en vivo", async () => {
    for (const agrupar of ["contratista", "entidad"]) {
      soc.requests.length = 0;
      const r = await runQuery({ operacion: "sumar", agrupar, orden: "desc", limite: 10 });
      const amplia = r.data?.error === "consulta_muy_amplia";
      const respaldo = r.data?.error === undefined;
      expect(amplia || respaldo, agrupar).toBe(true);
      if (respaldo) expect(params().filter((q) => !!q.get("$group")), agrupar).toHaveLength(0);
    }
  });
});

describe("AC-13.13 buscar_entidad: siglas y nombres comunes", () => {
  const buscar = async (texto: string): Promise<any[]> => {
    const t = await import("../../server/agent/tools");
    const { Lru } = await import("../../server/cache");
    const entities = readJson("data/entities.json");
    (t as any).configureTools({ base: { client: { base: soc.url }, cache: new Lru() }, entities });
    const r: any = await t.runTool("buscar_entidad", { texto });
    return r.data?.candidatos ?? [];
  };

  it("AC-13.13 existe el diccionario ALIASES con siglas y nombres comunes", async () => {
    const { ALIASES } = await import("../../server/data/entity-aliases");
    const keys = (ALIASES instanceof Map ? [...ALIASES.keys()] : Object.keys(ALIASES)).join(" ").toLowerCase();
    for (const k of ["mintic", "icbf", "invias", "dian", "sena"]) expect(keys, k).toContain(k);
  });

  it.each([
    ["MinTIC", "899999053"], ["Ministerio TIC", "899999053"], ["ICBF", "899999239"], ["INVIAS", "800215807"], ["Dian", "800197268"],
  ])("AC-13.13 %s -> el NIT oficial %s del índice, como primer candidato", async (texto, nit) => {
    const c = await buscar(texto);
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].nit).toBe(nit);
    expect(typeof c[0].nombre).toBe("string");
  });

  it("AC-13.13 un texto ambiguo devuelve varios candidatos para preguntar con opciones", async () => {
    const c = await buscar("Alcaldía");
    expect(c.length).toBeGreaterThan(1);
  });
});

describe("AC-13.1 / AC-13.2 sin atajos de reglas salvo el saludo", () => {
  let app: { port: number; close(): Promise<void> | void };
  let logged: string[];
  beforeEach(async () => {
    logged = [];
    const cap = (c: any) => { logged.push(typeof c === "string" ? c : Buffer.from(c).toString()); return true; };
    vi.spyOn(process.stdout, "write").mockImplementation(cap as any);
    vi.spyOn(process.stderr, "write").mockImplementation(cap as any);
    for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: any[]) => { logged.push(a.map(String).join(" ")); });
    const { startServer } = await import("../../server/index");
    app = await startServer({ port: 0, env: { MOCK_EXTERNALS: "1", ALLOWED_ORIGINS: "http://localhost:5173" } });
  });
  afterEach(async () => { await app.close(); });
  const chat = async (message: string) => fetch(`http://127.0.0.1:${app.port}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }),
  }).then((r) => r.json()) as Promise<{ text: string; cards: any[] }>;

  it("AC-13.1 ninguna pregunta de datos se responde por un atajo de reglas (ruta distinta de 'atajo')", async () => {
    for (const q of ["¿Cuánto se gastó en Manizales?", "los contratos de menor valor de la Alcaldía de Cali", "contratos del ICBF"]) await chat(q);
    const rutas = logged.filter((l) => /"route"/.test(l));
    expect(rutas.length).toBeGreaterThan(0);
    for (const l of rutas) expect(l).not.toMatch(/"route":\s*"atajo"/);
  });

  it("AC-13.1 el saludo sí se responde con calidez, sin tarjetas", async () => {
    const r = await chat("Hola, buenas tardes");
    expect(r.text).toMatch(/hola|buen/i);
    expect(r.cards ?? []).toHaveLength(0);
  });
});

describe("AC-13.16 / AC-07.4 / TM-17 modo diagnóstico", () => {
  const CODE = "codigo-secreto-diag-7391";
  const MARK = "ZZDIAGMARCA";
  const PII = "mi cédula 1020304050, correo juan.perez@example.com, celular 3001234567";
  let app: { port: number; close(): Promise<void> | void };
  let logged: string[];
  beforeEach(async () => {
    logged = [];
    const cap = (c: any) => { logged.push(typeof c === "string" ? c : Buffer.from(c).toString()); return true; };
    vi.spyOn(process.stdout, "write").mockImplementation(cap as any);
    vi.spyOn(process.stderr, "write").mockImplementation(cap as any);
    for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: any[]) => { logged.push(a.map(String).join(" ")); });
    process.env.DIAG_CODE = CODE;
    const { startServer } = await import("../../server/index");
    app = await startServer({ port: 0, env: { MOCK_EXTERNALS: "1", DIAG_CODE: CODE, ALLOWED_ORIGINS: "http://localhost:5173" } });
  });
  afterEach(async () => { delete process.env.DIAG_CODE; await app.close(); });
  const chat = (headers: Record<string, string> = {}, path = "/api/chat") => fetch(`http://127.0.0.1:${app.port}${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ message: `${MARK} contratos de la Alcaldía de Cali, ${PII}` }),
  }).then((r) => r.text());
  const contentLines = () => logged.filter((l) => l.includes(MARK));

  it("AC-13.16 sin código no se registra nada de contenido", async () => {
    await chat();
    expect(contentLines()).toHaveLength(0);
  });

  it("AC-13.16 con código erróneo no se registra contenido ni se registra el código enviado", async () => {
    await chat({ "x-diag-code": "codigo-erroneo-5555" });
    expect(contentLines()).toHaveLength(0);
    expect(logged.join("\n")).not.toContain("codigo-erroneo-5555");
  });

  it("AC-13.16 el código en la URL no activa el modo", async () => {
    await chat({}, `/api/chat?diag=${CODE}&x-diag-code=${CODE}`);
    expect(contentLines()).toHaveLength(0);
  });

  it("AC-13.16 con el código correcto hay una entrada en el log 'diag' con pregunta, y sin cédula, correo ni teléfono", async () => {
    await chat({ "x-diag-code": CODE });
    const lines = contentLines();
    expect(lines.length).toBeGreaterThan(0);
    const diag = lines.filter((l) => /\bdiag\b/.test(l));
    expect(diag.length, lines.join("\n").slice(0, 300)).toBeGreaterThan(0);
    for (const l of diag) {
      expect(l).not.toContain("1020304050");
      expect(l).not.toContain("juan.perez@example.com");
      expect(l).not.toContain("3001234567");
    }
  });

  it("AC-13.16 el código nunca aparece en los registros, ni siquiera cuando es correcto", async () => {
    await chat({ "x-diag-code": CODE });
    expect(logged.join("\n")).not.toContain(CODE);
  });

  it("AC-13.16 isDiagnostic: correcto -> true; ausente o erróneo -> false (cerrado)", async () => {
    const { isDiagnostic } = await import("../../server/diag");
    const req = (h: Record<string, string>) => ({ headers: h, header: (n: string) => h[n.toLowerCase()], socket: { remoteAddress: "127.0.0.1" } }) as any;
    expect(await isDiagnostic(req({ "x-diag-code": CODE }))).toBe(true);
    expect(await isDiagnostic(req({}))).toBe(false);
    expect(await isDiagnostic(req({ "x-diag-code": "otro" }))).toBe(false);
    delete process.env.DIAG_CODE;
    expect(await isDiagnostic(req({ "x-diag-code": "" }))).toBe(false);
  });

  it("AC-13.16 el código no está en el código del navegador ni escrito en el repositorio", () => {
    for (const p of ["web/src/main.ts", "scripts/gcp-diag-log.ps1"]) {
      if (existsSync(resolve(root, p))) expect(readFileSync(resolve(root, p), "utf8"), p).not.toContain(CODE);
    }
    expect(existsSync(resolve(root, "scripts/gcp-diag-log.ps1"))).toBe(true);
    expect(readFileSync(resolve(root, "scripts/gcp-diag-log.ps1"), "utf8")).toMatch(/diag/i);
  });
});

describe("AC-13.14 / AC-13.15 / AC-11.5 batería con juez y comparación de modelos", () => {
  const MODELS = ["deepseek-flash", "deepseek-v4-pro"];
  const results = () => MODELS.map((m) => `eval/battery-results-${m}.json`).filter((f) => existsSync(resolve(root, f)));

  it("AC-13.14 eval/battery.json tiene >= 180 preguntas con id, pregunta, canal y expect.intent", () => {
    expect(existsSync(resolve(root, "eval/battery.json"))).toBe(true);
    const j = readJson("eval/battery.json");
    const qs: any[] = Array.isArray(j) ? j : j.questions;
    expect(qs.length).toBeGreaterThanOrEqual(180);
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
    for (const q of qs) {
      expect(String(q.question ?? "").trim().length, q.id).toBeGreaterThan(0);
      expect(["texto", "voz", "whatsapp"]).toContain(q.channel);
      expect(q.expect?.intent, q.id).toBeTruthy();
    }
  });

  it("AC-13.14 la batería es variada: siglas, menor/mayor/promedio, fechas, estados, modalidades y seguimientos", () => {
    const j = readJson("eval/battery.json");
    const txt = JSON.stringify(Array.isArray(j) ? j : j.questions);
    for (const re of [/MinTIC|ICBF|INVIAS|DIAN/i, /menor/i, /mayor|m[aá]s grande/i, /promedio/i, /20\d\d|mes|a[ñn]o/i, /estado|liquidad|terminad|activ/i, /modalidad|directa|licitaci/i, /ese contrato|el primero|y en |y el/i]) expect(txt).toMatch(re);
  });

  it("AC-13.14 existe el juez eval/judge.ts y el script npm eval:battery", () => {
    expect(existsSync(resolve(root, "eval/judge.ts"))).toBe(true);
    expect(readJson("package.json").scripts?.["eval:battery"]).toMatch(/battery/);
  });

  it("AC-13.14 / AC-11.5 los resultados de la batería: forma del contrato y >= 90 % de aciertos", () => {
    const files = results();
    expect(files.length, "falta eval/battery-results-<modelo>.json").toBeGreaterThan(0);
    const total = (readJson("eval/battery.json") as any);
    const n = (Array.isArray(total) ? total : total.questions).length;
    for (const f of files) {
      const r = readJson(f);
      expect(Number.isNaN(Date.parse(r.runAt)), f).toBe(false);
      expect(MODELS).toContain(r.model);
      expect(r.results.length, f).toBe(n);
      for (const x of r.results) expect(x, f).toEqual(expect.objectContaining({ id: expect.anything(), ok: expect.any(Boolean), ms: expect.any(Number) }));
      expect(r.okRate, f).toBeGreaterThanOrEqual(0.9);
      for (const k of ["p50", "p95", "costPerQ"]) expect(typeof r[k], `${f} ${k}`).toBe("number");
    }
  });

  it("AC-13.15 docs/MODELO.md compara flash y v4-pro (acierto, tiempo, costo) y documenta la elección", () => {
    expect(existsSync(resolve(root, "docs/MODELO.md"))).toBe(true);
    const md = readFileSync(resolve(root, "docs/MODELO.md"), "utf8");
    expect(md).toMatch(/deepseek-flash/);
    expect(md).toMatch(/deepseek-v4-pro/);
    expect(md).toMatch(/acierto/i);
    expect(md).toMatch(/tiempo|latencia|p50|p95/i);
    expect(md).toMatch(/costo/i);
    expect(md).toMatch(/elec|decisi[oó]n|usaremos|se usa/i);
  });
});
