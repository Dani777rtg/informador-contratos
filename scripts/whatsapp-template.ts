// Crea la plantilla de WhatsApp (UTILITY, es) y la sigue hasta APPROVED. Uso: npm run wa:template [-- --status]
type F = typeof fetch;
export type EnsureOpts = {
  fetch: F; wabaId: string; token: string; log: (l: string) => void;
  sleep?: (ms: number) => Promise<void>; statusOnly?: boolean; baseName?: string;
};

export const BASE_NAME = "resumen_secop";
// Sin variables al inicio/fin ni tono promocional (Meta los rechaza).
const TEXT = "Resumen de su consulta de contratos públicos: {{1}}. Puede revisar el detalle en SECOP: {{2}}. Gracias por usar el servicio.";
const EXAMPLE = ["3 contratos consultados, valor total 250 millones COP", "https://www.secop.gov.co/ejemplo"];
const MAX_POLLS = 60;

export async function ensureTemplate(o: EnsureOpts): Promise<{ status: string; name: string }> {
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const base = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION ?? "v21.0"}`;
  const auth = { Authorization: `Bearer ${o.token}` };
  const call = async (url: string, body?: unknown) => {
    const res = await o.fetch(`${base}/${url}`, body
      ? { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) }
      : { headers: auth });
    return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as any };
  };
  const root = o.baseName ?? BASE_NAME;
  const poll = async (id: string, name: string) => {
    let s = "PENDING";
    for (let i = 0; i < MAX_POLLS; i++) {
      const r = await call(`${id}?fields=status`);
      if (!r.ok) throw new Error(`Consulta de estado falló (HTTP ${r.status})`);
      s = r.json.status;
      o.log(`Plantilla ${name}: ${s}`);
      if (s !== "PENDING" && s !== "IN_APPEAL") return s;
      await sleep(5000);
    }
    return s;
  };

  // Reutiliza una plantilla existente si está aprobada o en revisión.
  const found = await call(`${o.wabaId}/message_templates?name=${root}&fields=id,name,status`);
  const prev = found.ok ? (found.json.data ?? []).find((t: any) => t.name === root) : undefined;
  if (prev && prev.status === "APPROVED") { o.log(`Plantilla ${root}: APPROVED`); return { status: "APPROVED", name: root }; }
  if (o.statusOnly) {
    const s = prev?.status ?? "NOT_FOUND";
    o.log(`Plantilla ${root}: ${s}`);
    return { status: s, name: root };
  }
  if (prev && prev.status === "PENDING") return { status: await poll(prev.id, root), name: root };

  // Meta no deja reutilizar el nombre de una rechazada: cada reenvío usa sufijo nuevo.
  let name = prev ? `${root}_v${Date.now().toString(36)}` : root;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await call(`${o.wabaId}/message_templates`, {
      name, category: "UTILITY", language: "es", parameter_format: "positional",
      components: [{ type: "BODY", text: TEXT, example: { body_text: [EXAMPLE] } }],
    });
    if (!r.ok || !r.json.id) throw new Error(`Creación falló (HTTP ${r.status}): ${r.json?.error?.message ?? "sin detalle"}`);
    o.log(`Plantilla ${name} creada (id ${r.json.id}), en revisión`);
    const s = await poll(r.json.id, name);
    if (s !== "REJECTED") return { status: s, name };
    o.log(`Rechazada (intento ${attempt}); se reenvía con nombre nuevo`);
    name = `${root}_v${attempt + 1}_${Date.now().toString(36)}`;
  }
  throw new Error("La plantilla fue rechazada 3 veces; revise el texto en Business Manager");
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("whatsapp-template.ts")) {
  const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_BUSINESS_ACCOUNT_ID: wabaId } = process.env;
  if (!token || !wabaId) { console.error("Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_BUSINESS_ACCOUNT_ID"); process.exit(1); }
  ensureTemplate({ fetch, wabaId, token, log: console.log, statusOnly: process.argv.includes("--status") })
    .then((r) => { console.log(`Resultado: ${r.name} ${r.status}`); process.exit(r.status === "APPROVED" ? 0 : 2); })
    .catch((e) => { console.error(String(e.message ?? e).replace(token, "***")); process.exit(1); });
}
