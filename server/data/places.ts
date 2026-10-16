import { fetchRows, normalize, type Client } from "./socrata.js";

export interface Place { ciudad: string; departamento: string; norm: string }
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
    })).then((rows) => rows.flatMap((r) => r.ciudad && r.departamento ? [{ ciudad: r.ciudad, departamento: r.departamento, norm: normalize(r.ciudad) }] : []))
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
