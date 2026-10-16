const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export interface WaReply { ok: boolean; message: string; copyLink?: string }

export async function sendWhatsapp(phone: string, consent: boolean, state: string): Promise<WaReply> {
  try {
    const res = await fetch(`${API}/api/whatsapp`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, consent, state }),
    });
    return (await res.json()) as WaReply;
  } catch {
    return { ok: false, message: "No pude enviar el mensaje en este momento." };
  }
}

/** Formulario: número, casilla de autorización y aviso de privacidad. Todo con textContent. */
export function renderWhatsappForm(host: HTMLElement, getState: () => string | undefined): void {
  const el = <K extends keyof HTMLElementTagNameMap>(t: K, text?: string) => { const e = document.createElement(t); if (text) e.textContent = text; return e; };
  const form = el("form");
  const label = el("label", "Tu número de WhatsApp (ej. +573001234567) ");
  const phone = el("input"); phone.type = "tel"; phone.required = true; phone.autocomplete = "tel";
  label.append(phone);
  const cl = el("label"); const consent = el("input"); consent.type = "checkbox"; consent.required = true;
  cl.append(consent, " Autorizo expresamente que me envíen este resumen por WhatsApp. Usaré tu número solo para este envío y no lo guardaré en claro (Ley 1581 de 2012).");
  const btn = el("button", "Enviarme el resumen por WhatsApp"); btn.type = "submit"; btn.className = "btn btn--outline";
  const out = el("p"); out.setAttribute("role", "status");
  form.append(label, cl, btn, out);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await sendWhatsapp(phone.value.trim(), consent.checked, getState() ?? "");
    out.textContent = r.message;
    if (r.copyLink) { const i = el("input"); i.readOnly = true; i.value = r.copyLink; i.setAttribute("aria-label", "Enlace SECOP para copiar"); out.append(" ", i); }
  });
  host.replaceChildren(form);
}
