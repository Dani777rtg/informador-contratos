const MULT: Record<string, number> = { "mil": 1e3, "miles": 1e3, "millon": 1e6, "millones": 1e6, "mil millones": 1e9, "miles de millones": 1e9, "billon": 1e12, "billones": 1e12 };
const NUM_SUFFIX = /\d(?:[\d.,]*\d)?(?:\s+(?:mil millones|miles de millones|millones|millón|billones|billón|mil)(?!\p{L}))?/giu;

interface Num { value: number; scaled: boolean }

function parse(raw: string): Num | null {
  const m = /^([\d.,]*\d)(?:\s+(.+))?$/i.exec(raw.trim());
  if (!m) return null;
  let n = m[1];
  const suffix = m[2]?.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const mult = suffix ? MULT[suffix] : undefined;
  if (n.includes(".") && n.includes(",")) n = n.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(n) || (!suffix && /^\d{1,3}(,\d{3})+$/.test(n))) n = n.replace(/[.,]/g, "");
  else n = n.replace(",", ".");
  const v = Number(n);
  return Number.isFinite(v) ? { value: v * (mult ?? 1), scaled: mult !== undefined } : null;
}

export function extractNumbers(text: string): Num[] {
  return (text.match(NUM_SUFFIX) ?? []).map(parse).filter((n): n is Num => n !== null);
}

/** Cifras respaldadas: toda cifra de `sources` (JSON/strings), normalizada. */
export function allowedNumbers(...sources: unknown[]): number[] {
  return sources.flatMap((s) => extractNumbers(typeof s === "string" ? s : JSON.stringify(s) ?? "")).map((n) => n.value);
}

/** Años (19xx/20xx) y partes de fechas ISO: lo único que se acepta del mensaje del usuario o del contexto. */
export function yearNumbers(...sources: unknown[]): number[] {
  const t = sources.map((s) => (typeof s === "string" ? s : JSON.stringify(s) ?? "")).join(" ");
  const out = [...t.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  for (const m of t.matchAll(/\b\d{4}-(\d{2})-(\d{2})\b/g)) out.push(Number(m[1]), Number(m[2]));
  return out;
}

const supported = (n: Num, allowed: number[]) =>
  allowed.some((a) => (n.scaled ? a !== 0 && Math.abs(a - n.value) / Math.abs(a) <= 0.05 : a === n.value));

/** Descarta las frases con una cifra que no esté en los resultados. */
export function verifyNumbers(text: string, allowed: number[]): { text: string; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    (extractNumbers(s).every((n) => supported(n, allowed)) ? kept : dropped).push(s);
  }
  return { text: kept.join(" "), dropped };
}
