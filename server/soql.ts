import { buildParams, COLUMNS, fetchRows, type Client, type Column, type Cond, type Row } from "./data/socrata.js";

/** Valor exacto para tarjetas, con moneda: «$2.700.123.456 COP». */
export const money = (v: number | string) =>
  `$${String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} COP`;
/** Los montos llegan como texto: numero finito o 0. */
export const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export interface Agg { group?: Column; sums: Column[]; where?: Cond[]; limit?: number; /** Orden: por la primera suma (defecto) o por número de contratos. */ by?: "sum" | "count" }
const ok = (c: Column): Column => {
  if (!(COLUMNS as readonly string[]).includes(c)) throw new Error(`columna no permitida: ${c}`);
  return c;
};

/** $select/$group/$order solo desde columnas permitidas; where y limit via buildParams (valores escapados, limit <= 100). */
export function aggParams(a: Agg): URLSearchParams {
  const p = buildParams({ where: a.where, limit: a.limit ?? 20 });
  const sums = a.sums.map((c) => `sum(${ok(c)}) as s_${c}`);
  p.set("$select", [...(a.group ? [ok(a.group)] : []), ...sums, "count(*) as n"].join(","));
  if (a.group) { p.set("$group", a.group); p.set("$order", a.by === "count" ? "n DESC" : `s_${a.sums[0]} DESC`); }
  return p;
}

// Las agregaciones sobre entidades grandes tardan más que una lista: margen propio (la lista conserva el tope corto).
export const aggregate = (c: Client, a: Agg): Promise<Row[]> => fetchRows({ ...c, timeoutMs: Math.max(c.timeoutMs ?? 0, 8000) }, aggParams(a));
