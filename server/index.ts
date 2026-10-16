import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createSessionCodec, emptyContext, type Ctx as Ctx2 } from "./session.js";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getConnInfo } from "@hono/node-server/conninfo";
import { bodyLimit } from "hono/body-limit";
import { DATASET, toEntity, type Client, type Entity, type Row } from "./data/socrata.js";
import { Lru } from "./cache.js";
import { createPlaces } from "./data/places.js";
import { loadSnapshot } from "./fallback/snapshot.js";
import { roundAmounts, normalNames, toSpoken } from "./speech/spoken.js";
import { type Ctx } from "./tools/search.js";
import { createSocrataMock, MOCK_ENTITIES } from "./mocks/socrata.js";
import { createDeepseekMock } from "./mocks/deepseek.js";
import { attachDeepgramMock } from "./mocks/deepgram.js";
import { createWhatsappMock } from "./mocks/whatsapp.js";
import { createRateLimiter, clientIp } from "./guards/rate-limit.js";
import { createDemandGuard } from "./guards/demand.js";
import { posNum, validateClientMessage } from "./guards/validate.js";
import { createVoice } from "./voice/index.js";
import { createDeepseekLlm } from "./agent/loop.js";
import { createTools } from "./agent/tools.js";
import { createAsker } from "./agent/ask.js";
import { createTopicGuard } from "./session-topic.js";
import { createMetrics } from "./metrics.js";
import { createQuestionLogger } from "./log.js";
import { createWhatsApp } from "./whatsapp/index.js";
import { firestoreStore, memoryStore, templateStatus } from "./whatsapp/store.js";
import { diagLog, isDiagnostic } from "./diag.js";
import { createNonce, securityHeaders } from "./headers.js";

type Env = Record<string, string | undefined>;
type Answer = Record<string, unknown> & { text: string; state: string };
const day = (d: Date) => d.toISOString().slice(0, 10);

function loadEntities(mock: boolean): Entity[] {
  if (mock) return MOCK_ENTITIES;
  const f = resolve("data/entities.json");
  if (!existsSync(f)) return [];
  try {
    const raw = JSON.parse(readFileSync(f, "utf8")) as { nit: string; name: string }[];
    return raw.map((e) => toEntity(e.nit, e.name));
  } catch {
    throw new Error("data/entities.json no es un JSON válido con la forma [{nit, name}]; regenéralo con el script de entidades.");
  }
}

export function createApp(env: Env): { app: Hono; attach?: (s: Server) => void; chat: (message: string, state: string | undefined, channel: "texto" | "voz") => Promise<Answer>; warm: () => void } {
  const mock = env.MOCK_EXTERNALS === "1";
  if (mock && env.NODE_ENV === "production") throw new Error("MOCK_EXTERNALS=1 no se permite con NODE_ENV=production.");
  const app = new Hono();
  const entities = loadEntities(mock);
  let attach: ((s: Server) => void) | undefined;
  let mockAttach: ((s: Server) => void) | undefined;
  let client: Client = { base: env.SOCRATA_BASE ?? "https://www.datos.gov.co", token: env.DATOSGOV_APP_TOKEN, reuseMs: 8000 };
  if (mock) {
    const socrata = createSocrataMock();
    app.route("/", socrata);
    app.route("/", createWhatsappMock());
    app.route("/__mock/deepseek", createDeepseekMock());
    mockAttach = attachDeepgramMock;
    client = { base: "http://mock.local/__mock/socrata", fetchFn: ((u: string, i?: RequestInit) => socrata.request(u, i)) as typeof fetch };
  }

  app.use("*", async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(securityHeaders(createNonce()))) c.res.headers.set(k, v);
  });
  // Front y API comparten origen (Cloud Run); CORS solo para los orígenes permitidos (dev con Vite en otro puerto).
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const corsMw = cors({ origin: (o) => (allowed.includes(o) ? o : null), allowMethods: ["GET", "POST"], allowHeaders: ["content-type", "x-diag-code"], maxAge: 600 });
  for (const p of ["/api/*", "/session", "/health"]) app.use(p, corsMw);
  // Con sustitutos locales (MOCK_EXTERNALS=1, nunca en producción) el límite por defecto sube para no frenar las pruebas.
  const limiter = createRateLimiter({ limit: posNum(env.RATE_LIMIT_PER_MIN, mock ? 10_000 : 20) });
  const demand = createDemandGuard({});
  app.onError((_e, c) => c.json({ text: "No pude procesar tu solicitud en este momento. Intenta de nuevo.", cards: [] }, 500));
  app.use("/api/*", bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ text: "La solicitud es demasiado grande.", cards: [] }, 413) }));
  const socketIp = (c: Parameters<typeof getConnInfo>[0]) => { try { return getConnInfo(c).remote.address; } catch { return undefined; } };
  app.use("/api/*", async (c, next) => {
    const r = limiter.check(clientIp(c.req.header("x-forwarded-for"), socketIp(c) ?? "unknown"));
    if (!r.allowed) return c.json({ text: r.message, cards: [] }, 429, { "retry-after": String(r.retryAfterSec) });
    const d = demand.admit("text");
    if (!d.allowed) return c.json({ text: d.message, cards: [] }, 503);
    await next();
  });
  const ctx: Ctx = { client, cache: new Lru<Row[]>() };
  const places = createPlaces(client);
  const metrics = createMetrics();
  const logQuestion = createQuestionLogger((line) => console.log(line));
  const llm = createDeepseekLlm({
    baseUrl: env.DEEPSEEK_BASE_URL ?? (mock ? "http://mock.local/__mock/deepseek/v1" : undefined), apiKey: env.DEEPSEEK_API_KEY,
    ...(mock && !env.DEEPSEEK_BASE_URL ? { fetch: ((u: string, i?: RequestInit) => app.request(u.replace("http://mock.local", ""), i)) as typeof fetch } : {}),
  });
  const tools = createTools(ctx, entities, places);
  const ask = createAsker({ tools, llm, metrics, log: logQuestion, demand, topicGuard: createTopicGuard(entities) });
  // HMAC_SECRET viene de Secret Manager en producción; sin él (local) la clave es efímera y las sesiones no sobreviven a un reinicio.
  const codec = createSessionCodec({ keys: { 1: env.HMAC_SECRET || randomBytes(32).toString("hex") }, currentKeyVersion: 1 });

  const voice = createVoice(env, { limiter, demand }, {
    // Las herramientas de ESTE servidor (cliente, entidades, municipios), no el último configurado en el proceso.
    run: async (name, args, _data, sctx) => (tools[name] ? tools[name].run(args, sctx ?? {}) : { data: { error: "sin_resultados" } }),
    turn: (t) => { metrics.record({ channel: "voz", tokens: 0, latencyMs: t.latencyMs }); logQuestion({ tokens: 0, latencyMs: t.latencyMs, channel: "voz", route: "voz", tools: t.tools, declineCode: t.declineCode, intent: t.intent, placeMatched: t.placeMatched ?? "no", resultCode: t.resultCode }); },
    close: (c) => logQuestion({ tokens: 0, latencyMs: c.ms, channel: "voz", route: "voz", tools: c.tools, closeReason: c.closeReason, errorType: c.errorType }),
  });
  attach = (s) => { voice.attach(s); mockAttach?.(s); };

  app.get("/api/metrics", (c) => env.METRICS_TOKEN && c.req.header("x-metrics-token") === env.METRICS_TOKEN ? c.json(metrics.report()) : c.json({ error: "forbidden" }, 403));

  app.post("/session", (c) => {
    const r = limiter.check(clientIp(c.req.header("x-forwarded-for"), socketIp(c) ?? "unknown"));
    if (!r.allowed) return c.json({ error: r.message }, 429, { "retry-after": String(r.retryAfterSec) });
    return voice.originAllowed(c.req.header("origin")) ? c.json({ token: voice.newToken() }) : c.json({ error: "origin" }, 403);
  });

  app.get("/health", (c) => { void places(); return c.json({ ok: true }); }); // precalienta la lista de municipios sin esperarla

  // WhatsApp: resumen y enlace salen del estado de la conversación (solo ids validados), nunca de texto libre del cliente.
  const wabaId = env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? env.WHATSAPP_WABA_ID ?? "", templateName = env.WHATSAPP_TEMPLATE ?? "resumen_secop", token = env.WHATSAPP_ACCESS_TOKEN ?? env.WHATSAPP_TOKEN ?? "";
  const ver = env.WHATSAPP_API_VERSION ?? "v21.0";
  const waFetch = mock ? ((u: string, i?: RequestInit) => app.request(u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+/, "/__mock/whatsapp"), i)) as typeof fetch : fetch;
  const approved = templateStatus(waFetch, { wabaId, token, name: templateName, base: mock ? "/__mock/whatsapp" : `https://graph.facebook.com/${ver}` });
  const waStore = mock || !env.GOOGLE_CLOUD_PROJECT ? memoryStore() : firestoreStore(env.GOOGLE_CLOUD_PROJECT);
  app.post("/api/whatsapp", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { phone?: unknown; consent?: unknown; state?: unknown };
    const ids = ((codec.verify(b.state) ?? emptyContext()).results ?? []).filter((i) => /^[\w.-]{1,60}$/.test(i));
    if (!ids.length) return c.json({ ok: false, message: "Primero pídeme los contratos de una entidad y luego te los envío." }, 400);
    const secopUrl = `https://www.datos.gov.co/d/${DATASET}`;
    const wa = createWhatsApp({
      fetch: waFetch, store: waStore, now: Date.now, wabaId, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "", token, templateName,
      templateApproved: await approved(), apiVersion: ver,
    });
    const ip = clientIp(c.req.header("x-forwarded-for"));
    const r = await wa.send({ ip, phone: typeof b.phone === "string" ? b.phone : "", consent: b.consent === true, summary: `Resumen de ${ids.length} contratos`, secopUrl });
    return c.json(r, r.ok ? 200 : r.retryAfterSeconds ? 429 : 400);
  });

  app.post("/api/chat", async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const body = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as { message?: unknown; state?: unknown };
    // Estado firmado inválido, viejo, caducado o desmesurado -> conversación nueva, sin error.
    const state = typeof body.state === "string" && body.state.length <= 4096 ? body.state : undefined;
    const verified = codec.verify(state) ?? emptyContext();
    const v = validateClientMessage({ type: "message", text: body.message }, { turnCount: verified.turns ?? 0 });
    if (!v.ok) return c.json({ text: v.error, cards: [] }, 400);
    const diag = isDiagnostic(c.req.header("x-diag-code"), clientIp(c.req.header("x-forwarded-for"), socketIp(c) ?? "unknown"), env);
    const out = await answer(body.message as string, verified, "texto");
    if (diag) diagLog({ channel: "texto", pregunta: body.message, respuesta: out.text });
    return c.json(out);
  });

  /** Una respuesta del asistente (texto y voz comparten atajos, agente y contexto). */
  async function answer(message: string, verified: Ctx2, channel: "texto" | "voz"): Promise<Answer> {
    const prev: Ctx2 = { ...verified, turns: (verified.turns ?? 0) + 1 };
    let cur = prev;
    const now = new Date();
    const from = new Date(now); from.setFullYear(from.getFullYear() - 1);
    const year = /\b(20[12]\d)\b/.exec(message)?.[1];
    let period: { from: string; to: string; defaulted?: boolean } = year ? { from: `${year}-01-01`, to: `${year}-12-31` }
      : prev.period ? prev.period : { from: day(from), to: day(now), defaulted: true };
    const source = { dataset: DATASET, queriedAt: now.toISOString(), dataUpdatedAt: now.toISOString(), url: `https://www.datos.gov.co/d/${DATASET}` };
    const t0 = Date.now();
    let agentUsed = false;
    const reply = (r: Record<string, unknown>) => {
      if (!agentUsed) { const latencyMs = Date.now() - t0; metrics.record({ channel, tokens: 0, latencyMs }); logQuestion({ tokens: 0, latencyMs, channel, route: "atajo" }); }
      // Lenguaje llano: cifra clave redondeada y nombres en formato normal; el valor exacto queda en la tarjeta.
      const text = typeof r.text === "string" ? roundAmounts(normalNames(r.text)) : r.text;
      return { cards: [], period, source, state: codec.sign(cur), ...r, text, ...(channel === "voz" && typeof text === "string" ? { spoken: toSpoken(text) } : {}) } as Answer;
    };

    // Saludo solo: respuesta cálida sin datos ni LLM (AC-13.1).
    if (/^((hola|buen[oa]s( (dias|tardes|noches))?|hey|saludos|como estas|que tal|como vas)[\s,.!¡¿?]*)+$/.test(message.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()))
      return reply({ text: "¡Hola! Qué gusto saludarte. Te ayudo a entender en qué se gasta el dinero público según el SECOP: por municipio, departamento, entidad o contratista. ¿Qué te gustaría saber?" });
    // Todo lo demás lo decide el agente con sus herramientas (texto y voz, misma misión).
    agentUsed = true;
    try {
      const a = await ask(message, prev, channel);
      cur = { ...a.context, turns: prev.turns }; // el tope de turnos vive en el estado firmado
      return reply({ text: a.text || (a.cards.length ? "Estos son los resultados de tu consulta, con datos oficiales de SECOP." : "No pude armar una respuesta con datos oficiales. Intenta con el nombre de la entidad."), cards: a.cards, period: cur.period ?? period, cached: a.cached, tokens: a.tokens, filters: { ...cur.filtros, entity: cur.entity?.name } });
    } catch { return reply({ text: "No pude consultar datos.gov.co en este momento y no tengo una copia guardada. Intenta de nuevo en unos minutos." }); }
  }
  // Front (web/dist) en el mismo servicio; va al final: solo atiende lo que ninguna ruta anterior resolvió.
  app.use("*", async (c, next) => {
    await next();
    if (c.req.method === "GET" && c.res.status === 200 && !c.res.headers.has("cache-control") && !c.res.headers.has("access-control-allow-origin") && c.res.headers.get("content-type")?.match(/html|javascript|css|image|font/))
      c.res.headers.set("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  });
  app.use("*", serveStatic({ root: "web/dist" }));
  // `chat`: mismo flujo que /api/chat, en proceso (evaluación con datos reales).
  const chat = (message: string, state: string | undefined, channel: "texto" | "voz") => answer(message, codec.verify(state) ?? emptyContext(), channel);
  return { app, attach, chat, warm: () => { void places(); loadSnapshot(); } }; // el respaldo (gunzip + JSON) se carga al arrancar, no en la primera pregunta
}

export async function startServer({ port, env }: { port: number; env: Env }): Promise<{ port: number; close(): Promise<void> }> {
  const { app, attach, warm } = createApp(env);
  warm();
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
