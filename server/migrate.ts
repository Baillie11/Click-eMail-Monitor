import { openDatabase } from "./db.js";
import { migrate } from "./schema.js";
const db = openDatabase();
await migrate(db);
console.log("Database migration 1 applied.");
await db.close();
