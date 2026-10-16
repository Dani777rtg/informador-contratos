import { normalize, resolveEntity, type Entity } from "./data/socrata.js";
import type { Ctx } from "./session.js";

const TOPIC = /alimentacion escolar|\bpae\b|alumbrado publico|\b(vias?|carreteras?|pavimentacion)\b|\bsalud\b|\beducacion\b|\bagua\b|acueducto|\bseguridad\b/;
const PLACE_KIND = /^(alcaldia|gobernacion|municipio|departamento|distrito)\b/;
const NOISE = new Set(["alcaldia", "gobernacion", "municipio", "departamento", "distrito", "de", "del", "la", "el", "los", "las", "y", "e", "especial", "capital"]);
const phrase = (name: string) => normalize(name).split(" ").filter((w) => !NOISE.has(w)).join(" ");

/** Detector de cambio de tema por turno (texto y voz): si el mensaje nombra otra entidad, lugar o tema, descarta el contexto previo. */
export function createTopicGuard(entities: Entity[]) {
  // Lugares (municipio/departamento) con sus nombres alternos, p. ej. "armenia" o "cali" de "Alcaldía de Santiago de Cali".
  const places = entities.flatMap((e) => [e.name, ...(e.aka ?? [])].filter((n) => PLACE_KIND.test(normalize(n))).map(phrase)).filter((p) => p.length > 2);
  const uniquePlaces = [...new Set(places)];
  return function topicGuard(message: string, ctx: Ctx): Ctx {
    const m = ` ${normalize(message)} `;
    const cur = ` ${normalize(ctx.entity?.name ?? "")} `;
    const nit = /\bnit\s*:?\s*([\d.]{6,13})/i.exec(message)?.[1]?.replace(/\D/g, "");
    const res = resolveEntity(message, entities);
    const changed =
      (nit !== undefined && nit !== ctx.entity?.nit) ||
      (res.kind === "entity" && res.entity.nit !== ctx.entity?.nit) ||
      (res.kind === "ambiguous" && !res.options.some((o) => o.nit === ctx.entity?.nit)) ||
      uniquePlaces.some((p) => m.includes(` ${p} `) && !cur.includes(` ${p} `)) ||
      (TOPIC.test(m) && !TOPIC.test(cur));
    if (!changed) return ctx;
    // «¿Y en Antioquia?»: cambia el lugar pero no la intención; solo el tipo de consulta sobrevive (ver followHint en loop.ts).
    const keep = ctx.filtros?.tipo && /^\s*y\s+(en|de|del|para|con)\s/.test(m.replace(/^\s*[¿]/, " ")) ? { filtros: { tipo: ctx.filtros.tipo } } : {};
    return ctx.turns === undefined ? keep : { turns: ctx.turns, ...keep };
  };
}
