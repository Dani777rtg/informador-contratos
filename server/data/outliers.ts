// Montos atípicos (AC-13.8): valores imposibles que SECOP registra tal cual (p. ej. 577 billones en un contrato). Puro, sin red.
import type { Cond } from "./socrata.js";

/** Más de 10 billones de pesos en un solo contrato. */
export const OUTLIER_MIN = 1e13;
export const OUTLIER_NOTE = "este valor es inusualmente alto y así aparece registrado en SECOP";

/** Atípico: más de 10 billones, o más de la mitad del total del territorio (cuando se conoce). */
export function isOutlier(value: number, territoryTotal?: number): boolean {
  if (!Number.isFinite(value)) return false;
  return value > OUTLIER_MIN || (territoryTotal !== undefined && territoryTotal > 0 && value > territoryTotal * 0.5);
}

/** Condiciones para totales y rankings: sin contratos atípicos. */
export const withoutOutliers = (where: Cond[]): Cond[] => [...where, { col: "valor_del_contrato", op: "<=", value: OUTLIER_MIN }];
