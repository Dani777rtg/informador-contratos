import { query, type Client, type Cond, type Row } from "../data/socrata.js";
import { withCache, type Lru } from "../cache.js";
import { money } from "../soql.js";

export interface Ctx { client: Client; cache: Lru<Row[]> }
export const MAX_VISIBLE = 5;

export const key = (kind: string, where: Cond[]) => `${kind}|${JSON.stringify(where)}`;

export const searchContracts = (ctx: Ctx, where: Cond[]) =>
  withCache(ctx.cache, key("contracts", where), () =>
    query(ctx.client, { where, order: { col: "fecha_de_firma", desc: true }, limit: MAX_VISIBLE + 1 }));

/** Los contratos mostrados van de mayor a menor valor: así «el más grande» es el primero. */
export const byValue = (rows: Row[]): Row[] => [...rows].sort((a, b) => Number(b.valor_del_contrato ?? 0) - Number(a.valor_del_contrato ?? 0));

export const contractCard = (r: Row) => ({
  kind: "contract", entity: r.nombre_entidad, city: r.ciudad, department: r.departamento, contractor: r.proveedor_adjudicado, object: r.objeto_del_contrato,
  value: money(r.valor_del_contrato ?? "0"), signedAt: (r.fecha_de_firma ?? "").slice(0, 10), status: r.estado_contrato,
  url: typeof r.urlproceso === "object" ? (r.urlproceso as { url?: string }).url : r.urlproceso,
});
