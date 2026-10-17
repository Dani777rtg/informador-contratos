import { normalize, type Cond, type Row } from "../data/socrata.js";

export interface Filters {
  nit?: string; ciudad?: string; departamento?: string; tema?: string; proveedor?: string; nitProveedor?: string;
  period: { from: string; to: string; defaulted?: boolean };
  /** Texto del nombre de la entidad cuando no hay índice para resolver su NIT. */
  entidadTexto?: string; estado?: string; modalidad?: string; tipo?: string; valorMin?: number; valorMax?: number;
}

/** Variantes de mayúsculas y tildes de un texto libre (SoQL distingue ambas), separadas por "|", sin comillas ni símbolos. */
export const textTerms = (v: string): string => {
  const t = v.trim().slice(0, 60).replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const all = [t, t.toLowerCase(), t.toUpperCase(), cap(t), t.split(" ").map(cap).join(" ")];
  return [...new Set(all.flatMap((x) => [x, x.normalize("NFD").replace(/\p{M}/gu, "")]))].filter(Boolean).join("|");
};

// Temas comunes: etiqueta y términos con y sin tilde (SoQL no ignora acentos).
export const TOPICS: [RegExp, string, string][] = [
  [/alimentacion escolar|\bpae\b/, "alimentación escolar", "ALIMENTACIÓN ESCOLAR|ALIMENTACION ESCOLAR"],
  [/alumbrado publico/, "alumbrado público", "ALUMBRADO PÚBLICO|ALUMBRADO PUBLICO"],
  [/\b(vias?|carreteras?|pavimentacion)\b/, "vías", "VÍAS|VIAS|CARRETER|PAVIMENT"],
  [/\bsalud\b/, "salud", "SALUD"], [/\beducacion\b/, "educación", "EDUCACIÓN|EDUCACION"],
  [/\bagua\b|acueducto/, "agua", "AGUA|ACUEDUCTO"], [/\bseguridad\b/, "seguridad", "SEGURIDAD"],
];

/** Términos de búsqueda de un tema libre: el texto tal cual y sin tilde. */
export const topicTerms = (tema: string): string => {
  const t = tema.trim().slice(0, 80).replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").toUpperCase();
  const known = TOPICS.find(([re]) => re.test(normalize(t)));
  return known ? known[2] : [...new Set([t, t.normalize("NFD").replace(/\p{M}/gu, "")])].filter(Boolean).join("|");
};

/** Un solo punto donde los filtros se vuelven condiciones. */
export function buildWhere(f: Filters): Cond[] {
  const w: Cond[] = [];
  if (f.nit) w.push({ col: "nit_entidad", op: "=", value: f.nit });
  if (f.ciudad) w.push({ col: "ciudad", op: "=", value: f.ciudad });
  if (f.departamento) w.push({ col: "departamento", op: "=", value: f.departamento });
  if (f.nitProveedor) w.push({ col: "documento_proveedor", op: "=", value: f.nitProveedor });
  if (f.proveedor) w.push({ col: "proveedor_adjudicado", op: "ulike", value: f.proveedor.slice(0, 80) });
  // Un solo criterio de tema para todas las herramientas (misma columna, con y sin tilde): lista y total cuadran.
  if (f.tema) w.push({ col: "objeto_del_contrato", op: "ulike", value: topicTerms(f.tema) });
  if (f.entidadTexto && textTerms(f.entidadTexto)) w.push({ col: "nombre_entidad", op: "ulike", value: textTerms(f.entidadTexto) });
  for (const [col, v] of [["estado_contrato", f.estado], ["modalidad_de_contratacion", f.modalidad], ["tipo_de_contrato", f.tipo]] as const) if (v && textTerms(v)) w.push({ col, op: "alike", value: textTerms(v) });
  if (f.valorMin !== undefined) w.push({ col: "valor_del_contrato", op: ">=", value: f.valorMin });
  if (f.valorMax !== undefined) w.push({ col: "valor_del_contrato", op: "<=", value: f.valorMax });
  w.push({ col: "fecha_de_firma", op: ">=", value: `${f.period.from}T00:00:00` });
  if (!f.period.defaulted) w.push({ col: "fecha_de_firma", op: "<=", value: `${f.period.to}T23:59:59` });
  return w;
}

/** Verificación en los resultados: descarta filas cuyo territorio o tema no coincide (el $q es difuso). */
export function matching(rows: Row[], f: Pick<Filters, "ciudad" | "departamento" | "tema">): Row[] {
  // El tema ya lo aplica el servidor con el mismo criterio que los totales (buildWhere): aquí solo se verifica el territorio.
  return rows.filter((r) =>
    (!f.ciudad || normalize(r.ciudad ?? "") === normalize(f.ciudad)) &&
    (!f.departamento || normalize(r.departamento ?? "") === normalize(f.departamento)));
}
