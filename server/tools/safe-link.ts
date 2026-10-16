/** Solo https:// hacia secop.gov.co o sus subdominios, sin credenciales (TM-12). */
export function safeLink(url: unknown): string | null {
  if (typeof url !== "string") return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (u.hostname !== "secop.gov.co" && !u.hostname.endsWith(".secop.gov.co")) return null;
  return url;
}