import { findPlace } from "../data/places.js";
import { normalize } from "../data/socrata.js";
import { snapshotPlaces } from "../fallback/snapshot.js";
import { TOPICS } from "../tools/filters.js";

/**
 * Adivina la herramienta que el modelo va a pedir para el mensaje del usuario, para calentar la caché de datos.gov.co
 * mientras DeepSeek decide (~1,5 s). Solo lectura; si acierta el filtro, la herramienta responde desde la caché.
 */
export function guessCall(message: string): { name: string; args: Record<string, string> } | null {
  const n = normalize(message);
  const name = /mas grandes?|mayor(es)?\b/.test(n) ? "contratos_mayores"
    : /\b(quien(es)?|empresas?|contratistas?|proveedor(es)?)\b/.test(n) ? "top_contratistas"
    : /\bentidades\b/.test(n) ? "top_entidades"
    : /en que (se )?gast|categoria|tipo de contrato/.test(n) ? "gasto_por_categoria"
    : /cuanto|total|pesos|gast/.test(n) ? "gasto_total" : null;
  if (!name) return null;
  const place = findPlace(message, snapshotPlaces());
  if (place.ambiguous) return null;
  const args: Record<string, string> = {};
  if (place.ciudad) args.municipio = place.ciudad;
  if (place.departamento) args.departamento = place.departamento;
  const topic = TOPICS.find(([re]) => re.test(n));
  if (topic) args.tema = topic[1];
  return Object.keys(args).length ? { name, args } : null;
}
