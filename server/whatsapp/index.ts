import { createHash } from "node:crypto";

export interface Store { get(key: string): Promise<{ t: number } | undefined>; set(key: string, value: { t: number }): Promise<void> }
export interface WaOpts {
  fetch: typeof fetch; store: Store; now: () => number;
  wabaId: string; phoneNumberId: string; token: string; templateName: string;
  templateApproved: boolean; apiVersion?: string;
}
export interface WaResult { ok: boolean; message: string; retryAfterSeconds?: number; copyLink?: string }

const WINDOW_MS = 10 * 60_000;
const E164 = /^\+[1-9]\d{7,14}$/;
export const hash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

export function createWhatsApp(o: WaOpts) {
  return {
    async send(a: { ip: string; phone: string; consent: boolean; summary: string; secopUrl: string }): Promise<WaResult> {
      const fail = (message: string, extra: Partial<WaResult> = {}): WaResult => ({ ok: false, message, ...extra });
      const copy = { copyLink: a.secopUrl };
      if (a.consent !== true) return fail("Necesito tu autorización expresa para enviarte el mensaje por WhatsApp.");
      if (!E164.test(a.phone ?? "")) return fail("Escribe el número en formato internacional, por ejemplo +573001234567.");
      if (!o.templateApproved) return fail("El envío por WhatsApp aún no está disponible (la plantilla no está aprobada). Puedes copiar el enlace.", copy);

      const key = `wa_${hash(a.ip)}`;
      const last = (await o.store.get(key))?.t;
      const now = o.now();
      if (last !== undefined && now - last < WINDOW_MS) {
        const s = Math.ceil((WINDOW_MS - (now - last)) / 1000);
        return fail(`Ya enviaste un mensaje hace poco. Intenta de nuevo en ${Math.ceil(s / 60)} min.`, { retryAfterSeconds: s });
      }
      // ponytail: get+set no es atómico entre instancias; transacción de Firestore si el abuso lo exige.
      await o.store.set(key, { t: now });
      try {
        const r = await o.fetch(`https://graph.facebook.com/${o.apiVersion ?? "v21.0"}/${o.phoneNumberId}/messages`, {
          method: "POST",
          headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp", to: a.phone.slice(1), type: "template",
            template: { name: o.templateName, language: { code: "es" }, components: [{ type: "body", parameters: [
              { type: "text", text: a.summary }, { type: "text", text: a.secopUrl }] }] },
          }),
        });
        if (!r.ok) throw new Error(String(r.status));
      } catch (e) {
        // Solo hash del número, nunca en claro.
        console.error(JSON.stringify({ evt: "whatsapp_fail", to: hash(a.phone), err: e instanceof Error ? e.message : "error" }));
        return fail("No pude enviar el mensaje por WhatsApp. Puedes copiar el enlace.", copy);
      }
      return { ok: true, message: "Listo, te envié el resumen por WhatsApp." };
    },
  };
}
