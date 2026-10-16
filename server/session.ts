import { createHmac, timingSafeEqual } from "node:crypto";

/** Contexto de conversación compartido entre voz y texto. */
export interface Ctx {
  entity?: { nit: string; name: string };
  period?: { from: string; to: string };
  contract?: string;
  results?: string[];
}
export interface Turn extends Partial<Ctx> { topicChange?: boolean }

const TTL_MS = 2 * 3600_000;

export const emptyContext = (): Ctx => ({});

/** Puro. Un cambio de tema descarta entidad, periodo, contrato y resultados anteriores. */
export function applyTurn(ctx: Ctx, t: Turn): Ctx {
  const { topicChange, ...rest } = t;
  const base: Ctx = topicChange ? {} : ctx;
  const out: Ctx = { ...base };
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export function createSessionCodec(o: { keys: Record<number, string>; currentKeyVersion: number; now?: () => number }) {
  const now = o.now ?? Date.now;
  const mac = (key: string, payload: string) => createHmac("sha256", key).update(payload).digest();
  return {
    sign(ctx: Ctx): string {
      const key = o.keys[o.currentKeyVersion];
      if (!key) throw new Error("clave de sesión no configurada");
      const payload = Buffer.from(JSON.stringify({ kv: o.currentKeyVersion, exp: now() + TTL_MS, ctx })).toString("base64url");
      return `${payload}.${mac(key, payload).toString("base64url")}`;
    },
    /** Contexto o null (firma inválida, clave retirada, caducado, basura). Nunca lanza. */
    verify(token: unknown): Ctx | null {
      try {
        if (typeof token !== "string") return null;
        const parts = token.split(".");
        if (parts.length !== 2) return null;
        const [payload, sig] = parts;
        const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { kv?: unknown; exp?: unknown; ctx?: unknown };
        const key = typeof body.kv === "number" ? o.keys[body.kv] : undefined;
        if (!key) return null;
        const want = mac(key, payload);
        const got = Buffer.from(sig, "base64url");
        if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
        if (typeof body.exp !== "number" || now() > body.exp) return null;
        if (!body.ctx || typeof body.ctx !== "object") return null;
        return body.ctx as Ctx;
      } catch {
        return null;
      }
    },
  };
}
