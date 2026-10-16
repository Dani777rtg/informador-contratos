/**
 * US-10 acceptance tests. WhatsApp/Meta (fetch) and Firestore (store) are local fakes.
 *
 * Module contract these tests assume (not yet implemented; builders must provide it):
 *  - scripts/whatsapp-template.ts
 *      ensureTemplate({ fetch, wabaId, token, log, sleep? }) -> Promise<{ status: "APPROVED" | string, name: string }>
 *      `fetch` is fetch-compatible; `log(line: string)` receives log lines; `sleep(ms)` replaces real waiting.
 *  - server/whatsapp/index.ts
 *      createWhatsApp({ fetch, store, now, wabaId, phoneNumberId, token, templateName, templateApproved })
 *        store: Firestore-like { get(key): Promise<any|undefined>, set(key, value): Promise<void> }
 *        now(): number (ms)
 *      .send({ ip, phone, consent, summary, secopUrl })
 *        -> Promise<{ ok: boolean, message: string, retryAfterSeconds?: number, copyLink?: string }>
 */
import { describe, it, expect } from "vitest";
import { ensureTemplate } from "../../scripts/whatsapp-template";
import { createWhatsApp } from "../../server/whatsapp/index";

type Call = { method: string; url: string; body: any };

function metaFake(opts: { statuses?: string[]; failSend?: boolean } = {}) {
  const calls: Call[] = [];
  const statuses = [...(opts.statuses ?? ["APPROVED"])];
  let created = 0;
  const fetch = async (url: any, init: any = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: String(url), body });
    const json = (o: any, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (method === "POST" && String(url).includes("/message_templates")) {
      created++;
      return json({ id: `tpl-${created}`, status: "PENDING" });
    }
    if (method === "GET" && String(url).includes("tpl-")) {
      const s = statuses.length > 1 ? statuses.shift()! : statuses[0];
      return json({ id: "tpl", status: s });
    }
    if (method === "POST" && String(url).includes("/messages")) {
      return opts.failSend ? json({ error: { message: "boom" } }, 500) : json({ messages: [{ id: "wamid.1" }] });
    }
    return json({}, 404);
  };
  return { fetch, calls };
}

function firestoreFake() {
  const data = new Map<string, any>();
  return {
    async get(k: string) { return data.get(k); },
    async set(k: string, v: any) { data.set(k, v); },
  };
}

const sends = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.url.includes("/messages"));
const base = { wabaId: "WABA1", phoneNumberId: "PN1", token: "t", templateName: "resumen_secop" };
const msg = { phone: "+573001234567", consent: true, summary: "Resumen de 3 contratos", secopUrl: "https://www.secop.gov.co/x" };

describe("AC-10.1 plantilla creada y seguida hasta APROBADA", () => {
  it("AC-10.1 crea plantilla UTILITY en es con variables posicionales con ejemplo, consulta estado y lo registra", async () => {
    const meta = metaFake({ statuses: ["PENDING", "PENDING", "APPROVED"] });
    const logs: string[] = [];
    const r = await ensureTemplate({ fetch: meta.fetch, wabaId: "WABA1", token: "t", log: (l: string) => logs.push(l), sleep: async () => {} });
    const post = meta.calls.find((c) => c.method === "POST" && c.url.includes("/WABA1/message_templates"))!;
    expect(post).toBeTruthy();
    expect(post.body.category).toBe("UTILITY");
    expect(post.body.language).toBe("es");
    const bodyComp = post.body.components.find((c: any) => c.type === "BODY");
    expect(bodyComp.text).toMatch(/\{\{1\}\}/);
    expect(bodyComp.example.body_text[0].length).toBeGreaterThanOrEqual(1);
    expect(meta.calls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(2);
    expect(r.status).toBe("APPROVED");
    expect(logs.join("\n")).toMatch(/APPROVED|APROBAD/i);
  });

  it("AC-10.1 si es rechazada la corrige y la reenvía como plantilla nueva", async () => {
    const meta = metaFake({ statuses: ["REJECTED", "APPROVED"] });
    const r = await ensureTemplate({ fetch: meta.fetch, wabaId: "WABA1", token: "t", log: () => {}, sleep: async () => {} });
    const posts = meta.calls.filter((c) => c.method === "POST" && c.url.includes("/message_templates"));
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(r.status).toBe("APPROVED");
  });
});

describe("AC-10.2 envío con número E.164 y consentimiento", () => {
  it("AC-10.2 envía la plantilla con resumen y enlace SECOP cuando hay número válido y consentimiento", async () => {
    const meta = metaFake();
    const wa = createWhatsApp({ ...base, fetch: meta.fetch, store: firestoreFake(), now: () => 1_000_000, templateApproved: true });
    const r = await wa.send({ ip: "1.1.1.1", ...msg });
    expect(r.ok).toBe(true);
    const s = sends(meta.calls);
    expect(s).toHaveLength(1);
    expect(s[0].body.to.replace(/^\+/, "")).toBe("573001234567");
    expect(s[0].body.type).toBe("template");
    const params = JSON.stringify(s[0].body.template.components);
    expect(params).toContain(msg.summary);
    expect(params).toContain(msg.secopUrl);
  });

  it.each(["3001234567", "+0123", "abc", "+57 300 123", ""])("AC-10.2 rechaza número no E.164 (%s) sin enviar", async (phone) => {
    const meta = metaFake();
    const wa = createWhatsApp({ ...base, fetch: meta.fetch, store: firestoreFake(), now: () => 1_000_000, templateApproved: true });
    const r = await wa.send({ ip: "1.1.1.1", ...msg, phone });
    expect(r.ok).toBe(false);
    expect(sends(meta.calls)).toHaveLength(0);
  });

  it("AC-10.2 sin autorización explícita no envía", async () => {
    const meta = metaFake();
    const wa = createWhatsApp({ ...base, fetch: meta.fetch, store: firestoreFake(), now: () => 1_000_000, templateApproved: true });
    const r = await wa.send({ ip: "1.1.1.1", ...msg, consent: false });
    expect(r.ok).toBe(false);
    expect(sends(meta.calls)).toHaveLength(0);
  });
});

describe("AC-10.3 límite de 10 minutos por IP en Firestore (TM-9)", () => {
  it("AC-10.3 rechaza un segundo envío de la misma IP dentro de 10 min y dice cuánto falta", async () => {
    const meta = metaFake();
    let t = 1_000_000;
    const wa = createWhatsApp({ ...base, fetch: meta.fetch, store: firestoreFake(), now: () => t, templateApproved: true });
    expect((await wa.send({ ip: "2.2.2.2", ...msg })).ok).toBe(true);
    t += 5 * 60_000;
    const r = await wa.send({ ip: "2.2.2.2", ...msg });
    expect(r.ok).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(290);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(300);
    expect(sends(meta.calls)).toHaveLength(1);
  });

  it("AC-10.3 pasados 10 min la misma IP vuelve a poder enviar, y otra IP no se ve afectada", async () => {
    const meta = metaFake();
    let t = 1_000_000;
    const wa = createWhatsApp({ ...base, fetch: meta.fetch, store: firestoreFake(), now: () => t, templateApproved: true });
    await wa.send({ ip: "2.2.2.2", ...msg });
    expect((await wa.send({ ip: "3.3.3.3", ...msg })).ok).toBe(true);
    t += 10 * 60_000 + 1000;
    expect((await wa.send({ ip: "2.2.2.2", ...msg })).ok).toBe(true);
  });

  it("AC-10.3 el contador es compartido entre instancias y sobrevive a reinicios (mismo Firestore)", async () => {
    const meta = metaFake();
    const store = firestoreFake();
    const t = 1_000_000;
    const a = createWhatsApp({ ...base, fetch: meta.fetch, store, now: () => t, templateApproved: true });
    await a.send({ ip: "4.4.4.4", ...msg });
    const b = createWhatsApp({ ...base, fetch: meta.fetch, store, now: () => t + 60_000, templateApproved: true });
    const r = await b.send({ ip: "4.4.4.4", ...msg });
    expect(r.ok).toBe(false);
    expect(sends(meta.calls)).toHaveLength(1);
  });
});

describe("AC-10.4 plantilla no aprobada o envío fallido", () => {
  it("AC-10.4 plantilla no aprobada: lo dice, ofrece el enlace para copiar y no envía", async () => {
    const meta = metaFake();
    const wa = createWhatsApp({ ...base, fetch: meta.fetch, store: firestoreFake(), now: () => 1_000_000, templateApproved: false });
    const r = await wa.send({ ip: "5.5.5.5", ...msg });
    expect(r.ok).toBe(false);
    expect(r.message.length).toBeGreaterThan(0);
    expect(r.copyLink).toBe(msg.secopUrl);
    expect(sends(meta.calls)).toHaveLength(0);
  });

  it("AC-10.4 envío fallido: lo dice y ofrece el enlace para copiar", async () => {
    const meta = metaFake({ failSend: true });
    const wa = createWhatsApp({ ...base, fetch: meta.fetch, store: firestoreFake(), now: () => 1_000_000, templateApproved: true });
    const r = await wa.send({ ip: "6.6.6.6", ...msg });
    expect(r.ok).toBe(false);
    expect(r.message.length).toBeGreaterThan(0);
    expect(r.copyLink).toBe(msg.secopUrl);
  });
});
