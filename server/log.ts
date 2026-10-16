export interface QuestionLog {
  tokens: number; latencyMs: number; channel: "texto" | "voz" | "whatsapp"; errorCode?: string;
  /** Solo etiquetas cerradas: nunca texto de la pregunta ni identificadores. */
  intent?: string; route?: "atajo" | "agente" | "respaldo" | "voz"; tools?: string[]; declineCode?: string; errorType?: string; closeReason?: string;
  placeMatched?: "si" | "no" | "confirmar"; resultCode?: string;
}

/** Solo registra tokens, latencia, canal, ruta y códigos: nunca contenido ni teléfonos. */
export function createQuestionLogger(write: (line: string) => void) {
  return ({ tokens, latencyMs, channel, errorCode, intent, route, tools, declineCode, errorType, closeReason, placeMatched, resultCode }: QuestionLog) =>
    write(JSON.stringify({ ts: new Date().toISOString(), tokens, latencyMs, channel, errorCode, intent, route, tools, declineCode, errorType, closeReason, ...(channel === "voz" ? { placeMatched: placeMatched ?? "no", resultCode: resultCode ?? errorType ?? "ok" } : {}) }));
}
