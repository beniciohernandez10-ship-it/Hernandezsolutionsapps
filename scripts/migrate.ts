import { openDatabase } from "../src/lib/db";
import { migrate } from "../src/lib/db/migrate";

const database = await openDatabase();
const ran = await migrate(database, undefined, (m) => console.log(m));
console.log(ran.length ? `Applied ${ran.length} migration(s).` : "Database is up to date.");
await database.close();
