import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./index";

export const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

/**
 * Applies pending SQL migrations in filename order, each in its own
 * transaction. Run explicitly (npm run db:migrate or a deployment step), never
 * during request handling.
 */
export async function migrate(database: Database, dir = MIGRATIONS_DIR, log: (m: string) => void = () => {}) {
  await database.exec(`create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Set(
    (await database.query<{ version: string }>("select version from schema_migrations")).rows.map((r) => r.version),
  );
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await database.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into schema_migrations (version) values ($1)", [file]);
    });
    log(`applied ${file}`);
    ran.push(file);
  }
  return ran;
}
