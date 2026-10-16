import { MISSION_PROMPT, VOICE_AMOUNTS } from "./mission.js";

/** Misma misión que el Voice Agent (AC-13.1); solo cambia la línea de montos: cifras en texto, palabras en voz. Prefijo estático para la caché por prefijo. */
const TEXT_AMOUNTS = '- Montos en pesos con cifra redondeada y escala ("$804.000 millones de pesos"), nunca en palabras ni con todos los dígitos; el número de contratos exacto como lo devuelve la herramienta ("5.560 contratos"); el valor exacto está en la tarjeta. Nombres en formato normal, sin códigos ni identificadores. Fechas naturales.';
export const SYSTEM_PROMPT = MISSION_PROMPT.replace(VOICE_AMOUNTS, TEXT_AMOUNTS);

export const DATA_OPEN = "<datos_secop>";
export const DATA_CLOSE = "</datos_secop>";

/** Envuelve texto de SECOP como dato; neutraliza delimitadores falsos dentro del contenido. */
export function wrapData(payload: unknown): string {
  const body = (typeof payload === "string" ? payload : JSON.stringify(payload)).replaceAll(DATA_OPEN, "").replaceAll(DATA_CLOSE, "");
  return `${DATA_OPEN}${body}${DATA_CLOSE}`;
}
