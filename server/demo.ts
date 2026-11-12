import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
await mkdir(".data", { recursive: true });
let key: string;
try {
  key = (await readFile(".data/demo-key", "utf8")).trim();
} catch {
  key = randomBytes(32).toString("hex");
  await writeFile(".data/demo-key", key, { mode: 0o600 });
}
process.env.CREDENTIAL_KEY = key;
process.env.DEMO_MODE = "true";
process.env.NODE_ENV = "development";
// An empty value prevents dotenv from loading a real database URL from .env.
process.env.DATABASE_URL = "";
process.env.APP_ORIGIN = `http://localhost:${process.env.PORT || "3100"}`;
process.env.HOST = "127.0.0.1";
process.env.AI_API_KEY = "";
process.env.AI_BASE_URL = "";
process.env.DATA_DIR = ".data/demo";
console.log("Demo sign-in: demo@example.invalid / Demo-mail-only-2026");
await import("./main.js");
