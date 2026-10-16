import { Hono } from "hono";

/** Sustituto OpenAI-compatible de DeepSeek: chat/completions con tool calls y stream. */
export function createDeepseekMock(replyText = "Encontré tres contratos de ejemplo. Puedes pedir más detalle.") {
  const app = new Hono();
  app.post("/v1/chat/completions", async (c) => {
    const body = (await c.req.json()) as { stream?: boolean; model?: string; tools?: { function: { name: string } }[]; messages: { role: string }[] };
    const last = body.messages.at(-1)?.role;
    const tool = body.tools?.[0]?.function.name;
    const message = last === "user" && tool
      ? { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: tool, arguments: "{}" } }] }
      : { role: "assistant", content: replyText };
    const model = body.model ?? "deepseek-flash";
    if (!body.stream) return c.json({ id: "mock", model, choices: [{ index: 0, message, finish_reason: message.content ? "stop" : "tool_calls" }], usage: { total_tokens: 50 } });
    const ev = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
    const parts = message.content ? replyText.split(/(?<=\. )/).map((t) => ev({ choices: [{ delta: { content: t } }] })) : [ev({ choices: [{ delta: { tool_calls: [{ index: 0, ...message.tool_calls![0] }] } }] })];
    parts.push(ev({ choices: [{ delta: {}, finish_reason: message.content ? "stop" : "tool_calls" }], usage: { total_tokens: 50 } }), "data: [DONE]\n\n");
    return c.body(parts.join(""), 200, { "content-type": "text/event-stream" });
  });
  return app;
}
