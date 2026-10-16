import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { DATASET, normalize, query, resolveEntity, toEntity, type Client, type Cond, type Entity, type Row } from "./data/socrata.js";
import { createSocrataMock, MOCK_ENTITIES } from "./mocks/socrata.js";
import { createDeepseekMock } from "./mocks/deepseek.js";
import { attachDeepgramMock } from "./mocks/deepgram.js";
import { createWhatsappMock } from "./mocks/whatsapp.js";
import { createRateLimiter, clientIp } from "./guards/rate-limit.js";
import { createDemandGuard } from "./guards/demand.js";
import { validateClientMessage } from "./guards/validate.js";
import { createNonce, securityHeaders } from "./headers.js";

type Env = Record<string, string | undefined>;
const MAX_VISIBLE = 5;
// ponytail: temas fijos; la búsqueda libre por texto llega con T002 (herramientas SoQL).
const TOPICS: Record<string, string> = { "alumbrado publico": "ALUMBRADO PUBLICO" };

const money = (v: string) => `$${String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
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
  const limiter = createRateLimiter({});
  const demand = createDemandGuard({});
  app.use("/api/*", async (c, next) => {
    const r = limiter.check(clientIp(c.req.header("x-forwarded-for")));
    if (!r.allowed) return c.json({ text: r.message, cards: [] }, 429, { "retry-after": String(r.retryAfterSec) });
    const d = demand.admit("text");
    if (!d.allowed) return c.json({ text: d.message, cards: [] }, 503);
    await next();
  });

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
    const nit = /\bnit\s*:?\s*([\d.]{6,13})/i.exec(message)?.[1]?.replace(/\D/g, "");
    const res = resolveEntity(message, entities);
    if (res.kind === "ambiguous") {
      return reply({ text: "Hay varias entidades con ese nombre. ¿Cuál te interesa?", options: res.options.map((e) => e.name) });
    }
    const topic = Object.keys(TOPICS).find((t) => normalize(message).includes(t));
    if (res.kind === "entity") { where.push({ col: "nit_entidad", op: "=", value: res.entity.nit }); label = res.entity.name; }
    else if (nit) { where.push({ col: "nit_entidad", op: "=", value: nit }); label = `NIT ${nit}`; }
    else if (topic) { where.push({ col: "objeto_del_contrato", op: "like", value: TOPICS[topic] }); label = topic; }
    else return reply({ text: "No encontré una entidad, NIT o tema en tu pregunta. Prueba con el nombre de la entidad." });
    where.push({ col: "fecha_de_firma", op: ">=", value: `${period.from}T00:00:00` });

    let found: Row[];
    try {
      found = await query(client, { where, order: { col: "fecha_de_firma", desc: true }, limit: MAX_VISIBLE + 1 });
    } catch {
      return reply({ text: "No pude consultar datos.gov.co en este momento. Intenta de nuevo en unos minutos." });
    }
    if (!found.length) {
      return reply({ text: `No encontré contratos para ${label} en el periodo consultado (últimos 12 meses). Prueba ampliando el periodo o revisando el nombre.` });
    }
    const cards = found.slice(0, MAX_VISIBLE).map((r) => ({
      kind: "contract", entity: r.nombre_entidad, contractor: r.proveedor_adjudicado, object: r.objeto_del_contrato,
      value: money(r.valor_del_contrato ?? "0"), signedAt: (r.fecha_de_firma ?? "").slice(0, 10), status: r.estado_contrato,
      url: typeof r.urlproceso === "object" ? (r.urlproceso as { url?: string }).url : r.urlproceso,
    }));
    return reply({
      text: `Estos son los contratos de ${label}. No indicaste periodo, así que usé los últimos 12 meses.`,
      cards, hasMore: found.length > MAX_VISIBLE,
    });
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
