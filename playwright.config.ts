import { defineConfig } from "@playwright/test";

const API = 8099, WEB = 5199;
process.env.BASE_URL ??= `http://localhost:${WEB}`;
process.env.API_URL = `http://localhost:${API}`;

export default defineConfig({
  testDir: "tests",
  testMatch: ["e2e/**/*.spec.ts", "acceptance/*.spec.ts"],
  workers: 1,
  webServer: [
    { command: "npx tsx server/index.ts", port: API, reuseExistingServer: false, timeout: 60_000,
      env: { PORT: String(API), MOCK_EXTERNALS: "1", ALLOWED_ORIGINS: `http://localhost:${WEB}` } },
    { command: `npx vite --config web/vite.config.ts --port ${WEB} --strictPort`, port: WEB, reuseExistingServer: false, timeout: 60_000,
      env: { VITE_API_URL: `http://localhost:${API}` } },
  ],
});

