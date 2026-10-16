import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = Number(process.env.WS_TOKEN_TTL_MS ?? 5 * 60_000);
const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function issueSessionToken(o: { secret: string; now?: () => number }): string {
  const body = String((o.now ?? Date.now)() + TTL_MS);
  return `${body}.${sign(o.secret, body)}`;
}

export function verifyUpgrade(
  req: { origin?: string; token?: string },
  o: { allowedOrigins: string[]; secret: string; now?: () => number },
): { ok: boolean; reason?: string } {
  if (!req.origin || !o.allowedOrigins.includes(req.origin)) return { ok: false, reason: "origin" };
  const [exp, sig] = (req.token ?? "").split(".");
  if (!exp || !sig) return { ok: false, reason: "token" };
  const good = Buffer.from(sign(o.secret, exp));
  const got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got)) return { ok: false, reason: "token" };
  if (!(Number(exp) > (o.now ?? Date.now)())) return { ok: false, reason: "expired" };
  return { ok: true };
}