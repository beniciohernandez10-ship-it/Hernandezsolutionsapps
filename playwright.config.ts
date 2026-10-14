import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const env = `APP_ORIGIN=http://localhost:${PORT} PGLITE_DATA_DIR=.data/e2e DEMO_MODE=true ITC_LOG_SILENT=true`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `rm -rf .data/e2e && ${env} npx tsx scripts/migrate.ts && ${env} npx tsx scripts/seed.ts && npx next build && ${env} npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
