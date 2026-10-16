import { query, type Column, type Cond } from "../data/socrata.js";
import { withCache } from "../cache.js";
import { aggregate, money, num } from "../soql.js";
import { key, type Ctx } from "./search.js";

type Raw = Record<string, string | undefined>;

export const spendByCategory = async (ctx: Ctx, where: Cond[]) => {
  const r = await withCache(ctx.cache, key("spend", where), () =>
    aggregate(ctx.client, { group: "tipo_de_contrato", sums: ["valor_del_contrato"], where }));
  const cards = (r.value as Raw[]).filter((x) => x.tipo_de_contrato && num(x.n) > 0)
    .map((x) => ({ kind: "spend", category: x.tipo_de_contrato, total: money(num(x.s_valor_del_contrato)), count: num(x.n) }));
  return { cards, at: r.at, cached: r.cached };
};

const FUNDING: [Column, string][] = [
  ["presupuesto_general_de_la_nacion_pgn", "Presupuesto General de la Nación"],
  ["sistema_general_de_participaciones", "Sistema General de Participaciones"],
  ["sistema_general_de_regal_as", "Sistema General de Regalías"],
  ["recursos_propios", "Recursos propios"],
  ["recursos_de_credito", "Recursos de crédito"],
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
  // ponytail: el valor es texto, SoQL ordenaria lexicografico; se traen <=100 y se ordena aqui. Exacto solo sobre esa muestra.
  const r = await withCache(ctx.cache, key("top", where), () => query(ctx.client, { where, limit: 100 }));
  const cards = [...r.value].sort((a, b) => num(b.valor_del_contrato) - num(a.valor_del_contrato)).slice(0, 10)
    .map((x, i) => ({ kind: "top", rank: i + 1, name: x.objeto_del_contrato, value: money(num(x.valor_del_contrato)) }));
  return { cards, at: r.at, cached: r.cached };
};
