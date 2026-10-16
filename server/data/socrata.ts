import { SocrataUnavailable, timeoutFor, withRetry } from "./retry.js";

export const DATASET ="jbjy-vk9h";
export const MAX_LIMIT = 100;
/** Lista permitida: nunca columnas de banco/cuenta/documento de persona natural. */
export const COLUMNS = [
  "nombre_entidad", "nit_entidad", "proveedor_adjudicado", "objeto_del_contrato", "valor_del_contrato",
  "fecha_de_firma", "estado_contrato", "urlproceso", "tipo_de_contrato", "origen_de_los_recursos",
  "proceso_de_compra", "departamento", "ciudad", "id_contrato", "sector", "modalidad_de_contratacion",
  "presupuesto_general_de_la_nacion_pgn", "sistema_general_de_participaciones", "sistema_general_de_regal_as",
  "recursos_propios", "recursos_de_credito", "valor_facturado", "valor_pagado", "valor_pendiente_de_pago", "dias_adicionados",
  "fecha_de_inicio_del_contrato", "fecha_de_fin_del_contrato",
] as const;
export type Column = (typeof COLUMNS)[number];
export type Row = Partial<Record<Column, string>>;

/** Columnas solo para filtrar (nunca se seleccionan ni se devuelven): documento del proveedor. */
export type FilterCol = Column | "documento_proveedor";
/** "ulike": upper(col) contiene alguno de los términos separados por "|". */
export interface Cond { col: FilterCol; op: "=" | ">=" | "<=" | "like" | "ulike" | "q"; value: string | number }
export interface Query {
  select?: Column[]; where?: Cond[]; order?: { col: Column; desc?: boolean }; limit?: number; offset?: number;
}
export interface Client {
  base: string; token?: string; fetchFn?: typeof fetch; timeoutMs?: number;
  /** Presupuesto total de la herramienta (ver data/budget.ts): corta consultas y reintentos. */
  signal?: AbortSignal;
  /** Si >0, la misma consulta (en vuelo o terminada hace menos de estos ms) se reutiliza: la voz la calienta mientras el modelo decide. */
  reuseMs?: number;
}

/** valor_del_contrato llega como texto en Socrata: comparar y ordenar siempre como número. */
const numeric = (c: string): string => (c === "valor_del_contrato" ? `${c}::number` : c);
const filterCol = (c: string): string => (c === "documento_proveedor" ? c : numeric(col(c)));
const col = (c: string): Column => {
  if (!(COLUMNS as readonly string[]).includes(c)) throw new Error(`columna no permitida: ${c}`);
  return c as Column;
};
export const lit = (v: string | number): string =>
  typeof v === "number" ? String(Number.isFinite(v) ? v : 0) : `'${v.replace(/[\u0000-\u001f]/g, " ").replace(/'/g, "''")}'`;

export function buildParams(q: Query): URLSearchParams {
  const p = new URLSearchParams();
  if (q.select?.length) p.set("$select", q.select.map(col).join(","));
  // op "q": búsqueda de texto completo ($q, rápida); solo letras, dígitos y espacios.
  const text = q.where?.find((c) => c.op === "q");
  if (text) p.set("$q", String(text.value).replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  const conds = q.where?.filter((c) => c.op !== "q");
  if (conds?.length) {
    p.set("$where", conds.map((c) => {
      if (c.op === "ulike") {
        const terms = String(c.value).split("|").map((t) => t.replace(/[%_]/g, "").toUpperCase()).filter(Boolean);
        return `(${terms.map((t) => `upper(${filterCol(c.col)}) like ${lit(`%${t}%`)}`).join(" OR ")})`;
      }
      const v = c.op === "like" ? `%${String(c.value).replace(/[%_]/g, "")}%` : c.value;
      return `${filterCol(c.col)} ${c.op} ${lit(v)}`;
    }).join(" AND "));
  }
  if (q.order) p.set("$order", `${numeric(col(q.order.col))}${q.order.desc ? " DESC" : ""}`);
  p.set("$limit", String(Math.max(1, Math.min(MAX_LIMIT, Math.floor(q.limit ?? 10)))));
  if (q.offset) p.set("$offset", String(Math.max(0, Math.floor(q.offset))));
  return p;
}

export const query = (c: Client, q: Query, dataset = DATASET): Promise<Row[]> => fetchRows(c, buildParams(q), dataset);

const reuse = new Map<string, { at: number; p: Promise<Row[]> }>();
export function fetchRows(c: Client, params: URLSearchParams, dataset = DATASET): Promise<Row[]> {
  if (!c.reuseMs) return fetchRowsNow(c, params, dataset);
  const k = `${c.base}|${dataset}|${params}`, hit = reuse.get(k);
  if (hit && Date.now() - hit.at < c.reuseMs) return hit.p.catch(() => fetchRowsNow(c, params, dataset)); // el calentamiento falló: consulta propia
  if (reuse.size > 100) reuse.clear();
  const p = fetchRowsNow(c, params, dataset);
  reuse.set(k, { at: Date.now(), p });
  p.catch(() => reuse.delete(k));
  return p;
}

async function fetchRowsNow(c: Client, params: URLSearchParams, dataset: string): Promise<Row[]> {
  const f = c.fetchFn ?? fetch;
  const headers: Record<string, string> = c.token ? { "X-App-Token": c.token } : {};
  const rows = await withRetry(async (p) => {
    // La señal cubre también la lectura del cuerpo.
    const res = await f(`${c.base}/resource/${dataset}.json?${p}`, { headers, signal: c.signal ? AbortSignal.any([AbortSignal.timeout(c.timeoutMs ?? timeoutFor(p)), c.signal]) : AbortSignal.timeout(c.timeoutMs ?? timeoutFor(p)) });
    if (!res.ok) {
      if (res.status === 429) throw new SocrataUnavailable("429");
      if (res.status >= 500) throw new SocrataUnavailable("5xx");
      throw new Error(`socrata ${res.status}`);
    }
    return (await res.json()) as Row[];
  }, params);
  // Contratos sin agregación: solo columnas de la lista permitida (misma regla que privacy.sanitizeRow; no se importa por ciclo).
  if (dataset !== DATASET || params.has("$group") || params.get("$select")?.includes("(") || !Array.isArray(rows)) return rows;
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => (COLUMNS as readonly string[]).includes(k)))) as Row[];
}

// ---- Índice de entidades y desambiguación ----
export interface Entity { nit: string; name: string; norm: string; aka?: string[] }
export const normalize = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const SMALL = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "para", "por"]);
const ACRONYMS = new Set(["ese", "sa", "sas", "ant", "ica", "men", "idrd", "igac", "itm", "dian", "sena", "icbf", "invias", "esap", "dc"]);
/** Nombre de presentación: sin //, *, paréntesis sobrantes ni espacios dobles; en formato título si venía en mayúsculas. */
export function displayName(raw: string): string {
  let s = raw.replace(/[*/\\]+/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^\((.*)\)$/, "$1").replace(/\s*\(\s*(oficial|entidad oficial)\s*\)\s*$/i, "").replace(/[-\s.,;:]+$/, "").trim();
  if (/\(/.test(s) !== /\)/.test(s)) s = s.replace(/[()]/g, "").trim();
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(" ").map((w, i) =>
    /\./.test(w) || ACRONYMS.has(w) ? w.toUpperCase() : i > 0 && SMALL.has(w) ? w : w.replace(/^\p{L}/u, (c) => c.toUpperCase())).join(" ");
}
// Alias manual: en datos.gov.co el NIT 890399011 aparece con el nombre de una dependencia; se presenta como la alcaldía.
const CLEAN: Record<string, { name: string; aka: string[] }> = { "890399011": { name: "Alcaldía de Santiago de Cali", aka: ["Alcaldía de Cali"] } };
export const toEntity = (nit: string, name: string): Entity => {
  const c = CLEAN[nit];
  return c ? { nit, name: c.name, norm: normalize(c.name), aka: c.aka } : { nit, name: displayName(name), norm: normalize(name) };
};

export type Resolution =
  | { kind: "entity"; entity: Entity }
  | { kind: "ambiguous"; options: Entity[] }
  | { kind: "none" };

// Alias: gobernación = departamento; alcaldía/municipio/distrito equivalentes. Se ignoran artículos y preposiciones.
const ALIAS: Record<string, string> = { gobernacion: "departamento", alcaldia: "municipio", distrito: "municipio", distrital: "municipio", municipal: "municipio" };
const STOP = new Set(["de", "del", "la", "el", "los", "las", "y", "en", "e", "a", "al", "para", "por", "con", "que", "cuanto", "ha", "han", "contratos", "contrato", "contratado", "especial"]);
const GENERIC = new Set(["departamento", "municipio", "hospital", "universidad", "secretaria", "ministerio"]);
const tokens = (s: string): string[] => normalize(s).split(" ").filter((t) => t && !STOP.has(t)).map((t) => ALIAS[t] ?? t);

export function resolveEntity(message: string, index: Entity[]): Resolution {
  const mt = tokens(message);
  const m = ` ${mt.join(" ")} `;
  const withTokens = index.map((e) => ({ e, t: tokens(e.name) }));
  const hits = withTokens.filter(({ t }) => t.length && m.includes(` ${t.join(" ")} `)).sort((a, b) => b.t.length - a.t.length);
  if (hits.length) return { kind: "entity", entity: hits[0].e };
  const g = mt.find((w) => GENERIC.has(w));
  if (!g) return { kind: "none" };
  const cands = withTokens.filter(({ t }) => t.includes(g));
  // El lugar pesa más que la palabra genérica: gana el que más tokens no genéricos comparte con la pregunta.
  const score = (t: string[]) => new Set(t.filter((w) => w.length > 2 && !GENERIC.has(w) && mt.includes(w))).size;
  const best = Math.max(0, ...cands.map(({ t }) => score(t)));
  // Una palabra de la pregunta que sí está en nombres de entidades pero en ningún candidato ("Ministerio de Salud" sin ese ministerio en el índice): no listar entidades ajenas.
  if (best === 0 && mt.some((w) => w.length > 2 && !GENERIC.has(w) && withTokens.some(({ t }) => t.includes(w)))) return { kind: "none" };
  let tied = cands.filter(({ t }) => score(t) === best);
  // Ministerio: el nombre más corto gana frente a sus dependencias (Ejército, etc.) si es claramente más corto.
  if (g === "ministerio" && tied.length > 1) {
    const [a, b] = [...tied].sort((x, y) => x.t.length - y.t.length);
    if (b.t.length - a.t.length >= 2) tied = [a];
  }
  // Clara la alcaldía/gobernación: el nombre empieza por la palabra genérica o por el lugar mencionado ("Santiago de Cali Distrito…"), no por una dependencia.
  const heads = tied.filter(({ t }) => { const p = t.slice(0, t.indexOf(g)); return !p.length || p.some((w) => mt.includes(w)); });
  if (heads.length === 1) tied = heads;
  const options = tied.map(({ e }) => e);
  if (options.length === 1) return { kind: "entity", entity: options[0] };
  return options.length ? { kind: "ambiguous", options: options.slice(0, 8) } : { kind: "none" };
}
