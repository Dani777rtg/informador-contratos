// Genera server/fallback/snapshot.json.gz con agregados y contratos recientes de datos.gov.co (solo lectura).
// Uso: npm run snapshot   (con --env-file para DATOSGOV_APP_TOKEN, opcional)
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { DEPARTAMENTOS } from "../server/data/places.js";
import { COLUMNS, displayName, fetchRows, type Client } from "../server/data/socrata.js";
import { sanitize, type Snapshot, type Top } from "../server/fallback/snapshot.js";

const client: Client = { base: process.env.SOCRATA_BASE ?? "https://www.datos.gov.co", token: process.env.DATOSGOV_APP_TOKEN, timeoutMs: 120_000 };
const FROM_YEAR = new Date().getFullYear() - 3;
const since = new Date(); since.setFullYear(since.getFullYear() - 1);
const recent = `fecha_de_firma >= '${since.toISOString().slice(0, 10)}T00:00:00'`;
const q = (p: Record<string, string>) => fetchRows(client, new URLSearchParams(p));
const esc = (s: string) => s.replace(/'/g, "''");

async function aggregates(): Promise<Snapshot["agg"]> {
  const out: Snapshot["agg"] = [];
  for (let offset = 0; ; offset += 50_000) {
    const rows = await q({
      $select: "departamento,ciudad,date_extract_y(fecha_de_firma) as y,tipo_de_contrato,sum(valor_del_contrato) as s,count(*) as n",
      $where: `fecha_de_firma >= '${FROM_YEAR}-01-01T00:00:00' AND departamento IS NOT NULL AND ciudad IS NOT NULL`,
      $group: "departamento,ciudad,y,tipo_de_contrato", $order: "departamento,ciudad,y,tipo_de_contrato", $limit: "50000", $offset: String(offset),
    });
    for (const r of rows as Record<string, string>[]) out.push([r.departamento, r.ciudad, Number(r.y), r.tipo_de_contrato ?? "", Math.round(Number(r.s) || 0), Number(r.n) || 0]);
    if (rows.length < 50_000) return out;
  }
}

async function top(dep?: string): Promise<Top> {
  const where = `${recent}${dep ? ` AND departamento = '${esc(dep)}'` : ""}`;
  const rank = async (col: string) => ((await q({ $select: `${col},sum(valor_del_contrato) as s,count(*) as n`, $where: `${where} AND ${col} IS NOT NULL`, $group: col, $order: "s DESC", $limit: "10" })) as Record<string, string>[])
    .map((r) => ({ name: displayName(r[col]), total: Math.round(Number(r.s) || 0), count: Number(r.n) || 0 }));
  const select = COLUMNS.filter((c) => ["nombre_entidad", "proveedor_adjudicado", "objeto_del_contrato", "valor_del_contrato", "fecha_de_firma", "urlproceso", "ciudad", "departamento", "id_contrato"].includes(c)).join(",");
  const contratos = (await q({ $select: select, $where: where, $order: "valor_del_contrato DESC", $limit: "10" })) as Record<string, unknown>[];
  return {
    contratistas: await rank("proveedor_adjudicado"), entidades: await rank("nombre_entidad"),
    contratos: contratos.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? v : (v as { url?: string })?.url ?? ""]))),
  };
}

const snapshot: Snapshot = { generatedAt: new Date().toISOString(), agg: await aggregates(), top: { "*": await top() } };
for (const [, dep] of DEPARTAMENTOS) snapshot.top[dep] = await top(dep);
for (const dep of new Set(snapshot.agg.map((x) => x[0]))) snapshot.top[dep] ??= await top(dep);
const gz = gzipSync(JSON.stringify(sanitize(snapshot)));
writeFileSync(new URL("../server/fallback/snapshot.json.gz", import.meta.url), gz);
console.log(JSON.stringify({ bytes: gz.length, agg: snapshot.agg.length, departamentos: Object.keys(snapshot.top).length, generatedAt: snapshot.generatedAt }));
