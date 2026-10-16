import { Hono } from "hono";

const wait = () => new Promise((r) => setTimeout(r, Number(process.env.MOCK_LATENCY_MS_WHATSAPP ?? 0)));

/** Sustituto de WhatsApp Graph: envío de mensajes y estado de plantillas. */
export function createWhatsappMock() {
  const sent: unknown[] = [];
  const app = new Hono();
  app.post("/__mock/whatsapp/:phoneId/messages", async (c) => {
    await wait();
    sent.push(await c.req.json());
    return c.json({ messaging_product: "whatsapp", messages: [{ id: `wamid.mock${sent.length}` }] });
  });
  app.get("/__mock/whatsapp/:wabaId/message_templates", (c) =>
    c.json({ data: [{ name: c.req.query("name") ?? "consulta_contratos", status: "APPROVED" }] }));
  app.get("/__mock/whatsapp/sent", (c) => c.json(sent));
  return app;
}
