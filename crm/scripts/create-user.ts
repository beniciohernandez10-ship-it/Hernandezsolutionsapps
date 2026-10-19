/**
 * Create a user from the command line (handy for local development).
 *   npm run user:create -- --email you@example.com --name "Your Name" --role OWNER
 * The password is read from the terminal; on production use the /setup page or Settings → Users.
 */
import { createInterface } from "node:readline/promises";
import { hashPassword, passwordProblem } from "../src/lib/auth/password";
import { db } from "../src/lib/db";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.toLowerCase();
  const name = arg("name");
  const role = (arg("role") ?? "SALES").toUpperCase();
  if (!email || !name) throw new Error('Usage: npm run user:create -- --email you@example.com --name "Your Name" [--role OWNER|ADMIN|SALES|VIEWER]');
  if (!["OWNER", "ADMIN", "SALES", "VIEWER"].includes(role)) throw new Error("Role must be OWNER, ADMIN, SALES or VIEWER.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = process.env.NEW_USER_PASSWORD ?? (await rl.question("Password (12+ characters): "));
  rl.close();
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(problem);
  if (await db.user.findUnique({ where: { email } })) throw new Error("A user with that email already exists.");
  const u = await db.user.create({ data: { email, name, role: role as never, passwordHash: await hashPassword(password) } });
  console.log(`Created ${u.role.toLowerCase()} ${u.email}. They'll set up two-step sign-in on first login.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
