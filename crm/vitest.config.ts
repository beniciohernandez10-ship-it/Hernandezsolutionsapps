import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.ts"],
    environment: "node",
    // Always the in-memory database from global-setup, never whatever DATABASE_URL happens to be set.
    env: { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54329/postgres?sslmode=disable", APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), APP_ORIGIN: "https://crm.example.test" },
    globalSetup: ["tests/integration/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
