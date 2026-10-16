import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { normalize } from "../data/socrata.js";
import { TOPICS } from "../tools/filters.js";
import { money, num } from "../soql.js";

/** Copia comprimida de agregados y contratos recientes (npm run snapshot): respaldo cuando datos.gov.co no responde. */
export interface Top { contratistas: { name: string; total: number; count: number }[]; entidades: { name: string; total: number; count: number }[]; contratos: Record<string, string>[] }
export interface Snapshot {
  generatedAt: string;
  /** Filas [departamento, municipio, año, categoría, total en pesos, número de contratos]. */
  agg: [string, string, number, string, number, number][];
  /** Por departamento, por "departamento|municipio" y "*" (todo el país): rankings y los más grandes, últimos 12 meses. */
  top: Record<string, Top>;
  /** Listas por tema frecuente (etiqueta de TOPICS): territorio -> tema -> los 10 contratos de mayor valor. */
  temas?: Record<string, Record<string, Top["contratos"]>>;
  /** Territorio -> tema -> [total en pesos, número de contratos] de los últimos 12 meses. */
  temaTotales?: Record<string, Record<string, [number, number]>>;
}

/** Nunca entran al respaldo: documentos de identidad ni contacto de personas naturales. */
export const FORBIDDEN_KEY = /documento|identificacion|cedula|telefono|celular|correo|email|direccion|tipodoc/i;
export function sanitize<T>(v: T): T {
  if (Array.isArray(v)) return v.map(sanitize) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !FORBIDDEN_KEY.test(k)).map(([k, x]) => [k, sanitize(x)])) as T;
  return v;
}

let loaded: Snapshot | null | undefined;
export function loadSnapshot(path = new URL("./snapshot.json.gz", import.meta.url)): Snapshot | null {
  if (loaded !== undefined && path.href.endsWith("snapshot.json.gz")) return loaded;
  try { const s = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as Snapshot; loaded = s; return s; } catch { return (loaded = null); }
}

export interface Scope { departamento?: string; municipio?: string; tema?: string; /** Periodo por defecto (últimos 12 meses): el único que cubren los totales por tema. */ recent?: boolean; anio?: number; desde?: number; hasta?: number }
/** Etiqueta de tema frecuente (TOPICS) para un tema libre, o undefined si no es de los precalculados. */
export const topicLabel = (tema?: string): string | undefined => (tema ? TOPICS.find(([re]) => re.test(normalize(tema)))?.[1] : undefined);
const rows = (s: Snapshot, sc: Scope) => s.agg.filter(([d, c, y]) =>
  (!sc.departamento || normalize(d) === normalize(sc.departamento)) && (!sc.municipio || normalize(c) === normalize(sc.municipio)) &&
  (!sc.anio || y === sc.anio) && (!sc.desde || y >= sc.desde) && (!sc.hasta || y <= sc.hasta));

/** Misma forma de tarjetas que las herramientas en vivo. Territorio y año se respetan en agregados; los rankings son por departamento y recientes. */
export function fromSnapshot(s: Snapshot, tool: string, sc: Scope, limit: number): { cards: ({ kind: string } & Record<string, unknown>)[]; widened?: boolean } | null {
  if (sc.tema && tool === "gasto_total") {
    if (!sc.recent) return null;
    const key = Object.keys(s.temaTotales ?? {}).find((k) => normalize(k) === normalize(sc.municipio && sc.departamento ? `${sc.departamento}|${sc.municipio}` : sc.departamento ?? "*"));
    const t = key ? s.temaTotales?.[key]?.[sc.tema] : undefined;
    return t?.[1] ? { cards: [{ kind: "total", total: money(t[0]), count: t[1] }] } : null;
  }
  if (sc.tema && tool === "gasto_por_categoria") return null; // la categoría no se parte por tema
  const r = rows(s, sc);
  if (tool === "gasto_total") {
    const total = r.reduce((a, x) => a + x[4], 0), count = r.reduce((a, x) => a + x[5], 0);
    return count ? { cards: [{ kind: "total", total: money(total), count }] } : null;
  }
  if (tool === "gasto_por_categoria") {
    const by = new Map<string, [number, number]>();
    for (const x of r) { const e = by.get(x[3]) ?? [0, 0]; by.set(x[3], [e[0] + x[4], e[1] + x[5]]); }
    const cards = [...by].sort((a, b) => b[1][0] - a[1][0]).map(([category, [t, n]]) => ({ kind: "spend", category, total: money(t), count: n }));
    return cards.length ? { cards } : null;
  }
  // Rankings y listas: del municipio si el respaldo lo trae; si no, del departamento (widened) y nunca de otro lugar.
  const find = (key: string) => Object.keys(s.top).find((k) => normalize(k) === normalize(key));
  const munKey = sc.municipio && sc.departamento ? find(`${sc.departamento}|${sc.municipio}`) : undefined;
  const depKey = find(sc.departamento ?? "*");
  if (sc.municipio && !munKey && !depKey) return null;
  const key = munKey ?? depKey;
  if (!key) return null;
  const widened = Boolean(sc.municipio && !munKey);
  const top = s.top[key];
  if (sc.tema) {
    if (tool !== "contratos_mayores" && tool !== "buscar_contratos") return null;
    const lista = s.temas?.[key]?.[sc.tema];
    if (!lista?.length) return null;
    return { cards: contractCards(lista, limit), widened };
  }
  if (tool === "top_contratistas") return { cards: top.contratistas.slice(0, limit).map((x, i) => ({ kind: "contractor", rank: i + 1, name: x.name, total: money(x.total), count: x.count })), widened };
  if (tool === "top_entidades") return { cards: top.entidades.slice(0, limit).map((x, i) => ({ kind: "entity", rank: i + 1, name: x.name, total: money(x.total), count: x.count })), widened };
  if (tool === "contratos_mayores" || tool === "buscar_contratos") return { cards: contractCards(top.contratos, limit), widened };
  return null;
}

const contractCards = (list: Top["contratos"], limit: number) => list.slice(0, limit).map((x, i) => ({
  kind: "top", rank: i + 1, name: x.objeto_del_contrato, value: money(num(x.valor_del_contrato)), entity: x.nombre_entidad, city: x.ciudad,
  department: x.departamento, contractor: x.proveedor_adjudicado, signedAt: (x.fecha_de_firma ?? "").slice(0, 10), url: x.urlproceso,
}));

let snapPlaces: { ciudad: string; departamento: string; norm: string; n: number }[] | undefined;
/** Municipios del respaldo (con su número de contratos): lista de lugares cuando datos.gov.co no responde. */
export const snapshotPlaces = () => {
  if (snapPlaces) return snapPlaces;
  const by = new Map<string, { ciudad: string; departamento: string; norm: string; n: number }>();
  for (const [departamento, ciudad, , , , n] of loadSnapshot()?.agg ?? []) {
    const k = `${ciudad}|${departamento}`, e = by.get(k) ?? { ciudad, departamento, norm: normalize(ciudad), n: 0 };
    e.n += n; by.set(k, e);
  }
  return (snapPlaces = [...by.values()]);
};
