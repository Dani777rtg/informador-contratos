import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { applyTurn, createSessionCodec, emptyContext, resolveFollowUp, type Ctx as Ctx2 } from "./session.js";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getConnInfo } from "@hono/node-server/conninfo";
import { bodyLimit } from "hono/body-limit";
import { DATASET, fetchRows, query as socrataQuery, normalize, resolveEntity, toEntity, type Client, type Cond, type Entity, type Row } from "./data/socrata.js";
import demoAnswers from "./fallback/demo-answers.json" with { type: "json" };
import { demoKey, type DemoEntry, type DemoKind } from "./fallback/demo.js";
import { Lru } from "./cache.js";
import { createPlaces, findPlace } from "./data/places.js";
import { TOPICS } from "./tools/filters.js";
import { roundAmounts, roundedPesos, normalNames, toSpoken } from "./speech/spoken.js";
import { byValue, contractCard, MAX_VISIBLE, searchContracts, type Ctx } from "./tools/search.js";
import { fundingBreakdown, spendByCategory, topContracts } from "./tools/spend.js";
import { contractDetail } from "./tools/detail.js";
import { prefilter } from "./agent/guardrails.js";
import { decline } from "./agent/decline.js";
import { listDocuments } from "./tools/documents.js";
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
import { createNonce, securityHeaders } from "./headers.js";

type Env = Record<string, string | undefined>;
const DEMO = demoAnswers as Record<string, DemoEntry>;
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
  let client: Client = { base: env.SOCRATA_BASE ?? "https://www.datos.gov.co", token: env.DATOSGOV_APP_TOKEN };
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
  const corsMw = cors({ origin: (o) => (allowed.includes(o) ? o : null), allowMethods: ["GET", "POST"], allowHeaders: ["content-type"], maxAge: 600 });
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
    turn: (t) => { metrics.record({ channel: "voz", tokens: 0, latencyMs: t.latencyMs }); logQuestion({ tokens: 0, latencyMs: t.latencyMs, channel: "voz", route: "voz", tools: t.tools, declineCode: t.declineCode }); },
    close: (c) => logQuestion({ tokens: 0, latencyMs: c.ms, channel: "voz", route: "voz", tools: c.tools, closeReason: c.closeReason, errorType: c.errorType }),
  });
  attach = (s) => { voice.attach(s); mockAttach?.(s); };

  app.get("/api/metrics", (c) => env.METRICS_TOKEN && c.req.header("x-metrics-token") === env.METRICS_TOKEN ? c.json(metrics.report()) : c.json({ error: "forbidden" }, 403));

  app.post("/session", (c) => {
    const r = limiter.check(clientIp(c.req.header("x-forwarded-for"), socketIp(c) ?? "unknown"));
    if (!r.allowed) return c.json({ error: r.message }, 429, { "retry-after": String(r.retryAfterSec) });
    return voice.originAllowed(c.req.header("origin")) ? c.json({ token: voice.newToken() }) : c.json({ error: "origin" }, 403);
  });

  app.get("/health", (c) => c.json({ ok: true }));

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
    return c.json(await answer(body.message as string, verified, "texto"));
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

    const where: Cond[] = [];
    let label = "";
    const norm = normalize(message);
    const withSource = (at: Date, cached: boolean) => ({ source: { ...source, dataUpdatedAt: at.toISOString() }, cached });
    const fail = () => reply({ text: "No pude consultar datos.gov.co en este momento y no tengo una copia guardada. Intenta de nuevo en unos minutos." });

    // Juicios, acusaciones y ataques al prompt: plantilla fija al instante, sin LLM (0 tokens).
    const blocked = prefilter(message);
    if (blocked) return reply({ text: decline(blocked) });

    // Documentos del contrato de la lista anterior: solo enlaces oficiales, nunca el archivo.
    if (/documento|contrato firmado|estudio previo/.test(norm)) {
      const ids = (prev.results ?? []).filter((i) => /^[\w.-]{1,60}$/.test(i));
      const id = /segundo|tercer|primer/.test(norm) || !prev.contract ? ids[/segundo/.test(norm) ? 1 : /tercer/.test(norm) ? 2 : 0] : prev.contract;
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
    // Detalle de un contrato de la lista anterior (el contexto firmado lleva sus id_contrato).
    // También «dame ese contrato», «el más grande», «el primero», «ábrelo»: se resuelven sobre los resultados mostrados (del atajo o del agente).
    const followId = resolveFollowUp(message, prev);
    if (/detalle|pagos|avance/.test(norm) || followId) {
      const ids = (prev.results ?? []).filter((i) => /^[\w.-]{1,60}$/.test(i));
      const id = followId && /^[\w.-]{1,60}$/.test(followId) ? followId : ids[/segundo/.test(norm) ? 1 : /tercer/.test(norm) ? 2 : 0];
      if (!id) return reply({ text: "Primero pídeme los contratos de una entidad y luego el detalle de uno." });
      try {
        const d = await contractDetail(ctx, id);
        if (!d) return reply({ text: "No encontré ese contrato. Prueba pidiendo de nuevo la lista de contratos." });
        cur = applyTurn(prev, { contract: id });
        return reply({ text: "Este es el detalle y los pagos del contrato.", cards: [d.card], ...withSource(d.at, d.cached) });
      } catch { return fail(); }
    }

    const nit = /\bnit\s*:?\s*([\d.]{6,13})/i.exec(message)?.[1]?.replace(/\D/g, "");
    const res = resolveEntity(message, entities);
    if (res.kind === "ambiguous") {
      return reply({ text: "Hay varias entidades con ese nombre. ¿Cuál te interesa?", options: res.options.map((e) => e.name) });
    }
    const topicHit = TOPICS.find(([re]) => re.test(norm));
    // Un tema que ya es parte del nombre de la entidad ("Ministerio de Educación") no es un filtro aparte.
    const topic = topicHit && !(res.kind === "entity" && res.entity.norm.includes(normalize(topicHit[1]))) ? topicHit[1] : undefined;
    const byEntity = res.kind === "entity" || Boolean(nit);
    // Pregunta por contratistas o por un lugar: el atajo no sabe responderla, la resuelve el agente con filtros completos.
    const ranking = /\b(empresas?|contratistas?|proveedor(es)?|quien(es)?)\b|que mas|mas contratos/.test(norm);
    // Atajo sin LLM solo con intención y filtros inequívocos: entidad (o NIT) sola, tema nacional solo, o seguimiento de un atajo previo (sin filtros del agente).
    const pf = prev.filtros;
    const analyticsIntent = /mas grandes?|mayor(es)?|\btop\b|de donde|fuente|origen|recursos|gasta|gasto|en que/.test(norm);
    const followBase = !byEntity && !topic && prev.entity && !pf?.ciudad && !pf?.departamento && !pf?.tema && !pf?.proveedor && pf?.tipo !== "top_contratistas" &&
      (year || analyticsIntent || /contratos|lista/.test(norm));
    // La lista de municipios solo hace falta (y solo se espera) si el atajo es posible: así "hola" no espera a Socrata.
    const known = !ranking && !byEntity && (topic || followBase) ? await places() : [];
    const hasTerr = Boolean(findPlace(message, known).ciudad || findPlace(message, known).departamento || findPlace(message, known).ambiguous);
    const followUp = followBase && !hasTerr && known.length > 0;
    // En voz una lista de contratos no se lee: la resume el agente; los análisis (mayores, gasto, fuentes) y seguimientos sí salen por atajo.
    const spokenList = channel === "voz" && !analyticsIntent && !(followUp && pf?.tipo && pf.tipo !== "lista");
    const shortcut = !ranking && !spokenList && (byEntity ? !topic : topic ? !hasTerr && known.length > 0 : Boolean(followUp)); // sin la lista de municipios no se puede descartar un territorio: al agente
    if (!shortcut) {
      agentUsed = true;
      try {
        const a = await ask(message, prev, channel);
        cur = a.context;
        return reply({ text: a.text || (a.cards.length ? "Estos son los resultados de tu consulta, con datos oficiales de SECOP." : "No pude armar una respuesta con datos oficiales. Intenta con el nombre de la entidad."), cards: a.cards, period: cur.period ?? period, cached: a.cached, tokens: a.tokens, filters: { ...cur.filtros, entity: cur.entity?.name } });
      } catch { return fail(); }
    }
    // Seguimiento ("¿y en 2024?"): sin entidad/NIT/tema nuevos se reutiliza la entidad del contexto.
    const explicit = res.kind === "entity" || nit || topic;
    // Cambio de tema sin año explícito: vuelve a los últimos 12 meses (no arrastra el periodo anterior).
    if (explicit && !year) period = { from: day(from), to: day(now), defaulted: true };
    if (res.kind === "entity") { where.push({ col: "nit_entidad", op: "=", value: res.entity.nit }); label = res.entity.name; }
    else if (nit) { where.push({ col: "nit_entidad", op: "=", value: nit }); label = `NIT ${nit}`; }
    else if (topic) { where.push({ col: "objeto_del_contrato", op: "q", value: topic }); label = topic; }
    else if (prev.entity) { where.push({ col: "nit_entidad", op: "=", value: prev.entity.nit }); label = prev.entity.name; }
    else return reply({ text: "No encontré una entidad, NIT o tema en tu pregunta. Prueba con el nombre de la entidad." });
    const turnEntity = res.kind === "entity" ? res.entity : nit ? { nit, name: `NIT ${nit}` } : undefined;
    cur = applyTurn(prev, {
      topicChange: explicit ? true : undefined, entity: turnEntity,
      period: year ? { from: period.from, to: period.to } : undefined,
    });
    where.push({ col: "fecha_de_firma", op: ">=", value: `${period.from}T00:00:00` });
    if (!period.defaulted) where.push({ col: "fecha_de_firma", op: "<=", value: `${period.to}T23:59:59` });
    const periodText = period.defaulted ? "No indicaste periodo, así que usé los últimos 12 meses." : `Periodo: ${period.from} a ${period.to}.`;

    const TOP = ["Estos son los contratos más grandes de", topContracts, "top"], FUND = ["Así se reparte, por fuente de recursos, el dinero de", fundingBreakdown, "funding"], SPEND = ["Esto es lo que gasta por categoría", spendByCategory, "spend"];
    // "¿Y en 2024?": sin intención nueva se conserva la del turno anterior.
    const prevTipo = followUp && !/contratos|lista/.test(norm) ? pf?.tipo : undefined;
    const analytics = /mas grandes?|mayor(es)?|\btop\b/.test(norm) ? TOP
      : /de donde|fuente|origen|recursos/.test(norm) ? FUND
      : /gasta|gasto|en que/.test(norm) ? SPEND
      : prevTipo === "mayores" ? TOP : prevTipo === "fuentes_de_recursos" ? FUND : prevTipo === "gasto_por_categoria" ? SPEND : undefined;
    cur = applyTurn(cur, { filtros: { tipo: analytics === TOP ? "mayores" : analytics === FUND ? "fuentes_de_recursos" : analytics === SPEND ? "gasto_por_categoria" : "lista" } });
    const kind: DemoKind = (analytics?.[2] as DemoKind | undefined) ?? "contracts";
    try {
      if (analytics) {
        const [intro, tool] = analytics as [string, typeof topContracts];
        const r = await tool(ctx, where);
        const noData = period.defaulted ? "en los últimos 12 meses" : `entre ${period.from} y ${period.to}`;
        if (!r.cards.length) return reply({ text: `No encontré datos para ${label} ${noData}. Prueba ampliando el periodo o revisando el nombre.` });
        if ("ids" in r) cur = applyTurn(cur, { results: r.ids as string[] });
        // Cifra clave en lenguaje llano; el valor exacto queda en la tarjeta.
        const first = r.cards[0] as Record<string, unknown>;
        const key = kind === "top" ? `El mayor es de ${roundedPesos(Number(String(first.value).replace(/\D/g, "")))}${first.contractor ? `, con ${normalNames(String(first.contractor)).replace(/\.$/, "")}` : ""}.`
          : kind === "spend" ? `Lo que más se contrata es ${String(first.category).toLowerCase()}.`
          : `La fuente principal es ${String(first.source).toLowerCase()}.`;
        return reply({ text: `${intro} ${label}. ${key} ${periodText}`, cards: r.cards, ...withSource(r.at, r.cached) });
      }
      const r = await searchContracts(ctx, where);
      const found = r.value;
      if (!found.length) {
        return reply({ text: `No encontré contratos para ${label} ${period.defaulted ? "en los últimos 12 meses" : `entre ${period.from} y ${period.to}`}. Prueba ampliando el periodo o revisando el nombre.` });
      }
      const shown = byValue(found.slice(0, MAX_VISIBLE));
      cur = applyTurn(cur, { results: shown.map((x) => x.id_contrato).filter((i): i is string => Boolean(i)) });
      return reply({
        text: `Estos son los contratos de ${label}, de mayor a menor valor. ${periodText}`,
        cards: shown.map(contractCard), hasMore: found.length > MAX_VISIBLE, ...withSource(r.at, r.cached),
      });
    } catch {
      const demo = DEMO[demoKey(where, kind, period)];
      if (!demo) return fail();
      return reply({
        text: `datos.gov.co no respondió; te muestro una respuesta precalculada de ${demo.label}, con datos al ${demo.updatedAt.slice(0, 10)}.`,
        cards: demo.cards, cached: true, source: { ...source, dataUpdatedAt: demo.updatedAt },
      });
    }
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
  return { app, attach, chat, warm: () => void places() };
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
