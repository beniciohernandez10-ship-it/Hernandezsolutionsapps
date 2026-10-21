import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { openDatabase } from "../src/lib/db";
import { migrate } from "../src/lib/db/migrate";

/**
 * One-time setup, and password rotation, for the off-site audit store
 * (docs/audit-log.md). Run from a trusted machine:
 *
 *   1. Put the store owner's connection string in .env.audit.local:
 *        AUDIT_OWNER_DATABASE_URL=postgresql://...
 *   2. npm run audit:setup
 *
 * It applies db/audit to that database, gives the audit_writer login a new
 * random password, and saves the writer's connection string in Vercel
 * (production) as AUDIT_DATABASE_URL. No secret is printed. Redeploy after.
 * Running it again rotates the writer password.
 */

const ownerUrl = process.env.AUDIT_OWNER_DATABASE_URL;
if (!ownerUrl) {
  console.error("Set AUDIT_OWNER_DATABASE_URL in .env.audit.local (the audit database owner's connection string).");
  process.exit(1);
}

const target = new URL(ownerUrl);
// The store must be a different database from the portal's.
const main = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (main && main.hostname === target.hostname && main.pathname === target.pathname) {
  console.error("AUDIT_OWNER_DATABASE_URL points at the portal's own database. Use a separate Neon project.");
  process.exit(1);
}

const ownerDb = await openDatabase(ownerUrl);
const ran = await migrate(ownerDb, path.join(process.cwd(), "db", "audit"), (m) => console.log(m));
console.log(ran.length ? `Applied ${ran.length} audit migration(s).` : "Audit store schema is up to date.");

const password = randomBytes(32).toString("base64url");
const stmt = (await ownerDb.query<{ s: string }>("select format('alter role audit_writer with login password %L', $1::text) as s", [password])).rows[0].s;
await ownerDb.exec(stmt);
await ownerDb.close();
console.log("audit_writer login enabled with a new password.");

const writerUrl = new URL(ownerUrl);
writerUrl.username = "audit_writer";
writerUrl.password = password;

// Prove the writer works and is limited before handing it to the portal.
const writer = await openDatabase(writerUrl.toString());
const v = (await writer.query<{ ok: boolean; checked: string }>("select ok, checked from audit_verify()")).rows[0];
let canRead = true;
try {
  await writer.query("select 1 from audit_log limit 1");
} catch {
  canRead = false;
}
await writer.close();
if (canRead) {
  console.error("audit_writer can read audit_log directly; refusing to continue. Check the grants in db/audit.");
  process.exit(1);
}
console.log(`Writer check passed: append-only access, chain ${v.ok ? "valid" : "BROKEN"} (${v.checked} records).`);

const vercel = (args: string[], input?: string) =>
  spawnSync("npx", ["vercel", ...args], { input, encoding: "utf8", shell: process.platform === "win32", stdio: ["pipe", "pipe", "pipe"] });
const add = vercel(["env", "add", "AUDIT_DATABASE_URL", "production", "--sensitive", "--force", "--yes"], writerUrl.toString());
if (add.status !== 0) {
  console.error("Couldn't save AUDIT_DATABASE_URL in Vercel. Is this folder linked (npx vercel link)?");
  console.error((add.stderr || add.stdout).replaceAll(password, "***").slice(0, 2000));
  process.exit(1);
}
console.log("Saved AUDIT_DATABASE_URL (audit_writer) in Vercel production. Redeploy to start sending audit events.");
console.log("You can now delete .env.audit.local; keep the owner credentials in Neon only.");
