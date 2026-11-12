import { Pool, type PoolClient } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { config } from "./config.js";
import { mysql } from "./mysql.js";
export interface DB {
  dialect?: "postgres" | "mysql";
  query<T = any>(
    sql: string,
    values?: any[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
  transaction<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgres(url: string): DB {
  const pool = new Pool({ connectionString: url });
  const wrap = (client: Pool | PoolClient): DB => ({
    query: async (s, v) => (await client.query(s, v)) as any,
    transaction: async (fn) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await fn(wrap(c));
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  });
  return wrap(pool);
}
export function embedded(path?: string): DB {
  const pg = new PGlite(path);
  const wrap = (c: any): DB => ({
    query: async (s, v) => {
      const r = await c.query(s, v);
      return { rows: r.rows, rowCount: r.affectedRows };
    },
    transaction: (fn) => c.transaction((tx: any) => fn(wrap(tx))),
    close: () => pg.close(),
  });
  return wrap(pg);
}
export const openDatabase = () =>
  config.databaseUrl
    ? /^mysql:/.test(config.databaseUrl)
      ? mysql(config.databaseUrl)
      : postgres(config.databaseUrl)
    : embedded(config.dataDir);
export async function one<T = any>(
  db: DB,
  s: string,
  v: any[] = [],
): Promise<T | undefined> {
  return (await db.query<T>(s, v)).rows[0];
}
