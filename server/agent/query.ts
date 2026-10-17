import { buildParams, displayName, fetchRows, type Entity, type Row } from "../data/socrata.js";
import { matchEntity, matchPlace, type Place } from "../data/places.js";
import { withBudget } from "../data/budget.js";
import { SLOW_NOTICE, SocrataUnavailable } from "../data/retry.js";
import { aliasNit, ALIAS_LABEL } from "../data/entity-aliases.js";
import { withCache, Lru } from "../cache.js";
import { contractCard, key, type Ctx as DataCtx } from "../tools/search.js";
import { fundingBreakdown, mergeNames, topContracts } from "../tools/spend.js";
import { buildWhere, type Filters } from "../tools/filters.js";
import { fromSnapshot, loadSnapshot, snapshotPlaces, topicLabel, type Scope } from "../fallback/snapshot.js";
import { isOutlier, OUTLIER_NOTE, withoutOutliers } from "../data/outliers.js";
import { money, num } from "../soql.js";
import { roundedPesos } from "../speech/spoken.js";
import type { Ctx, ToolResult } from "./loop.js";

export const MAX_LIMIT = 10, DEFAULT_LIMIT = 5, MAX_TIME_ROWS = 12;
const day = (d: Date) => d.toISOString().slice(0, 10);
const str = (v: unknown, max = 80): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Listas cerradas: el modelo elige entre estas opciones, nunca escribe SoQL ni nombres de columna.
export const OPERACIONES = ["listar", "contar", "sumar", "promediar", "minimo", "maximo"] as const;
const GROUP_COL = { entidad: "nombre_entidad", contratista: "proveedor_adjudicado", categoria: "tipo_de_contrato", modalidad: "modalidad_de_contratacion", municipio: "ciudad" } as const;
export const AGRUPACIONES = [...Object.keys(GROUP_COL), "mes", "anio", "fuente"] as const;
const FILTROS = ["entidad", "nit", "contratista", "municipio", "departamento", "tema", "desde", "hasta", "valorMin", "valorMax", "estado", "modalidad", "tipo"] as const;
type Op = (typeof OPERACIONES)[number];
type Grp = (typeof AGRUPACIONES)[number];

const s = (description: string) => ({ type: "string", description });
export const QUERY_DEF = {
  name: "consultar",
  description: "Consulta contratos públicos de SECOP. Elige la operación y los filtros; el servidor arma la consulta. Para «menor valor» usa orden asc; para «más grandes» orden desc. Máximo 10 resultados. filtros.entidad acepta siglas y nombres comunes (MinTIC, ICBF, Alcaldía de Cali): no hace falta buscar_entidad antes. Para un año usa desde y hasta con ese año; sin fechas se usan los últimos 12 meses. Cita los montos y conteos exactamente como vienen en el resultado, sin redondearlos de nuevo.",
  parameters: {
    type: "object",
    properties: {
      filtros: {
        type: "object", additionalProperties: false,
        properties: {
          entidad: s("Nombre o sigla de la entidad (MinTIC, ICBF, Alcaldía de Cali)"), nit: s("NIT de la entidad"), contratista: s("Nombre del contratista"),
          municipio: s("Municipio"), departamento: s("Departamento"), tema: s("Tema libre en el objeto del contrato (vías, salud, alumbrado)"),
          desde: s("Fecha inicial AAAA-MM-DD o año AAAA"), hasta: s("Fecha final AAAA-MM-DD o año AAAA"),
          valorMin: { type: "number", description: "Valor mínimo del contrato en pesos" }, valorMax: { type: "number", description: "Valor máximo del contrato en pesos" },
          estado: s("Estado del contrato (En ejecución, Terminado, Liquidado...)"), modalidad: s("Modalidad (Contratación directa, Licitación pública...)"), tipo: s("Tipo de contrato (Prestación de servicios, Obra...)"),
        },
      },
      operacion: { type: "string", enum: [...OPERACIONES], description: "listar contratos, contar, sumar valor, promediar valor, minimo o maximo" },
      agrupar: { type: "string", enum: [...AGRUPACIONES], description: "Agrupar el resultado (fuente = fuente de los recursos)" },
      orden: { type: "string", enum: ["asc", "desc"], description: "asc = menor primero, desc = mayor primero" },
      limite: { type: "integer", description: "Cuántos resultados (máximo 10)" },
    },
    required: ["operacion"],
  },
};

export interface Deps { base: DataCtx; entities: Entity[]; places?: () => Promise<Place[]> }
let deps: Deps = {
  base: { client: { base: process.env.SOCRATA_BASE ?? "https://www.datos.gov.co", token: process.env.DATOSGOV_APP_TOKEN }, cache: new Lru<Row[]>() },
  entities: [],
};
/** Conecta las herramientas con el cliente, el índice de entidades y la lista de municipios (los mismos para texto y voz). */
export const configureTools = (d: Deps): void => { deps = d; };
export const currentDeps = (): Deps => deps;

/** Montos en lenguaje llano para el modelo («$2.700 millones de pesos»); el valor exacto con COP queda en las tarjetas. */
export function say<T>(v: T): T {
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

const fail = (error: string, extra: Record<string, unknown> = {}): ToolResult => ({ data: { error, ...extra } });
const invalid = (nota: string): ToolResult => fail("parametro_invalido", { sugerencia: nota });
const unavailable = (): ToolResult => fail("servicio_no_disponible", { nota: SLOW_NOTICE.instruccion.slice(0, 135) });

interface Parsed { filtros: Record<string, unknown>; op: Op; agrupar?: Grp; orden?: "asc" | "desc"; limite: number }
function parse(raw: Record<string, unknown>): Parsed | ToolResult {
  // Un filtro puesto fuera de «filtros» (error frecuente del modelo) se respeta, no se descarta; un año suelto vale como desde/hasta.
  const lifted: Record<string, unknown> = {};
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if ((FILTROS as readonly string[]).includes(k)) lifted[k] = v;
    else if (/^(anio|año|ano|year|periodo)$/.test(k) && /^\d{4}$/.test(String(v))) { lifted.desde ??= String(v); lifted.hasta ??= String(v); } else args[k] = v;
  }
  const asObject = (v: unknown): unknown => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return v; } }; // el modelo a veces manda el objeto como texto JSON
  const per = asObject(raw.periodo) as { desde?: unknown; hasta?: unknown } | undefined;
  if (per && typeof per === "object") { lifted.desde ??= per.desde; lifted.hasta ??= per.hasta; delete args.periodo; }
  const extra = Object.keys(args).find((k) => !["filtros", "operacion", "agrupar", "orden", "limite"].includes(k));
  if (extra) return invalid(`El parámetro «${extra.slice(0, 30)}» no existe. Los filtros van dentro de «filtros»; solo se permiten filtros, operacion, agrupar, orden y limite.`);
  const base = asObject(args.filtros ?? {});
  if (!base || typeof base !== "object" || Array.isArray(base)) return invalid("«filtros» debe ser un objeto.");
  const filtros = { ...lifted, ...base };
  const badKey = Object.keys(filtros).find((k) => !(FILTROS as readonly string[]).includes(k));
  if (badKey) return invalid(`El filtro «${badKey.slice(0, 30)}» no existe. Filtros permitidos: ${FILTROS.join(", ")}.`);
  const op = (args.operacion ?? "listar") as Op;
  if (!OPERACIONES.includes(op)) return invalid(`Operación permitida: ${OPERACIONES.join(", ")}.`);
  const agrupar = args.agrupar as Grp | undefined;
  if (agrupar !== undefined && !AGRUPACIONES.includes(agrupar)) return invalid(`Agrupación permitida: ${AGRUPACIONES.join(", ")}.`);
  if (agrupar && (op === "listar" || op === "minimo" || op === "maximo")) return invalid("Para agrupar usa sumar, contar o promediar.");
  const orden = args.orden as string | undefined;
  if (orden !== undefined && orden !== "asc" && orden !== "desc") return invalid("orden permitido: asc o desc.");
  const timed = agrupar === "mes" || agrupar === "anio";
  const n = Number(args.limite);
  const limite = Number.isInteger(n) && n >= 1 ? Math.min(n, timed ? MAX_TIME_ROWS : MAX_LIMIT) : op === "minimo" || op === "maximo" ? 1 : timed ? MAX_TIME_ROWS : DEFAULT_LIMIT;
  return { filtros: filtros as Record<string, unknown>, op, agrupar, orden: orden as Parsed["orden"], limite };
}

const year = (v: string): string | undefined => (/^\d{4}$/.test(v) ? v : undefined);
const date = (v: unknown, end: boolean): string | undefined | null => {
  const t = str(v, 10);
  if (!t) return undefined;
  const y = year(t);
  return y ? `${y}-${end ? "12-31" : "01-01"}` : /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};
const amount = (v: unknown): number | undefined | null => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

type Resolved = { f: Filters; label: string; scope: Scope; textual: boolean; explicitPeriod: boolean; narrow: boolean; entityName?: string; sugerencias?: string[] } | { out: ToolResult };

/** Interpreta y valida los filtros; nunca ignora en silencio un filtro que no pudo resolver. */
async function resolveFilters(a: Record<string, unknown>, ctx: Ctx, d: Deps): Promise<Resolved> {
  const f: Filters = { period: { from: "", to: "" } };
  const label: string[] = [];
  let entityName: string | undefined, sugerencias: string[] | undefined;
  const entidad = str(a.entidad), nit = (str(a.nit) || entidad).replace(/[.\s-]/g, "");
  if (/^\d{5,12}$/.test(nit)) { f.nit = nit; label.push(`entidad NIT ${nit}`); }
  else if (entidad) {
    const al = aliasNit(entidad);
    if (al) { f.nit = al; entityName = d.entities.find((e) => e.nit === al)?.name ?? ALIAS_LABEL[al]; label.push(entityName ?? entidad); }
    else if (!d.entities.length) { f.entidadTexto = entidad; label.push(`entidad: ${entidad}`); } // sin índice: búsqueda por nombre
    else {
      const m = matchEntity(entidad, d.entities);
      if ("sugerencias" in m) { f.entidadTexto = entidad; sugerencias = m.sugerencias; label.push(`entidades cuyo nombre contiene «${entidad.slice(0, 40)}»`); } // no está en el índice: se busca por nombre
      else { f.nit = m.entity.nit; entityName = m.entity.name; label.push(m.entity.name); }
    }
  }
  const municipio = str(a.municipio), dep = str(a.departamento);
  if (municipio || dep) {
    // Con la lista viva si el servidor la conectó; si no, la del respaldo (nunca una consulta extra a datos.gov.co).
    const known = (await d.places?.()) ?? [];
    const places = known.length ? known : snapshotPlaces();
    const m = matchPlace(municipio || dep, places, municipio ? dep : undefined, !municipio);
    if ("sugerencias" in m) return { out: fail("lugar_desconocido", { sugerencias: m.sugerencias, ...(m.confirmar ? { confirmar: m.confirmar } : {}), nota: `Pregunta al usuario${m.confirmar ? ` «${m.confirmar}»` : " por el lugar y ofrece las sugerencias"}; no digas que no hay datos.` }) };
    f.departamento = m.departamento;
    if (m.alcance === "municipio") { f.ciudad = m.municipio; label.push(`entidades con sede en ${m.municipio}, ${m.departamento}`); } else label.push(`entidades de ${m.departamento}`);
  }
  f.tema = str(a.tema, 60) || undefined;
  if (f.tema) label.push(`tema: ${f.tema}`);
  f.proveedor = str(a.contratista) || undefined;
  if (f.proveedor) label.push(`contratista: ${f.proveedor}`);
  for (const [k, name] of [["estado", "estado"], ["modalidad", "modalidad"], ["tipo", "tipo de contrato"]] as const) {
    const v = str(a[k], 60);
    if (v) { f[k] = v; label.push(`${name}: ${v}`); }
  }
  const [vmin, vmax] = [amount(a.valorMin), amount(a.valorMax)];
  if (vmin === null || vmax === null) return { out: invalid("valorMin y valorMax deben ser números de pesos, sin negativos.") };
  f.valorMin = vmin; f.valorMax = vmax;
  // Seguimiento ("¿y en 2024?"): sin ningún filtro nuevo se reutiliza la entidad del contexto.
  if (!f.nit && !f.entidadTexto && !f.ciudad && !f.departamento && !f.tema && !f.proveedor && ctx.entity) { f.nit = ctx.entity.nit; entityName = ctx.entity.name; label.push(ctx.entity.name); }
  const [desde, hasta] = [date(a.desde, false), date(a.hasta, true)];
  if (desde === null || hasta === null) return { out: invalid("desde y hasta van como AAAA-MM-DD o AAAA.") };
  const now = new Date(), from = new Date(now);
  from.setFullYear(from.getFullYear() - 1);
  const explicitPeriod = Boolean(desde || hasta);
  f.period = explicitPeriod ? { from: desde ?? "2000-01-01", to: hasta ?? day(now) } : ctx.period ?? { from: day(from), to: day(now) };
  const y1 = Number(f.period.from.slice(0, 4)), y2 = Number(f.period.to.slice(0, 4));
  const scope: Scope = { departamento: f.departamento, municipio: f.ciudad, tema: topicLabel(f.tema), recent: !explicitPeriod, ...(y1 === y2 ? { anio: y1 } : { desde: y1, hasta: y2 }) };
  return {
    f, label: label.join("; ") || "todo el país", scope, explicitPeriod, entityName, sugerencias,
    textual: Boolean(f.nit || f.entidadTexto || f.proveedor || (f.tema && !topicLabel(f.tema))),
    narrow: Boolean(f.nit || f.entidadTexto || f.ciudad || f.departamento || f.tema || f.proveedor),
  };
}

type Atip = { kind: string } & Record<string, unknown>;
interface Live { cards: ({ kind: string } & Record<string, unknown>)[]; ids?: string[]; hayMas?: boolean; atipicos?: Atip[] }

const num0 = (r: Row, k: string) => num((r as Record<string, unknown>)[k]);
const VALUE = "valor_del_contrato::number";

/** Una agregación: $select/$group/$order desde listas cerradas; where y limit por buildParams (valores escapados). */
async function aggregateRows(ctx: DataCtx, p: Parsed, f: Filters, limit: number): Promise<Row[]> {
  const where = withoutOutliers(buildWhere(f));
  const grp = p.agrupar as keyof typeof GROUP_COL | "mes" | "anio" | undefined;
  const timed = grp === "mes" || grp === "anio";
  const metric = p.op === "contar" ? "n" : p.op === "promediar" ? "a" : "s_valor_del_contrato";
  const dir = p.orden === "asc" ? "ASC" : "DESC";
  const params = buildParams({ where, limit });
  const sel = [`sum(${VALUE}) as s_valor_del_contrato`, "count(*) as n", `avg(${VALUE}) as a`];
  if (grp) {
    const g = timed ? "g" : GROUP_COL[grp];
    params.set("$select", [timed ? `date_trunc_${grp === "mes" ? "ym" : "y"}(fecha_de_firma) as g` : g, ...sel].join(","));
    params.set("$group", g);
    params.set("$order", timed ? `g ${p.orden === "desc" ? "DESC" : "ASC"}` : `${metric} ${dir}`);
  } else params.set("$select", sel.join(","));
  const r = await withCache(ctx.cache, key(`q-${p.op}-${grp ?? ""}-${p.orden ?? ""}-${limit}`, where), () => fetchRows({ ...ctx.client, timeoutMs: Math.max(ctx.client.timeoutMs ?? 0, 8000) }, params));
  return r.value;
}

async function live(p: Parsed, f: Filters, dctx: DataCtx): Promise<Live> {
  const { op, agrupar, limite: limit } = p;
  if (agrupar === "fuente") return { cards: (await fundingBreakdown(dctx, buildWhere(f))).cards };
  if (!agrupar && (op === "listar" || op === "minimo" || op === "maximo")) {
    const desc = p.orden ? p.orden === "desc" : op !== "minimo";
    // Ascendente: los contratos de valor 0 no son «el de menor valor»; se piden desde $1 salvo que se fije un mínimo.
    const t = await topContracts(dctx, buildWhere(desc || f.valorMin !== undefined ? f : { ...f, valorMin: 1 }), desc);
    const ranked = p.orden !== undefined || op !== "listar"; // con orden explícito son un ranking; si no, la lista de contratos
    const cards = ranked ? t.cards.slice(0, limit) : t.rows.slice(0, limit).map(contractCard);
    return { cards, ids: t.ids.slice(0, limit), hayMas: t.rows.length > limit, atipicos: t.atipicos as Atip[] };
  }
  const rows = await aggregateRows(dctx, p, f, !agrupar ? 1 : agrupar === "entidad" || agrupar === "contratista" ? 15 : agrupar === "mes" || agrupar === "anio" ? 24 : limit);
  const row = (r: Row) => { const sum = num0(r, "s_valor_del_contrato"), n = num0(r, "n"); return { sum, n, avg: n ? sum / n : 0 }; };
  const value = (t: ReturnType<typeof row>) => (op === "promediar" ? t.avg : t.sum);
  const tag = op === "promediar" ? " (promedio por contrato)" : "";
  if (!agrupar) {
    const t = row(rows[0] ?? {});
    const category = op === "promediar" ? "Valor promedio por contrato" : op === "contar" ? "Contratos firmados" : "Total contratado";
    return { cards: t.n > 0 ? [{ kind: "spend", category, total: money(value(t)), count: t.n }] : [] };
  }
  const timed = agrupar === "mes" || agrupar === "anio";
  const col = timed ? "g" : GROUP_COL[agrupar as keyof typeof GROUP_COL];
  const raw = rows as Record<string, string | undefined>[];
  const merged = agrupar === "entidad" || agrupar === "contratista" ? mergeNames(raw, col as "nombre_entidad", "sum") : raw;
  const label = (r: Record<string, string | undefined>) => timed ? String(r.g ?? r.mes ?? r.fecha_de_firma ?? "").slice(0, agrupar === "mes" ? 7 : 4) : r[col] ?? "";
  const sign = p.orden === "asc" ? 1 : -1; // mes y año: cronológico salvo orden desc
  const metric = (r: Record<string, string | undefined>) => (p.op === "contar" ? row(r).n : value(row(r)));
  const sorted = merged.filter((r) => label(r) && row(r).n > 0).sort((x, y) => timed ? (p.orden === "desc" ? -1 : 1) * label(x).localeCompare(label(y)) : sign * (metric(x) - metric(y)));
  const cards = sorted.slice(0, limit).map((r, i) => {
    const t = row(r), name = label(r);
    if (agrupar === "entidad") return { kind: "entity", rank: i + 1, name: `${displayName(name)}${tag}`, total: money(value(t)), count: t.n };
    if (agrupar === "contratista") return { kind: "contractor", rank: i + 1, name: `${name}${tag}`, total: money(value(t)), count: t.n };
    return { kind: "spend", category: `${name}${tag}`, total: money(value(t)), count: t.n };
  });
  return { cards };
}

const MEMO_MS = 30_000;
const memo = new WeakMap<object, Map<string, { at: number; res: ToolResult }>>();
const remember = (cache: object, k: string, res: ToolResult): ToolResult => { const m = memo.get(cache) ?? new Map(); m.set(k, { at: Date.now(), res }); memo.set(cache, m); return res; };

/** Herramienta del respaldo precalculado que equivale a esta consulta, o null si el respaldo no puede responderla con verdad. */
function snapshotTool(p: Parsed, f: Filters): string | null {
  if (f.estado || f.modalidad || f.tipo || f.valorMin !== undefined || f.valorMax !== undefined || f.entidadTexto) return null;
  if (p.op === "listar") return !p.agrupar && p.orden !== "asc" ? "contratos_mayores" : null;
  if (p.op === "promediar" || p.op === "minimo" || p.op === "maximo" || p.orden === "asc") return null;
  if (!p.agrupar) return "gasto_total";
  if (p.op === "contar" && p.agrupar !== "categoria") return null; // el respaldo ordena por valor, no por cantidad
  return ({ categoria: "gasto_por_categoria", entidad: "top_entidades", contratista: "top_contratistas" } as Record<string, string>)[p.agrupar] ?? null;
}

/**
 * Ejecuta una consulta flexible con presupuesto de 6,5 s (1 reintento), ampliación al departamento y respaldo comprimido.
 * Nunca lanza por fallas de datos.gov.co ni por parámetros inválidos.
 */
export async function runQuery(args: Record<string, unknown>, data: DataCtx = deps.base, ctx: Ctx = {}, d: Deps = { ...deps, base: data }): Promise<ToolResult> {
  const p = parse(args && typeof args === "object" ? args : {});
  if ("data" in p) return p;
  const r = await resolveFilters(p.filtros, ctx, d);
  if ("out" in r) return r.out;
  const dctx: DataCtx = { ...d.base, client: withBudget(d.base.client) }; // el reloj de 6,5 s corre solo desde aquí
  let { f, label } = r;
  const { limite: limit } = p;
  // Solo totales y agregaciones se recuerdan 30 s; las listas de contratos siempre van en vivo.
  const memoKey = JSON.stringify([p, f]), hit = p.agrupar || (p.op !== "listar" && p.op !== "minimo" && p.op !== "maximo") ? memo.get(d.base.cache)?.get(memoKey) : undefined;
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.res; // misma consulta repetida en segundos: sin volver a datos.gov.co
  const ctxOut = (g: Filters, ids?: string[]) => ({
    entity: g.nit ? { nit: g.nit, name: r.entityName ?? d.entities.find((e) => e.nit === g.nit)?.name ?? ctx.entity?.name ?? `NIT ${g.nit}` } : undefined,
    period: { from: g.period.from, to: g.period.to },
    filtros: { ciudad: g.ciudad, departamento: g.departamento, tema: g.tema, proveedor: g.proveedor, tipo: "consultar" },
    ...(ids ? { results: ids } : {}),
  });
  let note: string | undefined;
  // Respuesta del respaldo precalculado (mismas tarjetas que en vivo). Solo dice lo que puede decir con verdad.
  const backup = (): ToolResult | null => {
    const tool = snapshotTool(p, f), snap = loadSnapshot();
    const fb = snap && tool && !r.textual ? fromSnapshot(snap, tool, r.explicitPeriod || tool.startsWith("gasto") ? r.scope : { ...r.scope, anio: undefined, desde: undefined, hasta: undefined }, limit) : null;
    if (!snap || !fb) return null;
    const nota = `Datos de respaldo al ${snap.generatedAt.slice(0, 10)}, no en vivo. Dilo con esa fecha.${fb.widened ? ` No hay respaldo de ${f.ciudad}: son del departamento ${f.departamento}; dilo.` : ""}`;
    return { data: { resultado: say(fb.cards), filtros: label, respaldo: snap.generatedAt.slice(0, 10), nota }, cards: fb.cards as ToolResult["cards"], context: ctxOut(f), note: nota };
  };
  // Rankings nacionales de entidades o contratistas sin ningún filtro acotante: no se agregan en vivo (TM-18).
  if ((p.agrupar === "entidad" || p.agrupar === "contratista") && !r.narrow) {
    return backup() ?? fail("consulta_muy_amplia", { sugerencia: "Acota por departamento, municipio, entidad, contratista o tema, y vuelve a consultar." });
  }
  // Un tema frecuente sin territorio (LIKE sobre todo el país: 15 s en datos.gov.co, más que el presupuesto de 6,5 s) sale directo del respaldo.
  if (!r.explicitPeriod && r.scope.tema && !f.ciudad && !f.departamento && !f.nit && !f.proveedor && !p.agrupar && (snapshotTool(p, f) === "gasto_total" || (snapshotTool(p, f) === "contratos_mayores" && p.orden !== undefined))) {
    const b = backup();
    if (b) return b;
  }
  try {
    let res = await live(p, f, dctx);
    if (!res.cards.length && f.ciudad) {
      // Sin datos en el municipio: se amplía al departamento y se dice.
      const wide = { ...f, ciudad: undefined };
      const alt = await live(p, wide, dctx);
      if (alt.cards.length) {
        note = `No hay contratos de ${f.ciudad}; se amplió al departamento ${f.departamento}. Dilo.`;
        label = label.replace(/entidades con sede en [^;]+/, `entidades de ${f.departamento}`);
        res = alt; f = wide;
      }
    }
    if (!res.cards.length && r.sugerencias && f.entidadTexto) {
      return { data: { error: "sin_resultados", sugerencias: r.sugerencias, nota: `No encontré una entidad llamada "${f.entidadTexto.slice(0, 40)}". Ofrece las sugerencias o pide el NIT.` }, context: ctxOut(f) };
    }
    if (!res.cards.length) {
      return { data: { sinResultados: `No hay contratos de ${label} entre ${f.period.from} y ${f.period.to}. Dilo así; no muestres datos de otra entidad o territorio.`, periodo: f.period, error: "sin_resultados" }, context: ctxOut(f) };
    }
    // `ids` va en el mismo orden que `resultado`: con ellos el modelo (voz incluida) abre el detalle de «ese contrato».
    if (r.sugerencias && f.entidadTexto) note = `${note ? `${note} ` : ""}No hay una entidad con ese nombre exacto: son contratos de entidades cuyo nombre contiene «${f.entidadTexto.slice(0, 40)}». Dilo así.`;
    const atipicos = (res.atipicos ?? []).filter((c) => isOutlier(num(String(c.value ?? "").replace(/\D/g, ""))));
    if (atipicos.length) note = `${note ? `${note} ` : ""}Hay ${atipicos.length === 1 ? "un contrato" : `${atipicos.length} contratos`} fuera de los totales y rankings; di de forma neutral que ${OUTLIER_NOTE}.`;
    const out = {
      resultado: say(p.op === "contar" ? res.cards.map(({ total: _t, ...c }) => c) : res.cards), ...(res.ids?.length ? { ids: res.ids } : {}), filtros: label, periodo: f.period, ...(r.explicitPeriod ? {} : { periodoTexto: "sin fechas explícitas: son los últimos 12 meses" }), consulta: { operacion: p.op, agrupar: p.agrupar, orden: p.orden },
      ...(res.hayMas ? { hayMas: true } : {}),
      ...(f.ciudad ? { alcance: "Son contratos de entidades con sede en ese municipio (pueden incluir la gobernación o entidades nacionales); dilo así, sin decir que todos son del municipio." } : {}),
      ...(atipicos.length ? { atipicos: say(atipicos) } : {}), ...(note ? { nota: note } : {}),
    };
    const result: ToolResult = { data: out, cards: [...res.cards, ...atipicos] as ToolResult["cards"], context: ctxOut(f, res.ids), note };
    return p.agrupar || (p.op !== "listar" && p.op !== "minimo" && p.op !== "maximo") ? remember(d.base.cache, memoKey, result) : result;
  } catch (e) {
    if (!(e instanceof SocrataUnavailable)) throw e;
    return backup() ?? unavailable();
  }
}
