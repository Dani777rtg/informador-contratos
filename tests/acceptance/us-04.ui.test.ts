// @vitest-environment jsdom
// US-04 Interfaz GOV.CO. Estático sobre web/index.html + web/styles; sin red.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const css = () => {
  const d = join(root, "web/styles");
  return existsSync(d)
    ? readdirSync(d).filter((f) => f.endsWith(".css")).map((f) => read("web/styles/" + f)).join("\n")
    : "";
};
const name = (el: Element) =>
  (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
const buttons = () => [...document.querySelectorAll("button, [role=button]")];

beforeAll(() => {
  const parsed = new DOMParser().parseFromString(read("web/index.html"), "text/html");
  for (const a of [...parsed.documentElement.attributes]) document.documentElement.setAttribute(a.name, a.value);
  document.documentElement.innerHTML = parsed.documentElement.innerHTML;
});

describe("US-04", () => {
  it("AC-04.1 saludo, campo, micrófono, 3-4 ejemplos y avisos", () => {
    expect(document.querySelector("h1")?.textContent?.trim()).toBeTruthy();
    expect(document.querySelectorAll("input[type=text], input:not([type]), input[type=search], textarea").length).toBe(1);
    expect(buttons().filter((b) => /micr[óo]fono|hablar/i.test(name(b))).length).toBeGreaterThanOrEqual(1);
    const examples = buttons().filter((b) => /\?\s*$/.test(name(b)));
    expect(examples.length).toBeGreaterThanOrEqual(3);
    expect(examples.length).toBeLessThanOrEqual(4);
    const text = document.body.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("Prototipo — no es un servicio oficial del Estado");
    expect(text).toMatch(/inteligencia artificial/i);
  });

  it.todo("AC-04.2 respuesta en capas (necesita app corriendo: E2E Playwright con mocks)");
  it.todo("AC-04.3 estados y errores de una frase (E2E con mocks)");

  it("AC-04.3 existe región de estado anunciada a lectores de pantalla", () => {
    expect(document.querySelector("[role=status], [aria-live]")).not.toBeNull();
  });

  it("AC-04.4 móvil primero y objetivos táctiles de 44 px", () => {
    expect(document.querySelector('meta[name=viewport]')?.getAttribute("content")).toMatch(/width=device-width/);
    expect(css()).toMatch(/44px/);
  });

  it("AC-04.5 axe: 0 violaciones WCAG A/AA en estado vacío", async () => {
    const axe = (await import("axe-core")).default;
    const r = await axe.run(document.documentElement, {
      runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      rules: { "color-contrast": { enabled: false } }, // jsdom no calcula estilos
    });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  it.todo("AC-04.5 axe en cargando, resultado, sin resultados, error y voz (E2E, móvil y escritorio)");

  it("AC-04.6 Verdana, encabezado, pie, sin logos oficiales y DESIGN.md", () => {
    expect(css()).toMatch(/verdana/i);
    expect(document.querySelector("header, [role=banner]")).not.toBeNull();
    expect(document.querySelector("footer, [role=contentinfo]")).not.toBeNull();
    for (const img of document.querySelectorAll("img"))
      expect(img.getAttribute("src") ?? "").not.toMatch(/escudo|sello|logo/i);
    expect(existsSync(join(root, "docs/DESIGN.md"))).toBe(true);
  });

  it("AC-04.7 un solo control de micrófono, silenciar/interrumpir y subtítulos", () => {
    const mics = buttons().filter((b) => /micr[óo]fono/i.test(name(b)));
    expect(mics.length).toBe(1);
    expect(buttons().some((b) => /silenciar|interrumpir|callar/i.test(name(b)))).toBe(true);
    expect(document.querySelector("[aria-live]")).not.toBeNull();
  });
});
