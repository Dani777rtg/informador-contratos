import { displayName, normalize, query, type Column, type Cond } from "../data/socrata.js";
import { withCache } from "../cache.js";
import { aggregate, money, num } from "../soql.js";
import { isOutlier, withoutOutliers } from "../data/outliers.js";
import { atipicoCard, contractCard, key, type Ctx } from "./search.js";

type Raw = Record<string, string | undefined>;

const canon = (s: string) => normalize(s).replace(/\b(s a s|sas|ltda|s a|s en c|e s p)\b/g, "").replace(/[^a-z0-9]+/g, "");
/** El mismo nombre escrito de dos formas («X S.A.S.» / «X SAS») suma una sola fila; ordena por valor o por número de contratos. */
export function mergeNames(rows: Raw[], col: "proveedor_adjudicado" | "nombre_entidad", by: "sum" | "count"): Raw[] {
  const merged = new Map<string, Raw>();
  for (const r of rows) {
    const name = r[col];
    if (!name) continue;
    const k = canon(name), m = merged.get(k);
    if (!m) { merged.set(k, { ...r }); continue; }
    m.s_valor_del_contrato = String(num(m.s_valor_del_contrato) + num(r.s_valor_del_contrato));
    m.n = String(num(m.n) + num(r.n));
  }
  const key = by === "count" ? "n" : "s_valor_del_contrato";
  return [...merged.values()].sort((a, b) => num(b[key]) - num(a[key]));
}
// Todo total y ranking excluye los contratos atípicos (> 10 billones) en el servidor. ponytail: una sola llamada a datos (AC-05.6), así que las sumas no listan los atípicos; los rankings de contratos sí (`atipicos`).
const agg = async (ctx: Ctx, kind: string, where: Cond[], a: Parameters<typeof aggregate>[1]) => ({
  r: await withCache(ctx.cache, key(kind, where), () => aggregate(ctx.client, { ...a, where: withoutOutliers(where) })),
  atipicos: [] as ReturnType<typeof atipicoCard>[],
});

export const spendByCategory = async (ctx: Ctx, where: Cond[]) => {
  const { r, atipicos } = await agg(ctx, "spend", where, { group: "tipo_de_contrato", sums: ["valor_del_contrato"] });
  const cards = (r.value as Raw[]).filter((x) => x.tipo_de_contrato && num(x.n) > 0)
    .map((x) => ({ kind: "spend", category: x.tipo_de_contrato, total: money(num(x.s_valor_del_contrato)), count: num(x.n) }));
  return { cards, atipicos, at: r.at, cached: r.cached };
};

const FUNDING: [Column, string][] = [
  ["presupuesto_general_de_la_nacion_pgn", "Presupuesto General de la Nación"],
  ["sistema_general_de_participaciones", "Sistema General de Participaciones"],
  ["sistema_general_de_regal_as", "Sistema General de Regalías"],
  ["recursos_propios", "Recursos propios"],
  ["recursos_de_credito", "Recursos de crédito"],
];

export const fundingBreakdown = async (ctx: Ctx, where: Cond[]) => {
  const { r, atipicos } = await agg(ctx, "funding", where, { sums: FUNDING.map(([c]) => c), limit: 1 });
  const row = (r.value as Raw[])[0] ?? {};
  const cards = FUNDING.map(([c, source]) => ({ kind: "funding", source, total: num(row[`s_${c}`]) }))
    .filter((x) => x.total > 0).map((x) => ({ ...x, total: money(x.total) }));
  return { cards, atipicos, at: r.at, cached: r.cached };
};

export const topContracts = async (ctx: Ctx, where: Cond[], desc = true) => {
  // valor_del_contrato es texto en Socrata: el servidor ordena por valor_del_contrato::number sobre todo el filtro.
  const r = await withCache(ctx.cache, key(desc ? "top" : "bottom", where), () => query(ctx.client, { where, order: { col: "valor_del_contrato", desc }, limit: 10 })); // ≤ 10: un límite mayor activa la consulta liviana de reintento (retry.ts)
  const atipicos = r.value.filter((x) => isOutlier(num(x.valor_del_contrato))).map(atipicoCard);
  const rows = r.value.filter((x) => !isOutlier(num(x.valor_del_contrato))).slice(0, 10).sort((a, b) => (desc ? 1 : -1) * (num(b.valor_del_contrato) - num(a.valor_del_contrato)));
  const cards = rows.map((x, i) => ({
    kind: "top", rank: i + 1, name: x.objeto_del_contrato, value: money(num(x.valor_del_contrato)),
    entity: x.nombre_entidad, city: x.ciudad, department: x.departamento, contractor: x.proveedor_adjudicado, signedAt: (x.fecha_de_firma ?? "").slice(0, 10), url: contractCard(x).url,
  }));
  // ids en el mismo orden (valor desc): base de «el más grande», «el primero»…
  return { cards, rows, atipicos, ids: rows.map((x) => x.id_contrato).filter((i): i is string => Boolean(i)), at: r.at, cached: r.cached };
};

/** Ranking de contratistas por valor total adjudicado (nombre completo; el documento nunca se selecciona). */
export const topContractors = async (ctx: Ctx, where: Cond[], by: "sum" | "count" = "sum") => {
  const { r, atipicos } = await agg(ctx, `contractors-${by}`, where, { group: "proveedor_adjudicado", sums: ["valor_del_contrato"], limit: 15, by });
  const cards = mergeNames(r.value as Raw[], "proveedor_adjudicado", by).slice(0, 10).map((x, i) => ({
    kind: "contractor", rank: i + 1, name: x.proveedor_adjudicado, total: money(num(x.s_valor_del_contrato)), count: num(x.n),
  }));
  return { cards, atipicos, at: r.at, cached: r.cached };
};

/** Total contratado y número de contratos con los filtros dados (sin atípicos). */
export const totalSpend = async (ctx: Ctx, where: Cond[]) => {
  const { r, atipicos } = await agg(ctx, "total", where, { sums: ["valor_del_contrato"], limit: 1 });
  const row = (r.value as Raw[])[0] ?? {};
  const cards = num(row.n) > 0 ? [{ kind: "total", total: money(num(row.s_valor_del_contrato)), count: num(row.n) }] : [];
  return { cards, atipicos, at: r.at, cached: r.cached };
};

/** Ranking de entidades compradoras por valor contratado. */
export const topEntities = async (ctx: Ctx, where: Cond[]) => {
  const { r, atipicos } = await agg(ctx, "entities", where, { group: "nombre_entidad", sums: ["valor_del_contrato"], limit: 15 });
  const cards = mergeNames(r.value as Raw[], "nombre_entidad", "sum").slice(0, 10).map((x, i) => ({
    kind: "entity", rank: i + 1, name: displayName(x.nombre_entidad!), total: money(num(x.s_valor_del_contrato)), count: num(x.n),
  }));
  return { cards, atipicos, at: r.at, cached: r.cached };
};
