import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "tests/acceptance", testMatch: "**/*.spec.ts" });
