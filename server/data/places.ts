import { snapshotPlaces } from "../fallback/snapshot.js";
import { fetchRows, normalize, resolveEntity, type Client, type Entity } from "./socrata.js";

export interface Place { ciudad: string; departamento: string; norm: string; /** Contratos registrados: desempata homónimos. */ n?: number }
export interface Territory { ciudad?: string; departamento?: string }
export type PlaceMatch = Territory & { ambiguous?: string[] };

/** Nombres como aparecen en el campo departamento del dataset. */
export const DEPARTAMENTOS: [string, string][] = ["Amazonas", "Antioquia", "Arauca", "Atlántico", "Bolívar", "Boyacá", "Caldas", "Caquetá", "Casanare", "Cauca", "Cesar", "Chocó", "Córdoba", "Cundinamarca", "Guainía", "Guaviare", "Huila", "La Guajira", "Magdalena", "Meta", "Nariño", "Norte de Santander", "Putumayo", "Quindío", "Risaralda", "San Andrés, Providencia y Santa Catalina", "Santander", "Sucre", "Tolima", "Valle del Cauca", "Vaupés", "Vichada"]
  .map((d): [string, string] => [normalize(d), d]);
// "Bogotá" es ciudad y departamento (Distrito Capital) a la vez; se resuelve como ciudad.

const has = (text: string, term: string) => ` ${text} `.includes(` ${term} `);

/** Valores distintos de ciudad/departamento (una consulta con $group), en memoria; si falla no se guarda y devuelve []. */
export function createPlaces(client: Client): () => Promise<Place[]> {
  let cached: Promise<Place[]> | undefined;
  return () => {
    cached ??= fetchRows({ ...client, timeoutMs: 20_000 }, new URLSearchParams({
      $select: "ciudad,departamento,count(*) as n", $group: "ciudad,departamento", $where: "ciudad IS NOT NULL", $limit: "5000",
    })).then((rows) => rows.flatMap((r) => r.ciudad && r.departamento ? [{ ciudad: r.ciudad, departamento: r.departamento, norm: normalize(r.ciudad), n: Number((r as Record<string, string>).n) || 0 }] : []))
      .catch(() => { cached = undefined; return []; });
    return cached;
  };
}

/** Municipio mencionado (el nombre más largo gana); departamento si se nombra. Un municipio en varios departamentos sin departamento nombrado queda ambiguo. */
export function findPlace(message: string, places: Place[]): PlaceMatch {
  const norm = normalize(message);
  const dep = DEPARTAMENTOS.filter(([k]) => has(norm, k)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
  const hits = places.filter((p) => p.norm.length > 2 && has(norm, p.norm));
  const best = Math.max(0, ...hits.map((p) => p.norm.length));
  const top = hits.filter((p) => p.norm.length === best && (!dep || p.departamento === dep || hits.every((h) => h.departamento !== dep)));
  const deps = [...new Set(top.map((p) => p.departamento))];
  if (!top.length) return dep ? { departamento: dep } : {};
  if (deps.length > 1) return { ambiguous: deps.map((d) => `${top[0].ciudad} (${d})`) };
  return { ciudad: top[0].ciudad, departamento: deps[0] };
}

/** Texto de un filtro territorial para etiquetas. */
export const placeLabel = (t: Territory): string => [t.ciudad, t.departamento].filter(Boolean).join(", ");

/** Distancia de edición (Levenshtein) entre textos ya normalizados. */
export function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Los 3 candidatos más cercanos (sin tildes) dentro de la tolerancia de errores de transcripción; menor distancia primero. */
function closest<T>(text: string, items: T[], label: (t: T) => string): { best: T[]; near: T[] } {
  const scored = items.map((t) => ({ t, d: distance(text, normalize(label(t))) })).sort((a, b) => a.d - b.d);
  const tol = Math.max(1, Math.floor((text.length - 1) / 4));
  const near = scored.filter((x) => x.d <= tol);
  const top = near.filter((x) => x.d === near[0]?.d).map((x) => x.t);
  return { best: top, near: scored.slice(0, 3).map((x) => x.t) };
}

export type PlaceResult = { municipio?: string; departamento: string; alcance: "municipio" | "departamento" } | { sugerencias: string[] };

/** Municipio o departamento a partir de un texto (tolera tildes y errores del STT: «Manisales» -> Manizales). Con un municipio en varios departamentos, `departamento` desambigua. */
export function matchPlace(texto: string, places: Place[] = snapshotPlaces(), departamento?: string, soloDepartamento = false): PlaceResult {
  const n = normalize(texto);
  // El modelo lo pasó como `departamento`: «Nariño» o «Caldas» son el departamento, no el municipio homónimo.
  if (soloDepartamento) {
    const d = [...new Set(places.map((p) => p.departamento)), ...DEPARTAMENTOS.map(([, x]) => x)].find((x) => normalize(x) === n);
    if (d) return { departamento: d, alcance: "departamento" };
  }
  const depN = departamento ? normalize(departamento) : "";
  const inDep = (p: Place) => !depN || normalize(p.departamento) === depN || normalize(p.departamento).includes(depN);
  const exact = places.filter((p) => p.norm === n && inDep(p));
  const pick = (all: Place[]): PlaceResult => {
    // Homónimos: si uno tiene al menos 10 veces más contratos que el siguiente, es el municipio al que se refiere la gente.
    const hits = [...all].sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
    if (hits.length > 1 && hits[0].departamento !== hits[1].departamento && (hits[0].n ?? 0) >= 10 * (hits[1].n ?? 0) && (hits[0].n ?? 0) > 0) hits.length = 1;
    const deps = [...new Set(hits.map((p) => p.departamento))];
    return deps.length === 1 ? { municipio: hits[0].ciudad, departamento: deps[0], alcance: "municipio" } : { sugerencias: hits.map((p) => `${p.ciudad} (${p.departamento})`).slice(0, 3) };
  };
  if (exact.length) return pick(exact);
  const deps = [...new Set(places.map((p) => p.departamento)), ...DEPARTAMENTOS.map(([, d]) => d)];
  const dep = deps.find((d) => normalize(d) === n) ?? DEPARTAMENTOS.find(([k]) => n.length > 3 && has(n, k))?.[1];
  if (dep) return { departamento: dep, alcance: "departamento" };
  const m = closest(n, places.filter(inDep), (p) => p.ciudad), d = closest(n, [...new Set(deps)], (x) => x);
  const dm = distance(n, normalize(m.best[0]?.ciudad ?? "~".repeat(50))), dd = distance(n, normalize(d.best[0] ?? "~".repeat(50)));
  if (m.best.length && dm <= dd) return pick(m.best);
  if (d.best.length) return { departamento: d.best[0], alcance: "departamento" };
  return { sugerencias: [...new Set([...m.near.map((p) => p.ciudad), ...d.near])].slice(0, 3) };
}

/** Entidad por nombre (coincidencia por palabras, luego aproximada); sin acierto devuelve hasta 3 sugerencias. */
export function matchEntity(texto: string, entidades: Entity[]): { entity: Entity } | { sugerencias: string[] } {
  const r = resolveEntity(texto, entidades);
  if (r.kind === "entity") return { entity: r.entity };
  const n = normalize(texto);
  const m = closest(n, entidades, (e) => e.name);
  if (m.best.length === 1) return { entity: m.best[0] };
  if (r.kind === "ambiguous") return { sugerencias: r.options.slice(0, 3).map((e) => e.name) };
  return { sugerencias: (m.best.length ? m.best : m.near).slice(0, 3).map((e) => e.name) };
}
