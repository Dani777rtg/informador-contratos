const DOC = /\b\d{6,}\b/g;

/** Quita números de documento (6+ dígitos), prefijos CC/CE y nombres de personas; conserva la extensión. */
export function sanitizeFileName(name: string, opts: { personNames?: string[] } = {}): string {
  const dot = name.lastIndexOf(".");
  let base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (const p of opts.personNames ?? []) if (p) base = base.split(p).join("");
  base = base.replace(/\b(CC|CE)\b/gi, "").replace(DOC, "");
  // "<cédula> - <NOMBRE> - Documentos..." : tras quitar la cédula, descarta el segmento de nombre
  const parts = base.split(" - ").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) parts.splice(0, parts.length - 1);
  return (parts.join(" - ").replace(/\s+/g, " ").trim() || "documento") + ext;
}

const PERSON = /\b(?:[Ss]e[ñn]or[a]?|[Ss]ra?\.?|[Dd]ra?\.?|[Ii]ng\.?|[Dd]octor[a]?|[Aa] nombre de|CC|CE)\s+(?:\p{Lu}[\p{L}'.]+\s*){1,5}/gu;

/** Texto libre: quita números de documento (6+ dígitos) y nombres de persona natural tras tratamiento/"a nombre de". */
export function redactText(s: string): string {
  return s.replace(DOC, "[doc]").replace(PERSON, "[persona] ").replace(/\s+/g, " ").trim();
}
