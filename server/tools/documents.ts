import { sanitizeFileName } from "../privacy/index.js";
import { normalize } from "../data/socrata.js";
import { safeLink } from "./safe-link.js";

type Row = Record<string, string>;
export interface Doc { name: string; type: string; size: string; uploadedAt: string; url: string; rel: string; kind?: string }

export const documentsDataset = (year?: number): string =>
  year === undefined || year >= 2025 ? "dmgg-8hin" : year === 2024 ? "nbae-kzan" : year === 2023 ? "3skv-9na7" : year === 2022 ? "kgcd-kt7i" : "f8va-cf4m";

const STOP = new Set(["el", "la", "los", "las", "de", "del", "un", "una", "documento", "documentos"]);
// Nombres propios (2+ palabras capitalizadas seguidas) solo se quitan si el archivo traía una cédula.
const cleanName = (raw: string): string => {
  const s = sanitizeFileName(raw);
  return /\d{6,}/.test(raw) ? s.replace(/(?:\b[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+ +){1,}[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?=\.\w+$|$)/, "").replace(/\s+/g, " ").replace(/^\.|^$/, "documento.") || "documento" : s;
};

export async function listDocuments(
  input: { processId: string; year?: number; request?: string },
  deps: { query(dataset: string, params: Record<string, unknown>): Promise<Row[]> },
): Promise<{ documents: Doc[]; processUrl: string; found: boolean; message?: string }> {
  const processUrl = `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=${encodeURIComponent(input.processId)}`;
  const params = { $where: `proceso = '${input.processId.replace(/'/g, "''")}'`, $limit: 100 };
  let rows = await deps.query(documentsDataset(input.year), params);
  // Sin filas: el proceso pudo cargarse en el dataset del año anterior.
  if (!rows.length && input.year !== undefined && documentsDataset(input.year - 1) !== documentsDataset(input.year)) {
    rows = await deps.query(documentsDataset(input.year - 1), params);
  }
  const seen = new Set<string>();
  let documents: (Doc & { match: string })[] = [];
  for (const r of rows) {
    // Datos reales: url_descarga_documento llega como {url: "..."}; los mocks lo envían como texto.
    const u: unknown = r.url_descarga_documento;
    const url = safeLink(u && typeof u === "object" ? (u as { url?: unknown }).url : u);
    const name = cleanName(r.nombre_archivo ?? "");
    if (!url || !r.nombre_archivo || seen.has(r.nombre_archivo + url)) continue;
    seen.add(r.nombre_archivo + url);
    documents.push({
      name, type: r.extensi_n || "desconocido", size: r.tamanno_archivo || "0", uploadedAt: r.fecha_carga || "desconocida",
      url, rel: "noopener noreferrer", match: normalize(`${r.nombre_archivo} ${r.descripci_n_documento ?? r.descripci_n ?? ""}`),
    });
  }
  const tokens = normalize(input.request ?? "").split(" ").filter((t) => t && !STOP.has(t)).map((t) => t.replace(/s$/, ""));
  if (tokens.length) documents = documents.filter((d) => tokens.every((t) => d.match.includes(t)));
  const out = documents.map(({ match, ...d }) => d);
  return out.length
    ? { documents: out, processUrl, found: true }
    : { documents: [], processUrl, found: false, message: "No encontré ese documento publicado en SECOP. Puedes revisar el proceso directamente en el enlace oficial." };
}