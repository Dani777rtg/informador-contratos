const KEY = "session-state";

/** Estado firmado por el servidor; sin sessionStorage simplemente no se recupera. */
export const loadState = (): string | undefined => {
  try { return sessionStorage.getItem(KEY) ?? undefined; } catch { return undefined; }
};
export const saveState = (s: string | undefined): void => {
  try { if (s) sessionStorage.setItem(KEY, s); else sessionStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
};
