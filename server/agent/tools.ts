import { fetchRows, query as socrataQuery, resolveEntity, type Cond, type Entity } from "../data/socrata.js";
import { contractCard, MAX_VISIBLE, searchContracts, type Ctx as DataCtx } from "../tools/search.js";
import { fundingBreakdown, spendByCategory, topContracts } from "../tools/spend.js";
import { contractDetail } from "../tools/detail.js";
import { listDocuments } from "../tools/documents.js";
import type { Tool, ToolRegistry } from "./loop.js";

const day = (d: Date) => d.toISOString().slice(0, 10);
const ID = /^[\w.-]{1,60}$/;

/** Herramientas tipadas para el agente: parámetros validados, nunca SoQL crudo. */
export function createTools(data: DataCtx, entities: Entity[]): ToolRegistry {
  const consultar: Tool = {
    name: "consultar_contratos",
    description: "Contratos SECOP por entidad o tema.",
    parameters: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["lista", "mayores", "gasto_por_categoria", "fuentes_de_recursos"] },
        nit: { type: "string", description: "NIT" },
        entidad: { type: "string", description: "Entidad" },
        tema: { type: "string", description: "Objeto del contrato" },
        anio: { type: "integer", minimum: 2000, maximum: 2100 },
      },
      required: ["tipo"],
    },
    async run(args, ctx) {
      const tipo = String(args.tipo ?? "lista");
      if (!["lista", "mayores", "gasto_por_categoria", "fuentes_de_recursos"].includes(tipo)) return { data: { error: "tipo inválido" } };
      let entity = ctx.entity;
      const nit = typeof args.nit === "string" ? args.nit.replace(/\D/g, "") : "";
      if (nit.length >= 5 && nit.length <= 12) entity = { nit, name: `NIT ${nit}` };
      else if (typeof args.entidad === "string" && args.entidad.trim()) {
        const r = resolveEntity(args.entidad, entities);
        if (r.kind === "ambiguous") return { data: { ambigua: r.options.map((e) => e.name) } };
        if (r.kind === "entity") entity = { nit: r.entity.nit, name: r.entity.name };
      }
      const tema = typeof args.tema === "string" ? args.tema.trim().slice(0, 80) : "";
      if (!entity && !tema) return { data: { error: "falta entidad, NIT o tema" } };
      const anio = Number(args.anio);
      const now = new Date();
      const from = new Date(now); from.setFullYear(from.getFullYear() - 1);
      const period = Number.isInteger(anio) && anio >= 2000 && anio <= 2100 ? { from: `${anio}-01-01`, to: `${anio}-12-31` }
        : ctx.period ?? { from: day(from), to: day(now) };
      const where: Cond[] = [];
      if (tema) where.push({ col: "objeto_del_contrato", op: "like", value: tema.toUpperCase() });
      else if (entity) where.push({ col: "nit_entidad", op: "=", value: entity.nit });
      where.push({ col: "fecha_de_firma", op: ">=", value: `${period.from}T00:00:00` }, { col: "fecha_de_firma", op: "<=", value: `${period.to}T23:59:59` });
      const context = { entity: tema ? undefined : entity, period };
      if (tipo === "lista") {
        const r = await searchContracts(data, where);
        const shown = r.value.slice(0, MAX_VISIBLE);
        const cards = shown.map(contractCard);
        return { data: { contratos: cards, hayMas: r.value.length > MAX_VISIBLE, periodo: period }, cards, context: { ...context, results: shown.map((x) => x.id_contrato).filter((i): i is string => Boolean(i)) } };
      }
      const fn = tipo === "mayores" ? topContracts : tipo === "fuentes_de_recursos" ? fundingBreakdown : spendByCategory;
      const r = await fn(data, where);
      return { data: { resultado: r.cards, periodo: period }, cards: r.cards, context };
    },
  };
  const detalle: Tool = {
    name: "detalle_contrato",
    description: "Detalle y pagos de un contrato.",
    parameters: { type: "object", properties: { id_contrato: { type: "string" } }, required: ["id_contrato"] },
    async run(args) {
      const id = String(args.id_contrato ?? "");
      if (!ID.test(id)) return { data: { error: "id inválido" } };
      const d = await contractDetail(data, id);
      return d ? { data: d.card, cards: [d.card], context: { contract: id } } : { data: { error: "contrato no encontrado" } };
    },
  };
  const documentos: Tool = {
    name: "documentos_contrato",
    description: "Documentos SECOP de un contrato.",
    parameters: { type: "object", properties: { id_contrato: { type: "string" } }, required: ["id_contrato"] },
    async run(args) {
      const id = String(args.id_contrato ?? "");
      if (!ID.test(id)) return { data: { error: "id inválido" } };
      const [k] = await socrataQuery(data.client, { where: [{ col: "id_contrato", op: "=", value: id }], limit: 1 });
      if (!k?.proceso_de_compra) return { data: { error: "contrato no encontrado" } };
      const r = await listDocuments({ processId: k.proceso_de_compra, year: Number(k.fecha_de_firma?.slice(0, 4)) || undefined }, {
        query: (ds, p) => fetchRows(data.client, new URLSearchParams(Object.entries(p).map(([a, b]) => [a, String(b)])), ds) as Promise<Record<string, string>[]>,
      });
      const card = { kind: "documents", documents: r.documents, processUrl: r.processUrl };
      return { data: { documentos: r.documents.map((d) => d.name), mensaje: r.message }, cards: [card], context: { contract: id } };
    },
  };
  return { [consultar.name]: consultar, [detalle.name]: detalle, [documentos.name]: documentos };
}
