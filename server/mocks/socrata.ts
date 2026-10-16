import { Hono } from "hono";
import { toEntity, type Entity, type Row } from "../data/socrata.js";

/** Índice pequeño de fixtures (en producción sale de data/entities.json). */
export const MOCK_ENTITIES: Entity[] = [
  toEntity("890399011", "Alcaldía de Cali"),
  toEntity("890900286", "Gobernación de Antioquia"),
  toEntity("890905211", "Alcaldía de Medellín"),
  toEntity("899999061", "Alcaldía de Bogotá"),
];

const MOCK_PLACES = [["Cali", "Valle del Cauca"], ["Manizales", "Caldas"], ["Cartagena", "Bolívar"], ["Medellín", "Antioquia"], ["Pasto", "Nariño"]];

const wait =() => new Promise((r) => setTimeout(r, Number(process.env.MOCK_LATENCY_MS_SOCRATA ?? 0)));

type Mode = "ok" | "slow" | "fail" | "empty";

function rows(entity: string, nit: string, n: number, object = "Prestación de servicios de apoyo a la gestión"): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    nombre_entidad: entity, nit_entidad: nit, proveedor_adjudicado: `Contratista Ejemplo ${i + 1} S.A.S.`,
    objeto_del_contrato: `${object} ${i + 1}`, valor_del_contrato: String((i + 1) * 123456789),
    fecha_de_firma: `2026-0${(i % 9) + 1}-15T00:00:00.000`, estado_contrato: i % 2 ? "Terminado" : "En ejecución",
    urlproceso: { url: `https://community.secop.gov.co/Public/Tools/gv_ViewContract?id=${nit}${i}` } as unknown as string,
    tipo_de_contrato: "Prestación de servicios", origen_de_los_recursos: i % 2 ? "Recursos propios" : "Presupuesto General",
    proceso_de_compra: `CO1.BDOS.${i + 1}`, id_contrato: `CO1.${nit}.${i}`,
    presupuesto_general_de_la_nacion_pgn: String((i + 1) * 1000000), recursos_propios: String((i % 3) * 500000),
    sistema_general_de_participaciones: "0", sistema_general_de_regal_as: "0", recursos_de_credito: "0",
    valor_facturado: String((i + 1) * 100000000), valor_pagado: String((i + 1) * 90000000), valor_pendiente_de_pago: String((i + 1) * 10000000), dias_adicionados: String(i * 10), modalidad_de_contratacion: "Contratación directa", fecha_de_inicio_del_contrato: "2026-02-01T00:00:00.000", fecha_de_fin_del_contrato: "2026-12-31T00:00:00.000", departamento: "Valle del Cauca", ciudad: "Cali",
  }));
}

/** Agrega como lo haria SoQL: $group + sum(col) as alias + count(*) as n. */
function aggregate(rs: Row[], select: string, group: string | null): Record<string, string>[] {
  const sums = [...select.matchAll(/sum\((\w+)\) as (\w+)/g)];
  const groups = new Map<string, Row[]>();
  for (const r of rs) { const k = group ? String(r[group as keyof Row]) : ""; groups.set(k, [...(groups.get(k) ?? []), r]); }
  return [...groups].map(([k, g]) => ({
    ...(group ? { [group]: k } : {}),
    ...Object.fromEntries(sums.map(([, c, a]) => [a, String(g.reduce((t, r) => t + Number(r[c as keyof Row] ?? 0), 0))])),
    n: String(g.length),
  }));
}

/** Sustituto de datos.gov.co con modos de fallo y registro de peticiones. */
export function createSocrataMock() {
  let mode: Mode = "ok";
  let requests: { url: string }[] = [];
  const app = new Hono();
  app.post("/__mock/socrata", async (c) => { mode = ((await c.req.json()) as { mode: Mode }).mode; return c.json({ mode }); });
  app.get("/__mock/socrata/requests", (c) => c.json(requests));
  app.delete("/__mock/socrata/requests", (c) => { requests = []; return c.body(null, 204); });
  app.get("/__mock/socrata/resource/:id", async (c) => {
    requests.push({ url: c.req.url });
    await wait();
    if (mode === "fail") return c.json({ message: "mock failure" }, 500);
    if (mode === "slow") await new Promise((r) => setTimeout(r, 5000));
    if (mode === "empty") return c.json([]);
    const where = c.req.query("$where") ?? "";
    const hit = MOCK_ENTITIES.find((e) => where.includes(e.nit));
    if (c.req.param("id").startsWith("dmgg-8hin")) {
      const d = (nombre_archivo: string, n: number) => ({ proceso: "x", n_mero_de_contrato: "C-1", nombre_archivo, extensi_n: "pdf", tamanno_archivo: String(n), fecha_carga: "2026-02-01T00:00:00.000", url_descarga_documento: `https://community.secop.gov.co/Public/Archive/RetrieveFile/Index?DocumentId=${n}` });
      return c.json([d("Contrato firmado.pdf", 101), d("Contrato firmado.pdf", 101), d("Estudio previo.pdf", 102)]);
    }
    if (!c.req.param("id").startsWith("jbjy-vk9h")) return c.json([]);
    // Lista de municipios (consulta $group=ciudad,departamento).
    if (c.req.query("$group") === "ciudad,departamento") return c.json(MOCK_PLACES.map(([ciudad, departamento]) => ({ ciudad, departamento, n: "10" })));
    const agg = (rs: Row[]) => (c.req.query("$select") ?? "").includes("sum(") ? aggregate(rs, c.req.query("$select")!, c.req.query("$group") ?? null) : rs;
    if (hit) return c.json(agg(rows(hit.name, hit.nit, 8)));
    if (/ALUMBRADO/i.test(where + (c.req.query("$q") ?? ""))) return c.json(rows("Alcaldía de Cali", "890399011", 3, "Mantenimiento de alumbrado público"));
    return c.json([]);
  });
  return app;
}
