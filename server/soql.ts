import { buildParams, COLUMNS, fetchRows, type Client, type Column, type Cond, type Row } from "./data/socrata.js";

export const money = (v: number | string) =>
  `$${String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
/** Los montos llegan como texto: numero finito o 0. */
export const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export interface Agg { group?: Column; sums: Column[]; where?: Cond[]; limit?: number }
const ok = (c: Column): Column => {
  if (!(COLUMNS as readonly string[]).includes(c)) throw new Error(`columna no permitida: ${c}`);
  return c;
};

/** $select/$group/$order solo desde columnas permitidas; where y limit via buildParams (valores escapados, limit <= 100). */
export function aggParams(a: Agg): URLSearchParams {
  const p = buildParams({ where: a.where, limit: a.limit ?? 20 });
  const sums = a.sums.map((c) => `sum(${ok(c)}) as s_${c}`);
  p.set("$select", [...(a.group ? [ok(a.group)] : []), ...sums, "count(*) as n"].join(","));
  if (a.group) { p.set("$group", a.group); p.set("$order", `s_${a.sums[0]} DESC`); }
  return p;
}

export const aggregate = (c: Client, a: Agg): Promise<Row[]> => fetchRows(c, aggParams(a));
