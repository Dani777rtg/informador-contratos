export const MAX_CHARS = 500;
export const MAX_TURNS = 30;
export const MAX_AUDIO_MS = 60_000;
export const MAX_TOOLS_PER_TURN = 3;

export function validateClientMessage(msg: unknown, ctx: { turnCount: number }): { ok: boolean; error?: string } {
  const bad = (error: string) => ({ ok: false, error });
  if (typeof msg !== "object" || msg === null) return bad("Mensaje invalido.");
  const m = msg as Record<string, unknown>;
  if (ctx.turnCount >= MAX_TURNS) return bad("La conversacion llego al limite de 30 turnos. Inicia una nueva.");
  if (m.type === "message") {
    if (typeof m.text !== "string" || !m.text.trim()) return bad("Mensaje invalido.");
    if (m.text.length > MAX_CHARS) return bad("El mensaje supera los 500 caracteres.");
    return { ok: true };
  }
  if (m.type === "audio") {
    if (typeof m.durationMs !== "number" || !Number.isFinite(m.durationMs) || m.durationMs < 0) return bad("Audio invalido.");
    if (m.durationMs > MAX_AUDIO_MS) return bad("El audio supera los 60 segundos.");
    return { ok: true };
  }
  return bad("Tipo de mensaje desconocido.");
}

export const validateToolCalls = (count: number): boolean => count <= MAX_TOOLS_PER_TURN;