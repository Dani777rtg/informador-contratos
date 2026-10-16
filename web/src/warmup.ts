// Despierta Cloud Run (min-instances=0) con una petición ligera a /health.
const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
let last = 0;
export function warmup(): void {
  if (Date.now() - last < 60_000) return;
  last = Date.now();
  void fetch(`${API}/health`, { cache: "no-store" }).catch(() => { /* sin red: el chat mostrará el error */ });
}
