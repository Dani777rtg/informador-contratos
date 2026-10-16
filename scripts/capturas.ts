// Toma las capturas de docs/capturas con backend mock (MOCK_EXTERNALS=1) y Vite local.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const API = 8099, WEB = 5199;
const procs: ChildProcess[] = [];
const run = (cmd: string, env: Record<string, string>): void => {
  procs.push(spawn(cmd, { shell: true, stdio: "ignore", env: { ...process.env, ...env } }));
};
const kill = (): void => procs.forEach((p) => p.pid && spawn("taskkill", ["/pid", String(p.pid), "/t", "/f"], { stdio: "ignore" }));
async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no responde: ${url}`);
}

const views = { movil: { width: 390, height: 844 }, escritorio: { width: 1366, height: 768 } };
const Q = "¿Qué contratos tiene la Gobernación de Antioquia?";

try {
  mkdirSync("docs/capturas", { recursive: true });
  run("npx tsx server/index.ts", { PORT: String(API), MOCK_EXTERNALS: "1", ALLOWED_ORIGINS: `http://localhost:${WEB}` });
  run(`npx vite --config web/vite.config.ts --port ${WEB} --strictPort`, { VITE_API_URL: `http://localhost:${API}` });
  await waitFor(`http://localhost:${API}/`);
  await waitFor(`http://localhost:${WEB}/`);
  const browser = await chromium.launch();
  for (const [name, viewport] of Object.entries(views)) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(() => localStorage.setItem("privacy-accepted", "1"));
    const page = await ctx.newPage();
    const shot = (n: string) => page.screenshot({ path: `docs/capturas/${n}-${name}.png` });
    // El backend no emite CORS: el navegador de captura lo añade (solo en este script).
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
    const fresh = async () => {
      await page.unroute("**/api/chat");
      await page.route("**/api/chat", async (r) => {
        if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
        const res = await r.fetch();
        await r.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
      });
      await page.goto(`http://localhost:${WEB}/`);
    };
    const ask = async () => { await page.fill("#q", Q); await page.click("button[type=submit]"); };

    await fresh(); await shot("1-vacio");
    await fresh(); await page.route("**/api/chat", (r) => r.request().method() === "OPTIONS" ? r.fulfill({ status: 204, headers: cors }) : undefined); // POST queda colgado
    await ask(); await page.waitForSelector("#status:not(:empty)"); await shot("2-cargando");
    await fresh(); await ask(); await page.waitForSelector("#answer *"); await shot("3-resultado");
    await fresh(); // con "Antioquia" el mock devuelve resultados; para "sin resultados" se fuerza la respuesta
    await page.route("**/api/chat", (r) => r.request().method() === "OPTIONS" ? r.fulfill({ status: 204, headers: cors })
      : r.fulfill({ json: { text: "No encontré contratos con esos criterios.", cards: [], state: "s" }, headers: cors }));
    await ask(); await page.waitForSelector("#answer *"); await shot("4-sin-resultados");
    await fresh(); await page.route("**/api/chat", (r) => r.request().method() === "OPTIONS" ? r.fulfill({ status: 204, headers: cors }) : r.abort());
    await ask(); await page.waitForSelector("#status.error"); await shot("5-error");
    await fresh(); await page.click("#mic"); await shot("6-voz-activa"); // estado visual, sin micrófono real
    await ctx.close();
  }
  await browser.close();
} finally { kill(); }
