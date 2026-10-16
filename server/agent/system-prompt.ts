import { MISSION_PROMPT } from "./mission";

/** Mismo prompt que el Voice Agent: ambos canales comparten misión (AC-13.1). Prefijo estático para la caché por prefijo. */
export const SYSTEM_PROMPT = MISSION_PROMPT;

export const DATA_OPEN = "<datos_secop>";
export const DATA_CLOSE = "</datos_secop>";

/** Envuelve texto de SECOP como dato; neutraliza delimitadores falsos dentro del contenido. */
export function wrapData(payload: unknown): string {
  const body = (typeof payload === "string" ? payload : JSON.stringify(payload)).replaceAll(DATA_OPEN, "").replaceAll(DATA_CLOSE, "");
  return `${DATA_OPEN}${body}${DATA_CLOSE}`;
}
