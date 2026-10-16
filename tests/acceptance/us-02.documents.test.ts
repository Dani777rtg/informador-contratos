// US-02 Ver y abrir documentos del contrato. Locales, sin red: el dataset se inyecta como sustituto.
//
// Contrato asumido (el constructor lo implementa; ver informe de QA):
//   server/tools/safe-link.ts      export function safeLink(url: unknown): string | null
//   server/tools/documents.ts      export async function listDocuments(
//       input: { processId: string; year?: number; request?: string },
//       deps: { query(dataset: string, params: Record<string, unknown>): Promise<Record<string, string>[]> }
//     ): Promise<{ documents: { name: string; type: string; size: string; uploadedAt: string;
//                               url: string; rel: string; kind?: string }[];
//                  processUrl: string; found: boolean; message?: string }>
//   Columnas de fila (dmgg-8hin): nombre_archivo, extensi_n, tamanno_archivo, fecha_carga,
//   url_descarga_documento, descripci_n_documento.
import { describe, it, expect, vi } from "vitest";
import { safeLink } from "../../server/tools/safe-link";
import { listDocuments } from "../../server/tools/documents";

const row = (o: Record<string, string> = {}) => ({
  nombre_archivo: "Contrato firmado.pdf",
  extensi_n: "pdf",
  tamanno_archivo: "120",
  fecha_carga: "2025-03-01T00:00:00.000",
  url_descarga_documento: "https://community.secop.gov.co/Public/Archive/RetrieveFile/Index?DocumentId=1",
  descripci_n_documento: "contrato",
  ...o,
});
const deps = (rows: Record<string, string>[]) => ({ query: vi.fn(async () => rows) });
const PID = "CO1.PCCNTR.123456";

describe("AC-02.1 lista de documentos sin duplicados", () => {
  it("AC-02.1 lista campos requeridos y elimina duplicados", async () => {
    const d = deps([row(), row(), row({ nombre_archivo: "Estudio previo.pdf", url_descarga_documento: "https://community.secop.gov.co/x?DocumentId=2" })]);
    const r = await listDocuments({ processId: PID, year: 2025 }, d);
    expect(r.documents).toHaveLength(2);
    for (const doc of r.documents) {
      for (const k of ["name", "type", "size", "uploadedAt", "url"] as const) expect(doc[k]).toBeTruthy();
    }
  });

  it("AC-02.1 consulta el dataset de archivos dmgg-8hin para un proceso reciente", async () => {
    const d = deps([row()]);
    await listDocuments({ processId: PID, year: 2025 }, d);
    expect(d.query.mock.calls[0][0]).toBe("dmgg-8hin");
  });

  it("AC-02.1 usa un dataset distinto para un año histórico", async () => {
    const d = deps([row()]);
    await listDocuments({ processId: PID, year: 2012 }, d);
    expect(d.query.mock.calls[0][0]).not.toBe("dmgg-8hin");
  });
});

describe("AC-02.2 documento específico", () => {
  it("AC-02.2 entrega el enlace oficial del contrato firmado", async () => {
    const r = await listDocuments(
      { processId: PID, year: 2025, request: "el contrato firmado" },
      deps([row({ nombre_archivo: "Estudio previo.pdf", url_descarga_documento: "https://community.secop.gov.co/e" }), row()]),
    );
    expect(r.found).toBe(true);
    expect(r.documents[0].url).toBe(row().url_descarga_documento);
  });
});

describe("AC-02.3 documento no publicado", () => {
  it("AC-02.3 sin documentos: lo dice y da el enlace al proceso en SECOP", async () => {
    const r = await listDocuments({ processId: PID, year: 2025 }, deps([]));
    expect(r.found).toBe(false);
    expect(r.documents).toEqual([]);
    expect(r.message).toBeTruthy();
    expect(safeLink(r.processUrl)).toBe(r.processUrl);
  });

  it("AC-02.3 documento pedido que no existe: found=false y enlace al proceso", async () => {
    const r = await listDocuments({ processId: PID, year: 2025, request: "la póliza" }, deps([row()]));
    expect(r.found).toBe(false);
    expect(safeLink(r.processUrl)).toBe(r.processUrl);
  });
});

describe("AC-02.4 nombres sin PII, sin retransmitir archivo (NO-06, NO-14, TM-3)", () => {
  it("AC-02.4 quita cédulas y nombres de personas del nombre de archivo", async () => {
    const r = await listDocuments(
      { processId: PID, year: 2025 },
      deps([row({ nombre_archivo: "Cedula 1032456789 Juan Perez Gomez.pdf" })]),
    );
    const name = r.documents[0].name;
    expect(name).not.toMatch(/1032456789/);
    expect(name).not.toMatch(/Juan|Perez|Gomez/i);
  });

  it("AC-02.4 no descarga el archivo: solo consulta el dataset", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await listDocuments({ processId: PID, year: 2025 }, deps([row()]));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("AC-02.5 enlaces seguros (TM-12)", () => {
  it.each([
    "https://community.secop.gov.co/Public/x",
    "https://www.secop.gov.co/y",
    "https://colombiacompra.secop.gov.co/z",
  ])("AC-02.5 acepta %s", (u) => expect(safeLink(u)).toBe(u));

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "http://community.secop.gov.co/x",
    "https://evil.com/community.secop.gov.co",
    "https://secop.gov.co.evil.com/x",
    "https://evilsecop.gov.co/x",
    "https://community.secop.gov.co@evil.com/x",
    "//community.secop.gov.co/x",
    "",
    null,
    undefined,
  ])("AC-02.5 descarta %s", (u) => expect(safeLink(u as any)).toBeNull());

  it("AC-02.5 el resultado descarta enlaces ajenos y marca rel noopener noreferrer", async () => {
    const r = await listDocuments(
      { processId: PID, year: 2025 },
      deps([
        row({ nombre_archivo: "a.pdf", url_descarga_documento: "javascript:alert(1)" }),
        row({ nombre_archivo: "b.pdf", url_descarga_documento: "https://evil.com/b" }),
        row({ nombre_archivo: "c.pdf" }),
      ]),
    );
    for (const doc of r.documents) {
      if (doc.url) {
        expect(safeLink(doc.url)).toBe(doc.url);
        expect(doc.rel).toBe("noopener noreferrer");
      }
    }
    expect(r.documents.some((x) => /evil|javascript/.test(x.url ?? ""))).toBe(false);
  });
});
