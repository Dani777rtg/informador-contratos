import { COLUMNS } from "../data/socrata.js";
export { sanitizeFileName } from "./redact.js";

export const ALLOWED_COLUMNS: readonly string[] = COLUMNS;

/** Solo columnas permitidas; documento_proveedor únicamente si el proveedor es NIT (entidad/empresa). */
export function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of ALLOWED_COLUMNS) if (c in row) out[c] = row[c];
  if (/^nit$/i.test(String(row.tipodocproveedor ?? "").trim())) {
    out.tipodocproveedor = row.tipodocproveedor;
    out.documento_proveedor = row.documento_proveedor;
  }
  return out;
}
