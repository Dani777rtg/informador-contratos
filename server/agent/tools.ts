import { fetchRows, normalize, query as socrataQuery, resolveEntity, type Entity } from "../data/socrata.js";
import { DEPARTAMENTOS, findPlace, placeLabel, type Place } from "../data/places.js";
import { byValue, contractCard, MAX_VISIBLE, searchContracts, type Ctx as DataCtx } from "../tools/search.js";
import { fundingBreakdown, spendByCategory, topContractors, topContracts } from "../tools/spend.js";
import { buildWhere, matching, type Filters } from "../tools/filters.js";
import { contractDetail } from "../tools/detail.js";
import { listDocuments } from "../tools/documents.js";
import type { Ctx, Tool, ToolRegistry, ToolResult } from "./loop.js";

const day = (d: Date) => d.toISOString().slice(0, 10);
const ID = /^[\w.-]{1,60}$/;
const str = (v: unknown, max = 80): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const AGENT_TIMEOUT_MS = 10_000; // el agente ya espera al LLM; las agregaciones de Socrata pueden tardar más que el atajo

const FILTER_PROPS = {
  nit: { type: "string", description: "NIT de la entidad compradora" },
  entidad: { type: "string", description: "Nombre de la entidad compradora (ej. Ministerio de Educación, Alcaldía de Pasto)" },
  ciudad: { type: "string", description: "Municipio donde está la entidad (ej. Manizales, Cartagena, Medellín)" },
  departamento: { type: "string", description: "Departamento (ej. Antioquia)" },
  tema: { type: "string", description: "Tema u objeto del contrato, con tildes (ej. vías, salud, alimentación escolar)" },
  proveedor: { type: "string", description: "Nombre (o parte) del contratista" },
  nit_proveedor: { type: "string", description: "NIT o documento del contratista" },
  anio: { type: "integer", minimum: 2000, maximum: 2100, description: "Año de firma; sin él, últimos 12 meses" },
};

type Resolved = { filters: Filters; label: string; entity?: Entity } | { out: ToolResult };
const fail = (data: unknown): { out: ToolResult } => ({ out: { data } });

/** Interpreta y valida los filtros del LLM; nunca ignora en silencio un filtro que no pudo resolver. */
async function resolveFilters(args: Record<string, unknown>, ctx: Ctx, entities: Entity[], places: () => Promise<Place[]>): Promise<Resolved> {
  const f: Filters = { period: { from: "", to: "" } };
  const label: string[] = [];
  let entity: Entity | undefined;
  const nit = str(args.nit, 20).replace(/\D/g, "");
  if (nit.length >= 5 && nit.length <= 12) { f.nit = nit; label.push(`entidad NIT ${nit}`); }
  else if (str(args.entidad)) {
    const r = resolveEntity(str(args.entidad), entities);
    if (r.kind === "ambiguous") return fail({ ambigua: r.options.map((e) => e.name) });
    if (r.kind === "none") return fail({ error: `No identifiqué la entidad "${str(args.entidad)}". Pide al usuario el nombre completo o el NIT.` });
    entity = r.entity; f.nit = r.entity.nit; label.push(r.entity.name);
  }
  const ciudad = str(args.ciudad), dep = str(args.departamento);
  if (ciudad) {
    const p = findPlace(ciudad, await places());
    if (p.ambiguous) return fail({ ambigua: p.ambiguous });
    if (!p.ciudad) return fail({ error: `No encontré el municipio "${ciudad}" en los datos.` });
    f.ciudad = p.ciudad; f.departamento = p.departamento; label.push(`entidades de ${placeLabel(p)}`);
  } else if (dep) {
    const d = DEPARTAMENTOS.find(([k]) => k === normalize(dep) || normalize(dep).includes(k));
    if (!d) return fail({ error: `No reconozco el departamento "${dep}".` });
    f.departamento = d[1]; label.push(`entidades de ${d[1]}`);
  }
  f.tema = str(args.tema) || undefined;
  if (f.tema) label.push(`tema: ${f.tema}`);
  f.proveedor = str(args.proveedor) || undefined;
  if (f.proveedor) label.push(`contratista: ${f.proveedor}`);
  const np = str(args.nit_proveedor, 20).replace(/\D/g, "");
  if (np.length >= 5) { f.nitProveedor = np; label.push(`contratista NIT ${np}`); }
  // Seguimiento ("¿y en 2024?"): sin ningún filtro nuevo se reutiliza la entidad del contexto.
  if (!f.nit && !f.ciudad && !f.departamento && !f.tema && !f.proveedor && !f.nitProveedor && ctx.entity) {
    f.nit = ctx.entity.nit; entity = ctx.entity as Entity; label.push(ctx.entity.name);
  }
  if (!f.nit && !f.ciudad && !f.departamento && !f.tema && !f.proveedor && !f.nitProveedor) return fail({ error: "falta entidad, municipio, departamento, tema o contratista" });
  const anio = Number(args.anio);
  const now = new Date(), from = new Date(now); from.setFullYear(from.getFullYear() - 1);
  f.period = Number.isInteger(anio) && anio >= 2000 && anio <= 2100 ? { from: `${anio}-01-01`, to: `${anio}-12-31` }
    : ctx.period ?? { from: day(from), to: day(now) };
  return { filters: f, label: label.join("; "), entity };
}

/** Herramientas tipadas para el agente: parámetros validados, nunca SoQL crudo. */
export function createTools(base: DataCtx, entities: Entity[], places: () => Promise<Place[]> = async () => []): ToolRegistry {
  const data: DataCtx = { ...base, client: { ...base.client, timeoutMs: base.client.timeoutMs ?? AGENT_TIMEOUT_MS } };
  const empty = (label: string, f: Filters): ToolResult =>
    ({ data: { sinResultados: `No hay contratos de ${label} entre ${f.period.from} y ${f.period.to}. Dilo así; no muestres datos de otra entidad o territorio.`, periodo: f.period } });

  /** Plantilla común: resuelve filtros, ejecuta y añade al contexto los filtros usados. */
  const filtered = (name: string, description: string, extra: Record<string, unknown>, run: (f: Filters, label: string, args: Record<string, unknown>) => Promise<ToolResult>): Tool => ({
    name, description,
    parameters: { type: "object", properties: { ...extra, ...FILTER_PROPS }, required: "tipo" in extra ? ["tipo"] : [] },
    async run(args, ctx) {
      const r = await resolveFilters(args, ctx, entities, places);
      if ("out" in r) return r.out;
      const f = r.filters;
      const res = await run(f, r.label, args);
      return {
        ...res,
        context: {
          entity: f.nit ? { nit: f.nit, name: r.entity?.name ?? `NIT ${f.nit}` } : undefined,
          period: { from: f.period.from, to: f.period.to },
          filtros: { ciudad: f.ciudad, departamento: f.departamento, tema: f.tema, proveedor: f.proveedor, tipo: str(args.tipo, 30) || name },
          ...res.context,
        },
      };
    },
  });
  const shape = (cards: { kind: string }[], f: Filters, label: string, more = {}): ToolResult =>
    cards.length ? { data: { resultado: cards, filtros: label, periodo: f.period, ...more }, cards: cards as ToolResult["cards"] } : empty(label, f);

  const consultar = filtered("consultar_contratos",
    "Contratos SECOP. tipo: lista (recientes), mayores (mayor valor), fuentes_de_recursos. Combina entidad, municipio, departamento, tema, contratista y año.",
    { tipo: { type: "string", enum: ["lista", "mayores", "fuentes_de_recursos"] } },
    async (f, label, args) => {
      const where = buildWhere(f);
      const tipo = str(args.tipo, 30);
      if (tipo === "mayores") { const t = await topContracts(data, where); return { ...shape(t.cards, f, label), context: { results: t.ids } }; }
      if (tipo === "fuentes_de_recursos") return shape((await fundingBreakdown(data, where)).cards, f, label);
      if (tipo !== "lista") return { data: { error: "tipo inválido" } };
      const r = await searchContracts(data, where);
      const found = matching(r.value, f);
      if (!found.length) return empty(label, f);
      const shown = byValue(found.slice(0, MAX_VISIBLE)), cards = shown.map(contractCard);
      return {
        data: { contratos: cards, hayMas: found.length > MAX_VISIBLE, filtros: label, periodo: f.period }, cards,
        context: { results: shown.map((x) => x.id_contrato).filter((i): i is string => Boolean(i)) },
      };
    });
  const gasto = filtered("gasto_por_categoria", "Cuánto se contrató por tipo de contrato (categoría), con total y número de contratos. Mismos filtros.", {},
    async (f, label) => shape((await spendByCategory(data, buildWhere(f))).cards, f, label));
  const contratistas = filtered("top_contratistas", "Ranking de contratistas (empresas o personas), con total y número de contratos. orden: valor (defecto) o cantidad (quién tiene más contratos). Mismos filtros.",
    { orden: { type: "string", enum: ["valor", "cantidad"] } },
    async (f, label, args) => shape((await topContractors(data, buildWhere(f), str(args.orden, 10) === "cantidad" ? "count" : "sum")).cards, f, label));

  const detalle: Tool = {
    name: "detalle_contrato",
    description: "Detalle y pagos de un contrato.",
    parameters: { type: "object", properties: { id_contrato: { type: "string" } }, required: ["id_contrato"] },
    async run(args) {
      const id = String(args.id_contrato ?? "");
      if (!ID.test(id)) return { data: { error: "id inválido" } };
      const d = await contractDetail(data, id);
      return d ? { data: d.card, cards: [d.card], context: { contract: id } } : { data: { error: "contrato no encontrado" } };
    },
  };
  const documentos: Tool = {
    name: "documentos_contrato",
    description: "Documentos SECOP de un contrato.",
    parameters: { type: "object", properties: { id_contrato: { type: "string" } }, required: ["id_contrato"] },
    async run(args) {
      const id = String(args.id_contrato ?? "");
      if (!ID.test(id)) return { data: { error: "id inválido" } };
      const [k] = await socrataQuery(data.client, { where: [{ col: "id_contrato", op: "=", value: id }], limit: 1 });
      if (!k?.proceso_de_compra) return { data: { error: "contrato no encontrado" } };
      const r = await listDocuments({ processId: k.proceso_de_compra, year: Number(k.fecha_de_firma?.slice(0, 4)) || undefined }, {
        query: (ds, p) => fetchRows(data.client, new URLSearchParams(Object.entries(p).map(([a, b]) => [a, String(b)])), ds) as Promise<Record<string, string>[]>,
      });
      const card = { kind: "documents", documents: r.documents, processUrl: r.processUrl };
      return { data: { documentos: r.documents.map((d) => d.name), mensaje: r.message }, cards: [card], context: { contract: id } };
    },
  };
  return Object.fromEntries([consultar, gasto, contratistas, detalle, documentos].map((t) => [t.name, t]));
}
