import type { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import { config } from "../config";

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  /** Executes a multi-statement script without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  /** Runs fn in a transaction as the owning role (system context). */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: "postgres" | "pglite";
}

class PgDatabase implements Database {
  readonly kind = "postgres" as const;
  constructor(private pool: Pool) {}

  async query<T extends Row>(sql: string, params: unknown[] = []) {
    const r = await this.pool.query(sql, params);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("begin");
      const tx: Queryable = {
        query: async <R extends Row>(sql: string, params: unknown[] = []) => {
          const r = await client.query(sql, params);
          return { rows: r.rows as R[], rowCount: r.rowCount ?? 0 };
        },
        exec: async (sql: string) => {
          await client.query(sql);
        },
      };
      const out = await fn(tx);
      await client.query("commit");
      return out;
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async exec(sql: string) {
    await this.pool.query(sql);
  }

  close() {
    return this.pool.end();
  }
}

class PgliteDatabase implements Database {
  readonly kind = "pglite" as const;
  constructor(private db: PGlite) {}

  async query<T extends Row>(sql: string, params: unknown[] = []) {
    const r = await this.db.query<T>(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  }

  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction(async (t) =>
      fn({
        query: async <R extends Row>(sql: string, params: unknown[] = []) => {
          const r = await t.query<R>(sql, params);
          return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
        },
        exec: async (sql: string) => {
          await t.exec(sql);
        },
      }),
    );
  }

  async exec(sql: string) {
    await this.db.exec(sql);
  }

  close() {
    return this.db.close();
  }
}

export async function openDatabase(url = config().databaseUrl, pgliteDir = config().pgliteDir): Promise<Database> {
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: url,
      max: config().dbPoolMax,
      // Hosted Postgres providers terminate TLS; verify certificates unless explicitly disabled for local use.
      ssl: config().databaseSsl ? { rejectUnauthorized: true } : undefined,
    });
    return new PgDatabase(pool);
  }
  if (config().isDeployed) {
    throw new Error("DATABASE_URL is required in deployed environments; local PGlite storage is not durable on Vercel.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  if (!pgliteDir.startsWith("memory://")) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(pgliteDir, { recursive: true });
  }
  return new PgliteDatabase(new PGlite(pgliteDir));
}

const globalForDb = globalThis as unknown as { __itcDb?: Promise<Database> };

/** Shared process-wide database handle. */
export function db(): Promise<Database> {
  globalForDb.__itcDb ??= openDatabase();
  return globalForDb.__itcDb;
}

/** Test hook: replace the shared handle. */
export function setDatabaseForTesting(database: Database | undefined) {
  globalForDb.__itcDb = database ? Promise.resolve(database) : undefined;
}

/**
 * Runs fn in a transaction as the restricted itc_app role with the user's id
 * bound, so PostgreSQL row-level security applies in addition to the
 * application's own authorisation checks.
 */
export async function withUser<T>(userId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const database = await db();
  return database.transaction(async (tx) => {
    await tx.query("set local role itc_app");
    await tx.query("select set_config('app.user_id', $1, true)", [userId]);
    return fn(tx);
  });
}

/** System-context transaction (owner role). Callers must authorise first. */
export async function asSystem<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const database = await db();
  return database.transaction(fn);
}
