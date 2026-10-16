import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], exclude: ["**/*.spec.ts", "node_modules/**"] },
});
