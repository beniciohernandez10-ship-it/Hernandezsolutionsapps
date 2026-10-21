import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDatabase, principal, expectAppError } from "../helpers";
import { DEMO } from "@/lib/db/seed";
import { asSystem, type Database, type Queryable } from "@/lib/db";
import { migrate } from "@/lib/db/migrate";
import { auditStatus, checkAuditNow, setAuditStoreForTesting, shipAuditEvents, verifyAuditStore } from "@/lib/audit/store";

const U = DEMO.users;

/** A second, separate PostgreSQL acting as the audit store. */
let pg: PGlite;
let owner: Database;
/** What the portal gets: the same database, but logged in as audit_writer. */
let writer: Database;

function wrap(t: { query: PGlite["query"]; exec: PGlite["exec"] }): Queryable {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      const r = await t.query<Record<string, unknown>>(sql, params);
      return { rows: r.rows as never[], rowCount: r.affectedRows ?? r.rows.length };
    },
    exec: async (sql: string) => {
      await t.exec(sql);
    },
  };
}

/** Runs fn as the store owner (PGlite has one session, so the role is switched around it). */
async function asOwner<T>(fn: (q: Queryable) => Promise<T>) {
  await pg.exec("reset role");
  try {
    return await fn(wrap(pg));
  } finally {
    await pg.exec("set role audit_writer");
  }
}

const insertEvent = (action: string) =>
  asSystem((tx) => tx.query("insert into audit_events (actor_user_id, action, target_type, target_id, details) values ($1, $2, 'test', 'x', $3)", [U.operator, action, JSON.stringify({ n: action })]));

beforeAll(async () => {
  await freshDatabase();
  pg = new PGlite();
  owner = { kind: "pglite", ...wrap(pg), transaction: (fn) => pg.transaction((t) => fn(wrap(t as never))), close: () => pg.close() };
  await migrate(owner, path.join(process.cwd(), "db", "audit"));
  await pg.exec("set role audit_writer");
  writer = owner;
  setAuditStoreForTesting(writer);
});

afterAll(() => setAuditStoreForTesting(undefined));

const mainCount = async (where: string) => Number((await asSystem((tx) => tx.query<{ n: string }>(`select count(*) as n from audit_events where ${where}`))).rows[0].n);

describe("off-site audit store", () => {
  it("does nothing when not configured", async () => {
    setAuditStoreForTesting(null);
    expect(await shipAuditEvents()).toEqual({ configured: false, shipped: 0 });
    expect(await verifyAuditStore()).toBeNull();
    setAuditStoreForTesting(writer);
  });

  it("sends every audit event once, chained, and marks them exported", async () => {
    await insertEvent("test.one");
    await insertEvent("test.two");
    const total = await mainCount("true");
    const r = await shipAuditEvents({ batch: 3 });
    expect(r).toEqual({ configured: true, shipped: total });
    expect(await mainCount("exported_at is null")).toBe(0);
    // A retry after a lost acknowledgement doesn't duplicate anything.
    await asOwner((q) => q.query("select 1"));
    const again = await writer.query<{ appended: number; head_seq: string }>("select * from audit_append('it-center', $1::jsonb)", [
      JSON.stringify([{ id: 1, at: new Date().toISOString(), action: "test.dupe" }]),
    ]);
    expect(again.rows[0].appended).toBe(0);
    const stored = await asOwner((q) => q.query<{ seq: string; prev_hash: string; hash: string; action: string }>("select seq, prev_hash, hash, action from audit_log order by seq"));
    expect(stored.rows).toHaveLength(total);
    expect(stored.rows[1].prev_hash).toBe(stored.rows[0].hash);
    expect(stored.rows.map((x) => x.action)).toContain("test.two");
    expect(await verifyAuditStore()).toEqual({ ok: true, records: total, note: null });
    const status = await auditStatus(await principal(U.operator));
    expect(status).toMatchObject({ configured: true, pending: 0, storeRecords: total, lastVerifyOk: true, lastError: null });
  });

  it("gives the portal's login no way to read, change or delete stored rows", async () => {
    for (const sql of ["select * from audit_log", "update audit_log set action = 'x'", "delete from audit_log", "update audit_chain_head set seq = 0", "truncate audit_log"]) {
      await expect(writer.query(sql)).rejects.toThrow(/permission denied/);
    }
  });

  it("refuses edits even from the store owner while the guard is in place", async () => {
    await asOwner(async (q) => {
      await expect(q.query("update audit_log set action = 'x' where seq = 1")).rejects.toThrow(/append-only/);
      await expect(q.query("delete from audit_log where seq = 1")).rejects.toThrow(/append-only/);
    });
  });

  it("keeps audit rows in the portal database from being deleted or rewritten", async () => {
    await expect(asSystem((tx) => tx.query("delete from audit_events"))).rejects.toThrow(/cannot be deleted/);
    await expect(asSystem((tx) => tx.query("update audit_events set action = 'x'"))).rejects.toThrow(/cannot be changed/);
    await expect(asSystem((tx) => tx.query("update audit_events set exported_at = now()"))).rejects.toThrow(/cannot be changed/);
  });

  it("is for platform operators only", async () => {
    await expectAppError(auditStatus(await principal(U.manager)), 403);
    await expectAppError(checkAuditNow(await principal(U.tech)), 403);
  });

  it("ships new events and verifies on demand", async () => {
    await insertEvent("test.three");
    const r = await checkAuditNow(await principal(U.operator));
    expect(r).toMatchObject({ configured: true, shipped: 1, verification: { ok: true } });
  });

  it("detects a record changed behind the guard", async () => {
    await asOwner(async (q) => {
      await q.exec("alter table audit_log disable trigger audit_log_no_update");
      await q.query("update audit_log set details = '{\"n\":\"forged\"}' where seq = 2");
      await q.exec("alter table audit_log enable trigger audit_log_no_update");
    });
    const v = await verifyAuditStore();
    expect(v?.ok).toBe(false);
    expect(v?.note).toMatch(/record 2/);
    expect((await auditStatus(await principal(U.operator))).lastVerifyOk).toBe(false);
  });

  it("detects a store whose whole chain was rebuilt, using the checkpoint", async () => {
    // Rebuild the chain consistently from scratch with the last record dropped: the store alone looks valid.
    await asOwner(async (q) => {
      await q.exec("alter table audit_log disable trigger audit_log_no_update");
      const last = (await q.query<{ seq: string }>("select max(seq) as seq from audit_log")).rows[0].seq;
      await q.query("delete from audit_log where seq = $1", [last]);
      const rows = (await q.query<Record<string, unknown>>("select * from audit_log order by seq")).rows;
      let prev = "0".repeat(64);
      for (const r of rows) {
        const h = (await q.query<{ h: string }>(
          "select audit_link($1, audit_canonical($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)) as h",
          [prev, r.seq, r.source, r.source_id, r.at, r.actor_user_id, r.customer_id, r.action, r.target_type, r.target_id, r.outcome, r.details, r.request_id],
        )).rows[0].h;
        await q.query("update audit_log set prev_hash = $1, hash = $2 where seq = $3", [prev, h, r.seq]);
        prev = h;
      }
      await q.query("update audit_chain_head set seq = $1, hash = $2", [rows.length, prev]);
      await q.exec("alter table audit_log enable trigger audit_log_no_update");
    });
    expect((await writer.query<{ ok: boolean }>("select ok from audit_verify()")).rows[0].ok).toBe(true);
    const v = await verifyAuditStore();
    expect(v?.ok).toBe(false);
    expect(v?.note).toMatch(/removed/);
  });
});
