import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    // Unit tests never query the database; modules that import the client only need a URL to load.
    env: { DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://unused:unused@localhost:5432/unused" },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
