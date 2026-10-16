// Genera data/entities.json: entidades distintas por NIT. Uso: npm run build:entities
import { writeFileSync } from "node:fs";
import { DATASET } from "../server/data/socrata.js";

const base = process.env.SOCRATA_BASE ?? "https://www.datos.gov.co";
const token = process.env.DATOSGOV_APP_TOKEN;
// $group por NIT y nombre; solo columnas de entidad, nunca de personas.
const params = new URLSearchParams({
  $select: "nit_entidad,nombre_entidad,count(*) as n", $group: "nit_entidad,nombre_entidad",
  $order: "n DESC", $limit: "50000",
});
const res = await fetch(`${base}/resource/${DATASET}.json?${params}`, { headers: token ? { "X-App-Token": token } : {} });
if (!res.ok) throw new Error(`socrata ${res.status}`);
const rows = (await res.json()) as { nit_entidad?: string; nombre_entidad?: string }[];
const byNit = new Map<string, string>();
for (const r of rows) if (r.nit_entidad && r.nombre_entidad && !byNit.has(r.nit_entidad)) byNit.set(r.nit_entidad, r.nombre_entidad.trim());
const out = [...byNit].map(([nit, name]) => ({ nit, name }));
writeFileSync("data/entities.json", JSON.stringify(out));
console.log(`${out.length} entidades`);
