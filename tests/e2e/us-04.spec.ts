// US-04 E2E: backend local MOCK_EXTERNALS=1 + Vite (ver playwright.config.ts). axe-core inyectado.
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const base = process.env.BASE_URL!;
const Q = "¿Qué contratos tiene la Gobernación de Antioquia?";
const views = { movil: { width: 390, height: 844 }, escritorio: { width: 1366, height: 768 } };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
const empty = { text: "No encontré contratos con esos criterios.", cards: [], state: "s" };

async function open(page: Page) {
  await page.addInitScript(() => localStorage.setItem("privacy-accepted", "1"));
  await page.goto(base);
}
const ask = async (page: Page, q = Q) => { await page.fill("#q", q); await page.click("button[type=submit]"); };
async function axe(page: Page) {
  await page.addScriptTag({ path: axePath });
  const v = await page.evaluate(async () => {
    // @ts-expect-error axe se inyecta
    const r = await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] });
    return r.violations.map((x: { id: string; nodes: { html: string }[] }) => `${x.id}: ${x.nodes.map((n) => n.html).join(" | ")}`);
  });
  expect(v).toEqual([]);
}
// El POST se responde a mano; el preflight CORS lo contesta el backend real.
const fulfillPost = (page: Page, json: unknown) =>
  page.route("**/api/chat", (r) => r.request().method() === "POST" ? r.fulfill({ json, headers: cors }) : r.fallback());

test("AC-04.2 respuesta corta + tarjetas, detalle a demanda, sugerencias tocables", async ({ page }) => {
  await open(page);
  await ask(page);
  await expect(page.locator("#answer > p").first()).toBeVisible();
  const items = page.locator("#answer ul:not(.chips) > li");
  await expect(items.first()).toBeVisible();
  expect(await items.locator(":scope:visible").count()).toBeLessThanOrEqual(5);
  const details = page.locator("#answer details");
  await expect(details).toHaveJSProperty("open", false);
  await details.locator("summary").click();
  await expect(details).toHaveJSProperty("open", true);
  const chips = page.locator("#answer .chips button");
  const n = await chips.count();
  expect(n).toBeGreaterThanOrEqual(2);
  expect(n).toBeLessThanOrEqual(3);
  const req = page.waitForRequest((r) => r.url().includes("/api/chat") && r.method() === "POST");
  await chips.first().click();
  await req;
});

test("AC-04.2 más de 5 resultados: 5 visibles y 'Ver más' los revela", async ({ page }) => {
  await open(page);
  const cards = Array.from({ length: 8 }, (_, i) => ({ kind: "top", rank: i + 1, name: `Entidad ${i + 1}`, value: "$1" }));
  await fulfillPost(page, { text: "Hay ocho.", cards, state: "s" });
  await ask(page);
  const items = page.locator("#answer ul:not(.chips) > li");
  await expect(items.locator(":scope:visible")).toHaveCount(5);
  await page.getByRole("button", { name: "Ver más" }).click();
  await expect(items.locator(":scope:visible")).toHaveCount(8);
});

test("AC-04.3 'Buscando en SECOP…' al cargar, error de una frase, sin resultados con sugerencia", async ({ page }) => {
  await open(page);
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  await page.route("**/api/chat", async (r) => { await gate; await r.fallback(); });
  await ask(page);
  await expect(page.locator("#status")).toHaveText("Buscando en SECOP…");
  release();
  await expect(page.locator("#status")).toHaveText("");

  await page.unroute("**/api/chat");
  await page.route("**/api/chat", (r) => r.request().method() === "POST" ? r.abort() : r.fallback());
  await ask(page);
  const err = page.locator("#status.error");
  await expect(err).toHaveText("No pude consultar ahora; intenta de nuevo en un momento.");
  expect((await err.textContent())!.split(/[.!?]/).filter((s) => s.trim()).length).toBe(1);

  await page.unroute("**/api/chat");
  await fulfillPost(page, empty);
  await ask(page);
  await expect(page.locator("#answer")).toContainText("No encontré");
  expect(await page.locator("#answer .chips button").count()).toBeGreaterThanOrEqual(2);
});

for (const [name, viewport] of Object.entries(views)) {
  test.describe(`AC-04.5 axe WCAG A/AA ${name}`, () => {
    test.use({ viewport });
    test("vacío", async ({ page }) => { await open(page); await axe(page); });
    test("cargando", async ({ page }) => {
      await open(page);
      await page.route("**/api/chat", (r) => r.request().method() === "POST" ? new Promise(() => {}) : r.fallback());
      await ask(page);
      await expect(page.locator("#status")).toHaveText("Buscando en SECOP…");
      await axe(page);
    });
    test("resultado", async ({ page }) => {
      await open(page); await ask(page);
      await expect(page.locator("#answer .chips")).toBeVisible();
      await axe(page);
    });
    test("sin resultados", async ({ page }) => {
      await open(page);
      await fulfillPost(page, empty);
      await ask(page);
      await expect(page.locator("#answer")).toContainText("No encontré");
      await axe(page);
    });
    test("error", async ({ page }) => {
      await open(page);
      await page.route("**/api/chat", (r) => r.request().method() === "POST" ? r.abort() : r.fallback());
      await ask(page);
      await expect(page.locator("#status.error")).toBeVisible();
      await axe(page);
    });
    test("voz activa", async ({ page }) => {
      await open(page);
      await page.click("#mic");
      await axe(page);
    });
  });
}
