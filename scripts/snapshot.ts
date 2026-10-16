// Genera server/fallback/snapshot.json.gz con agregados y contratos recientes de datos.gov.co (solo lectura).
// Uso: npm run snapshot   (con --env-file para DATOSGOV_APP_TOKEN, opcional)
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { DEPARTAMENTOS } from "../server/data/places.js";
import { COLUMNS, displayName, fetchRows, type Client } from "../server/data/socrata.js";
import { sanitize, type Snapshot, type Top } from "../server/fallback/snapshot.js";
import { TOPICS } from "../server/tools/filters.js";

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

/** Territorio -> condición SoQL: país, departamento o "departamento|municipio". */
function territory(key: string): string {
  if (key === "*") return "";
  const [dep, mun] = key.split("|");
  return ` AND departamento = '${esc(dep)}'${mun ? ` AND ciudad = '${esc(mun)}'` : ""}`;
}
const SELECT = COLUMNS.filter((c) => ["nombre_entidad", "proveedor_adjudicado", "objeto_del_contrato", "valor_del_contrato", "fecha_de_firma", "urlproceso", "ciudad", "departamento", "id_contrato"].includes(c)).join(",");
const plain = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? v : (v as { url?: string })?.url ?? ""])));

async function top(key: string): Promise<Top> {
  const where = `${recent}${territory(key)}`;
  const rank = async (col: string) => ((await q({ $select: `${col},sum(valor_del_contrato) as s,count(*) as n`, $where: `${where} AND ${col} IS NOT NULL`, $group: col, $order: "s DESC", $limit: "10" })) as Record<string, string>[])
    .map((r) => ({ name: displayName(r[col]), total: Math.round(Number(r.s) || 0), count: Number(r.n) || 0 }));
  const contratos = (await q({ $select: SELECT, $where: where, $order: "valor_del_contrato DESC", $limit: "10" })) as Record<string, unknown>[];
  return { contratistas: await rank("proveedor_adjudicado"), entidades: await rank("nombre_entidad"), contratos: plain(contratos) };
}

/** Los 10 contratos de mayor valor del último año sobre un tema frecuente (mismos términos que la herramienta en vivo). */
async function tema(key: string, terms: string): Promise<{ lista: Top["contratos"]; total: [number, number] }> {
  const like = terms.split("|").map((t) => `upper(objeto_del_contrato) like '%${esc(t)}%'`).join(" OR ");
  const where = `${recent}${territory(key)} AND (${like})`;
  const lista = plain((await q({ $select: SELECT, $where: where, $order: "valor_del_contrato DESC", $limit: "10" })) as Record<string, unknown>[]);
  const [t] = (await q({ $select: "sum(valor_del_contrato) as s,count(*) as n", $where: where })) as Record<string, string>[];
  return { lista, total: [Math.round(Number(t?.s) || 0), Number(t?.n) || 0] };
}

/** Corre `fn` sobre `items` con 4 consultas a la vez y tolera fallos sueltos (un territorio sin dato no tumba el respaldo). */
async function pool<T>(items: T[], fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (i < items.length) { const x = items[i++]; try { await fn(x); } catch (e) { console.warn("omitido", String(e).slice(0, 80)); } } }));
}

const agg = await aggregates();
const snapshot: Snapshot = { generatedAt: new Date().toISOString(), agg, top: {}, temas: {}, temaTotales: {} };
const deps = [...new Set([...DEPARTAMENTOS.map(([, d]) => d), ...agg.map((x) => x[0])])];
// Municipios con más contratos (los que la gente pregunta); el resto cae al departamento con aviso.
const nByMun = new Map<string, number>();
for (const [d, c, , , , n] of agg) nByMun.set(`${d}|${c}`, (nByMun.get(`${d}|${c}`) ?? 0) + n);
const muns = [...nByMun].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.SNAPSHOT_MUNICIPIOS ?? 80)).map(([k]) => k);
const keys = ["*", ...deps, ...muns];
await pool(keys, async (k) => { snapshot.top[k] = await top(k); });
await pool(keys.flatMap((k) => TOPICS.map(([, label, terms]) => [k, label, terms] as const)), async ([k, label, terms]) => {
  const { lista, total } = await tema(k, terms);
  if (lista.length) ((snapshot.temas ??= {})[k] ??= {})[label] = lista;
  if (total[1]) ((snapshot.temaTotales ??= {})[k] ??= {})[label] = total;
});
const gz = gzipSync(JSON.stringify(sanitize(snapshot)));
writeFileSync(new URL("../server/fallback/snapshot.json.gz", import.meta.url), gz);
console.log(JSON.stringify({ bytes: gz.length, agg: snapshot.agg.length, territorios: Object.keys(snapshot.top).length, conTemas: Object.keys(snapshot.temas ?? {}).length, generatedAt: snapshot.generatedAt }));