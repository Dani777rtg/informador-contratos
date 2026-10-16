import { createHmac, timingSafeEqual } from "node:crypto";

/** Contexto de conversación compartido entre voz y texto. */
export interface Ctx {
  entity?: { nit: string; name: string };
  period?: { from: string; to: string };
  contract?: string;
  results?: string[];
  /** Filtros de la última consulta (municipio, departamento, tema, contratista) para seguimientos. */
  filtros?: { ciudad?: string; departamento?: string; tema?: string; proveedor?: string; tipo?: string };
  /** Turnos ya respondidos en la conversación (firmado con el contexto). */
  turns?: number;
}
export interface Turn extends Partial<Ctx> { topicChange?: boolean }

const TTL_MS = 2 * 3600_000;

export const emptyContext = (): Ctx => ({});

/** Puro. Un cambio de tema descarta entidad, periodo, contrato y resultados anteriores. */
export function applyTurn(ctx: Ctx, t: Turn): Ctx {
  const { topicChange, ...rest } = t;
  const base: Ctx = topicChange ? {} : ctx;
  const out: Ctx = { ...base };
  if (ctx.turns !== undefined) out.turns = ctx.turns;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const ORDINALS: [RegExp, number][] = [[/\bel (primero|primer contrato)\b/, 0], [/\bel segundo\b/, 1], [/\bel tercero\b/, 2]];

/**
 * Seguimiento corto sobre los resultados mostrados («dame ese contrato», «el más grande», «el primero», «ábrelo»):
 * devuelve el id del contrato o null. Los resultados vienen ordenados por valor, así que «el más grande» es el primero.
 */
export function resolveFollowUp(message: string, ctx: Ctx): string | null {
  const ids = ctx.results ?? [];
  const m = norm(message);
  if (m.split(" ").length > 8) return null;
  const ord = ORDINALS.find(([re]) => re.test(m));
  if (ord) return ids[ord[1]] ?? null;
  if (/\bel ultimo\b/.test(m)) return ids.at(-1) ?? null;
  if (/\bel (mas grande|mayor)\b/.test(m)) return ids[0] ?? null;
  if (/\b(ese|este) contrato\b|\babrelo\b|\bdame ese\b/.test(m)) return ctx.contract ?? ids[0] ?? null;
  return null;
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
