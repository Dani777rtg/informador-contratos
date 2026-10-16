// US-08 Seguridad y anti-abuso. Locales, sin red: todo con reloj y dependencias inyectadas.
//
// Contrato asumido (el constructor lo implementa; ver informe de QA):
//   server/guards/rate-limit.ts  export function createRateLimiter(o: { limit?: number; windowMs?: number; now?: () => number }):
//        { check(origin: string): { allowed: boolean; message?: string; retryAfterSec?: number } }
//        (por defecto 20 peticiones por 60 s por origen/IP)
//   server/guards/ws-auth.ts     export function issueSessionToken(o: { secret: string; now?: () => number }): string
//                                export function verifyUpgrade(req: { origin?: string; token?: string },
//                                  o: { allowedOrigins: string[]; secret: string; now?: () => number }): { ok: boolean; reason?: string }
//   server/guards/demand.ts      export function createDemandGuard(o: { dailyTokenCap?: number; overloaded?: () => boolean }):
//        { record(tokens: number): void; admit(channel: "text" | "voice"): { allowed: boolean; message?: string } }
//   server/guards/validate.ts    export function validateClientMessage(msg: unknown, ctx: { turnCount: number }): { ok: boolean; error?: string }
//        mensajes: { type: "message", text: string } | { type: "audio", durationMs: number }
//                                export function validateToolCalls(count: number): boolean   // true si <= 3
//   server/headers.ts            export function createNonce(): string
//                                export function securityHeaders(nonce: string): Record<string, string>  // claves en minúscula
//   scripts/scan-secrets.ts      export function scanText(text: string, name?: string): { rule: string }[]
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRateLimiter } from "../../server/guards/rate-limit";
import { issueSessionToken, verifyUpgrade } from "../../server/guards/ws-auth";
import { createDemandGuard } from "../../server/guards/demand";
import { validateClientMessage, validateToolCalls } from "../../server/guards/validate";
import { createNonce, securityHeaders } from "../../server/headers";
import { scanText } from "../../scripts/scan-secrets";

const root = join(__dirname, "..", "..");
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : "");
const walk = (d: string): string[] =>
  !existsSync(d) ? [] : readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe("AC-08.1 límite por origen", () => {
  it("AC-08.1 frena la petición 21 en un minuto con mensaje claro", () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ now: () => t });
    for (let i = 0; i < 20; i++) expect(rl.check("1.1.1.1").allowed).toBe(true);
    const r = rl.check("1.1.1.1");
    expect(r.allowed).toBe(false);
    expect(r.message).toBeTruthy();
  });

  it("AC-08.1 no afecta a otros orígenes", () => {
    const rl = createRateLimiter({ now: () => 5 });
    for (let i = 0; i < 25; i++) rl.check("1.1.1.1");
    expect(rl.check("2.2.2.2").allowed).toBe(true);
  });

  it("AC-08.1 el origen vuelve a ser atendido pasado el minuto", () => {
    let t = 0;
    const rl = createRateLimiter({ now: () => t });
    for (let i = 0; i < 25; i++) rl.check("1.1.1.1");
    t += 61_000;
    expect(rl.check("1.1.1.1").allowed).toBe(true);
  });
});

describe("AC-08.2 credenciales solo en el backend", () => {
  it("AC-08.2 el escáner detecta secretos con forma de clave y deja pasar texto normal", () => {
    const fake = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";
    expect(scanText(`const k = "${fake}"`, "x.ts").length).toBeGreaterThan(0);
    expect(scanText("const saludo = 'hola contratos públicos'", "x.ts")).toHaveLength(0);
  });

  it(".env está ignorado y el CI ejecuta el escaneo de secretos", () => {
    expect(read(".gitignore")).toMatch(/^\.env\s*$/m);
    expect(read(".github/workflows/ci.yml")).toMatch(/scan:secrets|scan-secrets/);
    expect(read("package.json")).toMatch(/"scan:secrets"/);
  });

  it("AC-08.2 .env.example y el bundle del frontend no contienen secretos", () => {
    expect(scanText(read(".env.example"), ".env.example")).toHaveLength(0);
    for (const f of walk(join(root, "web", "dist")).filter((p) => /\.(js|html|css)$/.test(p))) {
      expect(scanText(readFileSync(f, "utf8"), f), f).toHaveLength(0);
    }
  });
});

describe("AC-08.3 WebSocket con Origin y token firmado", () => {
  const secret = "test-secret";
  const allowedOrigins = ["https://demo.web.app"];
  it("AC-08.3 acepta Origin permitido con token válido", () => {
    const token = issueSessionToken({ secret });
    expect(verifyUpgrade({ origin: "https://demo.web.app", token }, { allowedOrigins, secret }).ok).toBe(true);
  });
  it("AC-08.3 rechaza Origin no permitido o ausente", () => {
    const token = issueSessionToken({ secret });
    expect(verifyUpgrade({ origin: "https://evil.example", token }, { allowedOrigins, secret }).ok).toBe(false);
    expect(verifyUpgrade({ token }, { allowedOrigins, secret }).ok).toBe(false);
  });
  it("AC-08.3 rechaza token ausente, manipulado o firmado con otra clave", () => {
    const o = { allowedOrigins, secret };
    const token = issueSessionToken({ secret });
    expect(verifyUpgrade({ origin: allowedOrigins[0] }, o).ok).toBe(false);
    expect(verifyUpgrade({ origin: allowedOrigins[0], token: token.slice(0, -2) + "xx" }, o).ok).toBe(false);
    expect(verifyUpgrade({ origin: allowedOrigins[0], token: issueSessionToken({ secret: "otra" }) }, o).ok).toBe(false);
  });
  it("AC-08.3 el token es de corta vida: caduca", () => {
    let t = 0;
    const token = issueSessionToken({ secret, now: () => t });
    t += 24 * 3600_000;
    expect(verifyUpgrade({ origin: allowedOrigins[0], token }, { allowedOrigins, secret, now: () => t }).ok).toBe(false);
  });
});

describe("AC-08.4 tope diario y sobrecarga", () => {
  it("AC-08.4 superado el tope diario responde 'hay mucha demanda' y no lanza", () => {
    const g = createDemandGuard({ dailyTokenCap: 1_000_000 });
    expect(g.admit("text").allowed).toBe(true);
    g.record(1_000_001);
    const r = g.admit("text");
    expect(r.allowed).toBe(false);
    expect(r.message).toMatch(/mucha demanda/i);
  });
  it("AC-08.4 con sobrecarga prioriza texto sobre voz", () => {
    const g = createDemandGuard({ overloaded: () => true });
    expect(g.admit("voice").allowed).toBe(false);
    expect(g.admit("voice").message).toMatch(/mucha demanda/i);
    expect(g.admit("text").allowed).toBe(true);
  });
});

describe("AC-08.5 validación de entradas y límites", () => {
  const ctx = { turnCount: 0 };
  it("AC-08.5 acepta un mensaje de 500 caracteres y rechaza 501", () => {
    expect(validateClientMessage({ type: "message", text: "a".repeat(500) }, ctx).ok).toBe(true);
    expect(validateClientMessage({ type: "message", text: "a".repeat(501) }, ctx).ok).toBe(false);
  });
  it("AC-08.5 rechaza entradas que no cumplen el esquema", () => {
    for (const bad of [null, "texto", 42, {}, { type: "message" }, { type: "message", text: 5 }, { type: "desconocido" }]) {
      expect(validateClientMessage(bad, ctx).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it("AC-08.5 limita a 30 turnos por conversación", () => {
    const m = { type: "message", text: "hola" };
    expect(validateClientMessage(m, { turnCount: 29 }).ok).toBe(true);
    expect(validateClientMessage(m, { turnCount: 30 }).ok).toBe(false);
  });
  it("AC-08.5 limita el enunciado de audio a 60 s", () => {
    expect(validateClientMessage({ type: "audio", durationMs: 60_000 }, ctx).ok).toBe(true);
    expect(validateClientMessage({ type: "audio", durationMs: 60_001 }, ctx).ok).toBe(false);
  });
  it("AC-08.5 limita a 3 herramientas por turno", () => {
    expect(validateToolCalls(3)).toBe(true);
    expect(validateToolCalls(4)).toBe(false);
  });
});

describe("AC-08.6 cabeceras y texto inerte", () => {
  const nonce = createNonce();
  const h = securityHeaders(nonce);
  it("AC-08.6 el nonce es distinto en cada llamada", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
  it("AC-08.6 CSP con nonce, sin unsafe-inline y frame-ancestors 'none'", () => {
    const csp = h["content-security-policy"];
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("frame-ancestors 'none'");
  });
  it("AC-08.6 HSTS, nosniff, Referrer-Policy y Permissions-Policy con micrófono solo propio", () => {
    expect(h["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBeTruthy();
    expect(h["permissions-policy"]).toMatch(/microphone=\(self\)/);
  });
  it("AC-08.6 sin source maps en producción", () => {
    expect(read("web/vite.config.ts")).not.toMatch(/sourcemap\s*:\s*(true|["'](inline|hidden)["'])/);
    expect(walk(join(root, "web", "dist")).filter((p) => p.endsWith(".map"))).toHaveLength(0);
  });
  it("AC-08.6 el frontend nunca inserta texto como HTML", () => {
    const files = walk(join(root, "web", "src")).filter((p) => /\.(ts|tsx|js)$/.test(p));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\(|dangerouslySetInnerHTML/);
    }
  });
});
