import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { DATASET, fetchRows, query as socrataQuery, normalize, resolveEntity, toEntity, type Client, type Cond, type Entity, type Row } from "./data/socrata.js";
import demoAnswers from "./fallback/demo-answers.json" with { type: "json" };
import { Lru } from "./cache.js";
import { contractCard, MAX_VISIBLE, searchContracts, type Ctx } from "./tools/search.js";
import { fundingBreakdown, spendByCategory, topContracts } from "./tools/spend.js";
import { contractDetail } from "./tools/detail.js";
import { listDocuments } from "./tools/documents.js";
import { createSocrataMock, MOCK_ENTITIES } from "./mocks/socrata.js";
import { createDeepseekMock } from "./mocks/deepseek.js";
import { attachDeepgramMock } from "./mocks/deepgram.js";
import { createWhatsappMock } from "./mocks/whatsapp.js";
import { createRateLimiter, clientIp } from "./guards/rate-limit.js";
import { createDemandGuard } from "./guards/demand.js";
import { validateClientMessage } from "./guards/validate.js";
import { createNonce, securityHeaders } from "./headers.js";

type Env = Record<string, string | undefined>;
const DEMO = demoAnswers as Record<string, { updatedAt: string; cards: Record<string, unknown>[] }>;
// ponytail: temas fijos; la búsqueda libre por texto llega con T002 (herramientas SoQL).
const TOPICS: Record<string, string> = { "alumbrado publico": "ALUMBRADO PUBLICO" };

const day = (d: Date) => d.toISOString().slice(0, 10);

function loadEntities(env: Env, mock: boolean): Entity[] {
  if (mock) return MOCK_ENTITIES;
  const f = resolve("data/entities.json");
  const raw = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { nit: string; name: string }[]) : [];
  return raw.map((e) => toEntity(e.nit, e.name));
}

export function createApp(env: Env): { app: Hono; attach?: (s: Server) => void } {
  const mock = env.MOCK_EXTERNALS === "1";
  const app = new Hono();
  const entities = loadEntities(env, mock);
  let attach: ((s: Server) => void) | undefined;
  let client: Client = { base: env.SOCRATA_BASE ?? "https://www.datos.gov.co", token: env.DATOSGOV_APP_TOKEN };
  if (mock) {
    const socrata = createSocrataMock();
    app.route("/", socrata);
    app.route("/", createWhatsappMock());
    app.route("/__mock/deepseek", createDeepseekMock());
    attach = attachDeepgramMock;
    client = { base: "http://mock.local/__mock/socrata", fetchFn: ((u: string, i?: RequestInit) => socrata.request(u, i)) as typeof fetch };
  }

  app.use("*", async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(securityHeaders(createNonce()))) c.res.headers.set(k, v);
  });
  // Con sustitutos locales (MOCK_EXTERNALS=1, nunca en producción) el límite por defecto sube para no frenar las pruebas.
  const limiter = createRateLimiter({ limit: Number(env.RATE_LIMIT_PER_MIN ?? (mock ? 10_000 : 20)) });
  const demand = createDemandGuard({});
  app.use("/api/*", async (c, next) => {
    const r = limiter.check(clientIp(c.req.header("x-forwarded-for")));
    if (!r.allowed) return c.json({ text: r.message, cards: [] }, 429, { "retry-after": String(r.retryAfterSec) });
    const d = demand.admit("text");
    if (!d.allowed) return c.json({ text: d.message, cards: [] }, 503);
    await next();
  });
  const ctx: Ctx = { client, cache: new Lru<Row[]>() };

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/api/chat", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { message?: unknown; state?: unknown };
    const v = validateClientMessage({ type: "message", text: body.message }, { turnCount: 0 });
    if (!v.ok) return c.json({ text: v.error, cards: [] }, 400);
    const message = body.message as string;
    const state = typeof body.state === "string" ? body.state : "";
    const now = new Date();
    const from = new Date(now); from.setFullYear(from.getFullYear() - 1);
    const period = { from: day(from), to: day(now), defaulted: true };
    const source = { dataset: DATASET, queriedAt: now.toISOString(), dataUpdatedAt: now.toISOString(), url: `https://www.datos.gov.co/d/${DATASET}` };
    const reply = (r: Record<string, unknown>) => c.json({ cards: [], period, source, state, ...r });

    const where: Cond[] = [];
    let label = "";
    const norm = normalize(message);
    const withSource = (at: Date, cached: boolean) => ({ source: { ...source, dataUpdatedAt: at.toISOString() }, cached });
    const fail = () => reply({ text: "No pude consultar datos.gov.co en este momento y no tengo una copia guardada. Intenta de nuevo en unos minutos." });

    // Documentos del contrato de la lista anterior: solo enlaces oficiales, nunca el archivo.
    if (/documento|contrato firmado|estudio previo/.test(norm)) {
      const ids = state.startsWith("ids:") ? state.slice(4).split(",").filter((i) => /^[\w.-]{1,60}$/.test(i)) : [];
      const id = ids[/segundo/.test(norm) ? 1 : /tercer/.test(norm) ? 2 : 0];
      if (!id) return reply({ text: "Primero pídeme los contratos de una entidad y luego los documentos de uno." });
      try {
        const [k] = await socrataQuery(client, { where: [{ col: "id_contrato", op: "=", value: id }], limit: 1 });
        if (!k?.proceso_de_compra) return reply({ text: "No encontré ese contrato. Prueba pidiendo de nuevo la lista de contratos." });
        const year = Number(k.fecha_de_firma?.slice(0, 4)) || undefined;
        const request = /contrato firmado|estudio previo/.exec(norm)?.[0];
        const r = await listDocuments({ processId: k.proceso_de_compra, year, request }, {
          query: (ds, p) => fetchRows(client, new URLSearchParams(Object.entries(p).map(([a, b]) => [a, String(b)])), ds) as Promise<Record<string, string>[]>,
        });
        const links = r.documents.map((d) => `${d.name} (${d.type}, ${d.size}, ${d.uploadedAt.slice(0, 10)})`).join("; ");
        return reply({
          text: r.found ? "Estos son los documentos publicados en SECOP." : r.message,
          cards: [{ kind: "documents", documents: r.documents, processUrl: r.processUrl, summary: links }],
        });
      } catch { return fail(); }
    }
    // Detalle de un contrato de la lista anterior (el estado lleva sus id_contrato).
    if (/detalle|pagos|avance/.test(norm)) {
      const ids = state.startsWith("ids:") ? state.slice(4).split(",").filter((i) => /^[\w.-]{1,60}$/.test(i)) : [];
      const id = ids[/segundo/.test(norm) ? 1 : /tercer/.test(norm) ? 2 : 0];
      if (!id) return reply({ text: "Primero pídeme los contratos de una entidad y luego el detalle de uno." });
      try {
        const d = await contractDetail(ctx, id);
        if (!d) return reply({ text: "No encontré ese contrato. Prueba pidiendo de nuevo la lista de contratos." });
        return reply({ text: "Este es el detalle y los pagos del contrato.", cards: [d.card], ...withSource(d.at, d.cached) });
      } catch { return fail(); }
    }

    const nit = /\bnit\s*:?\s*([\d.]{6,13})/i.exec(message)?.[1]?.replace(/\D/g, "");
    const res = resolveEntity(message, entities);
    if (res.kind === "ambiguous") {
      return reply({ text: "Hay varias entidades con ese nombre. ¿Cuál te interesa?", options: res.options.map((e) => e.name) });
    }
    const topic = Object.keys(TOPICS).find((t) => norm.includes(t));
    if (res.kind === "entity") { where.push({ col: "nit_entidad", op: "=", value: res.entity.nit }); label = res.entity.name; }
    else if (nit) { where.push({ col: "nit_entidad", op: "=", value: nit }); label = `NIT ${nit}`; }
    else if (topic) { where.push({ col: "objeto_del_contrato", op: "like", value: TOPICS[topic] }); label = topic; }
    else return reply({ text: "No encontré una entidad, NIT o tema en tu pregunta. Prueba con el nombre de la entidad." });
    where.push({ col: "fecha_de_firma", op: ">=", value: `${period.from}T00:00:00` });

    const analytics = /mas grandes|mayores|\btop\b/.test(norm) ? ["Estos son los contratos más grandes de", topContracts]
      : /de donde|fuente|origen|recursos/.test(norm) ? ["Así se reparte, por fuente de recursos, el dinero de", fundingBreakdown]
      : /gasta|gasto|en que/.test(norm) ? ["Esto es lo que gasta por categoría", spendByCategory] : undefined;
    try {
      if (analytics) {
        const [intro, tool] = analytics as [string, typeof topContracts];
        const r = await tool(ctx, where);
        if (!r.cards.length) return reply({ text: `No encontré datos para ${label} en el periodo consultado (últimos 12 meses). Prueba ampliando el periodo o revisando el nombre.` });
        return reply({ text: `${intro} ${label}. No indicaste periodo, así que usé los últimos 12 meses.`, cards: r.cards, ...withSource(r.at, r.cached) });
      }
      const r = await searchContracts(ctx, where);
      const found = r.value;
      if (!found.length) {
        return reply({ text: `No encontré contratos para ${label} en el periodo consultado (últimos 12 meses). Prueba ampliando el periodo o revisando el nombre.` });
      }
      const shown = found.slice(0, MAX_VISIBLE);
      return reply({
        text: `Estos son los contratos de ${label}. No indicaste periodo, así que usé los últimos 12 meses.`,
        cards: shown.map(contractCard), hasMore: found.length > MAX_VISIBLE,
        state: `ids:${shown.map((x) => x.id_contrato).filter(Boolean).join(",")}`, ...withSource(r.at, r.cached),
      });
    } catch {
      const demo = res.kind === "entity" ? DEMO[res.entity.nit] : undefined;
      if (!demo) return fail();
      return reply({
        text: `datos.gov.co no respondió; te muestro una respuesta precalculada del ${demo.updatedAt.slice(0, 10)}.`,
        cards: demo.cards, cached: true, source: { ...source, dataUpdatedAt: demo.updatedAt },
      });
    }
  });
  return { app, attach };
}

export async function startServer({ port, env }: { port: number; env: Env }): Promise<{ port: number; close(): Promise<void> }> {
  const { app, attach } = createApp(env);
  const server = await new Promise<Server>((ok) => { const s = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => ok(s as Server)); });
  attach?.(server);
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { port } = await startServer({ port: Number(process.env.PORT ?? 8080), env: process.env });
  console.log(`listening on ${port}`);
}
