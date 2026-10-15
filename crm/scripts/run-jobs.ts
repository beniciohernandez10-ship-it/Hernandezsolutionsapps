/** Run the daily jobs once (same as the Vercel cron). `npm run jobs:run` */
import { db } from "../src/lib/db";
import { runDailyJobs } from "../src/lib/jobs";

runDailyJobs()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
