import { openDatabase } from "../src/lib/db";
import { migrate } from "../src/lib/db/migrate";

// Runs before `next build` on Vercel (vercel.json buildCommand). Only the
// production build migrates, so preview builds never change the production
// schema. Vercel provides the real DATABASE_URL at build time, including
// values marked Sensitive, which `vercel env pull` cannot download.
if (process.env.VERCEL_ENV !== "production") {
  console.log(`Skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`);
} else {
  const database = await openDatabase();
  const ran = await migrate(database, undefined, (m) => console.log(m));
  console.log(ran.length ? `Applied ${ran.length} migration(s).` : "Database is up to date.");
  await database.close();
}
