/** Cache LRU en memoria con TTL. Respaldo si datos.gov.co falla: se consulta siempre en vivo y la cache solo sirve ante fallo (TTL = antiguedad maxima aceptable). */
export class Lru<T> {
  private m = new Map<string, { v: T; at: number }>();
  constructor(private max = 200, private ttlMs = 24 * 3_600_000) {}
  get(k: string): { v: T; at: number } | undefined {
    const e = this.m.get(k);
    if (!e || (Date.now() - e.at > this.ttlMs)) return undefined;
    this.m.delete(k); this.m.set(k, e); // recencia
    return e;
  }
  set(k: string, v: T): void {
    this.m.delete(k); this.m.set(k, { v, at: Date.now() });
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
}

export interface Fetched<T> { value: T; at: Date; cached: boolean }

/** Consulta en vivo; si falla, sirve la ultima respuesta guardada; si no hay, relanza el error. */
export async function withCache<T>(c: Lru<T>, key: string, fn: () => Promise<T>): Promise<Fetched<T>> {
  try {
    const value = await fn();
    c.set(key, value);
    return { value, at: new Date(), cached: false };
  } catch (e) {
    const old = c.get(key);
    if (old) return { value: old.v, at: new Date(old.at), cached: true };
    throw e;
  }
}
