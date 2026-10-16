import type { Store } from "./index.js";

export const memoryStore = (): Store => {
  const m = new Map<string, { t: number }>();
  return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};

/** Firestore vía REST con el token de metadatos de Cloud Run (sin dependencia nueva). */
export function firestoreStore(project: string, f: typeof fetch = fetch): Store {
  const doc = (k: string) => `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/wa_limits/${encodeURIComponent(k)}`;
  const auth = async () => {
    const r = await f("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
    return { authorization: `Bearer ${((await r.json()) as { access_token: string }).access_token}` };
  };
  return {
    async get(k) {
      const r = await f(doc(k), { headers: await auth() });
      if (r.status === 404) return undefined;
      if (!r.ok) throw new Error(`firestore ${r.status}`);
      const t = ((await r.json()) as { fields?: { t?: { integerValue?: string } } }).fields?.t?.integerValue;
      return t === undefined ? undefined : { t: Number(t) };
    },
    async set(k, v) {
      const r = await f(doc(k), { method: "PATCH", headers: { ...(await auth()), "content-type": "application/json" },
        body: JSON.stringify({ fields: { t: { integerValue: String(v.t) } } }) });
      if (!r.ok) throw new Error(`firestore ${r.status}`);
    },
  };
}

/** Estado APPROVED de la plantilla en Meta, cacheado 5 min. */
export function templateStatus(f: typeof fetch, o: { wabaId: string; token: string; name: string; base?: string }) {
  let at = 0, ok = false;
  return async (): Promise<boolean> => {
    if (Date.now() - at < 5 * 60_000) return ok;
    try {
      const r = await f(`${o.base ?? "https://graph.facebook.com/v21.0"}/${o.wabaId}/message_templates?name=${encodeURIComponent(o.name)}`, { headers: { authorization: `Bearer ${o.token}` } });
      const j = (await r.json()) as { data?: { status?: string }[] };
      ok = r.ok && j.data?.some((t) => t.status === "APPROVED") === true;
    } catch { ok = false; }
    at = Date.now();
    return ok;
  };
}
