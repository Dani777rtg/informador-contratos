// US-09: static checks only. Nothing here runs gcloud or touches the cloud.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const exists = (p: string) => existsSync(join(root, p));

const FORBIDDEN = ["ourtalent-509101", "agente-vocal-hackaton", "app-507617", "reemplazarrhh"];
const BILLING = "01EE60-CCE2B7-BE4593";

function lines(file: string) {
  return read(file).split(/\r?\n/);
}
// Non-comment lines of a PowerShell script.
const code = (file: string) => lines(file).filter((l) => !/^\s*#/.test(l)).join("\n");

describe("US-09 AC-09.1 proyecto GCP nuevo y dedicado", () => {
  it("AC-09.1 gcp-setup.ps1 existe y vincula la cuenta de facturacion indicada", () => {
    expect(exists("scripts/gcp-setup.ps1")).toBe(true);
    const c = code("scripts/gcp-setup.ps1");
    expect(c).toContain(BILLING);
    expect(c).toMatch(/billing\s+projects\s+link/);
  });

  it("AC-09.1 crea un proyecto y no reutiliza el ID eliminado informador-contratos-1015", () => {
    const c = code("scripts/gcp-setup.ps1");
    expect(c).toMatch(/projects\s+create/);
    expect(c).not.toContain("informador-contratos-1015");
  });

  it("AC-09.1 ningun script de scripts/ ni docs de despliegue usa proyectos prohibidos", () => {
    const files = ["scripts/gcp-setup.ps1", "scripts/deploy.ps1"];
    for (const f of files) {
      expect(exists(f), f).toBe(true);
      const c = code(f);
      for (const p of FORBIDDEN) expect(c, `${f} menciona ${p}`).not.toContain(p);
    }
  });

  it("AC-09.1 cada comando gcloud de deploy.ps1 fija el proyecto explicitamente", () => {
    const cmds = lines("scripts/deploy.ps1").filter(
      (l) => !/^\s*#/.test(l) && /\bgcloud\b\s+\S+/.test(l),
    );
    expect(cmds.length).toBeGreaterThan(0);
    for (const l of cmds) expect(l, l).toMatch(/--project|-P\b|\$Project|\$env:/i);
  });

  it("AC-09.1 no cambia el proyecto activo global de gcloud", () => {
    for (const f of ["scripts/gcp-setup.ps1", "scripts/deploy.ps1"]) {
      expect(code(f)).not.toMatch(/gcloud\s+config\s+set\s+project/);
    }
  });
});

describe("US-09 AC-09.2 frontend y backend en un solo servicio Cloud Run", () => {
  it("AC-09.2 deploy.ps1 despliega Cloud Run con min-instances=0, max acotado, cpu boost y timeout 60 min", () => {
    const c = code("scripts/deploy.ps1");
    expect(c).toMatch(/run\s+deploy/);
    expect(c).toMatch(/--min-instances[ =]0\b/);
    expect(c).toMatch(/--max-instances[ =]\d+/);
    expect(c).toMatch(/--cpu-boost/);
    expect(c).toMatch(/--timeout[ =](3600|60m)\b/);
  });

  it("AC-09.2 el servicio es publico por HTTPS (allow-unauthenticated)", () => {
    expect(code("scripts/deploy.ps1")).toMatch(/--allow-unauthenticated/);
  });

  it("AC-09.2 el Dockerfile construye el frontend y copia web/dist a la imagen", () => {
    const f = exists("Dockerfile") ? "Dockerfile" : "server/Dockerfile";
    expect(exists(f)).toBe(true);
    const d = read(f);
    expect(d).toMatch(/build:web|vite\s+build/);
    expect(d).toMatch(/COPY[^\n]*web\/dist|web\/dist/);
  });

  it("AC-09.2 server/index.ts sirve los estaticos de web/dist en /", () => {
    const s = read("server/index.ts");
    expect(s).toMatch(/serveStatic|express\.static|fastifyStatic|@fastify\/static/);
    expect(s).toMatch(/web[/\\'",\s]+dist|web\/dist/);
  });

  it("AC-09.2 deploy.ps1 ya no usa Firebase y no hay firebase.json", () => {
    expect(code("scripts/deploy.ps1")).not.toMatch(/firebase/i);
    expect(exists("firebase.json")).toBe(false);
  });
});

describe("US-09 AC-09.3 precalentamiento", () => {
  it("AC-09.3 web/src/warmup.ts existe y hace una peticion ligera a /health", () => {
    expect(exists("web/src/warmup.ts")).toBe(true);
    const w = read("web/src/warmup.ts");
    expect(w).toMatch(/fetch\(/);
    expect(w).toContain("/health");
  });

  it("AC-09.3 el precalentamiento se dispara al abrir la pagina y al tocar el microfono", () => {
    const w = read("web/src/warmup.ts");
    expect(w).toMatch(/export/);
    // Se usa desde algun otro archivo de web/src (carga y microfono).
    const srcDir = join(root, "web", "src");
    const used: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|jsx|html|vue|svelte)$/.test(n) && !/warmup\.ts$/.test(n) && /warmup/i.test(readFileSync(p, "utf8")))
          used.push(p);
      }
    };
    walk(srcDir);
    expect(used.length).toBeGreaterThan(0);
  });
});

describe("US-09 AC-09.4 presupuesto y costos", () => {
  it("AC-09.4 gcp-setup.ps1 crea una alerta de presupuesto", () => {
    expect(code("scripts/gcp-setup.ps1")).toMatch(/billing\s+budgets\s+create/);
  });

  it("AC-09.4 docs/COSTOS.md da costo en reposo y por cada 1.000 preguntas", () => {
    expect(exists("docs/COSTOS.md")).toBe(true);
    const d = read("docs/COSTOS.md");
    expect(d).toMatch(/reposo/i);
    expect(d).toMatch(/1\.?000\s+preguntas/i);
    expect(d).toMatch(/\$|USD/);
  });
});

describe("US-09 AC-09.5 region por latencia", () => {
  it("AC-09.5 la documentacion compara us-east1 y southamerica-east1 con mediciones y decision", () => {
    const d = (exists("docs/COSTOS.md") ? read("docs/COSTOS.md") : "") + (exists("docs/DEPLOY.md") ? read("docs/DEPLOY.md") : "");
    expect(d).toContain("us-east1");
    expect(d).toContain("southamerica-east1");
    expect(d).toMatch(/\bms\b/);
    expect(d).toMatch(/decisi[oó]n/i);
  });

  it("AC-09.5 la region usada en deploy.ps1 es una de las dos evaluadas", () => {
    expect(code("scripts/deploy.ps1")).toMatch(/us-east1|southamerica-east1/);
  });
});

describe("US-09 AC-09.6 produccion con aprobacion y rollback", () => {
  it("AC-09.6 deploy.ps1 exige confirmacion explicita antes de produccion", () => {
    expect(code("scripts/deploy.ps1")).toMatch(/Read-Host|-Confirm|\$Approve|-Approved|ShouldProcess/i);
  });

  it("AC-09.6 docs/DEPLOY.md documenta la revision previa y el rollback a la revision anterior", () => {
    expect(exists("docs/DEPLOY.md")).toBe(true);
    const d = read("docs/DEPLOY.md");
    expect(d).toMatch(/rollback/i);
    expect(d).toMatch(/update-traffic|--to-revisions|revisi[oó]n anterior/i);
    expect(d).toMatch(/aprobaci[oó]n/i);
  });
});
