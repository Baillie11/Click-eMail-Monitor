import { openDatabase } from "./db.js";
import { migrate } from "./schema.js";
const db = openDatabase();
await migrate(db);
console.log("Database migrations applied.");
await db.close();
