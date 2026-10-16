import { randomBytes } from "node:crypto";

export const createNonce = (): string => randomBytes(16).toString("base64");

export function securityHeaders(nonce: string): Record<string, string> {
  const connect = ["'self'", ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim().replace(/^http/, "ws")).filter(Boolean)].join(" ");
  return {
    "content-security-policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; connect-src ${connect}; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "microphone=(self), camera=(), geolocation=()",
  };
}