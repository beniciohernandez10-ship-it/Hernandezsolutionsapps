/**
 * Runs the CRM on this machine with a throwaway Postgres in .data/ and no
 * connected accounts: `npm run dev:local`, then http://localhost:3100/setup
 * with the code "local-setup-token". Nothing here touches a real database.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const PORT = 54330;
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`;
const dir = path.resolve(".data/pg");

async function main() {
  const fresh = !existsSync(path.join(dir, "PG_VERSION"));
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: PORT, persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  if (fresh) await server.initialise();
  await server.start();

  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  await client.query('CREATE TABLE IF NOT EXISTS "_local_migrations" (name text PRIMARY KEY)');
  const migrations = path.resolve("prisma/migrations");
  for (const name of readdirSync(migrations).filter((n) => /^\d/.test(n)).sort()) {
    if ((await client.query('SELECT 1 FROM "_local_migrations" WHERE name = $1', [name])).rowCount) continue;
    await client.query(readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
    await client.query('INSERT INTO "_local_migrations" VALUES ($1)', [name]);
  }
  // No authenticator needed for a local throwaway.
  await client.query(`INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES ('security', '{"requireMfa": false}', now()) ON CONFLICT ("key") DO NOTHING`);
  await client.end();

  const env = {
    ...process.env,
    DATABASE_URL: URL,
    APP_ORIGIN: "http://localhost:3100",
    ALLOWED_HOSTS: "localhost:3100",
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    SETUP_TOKEN: "local-setup-token",
    CRON_SECRET: "local-cron-secret",
    WEBSITE_LEAD_SECRET: "local-website-secret",
  };
  const next = spawn("npx", ["next", "dev", "-p", "3100"], { stdio: "inherit", env, shell: true });
  const stop = async () => {
    next.kill();
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
