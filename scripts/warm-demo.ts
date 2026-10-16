// Precalcula las respuestas del demo contra datos.gov.co (solo lectura) y las guarda en server/fallback/demo-answers.json.
// Uso: npm run warm:demo   (con --env-file para DATOSGOV_APP_TOKEN, opcional)
import { readFileSync, writeFileSync } from "node:fs";
import { resolveEntity, toEntity, type Client, type Cond } from "../server/data/socrata.js";
import { Lru } from "../server/cache.js";
import { contractCard, MAX_VISIBLE, searchContracts, type Ctx } from "../server/tools/search.js";
import { fundingBreakdown, spendByCategory, topContracts } from "../server/tools/spend.js";
import { demoKey, type DemoEntry, type DemoKind } from "../server/fallback/demo.js";

const client: Client = { base: process.env.SOCRATA_BASE ?? "https://www.datos.gov.co", token: process.env.DATOSGOV_APP_TOKEN, timeoutMs: 30_000 };
const ctx: Ctx = { client, cache: new Lru() };
const entities = (JSON.parse(readFileSync("data/entities.json", "utf8")) as { nit: string; name: string }[]).map((e) => toEntity(e.nit, e.name));
const day = (d: Date) => d.toISOString().slice(0, 10);

// Preguntas de docs/DEMO.md (mismo flujo de /api/chat). tema: [término $q, departamento].
const SCENES: { ask?: string; nit?: string; tema?: [string, string]; kind: DemoKind; year?: string }[] = [
  { ask: "Gobernación de Antioquia", kind: "spend", year: "2025" },
  { ask: "Gobernación de Antioquia", kind: "contracts", year: "2024" },
  { nit: "890399011", kind: "contracts" },
  { tema: ["alimentacion escolar", "Boyacá"], kind: "contracts" },
  { ask: "Ministerio de Educación", kind: "spend" },
  { ask: "Alcaldía de Cali", kind: "top" },
];
const tools = { spend: spendByCategory, top: topContracts, funding: fundingBreakdown };

const out: Record<string, DemoEntry> = {};
for (const s of SCENES) {
  const now = new Date(), from = new Date(now); from.setFullYear(from.getFullYear() - 1);
  const period = s.year ? { from: `${s.year}-01-01`, to: `${s.year}-12-31` } : { from: day(from), to: day(now), defaulted: true };
  const where: Cond[] = [];
  let label: string;
  if (s.tema) {
    where.push({ col: "objeto_del_contrato", op: "q", value: s.tema[0] }, { col: "departamento", op: "=", value: s.tema[1] });
    label = `${s.tema[0]} en ${s.tema[1]}`;
  } else {
    const r = s.nit ? undefined : resolveEntity(s.ask!, entities);
    if (!s.nit && r?.kind !== "entity") throw new Error(`entidad no resuelta: ${s.ask}`);
    const e = r?.kind === "entity" ? r.entity : undefined;
    where.push({ col: "nit_entidad", op: "=", value: e?.nit ?? s.nit! });
    label = e?.name ?? `NIT ${s.nit}`;
  }
  where.push({ col: "fecha_de_firma", op: ">=", value: `${period.from}T00:00:00` });
  if (!period.defaulted) where.push({ col: "fecha_de_firma", op: "<=", value: `${period.to}T23:59:59` });
  const cards = s.kind === "contracts"
    ? (await searchContracts(ctx, where)).value.slice(0, MAX_VISIBLE).map(contractCard)
    : (await tools[s.kind as keyof typeof tools](ctx, where)).cards;
  const k = demoKey(where, s.kind, period);
  if (!cards.length) { console.warn(`sin datos: ${k}`); continue; }
  const at = new Date().toISOString();
  out[k] = { queriedAt: at, updatedAt: at, label: `${label} (${s.year ?? "últimos 12 meses"})`, cards };
  console.log(`${k}: ${cards.length} tarjetas`);
}
writeFileSync("server/fallback/demo-answers.json", JSON.stringify(out, null, 2) + "\n");
