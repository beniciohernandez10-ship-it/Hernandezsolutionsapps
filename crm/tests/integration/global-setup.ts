import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

/** A throwaway real Postgres with the real migrations, on its own port. Never a real database. */
export default async function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "crm-test-pg-"));
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: 54329, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  const client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54329/postgres" });
  await client.connect();
  const migrations = path.resolve(import.meta.dirname, "../../prisma/migrations");
  for (const name of readdirSync(migrations).filter((n) => /^\d/.test(n)).sort()) {
    await client.query(readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
  }
  await client.end();
  return async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
