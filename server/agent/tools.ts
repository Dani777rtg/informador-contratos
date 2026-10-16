import { fetchRows, query as socrataQuery, type Entity, type Row } from "../data/socrata.js";
import { createPlaces, matchEntity, matchPlace, type Place } from "../data/places.js";
import { withBudget } from "../data/budget.js";
import { SLOW_NOTICE, SocrataUnavailable } from "../data/retry.js";
import { Lru } from "../cache.js";
import { byValue, contractCard, MAX_VISIBLE, searchContracts, type Ctx as DataCtx } from "../tools/search.js";
import { spendByCategory, topContractors, topContracts, topEntities, totalSpend } from "../tools/spend.js";
import { buildWhere, matching, type Filters } from "../tools/filters.js";
import { contractDetail } from "../tools/detail.js";
import { listDocuments } from "../tools/documents.js";
import { fromSnapshot, loadSnapshot, snapshotPlaces, type Scope } from "../fallback/snapshot.js";
import { isOutlier, OUTLIER_NOTE } from "../data/outliers.js";
import { roundedPesos } from "../speech/spoken.js";
import type { Ctx, Tool, ToolRegistry, ToolResult } from "./loop.js";

const day = (d: Date) => d.toISOString().slice(0, 10);
const ID = /^[\w.-]{1,60}$/;
const str = (v: unknown, max = 80): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const PLACES_WAIT_MS = 2500;
const MAX_LIMIT = 10, DEFAULT_LIMIT = 5;

const FILTER_PROPS = {
  municipio: { type: "string", description: "Municipio donde está la entidad (ej. Manizales, Cartagena, Medellín); tolera errores de transcripción" },
  departamento: { type: "string", description: "Departamento (ej. Antioquia)" },
  entidad: { type: "string", description: "Entidad compradora: nombre (ej. Ministerio de Educación, Alcaldía de Pasto) o NIT" },
  tema: { type: "string", description: "Tema u objeto del contrato, con tildes (ej. vías, salud, alimentación escolar)" },
  proveedor: { type: "string", description: "Nombre (o parte) del contratista" },
  anio: { type: "integer", minimum: 2000, maximum: 2100, description: "Año de firma; sin él ni desde/hasta, últimos 12 meses" },
  desde: { type: "string", description: "Inicio del periodo: año (2024) o fecha AAAA-MM-DD" },
  hasta: { type: "string", description: "Fin del periodo: año (2025) o fecha AAAA-MM-DD" },
  limite: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: "Cuántos resultados (máximo 10; por voz 3)" },
};
const def = (name: string, description: string, extra: Record<string, unknown> = {}) =>
  ({ name, description, parameters: { type: "object", properties: { ...FILTER_PROPS, ...extra }, required: [] as string[] } });

/** Definiciones para el LLM (texto) y para el Voice Agent: parámetros cerrados, nunca SoQL. */
export const TOOL_DEFS = [
  def("gasto_total", "Cuánto se contrató en total (valor y número de contratos). Sin entidad ni NIT: sirve por municipio, departamento, tema o periodo."),
  def("gasto_por_categoria", "Cuánto se contrató por tipo de contrato (categoría), con total y número de contratos."),
  def("top_entidades", "Ranking de entidades compradoras: cuáles contrataron más (valor y número de contratos)."),
  def("top_contratistas", "Ranking de contratistas (empresas o personas): quién recibió más. orden: valor (defecto) o cantidad.", { orden: { type: "string", enum: ["valor", "cantidad"] } }),
  def("contratos_mayores", "Los contratos de mayor valor del filtro, del más grande al más pequeño."),
  def("buscar_contratos", "Contratos recientes que cumplen los filtros (municipio, departamento, entidad, tema, contratista, periodo)."),
  {
    name: "detalle_contrato",
    description: "Detalle y pagos de un contrato mostrado antes; con documentos=true también sus documentos oficiales de SECOP.",
    parameters: { type: "object", properties: { id_contrato: { type: "string" }, documentos: { type: "boolean" } }, required: ["id_contrato"] },
  },
];

interface Deps { base: DataCtx; entities: Entity[]; places?: () => Promise<Place[]> }
let deps: Deps = {
  base: { client: { base: process.env.SOCRATA_BASE ?? "https://www.datos.gov.co", token: process.env.DATOSGOV_APP_TOKEN }, cache: new Lru<Row[]>() },
  entities: [],
};
/** Conecta las herramientas con el cliente, el índice de entidades y la lista de municipios (los mismos para texto y voz). */
export const configureTools = (d: Deps): void => { deps = d; };

/** Montos en lenguaje llano para el modelo («$2.700 millones de pesos»); el valor exacto con COP queda en las tarjetas. */
function say<T>(v: T): T {
  if (typeof v === "string") {
    const m = /^\$([\d.]+) COP$/.exec(v);
    if (!m) return v;
    const n = Number(m[1].replace(/\./g, ""));
    return (n >= 1e6 ? roundedPesos(n) : `${roundedPesos(n)} pesos`) as T;
  }
  if (Array.isArray(v)) return v.map(say) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, say(x)])) as T;
  return v;
}

const year = (v: unknown): string | undefined => { const s = str(v, 10); return /^\d{4}$/.test(s) ? s : undefined; };
const date = (v: unknown, end: boolean): string | undefined => {
  const s = str(v, 10), y = year(s);
  return y ? `${y}-${end ? "12-31" : "01-01"}` : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};

type Resolved = { f: Filters; label: string; scope: Scope; textual: boolean; explicitPeriod: boolean } | { out: ToolResult };
const fail = (data: unknown): { out: ToolResult } => ({ out: { data } });

/** Interpreta y valida los filtros; nunca ignora en silencio un filtro que no pudo resolver. */
async function resolveFilters(args: Record<string, unknown>, ctx: Ctx, d: Deps, client: DataCtx["client"]): Promise<Resolved> {
  const f: Filters = { period: { from: "", to: "" } };
  const label: string[] = [];
  const entidad = str(args.entidad);
  const nit = entidad.replace(/[.\s]/g, "");
  if (/^\d{5,12}$/.test(nit)) { f.nit = nit; label.push(`entidad NIT ${nit}`); }
  else if (entidad) {
    const m = matchEntity(entidad, d.entities);
    if ("sugerencias" in m) return fail({ error: "sin_resultados", sugerencias: m.sugerencias, nota: `No identifiqué la entidad "${entidad.slice(0, 40)}". Ofrece las sugerencias o pide el NIT.` });
    f.nit = m.entity.nit; label.push(m.entity.name);
  }
  const municipio = str(args.municipio) || str(args.ciudad), dep = str(args.departamento);
  if (municipio || dep) {
    // La lista de municipios en frío tarda ~12 s: no se espera más de 2,5 s (sigue cargando en segundo plano) y se usa la del respaldo.
    const known = await Promise.race([(d.places ?? placesFor(client))(), new Promise<Place[]>((ok) => setTimeout(() => ok([]), PLACES_WAIT_MS).unref())]);
    const places = known.length ? known : snapshotPlaces();
    const m = matchPlace(municipio || dep, places, municipio ? dep : undefined, !municipio);
    if ("sugerencias" in m) return fail({ error: "lugar_desconocido", sugerencias: m.sugerencias, nota: "Dilo y ofrece las sugerencias." });
    f.departamento = m.departamento;
    if (m.alcance === "municipio") { f.ciudad = m.municipio; label.push(`entidades de ${m.municipio}, ${m.departamento}`); } else label.push(`entidades de ${m.departamento}`);
  }
  f.tema = str(args.tema, 60) || undefined;
  if (f.tema && /[;'"\\]|--/.test(f.tema)) return fail({ error: "sin_resultados", nota: "tema inválido" });
  if (f.tema) label.push(`tema: ${f.tema}`);
  f.proveedor = str(args.proveedor) || undefined;
  if (f.proveedor) label.push(`contratista: ${f.proveedor}`);
  // Seguimiento ("¿y en 2024?"): sin ningún filtro nuevo se reutiliza la entidad del contexto.
  if (!f.nit && !f.ciudad && !f.departamento && !f.tema && !f.proveedor && ctx.entity) { f.nit = ctx.entity.nit; label.push(ctx.entity.name); }
  const anio = Number(args.anio), now = new Date(), from = new Date(now);
  from.setFullYear(from.getFullYear() - 1);
  const desde = date(args.desde, false), hasta = date(args.hasta, true);
  const explicitPeriod = Number.isInteger(anio) && anio >= 2000 && anio <= 2100 || Boolean(desde || hasta);
  f.period = Number.isInteger(anio) && anio >= 2000 && anio <= 2100 ? { from: `${anio}-01-01`, to: `${anio}-12-31` }
    : desde || hasta ? { from: desde ?? "2000-01-01", to: hasta ?? day(now) }
    : ctx.period ?? { from: day(from), to: day(now) };
  const y1 = Number(f.period.from.slice(0, 4)), y2 = Number(f.period.to.slice(0, 4));
  const scope: Scope = { departamento: f.departamento, municipio: f.ciudad, ...(y1 === y2 ? { anio: y1 } : { desde: y1, hasta: y2 }) };
  return { f, label: label.join("; ") || "todo el país", scope, textual: Boolean(f.nit || f.tema || f.proveedor), explicitPeriod };
}

const placeLists = new Map<string, () => Promise<Place[]>>();
const placesFor = (c: DataCtx["client"]) => { let p = placeLists.get(c.base); if (!p) placeLists.set(c.base, p = createPlaces(c)); return p; };


type Atip = { kind: string; atipico: boolean; note: string } & Record<string, unknown>;
interface Live { cards: { kind: string }[]; ids?: string[]; hayMas?: boolean; at?: Date; cached?: boolean; atipicos?: Atip[] }

const valueOf = (c: Record<string, unknown>) => Number(String(c.value ?? "").replace(/\D/g, ""));

async function live(name: string, f: Filters, args: Record<string, unknown>, limit: number, dctx: DataCtx): Promise<Live> {
  const where = buildWhere(f);
  const cut = <T extends { cards: unknown[] }>(r: T) => ({ ...r, cards: r.cards.slice(0, limit) });
  // Los atípicos nunca entran en totales ni rankings (además del filtro del servidor, se descartan aquí) y salen aparte.
  const split = <T extends { cards: { kind: string }[]; atipicos?: unknown[] }>(r: T): T => {
    const atip = (r.atipicos ?? []).filter((c) => isOutlier(valueOf(c as Record<string, unknown>))) as Atip[];
    return { ...r, atipicos: atip, cards: r.cards.filter((c) => !isOutlier(valueOf(c as Record<string, unknown>))) };
  };
  switch (name) {
    case "gasto_total": return split(await totalSpend(dctx, where));
    case "gasto_por_categoria": return split(cut(await spendByCategory(dctx, where)));
    case "top_entidades": return split(cut(await topEntities(dctx, where)));
    case "top_contratistas": return split(cut(await topContractors(dctx, where, str(args.orden, 10) === "cantidad" ? "count" : "sum")));
    case "contratos_mayores": { const t = split(await topContracts(dctx, where)); return { ...cut(t), ids: t.ids.slice(0, limit) }; }
    default: {
      const r = await searchContracts(dctx, where);
      const found = matching(r.value, f).filter((x) => !isOutlier(Number(x.valor_del_contrato ?? 0)));
      const shown = byValue(found.slice(0, Math.min(limit, MAX_VISIBLE)));
      return split({ cards: shown.map(contractCard), atipicos: r.atipicos, ids: shown.map((x) => x.id_contrato).filter((i): i is string => Boolean(i)), hayMas: found.length > shown.length, at: r.at, cached: r.cached });
    }
  }
}

async function detail(args: Record<string, unknown>, dctx: DataCtx): Promise<ToolResult> {
  const id = String(args.id_contrato ?? "");
  if (!ID.test(id)) return { data: { error: "sin_resultados", nota: "id inválido" } };
  const det = await contractDetail(dctx, id);
  if (!det) return { data: { error: "sin_resultados", nota: "No encontré ese contrato." } };
  const cards: ToolResult["cards"] = [det.card];
  const { modifications: _m, ...slimCard } = det.card;
  const c = det.card, amt = (s: string) => say(s) as string;
  const data: Record<string, unknown> = {
    ...say(slimCard) as object,
    // Dos frases para la voz; la ficha completa va en la tarjeta.
    resumen: `${c.contractor ?? "El contratista"} firmó con ${c.entity ?? "la entidad"} un contrato por ${amt(c.value)} el ${c.signedAt || "(sin fecha)"}${c.status ? `, hoy ${String(c.status).toLowerCase()}` : ""}. Se ha pagado ${amt(c.paid)} y quedan pendientes ${amt(c.pending)}.`,
    ...(c.atipico ? { nota: OUTLIER_NOTE } : {}),
  };
  if (args.documentos === true) {
    const [k] = await socrataQuery(dctx.client, { where: [{ col: "id_contrato", op: "=", value: id }], limit: 1 });
    if (k?.proceso_de_compra) {
      const r = await listDocuments({ processId: k.proceso_de_compra, year: Number(k.fecha_de_firma?.slice(0, 4)) || undefined }, {
        query: (ds, p) => fetchRows(dctx.client, new URLSearchParams(Object.entries(p).map(([a, b]) => [a, String(b)])), ds) as Promise<Record<string, string>[]>,
      });
      cards.push({ kind: "documents", documents: r.documents, processUrl: r.processUrl });
      data.documentos = r.documents.map((x) => x.name);
      data.mensajeDocumentos = r.message;
    }
  }
  return { data, cards, context: { contract: id } };
}

const limitOf = (args: Record<string, unknown>): number => { const n = Number(args.limite); return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT; };
const MEMO_MS = 30_000;
const memo = new WeakMap<object, Map<string, { at: number; res: ToolResult }>>();
const remember = (cache: object, key: string, res: ToolResult): ToolResult => { const m = memo.get(cache) ?? new Map(); m.set(key, { at: Date.now(), res }); memo.set(cache, m); return res; };
const unavailable = (): ToolResult => ({ data: { error: "servicio_no_disponible", nota: SLOW_NOTICE.instruccion.slice(0, 135) } });

/** Ejecuta una herramienta con presupuesto de 6,5 s (1 reintento), ampliación al departamento y respaldo comprimido. Nunca lanza por fallas de datos.gov.co. */
export async function runTool(name: string, args: Record<string, unknown>, data: DataCtx = deps.base, ctx: Ctx = {}, d: Deps = { ...deps, base: data }): Promise<ToolResult> {
  if (!TOOL_DEFS.some((t) => t.name === name)) return { data: { error: "sin_resultados", nota: "herramienta desconocida" } };
  if (name === "detalle_contrato") {
    const dctx: DataCtx = { ...d.base, client: withBudget(d.base.client) };
    try { return await detail(args, dctx); } catch (e) { if (e instanceof SocrataUnavailable) return unavailable(); throw e; }
  }
  const r = await resolveFilters(args, ctx, d, d.base.client);
  if ("out" in r) return r.out;
  const dctx: DataCtx = { ...d.base, client: withBudget(d.base.client) }; // el reloj de 6,5 s corre solo desde aquí
  let { f, label } = r;
  const memoKey = JSON.stringify([name, f, args.orden, limitOf(args)]), hit = memo.get(d.base.cache)?.get(memoKey);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.res; // misma consulta repetida en segundos: sin volver a datos.gov.co
  const limit = limitOf(args);
  const ctxOut = (g: Filters, ids?: string[]) => ({
    entity: g.nit ? { nit: g.nit, name: d.entities.find((e) => e.nit === g.nit)?.name ?? ctx.entity?.name ?? `NIT ${g.nit}` } : undefined,
    period: { from: g.period.from, to: g.period.to },
    filtros: { ciudad: g.ciudad, departamento: g.departamento, tema: g.tema, proveedor: g.proveedor, tipo: name === "contratos_mayores" ? "mayores" : name === "buscar_contratos" ? "lista" : name },
    ...(ids ? { results: ids } : {}),
  });
  let note: string | undefined;
  try {
    let res = await live(name, f, args, limit, dctx);
    if (!res.cards.length && f.ciudad) {
      // Sin datos en el municipio: se amplía al departamento y se dice.
      const wide = { ...f, ciudad: undefined };
      const alt = await live(name, wide, args, limit, dctx);
      if (alt.cards.length) {
        note = `No hay contratos de ${f.ciudad}; se amplió al departamento ${f.departamento}. Dilo.`;
        label = label.replace(/entidades de [^;]+/, `entidades de ${f.departamento}`);
        res = alt; f = wide;
      }
    }
    if (!res.cards.length) {
      return { data: { sinResultados: `No hay contratos de ${label} entre ${f.period.from} y ${f.period.to}. Dilo así; no muestres datos de otra entidad o territorio.`, periodo: f.period, error: "sin_resultados" }, context: ctxOut(f) };
    }
    // `ids` va en el mismo orden que `resultado`: con ellos el modelo (voz incluida) abre el detalle de «ese contrato».
    const atipicos = res.atipicos ?? [];
    if (atipicos.length) note = `${note ? `${note} ` : ""}Hay ${atipicos.length === 1 ? "un contrato" : `${atipicos.length} contratos`} fuera de los totales y rankings; di de forma neutral que ${OUTLIER_NOTE}.`;
    const data = { resultado: say(res.cards), ...(res.ids?.length ? { ids: res.ids } : {}), filtros: label, periodo: f.period, ...(res.hayMas ? { hayMas: true } : {}), ...(atipicos.length ? { atipicos: say(atipicos) } : {}), ...(note ? { nota: note } : {}) };
    return remember(d.base.cache, memoKey, { data, cards: [...res.cards, ...atipicos] as ToolResult["cards"], context: ctxOut(f, res.ids), note });
  } catch (e) {
    if (!(e instanceof SocrataUnavailable)) throw e;
    const snap = loadSnapshot();
    // El respaldo solo responde lo que puede decir con verdad: agregados por territorio/año y rankings recientes por departamento.
    const fb = snap && !r.textual ? fromSnapshot(snap, name, r.explicitPeriod || name.startsWith("gasto") ? r.scope : { ...r.scope, anio: undefined, desde: undefined, hasta: undefined }, limit) : null;
    if (!snap || !fb) return unavailable();
    note = `Datos de respaldo al ${snap.generatedAt.slice(0, 10)}, no en vivo. Dilo con esa fecha.`;
    return {
      data: { resultado: say(fb.cards), filtros: label, respaldo: snap.generatedAt.slice(0, 10), nota: note },
      cards: fb.cards as ToolResult["cards"], context: ctxOut(f), note,
    };
  }
}

/** Registro para el agente de texto: mismas definiciones y mismo ejecutor que la voz. */
export function createTools(base: DataCtx, entities: Entity[], places: () => Promise<Place[]> = async () => []): ToolRegistry {
  const d: Deps = { base, entities, places: places ?? undefined };
  configureTools(d);
  return Object.fromEntries(TOOL_DEFS.map((t): [string, Tool] => [t.name, { ...t, run: (args, ctx) => runTool(t.name, args, base, ctx, d) }]));
}
