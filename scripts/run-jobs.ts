import { cronTick } from "../src/lib/jobs";
import { db } from "../src/lib/db";

const r = await cronTick();
console.log(`Processed ${r.processed} job(s).`);
await (await db()).close();
