// Texto hablado y texto llano en español de Colombia (RNF-06, AC-05.9, AC-01.12). Puro, sin red.

const UNITS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

/** 0..999 en palabras. */
function words(n: number): string {
  if (n < 30) return UNITS[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` y ${UNITS[n % 10]}` : "");
  if (n === 100) return "cien";
  return `${HUNDREDS[Math.floor(n / 100)]}${n % 100 ? ` ${words(n % 100)}` : ""}`;
}
const dec = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");

/** Monto en pesos dicho de forma natural: «27 mil millones de pesos», «mil doscientos millones de pesos». */
export function spokenAmount(n: number): string {
  const v = Math.abs(Math.round(n));
  if (v >= 1e12) return `${dec(v / 1e12)} ${v >= 2e12 ? "billones" : "billón"} de pesos`;
  if (v >= 1e10) return `${Math.round(v / 1e9)} mil millones de pesos`;
  if (v >= 1e9) {
    const m = Math.round(v / 1e7) * 10, k = Math.floor(m / 1000), rest = m % 1000; // millones, a la decena
    return `${k === 1 ? "mil" : `${words(k)} mil`}${rest ? ` ${words(rest)}` : ""} millones de pesos`;
  }
  if (v >= 1e6) return `${v >= 1e7 ? Math.round(v / 1e6) : dec(v / 1e6)} ${v >= 2e6 ? "millones" : "millón"} de pesos`;
  if (v >= 1000) return `${Math.round(v / 1000)} mil pesos`;
  return `${v} pesos`;
}

/** Monto escrito para chat: cifra clave redondeada («$27.000 millones de pesos»); el valor exacto queda en la tarjeta. */
export function roundedPesos(n: number): string {
  const v = Math.abs(Math.round(n));
  const dots = (x: number) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (v >= 1e12) return `$${dec(v / 1e12)} billones de pesos`;
  if (v >= 1e6) return `$${dots(Math.round(v / 1e6))} millones de pesos`;
  return `$${dots(v)}`;
}

/** Interpreta «27.000.000.000», «27.000» (+ escala) o «2,5». */
function parseNum(s: string): number {
  return /^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, "")) : Number(s.replace(/\./g, "").replace(",", "."));
}
const SCALE: Record<string, number> = { "mil millones": 1e9, millones: 1e6, millón: 1e6, billones: 1e12, billón: 1e12, mil: 1e3 };
const MONEY = /\$\s?(\d(?:[\d.,]*\d)?)(?:\s+(mil millones|millones|millón|billones|billón|mil)(?!\p{L}))?(?:\s+(?:de pesos|COP))?/giu;

/** Reemplaza montos exactos de más de un millón por la cifra redondeada (texto de chat). */
export function roundAmounts(text: string): string {
  return text.replace(MONEY, (m, num: string, scale?: string) => {
    const v = parseNum(num.replace(/[.,]$/, "")) * (scale ? SCALE[scale.toLowerCase()] : 1);
    return !scale && v >= 1e6 ? roundedPesos(v) : m;
  });
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const KEEP = new Set(["SECOP", "NIT", "PGN"]);
const titleCase = (w: string) => w.charAt(0) + w.slice(1).toLowerCase();

/** Nombres en mayúsculas sostenidas -> formato normal (la ciudad, la entidad, el contratista). */
export function normalCase(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])[A-ZÁÉÍÓÚÑ]{3,}(?![\p{L}\p{N}])/gu, (w) => (KEEP.has(w) ? w : titleCase(w)))
    .replace(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)\s+(DE|DEL|LA|LAS|LOS|Y|EN)\b/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`);
}

/** Texto de chat: solo los nombres en mayúsculas sostenidas (dos o más palabras) pasan a formato normal; las siglas sueltas (PAE, ICBF) se respetan. */
export function normalNames(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])[A-ZÁÉÍÓÚÑ]{2,}(?:\s+(?:[A-ZÁÉÍÓÚÑ]{2,}|[A-ZÁÉÍÓÚÑ]\.)(?![\p{L}\p{N}])|\s+\d+(?![\p{L}\p{N}]))+/gu, (run) =>
    run.split(/\s+/).map((w, i) => (KEEP.has(w) || /^(S|E|A)\.?$/.test(w) || /^\d+$/.test(w) ? w : /^(DE|DEL|LA|LAS|LOS|Y|EN|E)$/.test(w) && i > 0 ? w.toLowerCase() : titleCase(w))).join(" "));
}

/** Texto para el TTS: cifras y fechas en palabras, sin códigos ni siglas crudas ni mayúsculas, máximo 2 frases. */
export function toSpoken(text: string): string {
  let s = text.replace(/https?:\/\/\S+/g, " ").replace(/[*_#`>]+/g, " ").replace(/^\s*[-•]\s+/gm, "").replace(/\s*\n+\s*/g, ". ");
  // Montos con símbolo: «$27.000 millones», «$27.000.000.000».
  s = s.replace(MONEY, (_, num: string, scale?: string) => spokenAmount(parseNum(num.replace(/[.,]$/, "")) * (scale ? SCALE[scale.toLowerCase()] : 1)));
  // Fechas ISO y dd/mm/aaaa.
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+)?\b/g, (_, y: string, m: string, d: string) => `${Number(d)} de ${MONTHS[Number(m) - 1] ?? m} de ${y}`)
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_, d: string, m: string, y: string) => `${Number(d)} de ${MONTHS[Number(m) - 1] ?? m} de ${y}`);
  // Códigos e identificadores (CO1.PCCNTR.123, NIT con puntos).
  s = s.replace(/\b[A-Z0-9]{2,}(?:[._-][A-Za-z0-9]+)+\b/g, " ").replace(/\b\d{1,3}(?:\.\d{3})+\b/g, (n) => n.replace(/\./g, ""));
  s = s.replace(/\b(\d+)\.(\d{1,2})\b(?!\.\d)/g, "$1,$2").replace(/\$/g, "");
  // Siglas con puntos («S.A.S.») y mayúsculas sostenidas.
  s = s.replace(/\b(?:[A-ZÁÉÍÓÚÑ]\.){2,}/g, (a) => a.replace(/\./g, " ").trim() + " ").replace(/\bSAS\b/g, "S A S");
  s = normalCase(s).replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  return s.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
}
