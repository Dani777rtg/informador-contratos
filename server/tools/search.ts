import { query, type Client, type Cond, type Row } from "../data/socrata.js";
import { withCache, type Lru } from "../cache.js";
import { money } from "../soql.js";
import { isOutlier, OUTLIER_NOTE } from "../data/outliers.js";

export interface Ctx { client: Client; cache: Lru<Row[]> }
export const MAX_VISIBLE = 5;

export const key = (kind: string, where: Cond[]) => `${kind}|${JSON.stringify(where)}`;

export const OUTLIER_SLACK = 3; // filas extra por si los primeros del orden son atípicos
export const atipicoCard = (x: Row) => ({ ...contractCard(x), atipico: true, note: OUTLIER_NOTE });

/** Los más grandes del filtro (orden numérico en el servidor) en UNA llamada: los atípicos (> 10 billones) quedan primero por el orden y se separan aquí. */
export const searchContracts = async (ctx: Ctx, where: Cond[]) => {
  const r = await withCache(ctx.cache, key("contracts", where), () =>
    query(ctx.client, { where, order: { col: "valor_del_contrato", desc: true }, limit: MAX_VISIBLE + 1 + OUTLIER_SLACK }));
  const out = r.value.filter((x) => isOutlier(Number(x.valor_del_contrato ?? 0)));
  return { ...r, value: r.value.filter((x) => !out.includes(x)).slice(0, MAX_VISIBLE + 1), atipicos: out.map(atipicoCard) };
};

/** Los contratos mostrados van de mayor a menor valor: así «el más grande» es el primero. */
export const byValue = (rows: Row[]): Row[] => [...rows].sort((a, b) => Number(b.valor_del_contrato ?? 0) - Number(a.valor_del_contrato ?? 0));

export const contractCard = (r: Row) => ({
  kind: "contract", entity: r.nombre_entidad, city: r.ciudad, department: r.departamento, contractor: r.proveedor_adjudicado, object: r.objeto_del_contrato,
  value: money(r.valor_del_contrato ?? "0"), signedAt: (r.fecha_de_firma ?? "").slice(0, 10), status: r.estado_contrato,
  url: typeof r.urlproceso === "object" ? (r.urlproceso as { url?: string }).url : r.urlproceso,
});
