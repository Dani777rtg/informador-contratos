import type { Client } from "./socrata.js";

/** Tope total de una herramienta contra datos.gov.co (con su 1 reintento de withRetry): pasado esto se usa el respaldo. */
export const API_BUDGET_MS = 6500;

/** Cliente con la señal de presupuesto: todas las consultas (y reintentos) de una herramienta comparten el mismo reloj. */
export const withBudget = (c: Client, ms = API_BUDGET_MS): Client => ({ ...c, signal: c.signal ? AbortSignal.any([c.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms) });
