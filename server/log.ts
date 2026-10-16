export interface QuestionLog { tokens: number; latencyMs: number; channel: "texto" | "voz" | "whatsapp"; errorCode?: string; [extra: string]: unknown }

/** Solo registra tokens, latencia, canal y código de error: nunca contenido ni teléfonos. */
export function createQuestionLogger(write: (line: string) => void) {
  return ({ tokens, latencyMs, channel, errorCode }: QuestionLog) =>
    write(JSON.stringify({ ts: new Date().toISOString(), tokens, latencyMs, channel, errorCode }));
}
