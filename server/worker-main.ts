import { openDatabase } from "./db.js";
import { config, validateConfig } from "./config.js";
import { tick } from "./worker.js";
validateConfig();
if (!config.databaseUrl)
  throw new Error(
    "The separate worker requires MySQL or PostgreSQL DATABASE_URL. Embedded demo runs its worker in the web process.",
  );
const db = openDatabase();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
  });
const once = process.argv.includes("--once");
const batch = Math.max(
  1,
  Math.min(10, Number(process.env.WORKER_BATCH_SIZE || 1)),
);
let iterations = 0;
const started = Date.now();
do {
  try {
    await tick(db);
  } catch {
    console.error("Worker iteration failed; will retry on the next interval.");
    if (once) {
      process.exitCode = 1;
      break;
    }
  }
  iterations++;
  if (once) {
    if (iterations >= batch || Date.now() - started >= 120000) break;
    continue;
  }
  if (!stopping) await new Promise((r) => setTimeout(r, 3000));
} while (!stopping);
await db.close();

if (once && !process.exitCode) console.log(`Worker batch completed: ${new Date().toISOString()}`);
