/**
 * US-13 Guía exploratoria del ciudadano (cambio 006). AC-13.1 .. AC-13.6, TM-16. Sin red real.
 *
 * Contrato (docs/changes/006 "Contratos de interfaz"):
 *  - server/agent/tools.ts: TOOL_DEFS, runTool(name, args, ctx) -> { data, cards, context?, note? }.
 *    Suposicion de ctx: el mismo contexto de datos que ya usan las herramientas { client: { base }, cache: new Lru() }
 *    (server/tools/search.ts `Ctx`); el constructor puede ajustarlo y esta prueba se corrige.
 *  - server/data/places.ts: matchPlace(texto), matchEntity(texto, entidades).
 *  - server/agent/mission.ts: MISSION_PROMPT.
 *  - server/fallback/snapshot.json.gz con generatedAt; server/data/budget.ts (1 reintento, tope 6,5 s).
 * datos.gov.co es un servidor http local (SOCRATA_BASE / client.base).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const PERSON_DOC = "1020304050";

type Mode = "ok" | "fail" | "slow" | "sinManizales" | "atipico" | "muchos";
interface Socrata { url: string; requests: string[]; mode: Mode; close(): Promise<void> }
async function startSocrata(): Promise<Socrata> {
  const s = { requests: [], mode: "ok" } as unknown as Socrata;
  const srv: Server = createServer((req, res) => {
    s.requests.push(decodeURIComponent(req.url!));
    const q = new URL(req.url!, "http://x").searchParams;
    const where = (q.get("$where") ?? "") + (q.get("$q") ?? "");
    const isPlaces = q.get("$group") === "ciudad,departamento";
    if (!isPlaces && s.mode === "fail") return void res.writeHead(500).end("boom");
    if (!isPlaces && s.mode === "slow") return void setTimeout(() => { try { res.writeHead(200).end("[]"); } catch { /* cerrado */ } }, 20_000);
    if (!isPlaces && s.mode === "sinManizales" && /manizales/i.test(where)) return void res.writeHead(200, { "content-type": "application/json" }).end("[]");
    const base = {
      nombre_entidad: "Alcaldía de Manizales", nit_entidad: "890801000", proveedor_adjudicado: "Constructora Andes SAS",
      objeto_del_contrato: "Mantenimiento de vías urbanas", valor_del_contrato: "5000000000", fecha_de_firma: "2026-03-10T00:00:00.000",
      estado_contrato: "Activo", urlproceso: "https://community.secop.gov.co/x", ciudad: "Manizales", departamento: "Caldas",
      id_contrato: "CO1.PCCNTR.9001", tipo_de_contrato: "Obra", total: "5000000000", n: "4", categoria: "Obra",
    };
    const rows = isPlaces
      ? [{ ciudad: "Manizales", departamento: "Caldas", n: "9" }, { ciudad: "Pereira", departamento: "Risaralda", n: "7" }, { ciudad: "Medellín", departamento: "Antioquia", n: "20" }]
      : [base, { ...base, id_contrato: "CO1.PCCNTR.9002", valor_del_contrato: "3000000000" },
        { ...base, id_contrato: "CO1.PCCNTR.9003", proveedor_adjudicado: "Juan Pérez Gómez", tipodocproveedor: "Cédula de Ciudadanía", documento_proveedor: PERSON_DOC }];
    if (!isPlaces && s.mode === "atipico") rows.unshift({ ...base, id_contrato: "CO1.PCCNTR.7777", valor_del_contrato: "25000000000000", total: "25000000000000", proveedor_adjudicado: "Atipica SAS" } as any);
    if (!isPlaces && s.mode === "muchos") for (let i = 0; i < 12; i++) rows[i] = { ...base, id_contrato: `CO1.PCCNTR.${8000 + i}`, valor_del_contrato: String(4e9 - i * 1e8) } as any;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(rows));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  s.url = `http://127.0.0.1:${(srv.address() as any).port}`;
  s.close = async () => { srv.closeAllConnections(); srv.close(); };
  return s;
}

let soc: Socrata;
beforeEach(async () => { soc = await startSocrata(); });
afterEach(async () => { await soc.close(); });

const tools = () => import("../../server/agent/tools");
const mkCtx = async () => {
  const { Lru } = await import("../../server/cache");
  return { client: { base: soc.url }, cache: new Lru() } as any;
};
const run = async (name: string, args: Record<string, unknown>) => (await tools()).runTool(name, args, await mkCtx()) as Promise<any>;
const dataRequests = () => soc.requests.filter((u) => !/group=ciudad,departamento|\$group=ciudad,departamento/.test(u));
const NAMES = ["consultar", "buscar_entidad", "detalle_contrato"]; // cambio 009: TOOL_DEFS (en voz además decline)
// consultar (AC-13.12): filtros cerrados + operación; el modelo nunca emite SoQL.
const cons = (filtros: Record<string, unknown>, extra: Record<string, unknown> = {}) => run("consultar", { filtros, operacion: "listar", ...extra });
const MAYORES = { orden: "desc", limite: 5 };
const PERIODO = { desde: "2026-01-01", hasta: "2026-12-31" };

describe("AC-13.1 misión explícita", () => {
  it("AC-13.1 MISSION_PROMPT fija el estilo: guía, sin opinar, 2 frases, 1 pregunta, un dato a la vez, 3 resultados por voz, decir que no sabe", async () => {
    const { MISSION_PROMPT } = await import("../../server/agent/mission");
    expect(MISSION_PROMPT).toMatch(/gu[ií]a/i);
    expect(MISSION_PROMPT).toMatch(/general/i);
    expect(MISSION_PROMPT).toMatch(/no (opin|juzg|califi)|sin opinar|nunca (opin|califi)/i);
    expect(MISSION_PROMPT).toMatch(/(dos|2) frases/i);
    expect(MISSION_PROMPT).toMatch(/(una|1) pregunta/i);
    expect(MISSION_PROMPT).toMatch(/(tres|3)/i);
    expect(MISSION_PROMPT).toMatch(/pantalla/i);
    expect(MISSION_PROMPT).toMatch(/no (lo )?sab|no s[eé]|no tengo ese dato/i);
  });
});

describe("AC-13.2 herramientas exploratorias sin NIT", () => {
  it("AC-13.2 TOOL_DEFS define consultar, buscar_entidad y detalle_contrato con parámetros cerrados y sin exigir entidad ni NIT", async () => {
    const { TOOL_DEFS } = await tools();
    const defs = TOOL_DEFS as any[];
    const nameOf = (d: any) => d.name ?? d.function?.name;
    expect(defs.map(nameOf).sort()).toEqual([...NAMES].sort());
    for (const d of defs) {
      const params = d.parameters ?? d.function?.parameters;
      expect(params?.type).toBe("object");
      for (const req of params.required ?? []) expect(req).not.toMatch(/nit|entidad/i);
    }
    const consultar = defs.find((d) => nameOf(d) === "consultar");
    const props = (consultar.parameters ?? consultar.function.parameters).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["filtros", "operacion", "agrupar", "orden", "limite"]));
    expect(Object.keys(props.filtros.properties)).toEqual(expect.arrayContaining(["municipio", "departamento", "entidad", "tema"]));
  });

  it.each([
    ["sumar", undefined], ["contar", undefined], ["promediar", undefined], ["listar", undefined],
    ["sumar", "entidad"], ["sumar", "contratista"], ["sumar", "categoria"],
  ] as const)(
    "AC-13.2 consultar %s agrupar=%s responde por territorio (municipio) y fechas, sin NIT ni entidad",
    async (operacion, agrupar) => {
      const r = await run("consultar", { filtros: { municipio: "Manizales", ...PERIODO }, operacion, agrupar, orden: "desc", limite: 5 });
      expect(r.data?.error, JSON.stringify(r.data).slice(0, 200)).toBeUndefined();
      expect(JSON.stringify(r).length).toBeGreaterThan(50);
      expect(dataRequests().length).toBeGreaterThan(0);
    },
  );

  it("AC-13.2 por departamento o a nivel país (sin ningún filtro territorial) también responde", async () => {
    expect((await run("consultar", { filtros: { departamento: "Caldas" }, operacion: "sumar" })).data?.error).toBeUndefined();
    expect((await run("consultar", { operacion: "sumar" })).data?.error).toBeUndefined();
  });

  it("AC-13.2 SoQL lo construye el servidor: sin SoQL crudo del modelo, $limit <= 100", async () => {
    await run("consultar", { filtros: { municipio: "Manizales", tema: "x' OR 1=1; DROP --" }, operacion: "listar", limite: 100000, $where: "1=1" });
    for (const u of dataRequests()) {
      const q = new URL(u, "http://x").searchParams;
      expect(Number(q.get("$limit") ?? 0)).toBeLessThanOrEqual(100);
      expect(q.get("$where") ?? "").not.toMatch(/DROP|^1=1$/i);
    }
  });

  it("AC-13.2 un municipio desconocido no lanza: lugar_desconocido con sugerencias", async () => {
    const r = await run("consultar", { filtros: { municipio: "Qwzxv Inexistente" }, operacion: "sumar", agrupar: "entidad" });
    expect(["lugar_desconocido", "parametro_invalido", "sin_resultados"]).toContain(r.data.error);
  });
});

describe("AC-13.13 buscar_entidad en la herramienta (cambio 009)", () => {
  it("AC-13.13 buscar_entidad devuelve candidatos { nit, nombre, confianza }", async () => {
    const r = await run("buscar_entidad", { texto: "MinTIC" });
    expect(Array.isArray(r.data?.candidatos)).toBe(true);
    expect(r.data.candidatos[0]).toEqual(expect.objectContaining({ nit: expect.any(String), nombre: expect.any(String), confianza: expect.anything() }));
  });
});

describe("AC-13.3 coincidencia aproximada y ampliación al departamento", () => {
  it("AC-13.3 matchPlace tolera errores de STT y tildes: 'Manisales' -> Manizales (Caldas)", async () => {
    const { matchPlace } = await import("../../server/data/places");
    for (const t of ["Manisales", "manizales", "Manízales"]) expect(matchPlace(t), t).toMatchObject({ municipio: "Manizales", departamento: "Caldas", alcance: "municipio" });
  });

  it("AC-13.3 matchPlace reconoce un departamento y sugiere cuando no hay coincidencia", async () => {
    const { matchPlace } = await import("../../server/data/places");
    expect(matchPlace("Antioquia")).toMatchObject({ departamento: "Antioquia", alcance: "departamento" });
    const none: any = matchPlace("zzzzqqq");
    expect(Array.isArray(none.sugerencias)).toBe(true);
  });

  it("AC-13.3 matchEntity tolera errores contra la lista de entidades", async () => {
    const { matchEntity } = await import("../../server/data/places");
    const entidades = [{ nit: "890801000", name: "Alcaldía de Manizales" }, { nit: "890399011", name: "Alcaldía de Cali" }] as any[];
    const m: any = matchEntity("alcaldia de manisales", entidades);
    expect(JSON.stringify(m)).toContain("890801000");
  });

  it("AC-13.3 'Manisales' dicho a la herramienta se resuelve al municipio correcto", async () => {
    const r = await run("consultar", { filtros: { municipio: "Manisales" }, operacion: "sumar", agrupar: "entidad" });
    expect(r.data?.error).toBeUndefined();
    expect(dataRequests().join("\n")).toMatch(/manizales/i);
  });

  it("AC-13.3 sin datos en el municipio amplía al departamento y lo dice", async () => {
    soc.mode = "sinManizales";
    const r = await run("consultar", { filtros: { municipio: "Manizales" }, operacion: "sumar", agrupar: "entidad" });
    expect(r.data?.error).toBeUndefined();
    expect(JSON.stringify(r.cards).length).toBeGreaterThan(5);
    expect(`${r.note ?? ""} ${JSON.stringify(r.data)}`).toMatch(/departamento/i);
    expect(dataRequests().some((u) => /caldas/i.test(u))).toBe(true);
  });
});

describe("AC-13.5 declinar con precisión (y TM-16)", () => {
  it("AC-13.5 los rankings por valor están permitidos: contratos_mayores y top_contratistas devuelven datos, no declinación", async () => {
    for (const [n, a] of [["mayores", { operacion: "listar", orden: "desc" }], ["contratistas", { operacion: "sumar", agrupar: "contratista", orden: "desc" }]] as const) {
      const r = await run("consultar", { filtros: { departamento: "Caldas" }, ...a });
      expect(r.data?.error, n).toBeUndefined();
      expect(JSON.stringify(r.data), n).not.toMatch(/declin|no puedo|no est[aá] permitido/i);
    }
  });

  it("AC-13.5 el nombre del contratista y los datos publicados del contrato se muestran", async () => {
    const r = await cons({ municipio: "Manizales" }, MAYORES);
    expect(JSON.stringify(r)).toContain("Constructora Andes");
  });

  it("AC-13.5 / TM-16 el documento o contacto de una persona natural no aparece en ningún resultado", async () => {
    for (const [n, a] of [["listar", { filtros: { municipio: "Manizales" }, operacion: "listar" }], ["mayores", { filtros: { municipio: "Manizales" }, operacion: "listar", orden: "desc" }], ["contratistas", { filtros: { departamento: "Caldas" }, operacion: "sumar", agrupar: "contratista" }]] as const) {
      expect(JSON.stringify(await run("consultar", a as any)), n).not.toContain(PERSON_DOC);
    }
  });

  it("AC-13.5 detalle_contrato de un contrato mostrado entrega el detalle (no es acción prohibida)", async () => {
    const r = await run("detalle_contrato", { id_contrato: "CO1.PCCNTR.9001" });
    expect(r.data?.error).not.toBe("prohibido");
    expect(JSON.stringify(r.data)).not.toMatch(/no puedo|declin/i);
  });

  it("AC-13.5 dato faltante o sin resultados no declina: sin_resultados con sugerencias", async () => {
    soc.mode = "sinManizales";
    const r = await run("detalle_contrato", { id_contrato: "CO1.PCCNTR.0000" });
    expect(["sin_resultados", undefined]).toContain(r.data?.error);
    expect(JSON.stringify(r.data)).not.toMatch(/no puedo|declin|prohibid/i);
  });

  describe("en la conversación de texto (mock local)", () => {
    let app: { port: number; close(): Promise<void> | void };
    beforeEach(async () => {
      const { startServer } = await import("../../server/index");
      app = await startServer({ port: 0, env: { MOCK_EXTERNALS: "1", ALLOWED_ORIGINS: "http://localhost:5173" } });
    });
    afterEach(async () => { await app.close(); });
    const chat = async (message: string, state?: string) => (await (await fetch(`http://127.0.0.1:${app.port}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, state }),
    })).json()) as { text: string; cards: any[]; state: string };
    const declineTexts = async () => {
      const d = await import("../../server/agent/decline");
      return (d.DECLINE_CODES as string[]).map((c) => d.decline(c));
    };

    it("AC-13.5 un ranking por valor no se declina", async () => {
      const r = await chat("¿Cuáles son los contratos más grandes de la Alcaldía de Cali?");
      expect(await declineTexts()).not.toContain(r.text);
      expect(r.cards.length).toBeGreaterThan(0);
    });

    it("AC-13.5 'ábrelo' sobre un contrato mostrado no es una acción prohibida", async () => {
      const first = await chat("contratos de la Alcaldía de Cali");
      const r = await chat("ábrelo", first.state);
      expect(await declineTexts()).not.toContain(r.text);
    });

    it("AC-13.5 / TM-16 pedir la cédula de una persona natural: se declina y no sale ningún documento", async () => {
      const r = await chat("dame la cédula y el celular de Juan Pérez, el contratista");
      expect(JSON.stringify(r)).not.toMatch(/\b\d{7,10}\b/);
      expect(await declineTexts()).toContain(r.text);
    });

    it("AC-13.5 sin resultados por falta de datos no declina", async () => {
      await fetch(`http://127.0.0.1:${app.port}/__mock/socrata`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "empty" }) });
      const r = await chat("contratos de la Alcaldía de Cali");
      expect(await declineTexts()).not.toContain(r.text);
    });
  });
});

describe("AC-13.4 seguimientos con lo que quedó en la conversación", () => {
  it("AC-13.4 la misión indica resolver 'ese contrato', 'el más grande', 'esa empresa', 'esa entidad' con el historial y no negar el detalle", async () => {
    const { MISSION_PROMPT } = await import("../../server/agent/mission");
    expect(MISSION_PROMPT).toMatch(/ese contrato|el m[aá]s grande|esa empresa|esa entidad|lo que (ya )?(se )?(mostr|dijo)/i);
    expect(MISSION_PROMPT).toMatch(/detalle/i);
  });

  it("AC-13.4 detalle_contrato acepta el id de un contrato mostrado en resultados previos", async () => {
    const lista = await cons({ municipio: "Manizales" }, MAYORES);
    const id = JSON.stringify(lista).match(/CO1\.PCCNTR\.\d+/)?.[0];
    expect(id).toBeTruthy();
    const d = await run("detalle_contrato", { id_contrato: id });
    expect(d.data?.error).toBeUndefined();
  });
});

describe("AC-13.6 presupuesto de tiempo y respaldo", () => {
  it("AC-13.6 / AC-01.9 datos.gov.co falla: 1 reintento, no más, y responde desde el respaldo con su fecha", async () => {
    soc.mode = "fail";
    const t0 = Date.now();
    const r = await run("consultar", { operacion: "listar", orden: "desc" });
    expect(Date.now() - t0).toBeLessThan(7500);
    expect(dataRequests().length).toBeLessThanOrEqual(2); // intento + 1 reintento
    expect(r.data?.error).toBeUndefined();
    expect(JSON.stringify(r)).toMatch(/20\d\d-\d\d-\d\d|\d{1,2} de [a-záéíóú]+ de 20\d\d/i);
  }, 20_000);

  it("AC-13.6 / AC-01.9 datos.gov.co lento: se corta cerca de 6,5 s, no espera indefinidamente", async () => {
    soc.mode = "slow";
    const t0 = Date.now();
    const r = await run("consultar", { operacion: "listar", orden: "desc" });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(8500);
    expect(ms).toBeGreaterThan(1000);
    expect(r.data).toBeTruthy();
  }, 20_000);

  it("AC-13.6 sin respaldo aplicable se responde servicio_no_disponible sin lanzar", async () => {
    soc.mode = "fail";
    const r = await cons({ municipio: "Manizales", tema: "tema-que-no-esta-en-el-respaldo-xyz" });
    expect(r.data).toBeTruthy();
    expect(r.data.error).toBe("servicio_no_disponible"); // cambio 007: consulta fuera del respaldo
  }, 20_000);

  it("AC-13.6 caché en memoria: la misma consulta repetida no vuelve a datos.gov.co", async () => {
    const ctx = await mkCtx();
    const { runTool } = await tools();
    await runTool("consultar", { filtros: { departamento: "Caldas", ...PERIODO }, operacion: "sumar" }, ctx);
    const n = dataRequests().length;
    await runTool("consultar", { filtros: { departamento: "Caldas", ...PERIODO }, operacion: "sumar" }, ctx);
    expect(dataRequests().length).toBe(n);
  });

  it("AC-13.6 existe la copia comprimida de respaldo con fecha de generación y scripts/snapshot", () => {
    const p = resolve(root, "server/fallback/snapshot.json.gz");
    expect(existsSync(p)).toBe(true);
    const snap = JSON.parse(gunzipSync(readFileSync(p)).toString("utf8"));
    expect(Number.isNaN(Date.parse(snap.generatedAt))).toBe(false);
    expect(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts?.snapshot).toBeTruthy();
  });

  it("AC-13.6 el resultado de una herramienta puede traer instrucción breve (note) cuando el prompt no basta", async () => {
    soc.mode = "sinManizales";
    const r = await run("consultar", { filtros: { municipio: "Manizales" }, operacion: "sumar", agrupar: "entidad" });
    expect(typeof r.note).toBe("string");
    expect(r.note.length).toBeGreaterThan(5);
    expect(r.note.length).toBeLessThan(400);
  });

  it("AC-13.6 la misión pide explicar la jerga en una frase y sugerir la siguiente pregunta", async () => {
    const { MISSION_PROMPT } = await import("../../server/agent/mission");
    expect(MISSION_PROMPT).toMatch(/jerga|t[eé]cnic|explica/i);
    expect(MISSION_PROMPT).toMatch(/sugier|suger|siguiente/i);
  });
});

describe("AC-13.1 (cambio 007) saludo cálido y tono cercano", () => {
  it("AC-13.1 la misión pide tutear, frases cálidas y responder el saludo sin soltar datos", async () => {
    const { MISSION_PROMPT } = await import("../../server/agent/mission");
    expect(MISSION_PROMPT).toMatch(/tute|cercan|c[aá]lid/i);
    expect(MISSION_PROMPT).toMatch(/salud/i);
  });

  it("AC-13.1 un saludo recibe un saludo y ninguna tarjeta ni cifra", async () => {
    const { startServer } = await import("../../server/index");
    const app = await startServer({ port: 0, env: { MOCK_EXTERNALS: "1", ALLOWED_ORIGINS: "http://localhost:5173" } });
    try {
      const r: any = await (await fetch(`http://127.0.0.1:${app.port}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Hola, buenos días" }) })).json();
      expect(r.text).toMatch(/hola|buen/i);
      expect(r.cards ?? []).toHaveLength(0);
      expect(r.text).not.toMatch(/\d/);
    } finally { await app.close(); }
  });
});

describe("AC-13.2 (cambio 007) lista en pantalla con ver más", () => {
  it("AC-13.2 buscar_contratos entrega entre 5 y 10 tarjetas y ofrece ver más", async () => {
    soc.mode = "muchos";
    const r = await cons({ municipio: "Manizales" });
    const cs = (r.cards ?? []).filter((c: any) => c.kind === "contract");
    expect(cs.length).toBeGreaterThanOrEqual(5);
    expect(cs.length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(r)).toMatch(/ver m[aá]s|hayMas|hasMore|hay_mas/i);
  });

  it("AC-13.2 cascada: sin datos en el municipio ofrece ampliar", async () => {
    soc.mode = "sinManizales";
    const r = await cons({ municipio: "Manizales" });
    expect(`${r.note ?? ""} ${JSON.stringify(r.data)}`).toMatch(/ampli|departamento/i);
  });
});

describe("AC-13.6 / AC-01.8 (cambio 007) un error no se repite desde caché", () => {
  it("AC-13.6 tras una falla, la misma consulta vuelve a datos.gov.co y ya no devuelve el error ni el respaldo", async () => {
    const ctx = await mkCtx();
    const { runTool } = await tools();
    soc.mode = "fail";
    await runTool("consultar", { filtros: { municipio: "Manizales", tema: "tema-que-no-esta-en-el-respaldo-xyz" }, operacion: "listar" }, ctx);
    soc.mode = "ok";
    const n = dataRequests().length;
    const r: any = await runTool("consultar", { filtros: { municipio: "Manizales", tema: "tema-que-no-esta-en-el-respaldo-xyz" }, operacion: "listar" }, ctx);
    expect(dataRequests().length).toBeGreaterThan(n);
    expect(r.data?.error).toBeUndefined();
  }, 30_000);

  it("AC-13.6 el respaldo precalculado trae totales, rankings, contratos mayores y listas por tema", () => {
    const snap = JSON.parse(gunzipSync(readFileSync(resolve(root, "server/fallback/snapshot.json.gz"))).toString("utf8"));
    const keys = Object.keys(snap).join(" ").toLowerCase();
    expect(keys).toMatch(/total|agg/);
    expect(keys).toMatch(/top|rank/);
    expect(keys).toMatch(/mayor|largest|big|top/);
    expect(keys).toMatch(/tema|topic|lista/);
  });
});

describe("AC-13.8 montos atípicos", () => {
  it("AC-13.8 isOutlier: > 10 billones o > 50 % del total del territorio", async () => {
    const { isOutlier } = await import("../../server/data/outliers");
    expect(isOutlier(25e12)).toBe(true);
    expect(isOutlier(5e9)).toBe(false);
    expect(isOutlier(6e9, 10e9)).toBe(true);
    expect(isOutlier(4e9, 10e9)).toBe(false);
  });

  it("AC-13.8 contratos_mayores excluye el atípico del ranking y lo muestra aparte con nota neutral", async () => {
    soc.mode = "atipico";
    const r = await cons({ municipio: "Manizales" }, MAYORES);
    const ranking = (r.cards ?? []).filter((c: any) => !c.atipico);
    expect(JSON.stringify(ranking)).not.toContain("Atipica");
    expect(r.data?.atipicos?.length ?? 0).toBeGreaterThan(0);
    expect((r.cards ?? []).some((c: any) => c.atipico === true)).toBe(true);
    expect(r.note ?? "").toMatch(/inusualmente alto y as[ií] aparece registrado en SECOP/i);
    expect(r.note ?? "").not.toMatch(/corrup|sobrecosto|sospech|fraude/i);
  });

  it("AC-13.8 la misma pregunta da el mismo dato (texto y voz comparten herramienta) y el total excluye el atípico", async () => {
    soc.mode = "atipico";
    const a = await run("consultar", { filtros: { municipio: "Manizales" }, operacion: "sumar" });
    const b = await run("consultar", { filtros: { municipio: "Manizales" }, operacion: "sumar" });
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
    expect(JSON.stringify(a.data?.total ?? a.data)).not.toMatch(/25000000000000/);
  });
});

describe("AC-13.9 detalle de contrato", () => {
  it("AC-13.9 detalle_contrato devuelve una tarjeta detail con la ficha completa", async () => {
    const r = await run("detalle_contrato", { id_contrato: "CO1.PCCNTR.9001" });
    const d = (r.cards ?? []).find((c: any) => c.kind === "detail");
    expect(d).toBeTruthy();
    for (const k of ["object", "entity", "contractor", "value", "signedAt", "startAt", "endAt", "status", "modality", "paid", "invoiced", "pending", "additions", "url"]) expect(d, k).toHaveProperty(k);
  });

  it("AC-13.9 la misión cubre 'ábrelo', 'el primero' o el número del contrato", async () => {
    const { MISSION_PROMPT } = await import("../../server/agent/mission");
    expect(MISSION_PROMPT).toMatch(/[aá]brelo|el primero|por su n[uú]mero/i);
  });
});

describe("AC-13.10 comprensión del lugar", () => {
  it("AC-13.10 PLACE_KEYTERMS trae los 32 departamentos y al menos 100 municipios", async () => {
    const { PLACE_KEYTERMS } = await import("../../server/data/places");
    expect(PLACE_KEYTERMS.length).toBeGreaterThanOrEqual(132);
    for (const t of ["Antioquia", "Nariño", "Caldas", "Boyacá", "Tunja", "Manizales", "Pasto", "Medellín"]) expect(PLACE_KEYTERMS, t).toContain(t);
  });

  it("AC-13.10 un lugar dudoso pide confirmación en vez de decir que no hay datos", async () => {
    const { matchPlace } = await import("../../server/data/places");
    const m: any = matchPlace("Tunha");
    expect(String(m.confirmar ?? "")).toMatch(/^¿Dijiste .+, en .+\?$/);
  });
});
