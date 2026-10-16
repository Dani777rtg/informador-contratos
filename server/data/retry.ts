/** Consultas a datos.gov.co con 1 reintento rápido, timeout por tipo de consulta y una consulta más liviana de respaldo. */
export class SocrataUnavailable extends Error {
  constructor(public kind: "timeout" | "429" | "5xx" | "network") { super(`socrata ${kind}`); }
}
/** Mensaje para el agente: lo que debe decir al usuario cuando datos.gov.co no responde (nunca "falló" a secas). */
export const SLOW_NOTICE = {
  error: "datos_gov_lento",
  instruccion: "datos.gov.co está respondiendo lento. Dilo en una sola frase honesta y sugiere intentar en un momento o preguntar por una entidad o tema concreto. No digas que la búsqueda falló.",
};

export const timeoutFor = (params: URLSearchParams): number => (params.has("$group") || /\b(sum|count|avg|max|min)\(/.test(params.get("$select") ?? "") ? 8000 : 3000);

const kindOf = (e: unknown): SocrataUnavailable["kind"] | null => {
  if (e instanceof SocrataUnavailable) return e.kind;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "timeout";
  return e instanceof TypeError ? "network" : null; // fetch lanza TypeError ante fallos de red
};
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const logRetry = (kind: string, attempt: number) => console.warn(JSON.stringify({ evt: "socrata_retry", kind, attempt }));

/** Reintenta timeouts, red, 429 y 5xx; otros errores (4xx, JSON) salen tal cual. `run` hace una sola consulta. */
export async function withRetry<T>(run: (params: URLSearchParams) => Promise<T>, params: URLSearchParams, retryMs = 150): Promise<T> {
  let last: SocrataUnavailable | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await run(params); } catch (e) {
      const kind = kindOf(e);
      if (!kind) throw e;
      logRetry(kind, attempt);
      last = new SocrataUnavailable(kind);
      if (attempt === 0) await wait(retryMs);
    }
  }
  // Respaldo: misma consulta con menos filas (más liviana); si no hay forma de aligerarla, se rinde.
  const limit = Number(params.get("$limit") ?? 0);
  if (limit > 10) {
    const light = new URLSearchParams(params);
    light.set("$limit", "10");
    try { return await run(light); } catch (e) { logRetry(kindOf(e) ?? "network", 2); }
  }
  throw last!;
}
