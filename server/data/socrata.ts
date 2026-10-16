export const DATASET = "jbjy-vk9h";
export const MAX_LIMIT = 100;
/** Lista permitida: nunca columnas de banco/cuenta/documento de persona natural. */
export const COLUMNS = [
  "nombre_entidad", "nit_entidad", "proveedor_adjudicado", "objeto_del_contrato", "valor_del_contrato",
  "fecha_de_firma", "estado_contrato", "urlproceso", "tipo_de_contrato", "origen_de_los_recursos",
  "proceso_de_compra", "departamento", "ciudad", "id_contrato", "sector", "modalidad_de_contratacion",
  "presupuesto_general_de_la_nacion_pgn", "sistema_general_de_participaciones", "sistema_general_de_regal_as",
  "recursos_propios", "recursos_de_credito", "valor_facturado", "valor_pagado", "valor_pendiente_de_pago", "dias_adicionados",
] as const;
export type Column = (typeof COLUMNS)[number];
export type Row = Partial<Record<Column, string>>;

export interface Cond { col: Column; op: "=" | ">=" | "<=" | "like"; value: string | number }
export interface Query {
  select?: Column[]; where?: Cond[]; order?: { col: Column; desc?: boolean }; limit?: number; offset?: number;
}
export interface Client {
  base: string; token?: string; fetchFn?: typeof fetch; timeoutMs?: number;
}

const col = (c: string): Column => {
  if (!(COLUMNS as readonly string[]).includes(c)) throw new Error(`columna no permitida: ${c}`);
  return c as Column;
};
export const lit = (v: string | number): string =>
  typeof v === "number" ? String(Number.isFinite(v) ? v : 0) : `'${v.replace(/[\u0000-\u001f]/g, " ").replace(/'/g, "''")}'`;

export function buildParams(q: Query): URLSearchParams {
  const p = new URLSearchParams();
  if (q.select?.length) p.set("$select", q.select.map(col).join(","));
  if (q.where?.length) {
    p.set("$where", q.where.map((c) => {
      const v = c.op === "like" ? `%${String(c.value).replace(/[%_]/g, "")}%` : c.value;
      return `${col(c.col)} ${c.op} ${lit(v)}`;
    }).join(" AND "));
  }
  if (q.order) p.set("$order", `${col(q.order.col)}${q.order.desc ? " DESC" : ""}`);
  p.set("$limit", String(Math.max(1, Math.min(MAX_LIMIT, Math.floor(q.limit ?? 10)))));
  if (q.offset) p.set("$offset", String(Math.max(0, Math.floor(q.offset))));
  return p;
}

export const query = (c: Client, q: Query, dataset = DATASET): Promise<Row[]> => fetchRows(c, buildParams(q), dataset);

export async function fetchRows(c: Client, params: URLSearchParams, dataset = DATASET): Promise<Row[]> {
  const url = `${c.base}/resource/${dataset}.json?${params}`;
  const f = c.fetchFn ?? fetch;
  const headers: Record<string, string> = c.token ? { "X-App-Token": c.token } : {};
  // La señal cubre también la lectura del cuerpo.
  const res = await f(url, { headers, signal: AbortSignal.timeout(c.timeoutMs ?? 3000) });
  if (!res.ok) throw new Error(`socrata ${res.status}`);
  const rows = (await res.json()) as Row[];
  // Contratos sin agregación: solo columnas de la lista permitida (misma regla que privacy.sanitizeRow; no se importa por ciclo).
  if (dataset !== DATASET || params.has("$group") || !Array.isArray(rows)) return rows;
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => (COLUMNS as readonly string[]).includes(k)))) as Row[];
}

// ---- Índice de entidades y desambiguación ----
export interface Entity { nit: string; name: string; norm: string }
export const normalize = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export const toEntity = (nit: string, name: string): Entity => ({ nit, name, norm: normalize(name) });

export type Resolution =
  | { kind: "entity"; entity: Entity }
  | { kind: "ambiguous"; options: Entity[] }
  | { kind: "none" };

const GENERIC = ["alcaldia", "gobernacion", "hospital", "universidad", "secretaria", "ministerio"];
export function resolveEntity(message: string, index: Entity[]): Resolution {
  const m = ` ${normalize(message)} `;
  const hits = index.filter((e) => m.includes(` ${e.norm} `)).sort((a, b) => b.norm.length - a.norm.length);
  if (hits.length) return { kind: "entity", entity: hits[0] };
  const g = GENERIC.find((w) => m.includes(` ${w} `));
  if (!g) return { kind: "none" };
  const options = index.filter((e) => e.norm.split(" ").includes(g));
  if (options.length === 1) return { kind: "entity", entity: options[0] };
  return options.length ? { kind: "ambiguous", options: options.slice(0, 8) } : { kind: "none" };
}
