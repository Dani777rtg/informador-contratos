import { Hono } from "hono";

type Msg = { role: string; content?: string | null };

/** Interpreta la pregunta como lo haría el modelo real: elige `consultar`, `buscar_entidad` o `detalle_contrato` con parámetros tipados. */
export function planCall(question: string, context = ""): { name: string; args: Record<string, unknown> } | null {
  const q = question.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/\balgo general\b/.test(q)) return null; // pregunta abierta: responde sin consultar
  const id = /\b(primero|ese contrato|abrelo|detalle)\b/.test(q) && /"results":\["([^"]+)"/.exec(context)?.[1];
  if (id) return { name: "detalle_contrato", args: { id_contrato: id } };
  const filtros: Record<string, unknown> = {};
  const nit = /\bnit\s*([\d.]{5,14})/.exec(q)?.[1];
  const ent = /\b(alcaldia|gobernacion|ministerio|secretaria|instituto|hospital|universidad)(\s+(?:de la|del|de)\s+[a-z]+(?:\s+[a-z]+)?)?/.exec(q)?.[0]
    ?? /\b(mintic|min ?tic|icbf|invias|dian|sena|fiscalia|registraduria|policia|ejercito)\b/.exec(q)?.[0];
  // La entidad va con las palabras del usuario: el mismo tramo de la pregunta original (la normalización conserva las posiciones).
  const at = ent ? q.indexOf(ent) : -1;
  if (nit) filtros.nit = nit.replace(/\D/g, ""); else if (ent) filtros.entidad = question.slice(at, at + ent.length);
  const lugar = !ent && !nit ? /\b(cali|manizales|cartagena|medellin|pasto|tunja|bogota)\b/.exec(q)?.[1] : undefined;
  if (lugar) filtros.municipio = lugar;
  const tema = /(alumbrado publico|educacion|salud|vias)/.exec(q)?.[1];
  if (tema) filtros.tema = tema === "alumbrado publico" ? "alumbrado público" : tema === "educacion" ? "educación" : tema;
  const anio = /\b(20\d\d)\b/.exec(q)?.[1];
  if (anio) { filtros.desde = anio; filtros.hasta = anio; }
  const base = (o: Record<string, unknown>) => ({ name: "consultar", args: { filtros, ...o } });
  if (/de donde sale|fuente|origen de los recursos/.test(q)) return base({ operacion: "sumar", agrupar: "fuente" });
  if (/(en que|gasta|categoria)/.test(q)) return base({ operacion: "sumar", agrupar: "categoria" });
  if (/por mes/.test(q)) return base({ operacion: "sumar", agrupar: "mes" });
  if (/promedio/.test(q)) return base({ operacion: "promediar" });
  if (/menor valor|mas baratos?|mas pequenos?/.test(q)) return base({ operacion: "listar", orden: "asc", limite: 5 });
  if (/mas grandes|mayor(es)? valor|mas caros?/.test(q)) return base({ operacion: "listar", orden: "desc", limite: 10 });
  if (/quien(es)?|contratistas?|empresas?/.test(q)) return base({ operacion: "sumar", agrupar: "contratista", orden: "desc", limite: 5 });
  if (/cuantos? contratos?/.test(q)) return base({ operacion: "contar" });
  if (/cuanto|total|gasto/.test(q)) return base({ operacion: "sumar" });
  return base({ operacion: "listar", limite: 5 });
}

/** Redacta como lo haría el modelo con el resultado de la herramienta: sin datos lo dice; con un ranking cita el primer monto. */
function reply(fallback: string, messages: Msg[]): string {
  const tool = [...messages].reverse().find((m) => m.role === "tool")?.content ?? "";
  if (/sin_resultados|sinResultados|"error"/.test(tool)) return "No encontré contratos con ese nombre en ese periodo. Prueba ampliar el rango de fechas o dime el nombre completo de la entidad.";
  const amount = /"orden":"(?:desc|asc)"/.test(tool) ? /\$\d{1,3}(?:\.\d{3})* millones de pesos|\$\d+ mil millones de pesos/.exec(tool)?.[0] : undefined;
  const base = amount ? `Estos son los resultados; el primero ronda ${amount}. Puedes pedir más detalle.` : fallback;
  return /últimos 12 meses/.test(tool) ? `${base} Son los últimos 12 meses.` : base;
}

const wait = () => new Promise((r) => setTimeout(r, Number(process.env.MOCK_LATENCY_MS_DEEPSEEK ?? 0)));

/** Sustituto OpenAI-compatible de DeepSeek: chat/completions con tool calls y stream. */
export function createDeepseekMock(replyText = "Encontré tres contratos de ejemplo. Puedes pedir más detalle.") {
  const app = new Hono();
  app.post("/v1/chat/completions", async (c) => {
    const body = (await c.req.json()) as { stream?: boolean; model?: string; tools?: { function: { name: string } }[]; messages: Msg[] };
    await wait();
    const last = body.messages.at(-1)?.role;
    const tool = body.tools?.[0]?.function.name;
    const user = [...body.messages as Msg[]].reverse().find((m) => m.role === "user")?.content ?? "";
    const plan = tool ? planCall(user, (body.messages as Msg[]).map((m) => m.content ?? "").join("\n")) : undefined;
    // Si el registro no ofrece esa herramienta (pruebas con herramientas propias), llama a la primera sin argumentos.
    const offered = plan && body.tools?.some((t) => t.function.name === plan.name);
    const call = offered ? plan : plan === null && body.tools?.some((t) => t.function.name === "consultar") ? undefined : tool ? { name: tool, args: {} } : undefined;
    const text = reply(replyText, body.messages);
    const message = last === "user" && call
      ? { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: text };
    const model = body.model ?? "deepseek-flash";
    if (!body.stream) return c.json({ id: "mock", model, choices: [{ index: 0, message, finish_reason: message.content ? "stop" : "tool_calls" }], usage: { total_tokens: 50 } });
    const ev = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
    const parts = message.content ? text.split(/(?<=\. )/).map((t) => ev({ choices: [{ delta: { content: t } }] })) : [ev({ choices: [{ delta: { tool_calls: [{ index: 0, ...message.tool_calls![0] }] } }] })];
    parts.push(ev({ choices: [{ delta: {}, finish_reason: message.content ? "stop" : "tool_calls" }], usage: { total_tokens: 50 } }), "data: [DONE]\n\n");
    return c.body(parts.join(""), 200, { "content-type": "text/event-stream" });
  });
  return app;
}
