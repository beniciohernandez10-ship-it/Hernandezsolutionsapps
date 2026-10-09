import { PGlite } from "@electric-sql/pglite";
import type { Database, Queryable } from "@/lib/db";
import { setDatabaseForTesting, asSystem } from "@/lib/db";
import { migrate } from "@/lib/db/migrate";
import { seedDemo } from "@/lib/db/seed";
import { loadPrincipal, type Principal } from "@/lib/authz";
import { setConfigForTesting } from "@/lib/config";

/** Fresh in-memory PostgreSQL (PGlite) with migrations and fictional demo data. */
export async function freshDatabase(): Promise<Database> {
  const pg = new PGlite();
  const wrap = (t: { query: PGlite["query"]; exec: PGlite["exec"] }): Queryable => ({
    query: async (sql: string, params: unknown[] = []) => {
      const r = await t.query<Record<string, unknown>>(sql, params);
      return { rows: r.rows as never[], rowCount: r.affectedRows ?? r.rows.length };
    },
    exec: async (sql: string) => {
      await t.exec(sql);
    },
  });
  const database: Database = {
    kind: "pglite",
    ...wrap(pg),
    transaction: (fn) => pg.transaction((t) => fn(wrap(t as never))),
    close: () => pg.close(),
  };
  await migrate(database);
  await seedDemo(database);
  setDatabaseForTesting(database);
  setConfigForTesting({ appOrigin: "http://localhost:3000", demoMode: true });
  return database;
}

export async function principal(userId: string): Promise<Principal> {
  const p = await asSystem((tx) => loadPrincipal(tx, userId));
  if (!p) throw new Error(`no principal ${userId}`);
  return p;
}

export async function expectAppError(promise: Promise<unknown>, status: number, code?: string) {
  try {
    await promise;
  } catch (err) {
    const e = err as { status?: number; code?: string; name?: string; issues?: unknown };
    if (e.name === "ZodError" && status === 422) return e;
    if (e.status !== status || (code && e.code !== code)) {
      throw new Error(`expected ${status}/${code ?? "*"} but got ${e.status}/${e.code}: ${(err as Error).message}`);
    }
    return e;
  }
  throw new Error(`expected error ${status} but call succeeded`);
}
