import type { Cond } from "../data/socrata.js";

export interface DemoEntry { queriedAt: string; updatedAt: string; label: string; cards: Record<string, unknown>[] }
export type DemoKind = "contracts" | "spend" | "top" | "funding";

/** Clave estable de una consulta: entidad/NIT/tema(+departamento) | tipo | periodo (año o "12m"). */
export function demoKey(where: Cond[], kind: DemoKind, period: { from: string; to: string; defaulted?: boolean }): string {
  const v = (c: string) => where.find((w) => w.col === c)?.value;
  const scope = v("nit_entidad") ? `nit:${v("nit_entidad")}` : `tema:${v("objeto_del_contrato")}${v("departamento") ? `@${v("departamento")}` : ""}`;
  return `${scope}|${kind}|${period.defaulted ? "12m" : period.from.slice(0, 4)}`;
}
