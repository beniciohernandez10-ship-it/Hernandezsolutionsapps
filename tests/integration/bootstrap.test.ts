import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Queryable } from "@/lib/db";
import { migrate } from "@/lib/db/migrate";
import { bootstrapFromEnv, bootstrapHomeCustomer, bootstrapOperator } from "@/lib/admin/bootstrap";

let db: Database;
beforeAll(async () => {
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
  db = { kind: "pglite", ...wrap(pg), transaction: (fn) => pg.transaction((t) => fn(wrap(t as never))), close: () => pg.close() };
  await migrate(db);
});

describe("operator bootstrap", () => {
  const env = (o: Record<string, string> = {}) => ({
    BOOTSTRAP_HS_TENANT_ID: randomUUID(),
    BOOTSTRAP_OPERATOR_OBJECT_ID: randomUUID(),
    BOOTSTRAP_OPERATOR_EMAIL: "Admin@Example.onmicrosoft.com",
    BOOTSTRAP_OPERATOR_NAME: "First Admin",
    ...o,
  });

  it("does nothing without variables and rejects partial ones", () => {
    expect(bootstrapFromEnv({})).toBeNull();
    expect(() => bootstrapFromEnv({ BOOTSTRAP_HS_TENANT_ID: randomUUID() })).toThrow();
  });

  it("creates the home directory and first operator once, then never again", async () => {
    const first = bootstrapFromEnv(env())!;
    expect(await bootstrapOperator(db, first)).toBe("created");
    const u = await db.query<{ email: string; is_platform_operator: boolean }>("select email, is_platform_operator from users where not is_system");
    expect(u.rows).toEqual([{ email: "admin@example.onmicrosoft.com", is_platform_operator: true }]);
    const d = await db.query("select kind from entra_directories where tenant_id = $1", [first.tenantId]);
    expect(d.rows[0].kind).toBe("msp");
    const i = await db.query("select object_id from user_identities");
    expect(i.rows[0].object_id).toBe(first.objectId);
    // A second run (or a different person) cannot add another operator.
    expect(await bootstrapOperator(db, bootstrapFromEnv(env({ BOOTSTRAP_OPERATOR_EMAIL: "attacker@example.com" }))!)).toBe("skipped");
    expect((await db.query("select count(*)::int as n from users where not is_system")).rows[0].n).toBe(1);
  });

  it("creates the home customer with the operator as service manager, once", async () => {
    expect(await bootstrapHomeCustomer(db, "Hernandez Solutions")).toBe("created");
    const m = await db.query<{ role: string; name: string }>(
      "select m.role, c.name from memberships m join customers c on c.id = m.customer_id join users u on u.id = m.user_id where u.is_platform_operator",
    );
    expect(m.rows).toEqual([{ role: "service_manager", name: "Hernandez Solutions" }]);
    expect(await bootstrapHomeCustomer(db, "Hernandez Solutions")).toBe("exists");
    expect((await db.query("select count(*)::int as n from memberships")).rows[0].n).toBe(1);
  });
});
