const MSG = "Hay mucha demanda, intenta en un momento.";

// ponytail: contador en memoria por instancia y por dia UTC; tope global real requiere almacen compartido.
export function createDemandGuard(o: { dailyTokenCap?: number; overloaded?: () => boolean } = {}): {
  record(tokens: number): void;
  admit(channel: "text" | "voice"): { allowed: boolean; message?: string };
} {
  const cap = o.dailyTokenCap ?? Number(process.env.DAILY_TOKEN_CAP ?? 1_000_000);
  let day = new Date().toISOString().slice(0, 10);
  let used = 0;
  const roll = () => { const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; used = 0; } };
  return {
    record(tokens) { roll(); used += tokens; },
    admit(channel) {
      roll();
      if (used > cap || (channel === "voice" && o.overloaded?.())) return { allowed: false, message: MSG };
      return { allowed: true };
    },
  };
}