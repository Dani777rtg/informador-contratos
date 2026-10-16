import { query, type Row } from "../data/socrata.js";
import { withCache } from "../cache.js";
import { money, num } from "../soql.js";
import { key, type Ctx } from "./search.js";

// ponytail: columnas de adiciones (cb9c-h8sn) y modificaciones (u8cx-r425) por verificar contra datos reales.
const pick = (r: Record<string, unknown>) =>
  Object.fromEntries(["tipo_modificacion", "valor_adicion", "dias_adicionados", "fecha_modificacion", "descripcion_modificacion"]
    .filter((k) => r[k] != null).map((k) => [k, r[k]]));

export const contractDetail = async (ctx: Ctx, id: string) => {
  const where = [{ col: "id_contrato" as const, op: "=" as const, value: id }];
  const q = (dataset: string) => withCache(ctx.cache, key(dataset, where), () => query(ctx.client, { where, limit: 20 }, dataset));
  const main = await q("jbjy-vk9h");
  const r = main.value.find((x) => x.id_contrato === id);
  if (!r) return undefined;
  // Si adiciones/modificaciones fallan, el detalle sigue con la lista vacia.
  const extra = async (ds: string, type: string) =>
    (await q(ds).catch(() => ({ value: [] as Row[] }))).value.map((x) => ({ type, ...pick(x as Record<string, unknown>) }));
  const modifications = [...(await extra("cb9c-h8sn", "adicion")), ...(await extra("u8cx-r425", "modificacion"))];
  const url = typeof r.urlproceso === "object" ? (r.urlproceso as { url?: string }).url : r.urlproceso;
  return {
    at: main.at, cached: main.cached,
    card: {
      kind: "detail", url, value: money(num(r.valor_del_contrato)), invoiced: money(num(r.valor_facturado)),
      paid: money(num(r.valor_pagado)), pending: money(num(r.valor_pendiente_de_pago)),
      addedDays: num(r.dias_adicionados), modifications,
    },
  };
};
