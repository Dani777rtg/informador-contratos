import { displayName, query, type Column, type Cond } from "../data/socrata.js";
import { withCache } from "../cache.js";
import { aggregate, money, num } from "../soql.js";
import { contractCard, key, type Ctx } from "./search.js";

type Raw = Record<string, string | undefined>;

export const spendByCategory = async (ctx: Ctx, where: Cond[]) => {
  const r = await withCache(ctx.cache, key("spend", where), () =>
    aggregate(ctx.client, { group: "tipo_de_contrato", sums: ["valor_del_contrato"], where }));
  const cards = (r.value as Raw[]).filter((x) => x.tipo_de_contrato && num(x.n) > 0)
    .map((x) => ({ kind: "spend", category: x.tipo_de_contrato, total: money(num(x.s_valor_del_contrato)), count: num(x.n) }));
  return { cards, at: r.at, cached: r.cached };
};

const FUNDING: [Column, string][] = [
  ["presupuesto_general_de_la_nacion_pgn", "Presupuesto General de la NaciÃ³n"],
  ["sistema_general_de_participaciones", "Sistema General de Participaciones"],
  ["sistema_general_de_regal_as", "Sistema General de RegalÃ­as"],
  ["recursos_propios", "Recursos propios"],
  ["recursos_de_credito", "Recursos de crÃ©dito"],
];

export const fundingBreakdown = async (ctx: Ctx, where: Cond[]) => {
  const r = await withCache(ctx.cache, key("funding", where), () =>
    aggregate(ctx.client, { sums: FUNDING.map(([c]) => c), where, limit: 1 }));
  const row = (r.value as Raw[])[0] ?? {};
  const cards = FUNDING.map(([c, source]) => ({ kind: "funding", source, total: num(row[`s_${c}`]) }))
    .filter((x) => x.total > 0).map((x) => ({ ...x, total: money(x.total) }));
  return { cards, at: r.at, cached: r.cached };
};

export const topContracts = async (ctx: Ctx, where: Cond[]) => {
  // valor_del_contrato es numÃ©rico en Socrata: el orden DESC del servidor es exacto sobre todo el filtro.
  const r = await withCache(ctx.cache, key("top", where), () => query(ctx.client, { where, order: { col: "valor_del_contrato", desc: true }, limit: 10 }));
  const rows = [...r.value].sort((a, b) => num(b.valor_del_contrato) - num(a.valor_del_contrato));
  const cards = rows.map((x, i) => ({
    kind: "top", rank: i + 1, name: x.objeto_del_contrato, value: money(num(x.valor_del_contrato)),
    entity: x.nombre_entidad, city: x.ciudad, department: x.departamento, contractor: x.proveedor_adjudicado, signedAt: (x.fecha_de_firma ?? "").slice(0, 10), url: contractCard(x).url,
  }));
  // ids en el mismo orden (valor desc): base de Â«el mÃ¡s grandeÂ», Â«el primeroÂ»â€¦
  return { cards, ids: rows.map((x) => x.id_contrato).filter((i): i is string => Boolean(i)), at: r.at, cached: r.cached };
};

/** Ranking de contratistas por valor total adjudicado (nombre completo; el documento nunca se selecciona). */
export const topContractors = async (ctx: Ctx, where: Cond[], by: "sum" | "count" = "sum") => {
  const r = await withCache(ctx.cache, key(`contractors-${by}`, where), () =>
    aggregate(ctx.client, { group: "proveedor_adjudicado", sums: ["valor_del_contrato"], where, limit: 10, by }));
  const cards = (r.value as Raw[]).filter((x) => x.proveedor_adjudicado).map((x, i) => ({
    kind: "contractor", rank: i + 1, name: x.proveedor_adjudicado, total: money(num(x.s_valor_del_contrato)), count: num(x.n),
  }));
  return { cards, at: r.at, cached: r.cached };
};

/** Total contratado y nÃºmero de contratos con los filtros dados. */
export const totalSpend = async (ctx: Ctx, where: Cond[]) => {
  const r = await withCache(ctx.cache, key("total", where), () => aggregate(ctx.client, { sums: ["valor_del_contrato"], where, limit: 1 }));
  const row = (r.value as Raw[])[0] ?? {};
  const cards = num(row.n) > 0 ? [{ kind: "total", total: money(num(row.s_valor_del_contrato)), count: num(row.n) }] : [];
  return { cards, at: r.at, cached: r.cached };
};

/** Ranking de entidades compradoras por valor contratado. */
export const topEntities = async (ctx: Ctx, where: Cond[]) => {
  const r = await withCache(ctx.cache, key("entities", where), () =>
    aggregate(ctx.client, { group: "nombre_entidad", sums: ["valor_del_contrato"], where, limit: 10 }));
  const cards = (r.value as Raw[]).filter((x) => x.nombre_entidad).map((x, i) => ({
    kind: "entity", rank: i + 1, name: displayName(x.nombre_entidad!), total: money(num(x.s_valor_del_contrato)), count: num(x.n),
  }));
  return { cards, at: r.at, cached: r.cached };
};