import { createHash, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;
const MAX_FAILS = 5, WINDOW_MS = 10 * 60_000, MAX_ORIGINS = 1000, MAX_CHARS = 600;
// ponytail: intentos fallidos en memoria por instancia; moverlos a un almacén compartido si hay varias instancias.
const fails = new Map<string, { n: number; since: number }>();
const sha = (s: string) => createHash("sha256").update(s).digest();

/** Modo diagnóstico (TM-17): true solo si `code` coincide con DIAG_CODE. Sin DIAG_CODE, o con demasiados intentos fallidos del origen, siempre false. Nunca registra el código. */
export function isDiagnostic(code: string | undefined, origin: string, env: Env = process.env, now = Date.now()): boolean {
  const secret = env.DIAG_CODE;
  if (!secret || !code) return false;
  const f = fails.get(origin);
  if (f && now - f.since < WINDOW_MS && f.n >= MAX_FAILS) return false;
  if (timingSafeEqual(sha(code), sha(secret))) { fails.delete(origin); return true; }
  if (!f || now - f.since >= WINDOW_MS) {
    if (fails.size >= MAX_ORIGINS) fails.delete(fails.keys().next().value as string);
    fails.set(origin, { n: 1, since: now });
  } else f.n++;
  return false;
}

/** Quita correos, teléfonos y cédulas/documentos (secuencias largas de dígitos) y recorta. */
export function redact(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]")
    .replace(/\+?\d[\d .-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 6 ? "[número]" : m))
    .slice(0, MAX_CHARS);
}

const clean = (v: unknown): unknown =>
  typeof v === "string" ? redact(v) : Array.isArray(v) ? v.slice(0, 20).map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v;

/** Línea JSON con `log:"diag"` (el sink de scripts/gcp-diag-log.ps1 la desvía a un bucket de 1 día y la excluye de _Default). Solo se llama con isDiagnostic verdadero. */
export function diagLog(entry: Record<string, unknown>, write: (line: string) => void = (l) => console.log(l)): void {
  write(JSON.stringify({ log: "diag", ts: new Date().toISOString(), ...(clean(entry) as Record<string, unknown>) }));
}
