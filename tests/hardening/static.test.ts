import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { createApp } from "../../server/index";

mkdirSync("web/dist/assets", { recursive: true });
writeFileSync("web/dist/index.html", "<!doctype html><title>t</title>");
writeFileSync("web/dist/assets/a.js", "1");
const { app } = createApp({ MOCK_EXTERNALS: "1", HMAC_SECRET: "s".repeat(32) });

describe("estáticos", () => {
  it("/ sirve index.html sin caché larga", async () => {
    const r = await app.request("/");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<title>t</title>");
    expect(r.headers.get("cache-control")).toBe("no-cache");
  });
  it("/assets con caché inmutable", async () => {
    expect((await app.request("/assets/a.js")).headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
  it("/health y /api siguen en JSON", async () => {
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
    const r = await app.request("/api/chat", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(r.headers.get("content-type")).toContain("json");
  });
});
