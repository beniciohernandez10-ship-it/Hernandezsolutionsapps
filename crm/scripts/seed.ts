/** Load built-in templates and the standard sequence (no sample leads). `npm run db:seed` */
import { db } from "../src/lib/db";
import { seedBuiltIns } from "../src/lib/seed";

seedBuiltIns(console.log)
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
