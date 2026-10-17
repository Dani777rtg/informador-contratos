import { fetchRows, query as socrataQuery, type Entity } from "../data/socrata.js";
import type { Place } from "../data/places.js";
import { withBudget } from "../data/budget.js";
import { SLOW_NOTICE, SocrataUnavailable } from "../data/retry.js";
import type { Ctx as DataCtx } from "../tools/search.js";
import { contractDetail } from "../tools/detail.js";
import { listDocuments } from "../tools/documents.js";
import { OUTLIER_NOTE } from "../data/outliers.js";
import { buscarEntidad } from "../data/entity-aliases.js";
import { configureTools, currentDeps, QUERY_DEF, runQuery, say, type Deps } from "./query.js";
import type { Ctx, Tool, ToolRegistry, ToolResult } from "./loop.js";

export { configureTools };
const ID = /^[\w.-]{1,60}$/;

/** Definiciones para el LLM (texto) y para el Voice Agent: parámetros cerrados, nunca SoQL. */
export const TOOL_DEFS = [
  QUERY_DEF,
  {
    name: "buscar_entidad",
    description: "Busca una entidad por sigla o nombre común (MinTIC, ICBF, INVIAS, DIAN, Alcaldía de Cali) y devuelve candidatos con NIT. Úsala si dudas; con dudas, pregunta al usuario con las opciones.",
    parameters: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
  },
  {
    name: "detalle_contrato",
    description: "Detalle de un contrato mostrado.",
    parameters: { type: "object", properties: { id_contrato: { type: "string" }, documentos: { type: "boolean" } }, required: ["id_contrato"] },
  },
];

async function detail(args: Record<string, unknown>, dctx: DataCtx): Promise<ToolResult> {
  const id = String(args.id_contrato ?? "");
  if (!ID.test(id)) return { data: { error: "sin_resultados", nota: "id inválido" } };
  const det = await contractDetail(dctx, id);
  if (!det) return { data: { error: "sin_resultados", nota: "No encontré ese contrato." } };
  const cards: ToolResult["cards"] = [det.card];
  const { modifications: _m, ...slimCard } = det.card;
  const c = det.card, amt = (s: string) => say(s) as string;
  const data: Record<string, unknown> = {
    ...say(slimCard) as object,
    // Dos frases para la voz; la ficha completa va en la tarjeta.
    resumen: `${c.contractor ?? "El contratista"} firmó con ${c.entity ?? "la entidad"} un contrato por ${amt(c.value)} el ${c.signedAt || "(sin fecha)"}${c.status ? `, hoy ${String(c.status).toLowerCase()}` : ""}. Se ha pagado ${amt(c.paid)} y quedan pendientes ${amt(c.pending)}.`,
    ...(c.atipico ? { nota: OUTLIER_NOTE } : {}),
  };
  if (args.documentos === true) {
    const [k] = await socrataQuery(dctx.client, { where: [{ col: "id_contrato", op: "=", value: id }], limit: 1 });
    if (k?.proceso_de_compra) {
      const r = await listDocuments({ processId: k.proceso_de_compra, year: Number(k.fecha_de_firma?.slice(0, 4)) || undefined }, {
        query: (ds, p) => fetchRows(dctx.client, new URLSearchParams(Object.entries(p).map(([a, b]) => [a, String(b)])), ds) as Promise<Record<string, string>[]>,
      });
      cards.push({ kind: "documents", documents: r.documents, processUrl: r.processUrl });
      data.documentos = r.documents.map((x) => x.name);
      data.mensajeDocumentos = r.message;
    }
  }
  return { data, cards, context: { contract: id } };
}

const unavailable = (): ToolResult => ({ data: { error: "servicio_no_disponible", nota: SLOW_NOTICE.instruccion.slice(0, 135) } });

/** Ejecuta una herramienta. Nunca lanza por fallas de datos.gov.co. */
export async function runTool(name: string, args: Record<string, unknown>, data: DataCtx = currentDeps().base, ctx: Ctx = {}, d: Deps = { ...currentDeps(), base: data }): Promise<ToolResult> {
  if (name === "consultar") return runQuery(args, data, ctx, d);
  if (name === "buscar_entidad") return { data: buscarEntidad(String(args.texto ?? "").slice(0, 80), d.entities) };
  if (name === "detalle_contrato") {
    const dctx: DataCtx = { ...d.base, client: withBudget(d.base.client) };
    try { return await detail(args, dctx); } catch (e) { if (e instanceof SocrataUnavailable) return unavailable(); throw e; }
  }
  return { data: { error: "sin_resultados", nota: "herramienta desconocida" } };
}

/** Registro para el agente de texto: mismas definiciones y mismo ejecutor que la voz. */
export function createTools(base: DataCtx, entities: Entity[], places: () => Promise<Place[]> = async () => []): ToolRegistry {
  const d: Deps = { base, entities, places: places ?? undefined };
  configureTools(d);
  return Object.fromEntries(TOOL_DEFS.map((t): [string, Tool] => [t.name, { ...t, run: (args, ctx) => runTool(t.name, args, base, ctx, d) }]));
}
