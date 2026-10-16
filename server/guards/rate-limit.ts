import { posNum } from "./validate.js";

export type RateResult = { allowed: boolean; message?: string; retryAfterSec?: number };

// ponytail: contadores en memoria por instancia; el limite real es N x max-instances de Cloud Run.
export function createRateLimiter(o: { limit?: number; windowMs?: number; now?: () => number } = {}): { check(origin: string): RateResult } {
  const limit = o.limit ?? posNum(process.env.RATE_LIMIT_PER_MIN, 20);
  const windowMs = o.windowMs ?? 60_000;
  const now = o.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    check(origin) {
      const t = now();
      const recent = (hits.get(origin) ?? []).filter((h) => t - h < windowMs);
      if (recent.length >= limit) {
        hits.set(origin, recent);
        const retryAfterSec = Math.max(1, Math.ceil((recent[0]! + windowMs - t) / 1000));
        return { allowed: false, retryAfterSec, message: `Demasiadas peticiones. Espera ${retryAfterSec} s e intenta de nuevo.` };
      }
      recent.push(t);
      hits.set(origin, recent);
      if (hits.size > 10_000) for (const [k, v] of hits) if (t - v[v.length - 1]! >= windowMs) hits.delete(k);
      return { allowed: true };
    },
  };
}

// En Cloud Run, Google agrega la IP real al final de X-Forwarded-For; la primera la controla el cliente.
export function clientIp(xff: string | undefined, fallback = "unknown"): string {
  const parts = (xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? fallback;
}