import { Hono } from "hono";

/** Sustituto de WhatsApp Graph: envío de mensajes y estado de plantillas. */
export function createWhatsappMock() {
  const sent: unknown[] = [];
  const app = new Hono();
  app.post("/__mock/whatsapp/:phoneId/messages", async (c) => {
    sent.push(await c.req.json());
    return c.json({ messaging_product: "whatsapp", messages: [{ id: `wamid.mock${sent.length}` }] });
  });
  app.get("/__mock/whatsapp/:wabaId/message_templates", (c) =>
    c.json({ data: [{ name: c.req.query("name") ?? "consulta_contratos", status: "APPROVED" }] }));
  app.get("/__mock/whatsapp/sent", (c) => c.json(sent));
  return app;
}
