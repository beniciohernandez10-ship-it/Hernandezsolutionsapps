/**
 * Runs before `next build` on Vercel (vercel.json buildCommand). Only the production build
 * migrates and seeds, so preview builds never touch the production database. Vercel provides
 * the real DATABASE_URL at build time, including values marked Sensitive.
 */
import { execSync } from "node:child_process";

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`Skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set for the production build.");
  // Migrations need a direct connection; Neon's pooled URL can't hold Prisma's migration lock.
  const direct = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: direct } });
  const { seedBuiltIns } = await import("../src/lib/seed");
  const { db } = await import("../src/lib/db");
  await seedBuiltIns(console.log);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
