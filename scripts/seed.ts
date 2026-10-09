import { openDatabase } from "../src/lib/db";
import { loadConfig } from "../src/lib/config";
import { seedDemo } from "../src/lib/db/seed";

if (loadConfig().isProduction) {
  console.error("Refusing to seed demonstration data into a production environment.");
  process.exit(1);
}
const database = await openDatabase();
const inserted = await seedDemo(database);
console.log(inserted ? "Seeded fictional demo data." : "Demo data already present; nothing to do.");
await database.close();
