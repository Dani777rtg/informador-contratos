import { Hono } from "hono";
import { toEntity, type Entity, type Row } from "../data/socrata.js";

/** Índice pequeño de fixtures (en producción sale de data/entities.json). */
export const MOCK_ENTITIES: Entity[] = [
  toEntity("890399011", "Alcaldía de Cali"),
  toEntity("890900286", "Gobernación de Antioquia"),
  toEntity("890905211", "Alcaldía de Medellín"),
  toEntity("899999061", "Alcaldía de Bogotá"),
];

type Mode = "ok" | "slow" | "fail" | "empty";

function rows(entity: string, nit: string, n: number, object = "Prestación de servicios de apoyo a la gestión"): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    nombre_entidad: entity, nit_entidad: nit, proveedor_adjudicado: `Contratista Ejemplo ${i + 1} S.A.S.`,
    objeto_del_contrato: `${object} ${i + 1}`, valor_del_contrato: String((i + 1) * 123456789),
    fecha_de_firma: `2026-0${(i % 9) + 1}-15T00:00:00.000`, estado_contrato: i % 2 ? "Terminado" : "En ejecución",
    urlproceso: { url: `https://community.secop.gov.co/Public/Tools/gv_ViewContract?id=${nit}${i}` } as unknown as string,
    tipo_de_contrato: "Prestación de servicios", origen_de_los_recursos: i % 2 ? "Recursos propios" : "Presupuesto General",
    proceso_de_compra: `CO1.BDOS.${i + 1}`, departamento: "Valle del Cauca", ciudad: "Cali",
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
    if (mode === "fail") return c.json({ message: "mock failure" }, 500);
    if (mode === "slow") await new Promise((r) => setTimeout(r, 5000));
    if (mode === "empty") return c.json([]);
    const where = c.req.query("$where") ?? "";
    const hit = MOCK_ENTITIES.find((e) => where.includes(e.nit));
    if (hit) return c.json(rows(hit.name, hit.nit, 8));
    if (/ALUMBRADO/i.test(where)) return c.json(rows("Alcaldía de Cali", "890399011", 3, "Mantenimiento de alumbrado público"));
    return c.json([]);
  });
  return app;
}
