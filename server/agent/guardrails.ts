/** Prefiltro determinista (sin LLM) y filtro de calificativos de salida. */
const RULES: [RegExp, string][] = [
  [/ignor\w*\s+(tus|las|todas|todo)\b.*(instruc|regla|anterior)|olvida\s+(tus|las)\s+instruc|a partir de ahora (eres|act[uú]a)|\bfinge\s+ser\b|\bDAN\b/i, "NO-12"],
  [/(system prompt|prompt del sistema|(tus|las) instrucciones (internas|ocultas|del sistema)|api[\s_-]?key|\bclave\b.*(api|deepseek|secreta)|\bcontrase[ñn]a\b)/i, "NO-13"],
  [/\b(vota|votar|elecciones|candidato|partido pol[ií]tico|uribismo|petrismo|izquierda|derecha pol[ií]tica)\b/i, "NO-05"],
  [/\b(corrupt[oa]s?|ladr[oó]n|roba(ron|n)?)\b.*\?|es corrupt|son corrupt/i, "NO-02"],
];

export function prefilter(message: string): string | null {
  return RULES.find(([re]) => re.test(message))?.[1] ?? null;
}

const FORBIDDEN = /\b(sobrecostos?|sobreprecios?|corrupci[oó]n|corrupt[oa]s?|sospechos[oa]s?|caro|cara|caros|caras|robo|robos|rob[oó]|fraude|fraudulent[oa]s?|irregular(es|idad(es)?)?|ilegal(es)?|culpables?|mafia)\b/i;

/** Descarta frases con calificativos prohibidos (RF-15). */
export function dropForbidden(text: string): string {
  return text.split(/(?<=[.!?])\s+/).filter((s) => !FORBIDDEN.test(s)).join(" ");
}
