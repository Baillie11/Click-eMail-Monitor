import { randomBytes } from "node:crypto";
import { createConnection } from "mysql2/promise";
import { embedded, type DB } from "../server/db.js";
import { mysql } from "../server/mysql.js";

// Each suite gets a new disposable database; never migrate or clear a supplied
// database. The admin URL must point at a dedicated local test server.
export async function testDatabase(): Promise<DB> {
  if (!process.env.MYSQL_TEST_URL) return embedded();
  const url = new URL(process.env.MYSQL_TEST_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("Integration test server must be local");
  url.pathname = "/";
  const admin = await createConnection(url.toString());
  const name = "cmm_test_" + randomBytes(10).toString("hex");
  await admin.query(
    `CREATE DATABASE ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  );
  url.pathname = "/" + name;
  const db = mysql(url.toString());
  const close = db.close;
  db.close = async () => {
    await close();
    await admin.query(`DROP DATABASE ${name}`);
    await admin.end();
  };
  return db;
}
