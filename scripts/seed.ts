import { openDatabase } from "../src/lib/db";
import { loadConfig } from "../src/lib/config";
import { seedDemo } from "../src/lib/db/seed";

const cfg = loadConfig();
if (cfg.isProduction || (cfg.databaseUrl && process.env.ALLOW_DEMO_SEED !== "true")) {
  console.error(
    "Refusing to seed fictional demo data: this looks like a production or hosted database. " +
      "Set ALLOW_DEMO_SEED=true only for a disposable development/staging database.",
  );
  process.exit(1);
}
const database = await openDatabase();
const inserted = await seedDemo(database);
console.log(inserted ? "Seeded fictional demo data." : "Demo data already present; nothing to do.");
await database.close();
