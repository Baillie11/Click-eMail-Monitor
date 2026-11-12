import { createPool, type PoolConnection } from "mysql2/promise";
import type { DB } from "./db.js";

// This adapter supports the application's fixed SQL vocabulary, not arbitrary
// PostgreSQL. Values remain bound parameters, including expanded IN lists.
export function compile(sql: string, values: any[] = []) {
  let s = sql
    .replace(/=ANY\((\$\d+)::(?:text|bigint)\[\]\)/g, " IN ($1)")
    .replace(/::(?:text|int|jsonb)\b/g, "")
    .replace(
      /(subject|sender|body) ILIKE/g,
      "$1 COLLATE utf8mb4_unicode_ci LIKE",
    )
    .replace(/'%'\|\|(\$\d+)\|\|'%'/g, "CONCAT('%',$1,'%')")
    .replace(
      /now\(\)\+\((\$\d+)\*interval '1 (minute|second)'\)/g,
      "TIMESTAMPADD($2,$1,now())",
    )
    .replace(/interval '(\d+) (minute|hour|day|second)s?'/g, "INTERVAL $1 $2")
    .replace(
      /FOR UPDATE SKIP LOCKED LIMIT (\d+)/g,
      "LIMIT $1 FOR UPDATE SKIP LOCKED",
    )
    .replace(
      /settings=settings\|\|(\$\d+)/g,
      "settings=JSON_MERGE_PATCH(settings,$1)",
    );
  if (s.startsWith("DELETE FROM messages m USING")) {
    s =
      "DELETE m FROM messages m JOIN mailboxes b ON m.mailbox_id=b.id WHERE m.received_at<TIMESTAMPADD(DAY,-CAST(JSON_UNQUOTE(JSON_EXTRACT(b.settings,'$.retentionDays')) AS SIGNED),now())";
  }
  s = s
    .replace(/ ON CONFLICT(?:\([^)]*\))? DO NOTHING$/, () => {
      const col = s.match(/INSERT INTO \w+\((\w+)/)?.[1];
      if (!col) throw new Error("Unsupported conflict query");
      return ` ON DUPLICATE KEY UPDATE ${col}=${col}`;
    })
    .replace(
      / ON CONFLICT\([^)]*\) DO UPDATE SET /,
      " ON DUPLICATE KEY UPDATE ",
    )
    .replace(/excluded\.(\w+)/g, "VALUES($1)");
  const args: any[] = [];
  // Match datetime(3) defaults: second-precision NOW() can otherwise make a
  // newly inserted due mailbox appear to be scheduled in the future.
  s = s.replace(/\bnow\(\)/gi, "now(3)");
  s = s.replace(/\$(\d+)/g, (_, n) => {
    const value = values[Number(n) - 1];
    if (Array.isArray(value)) {
      if (!value.length) return "SELECT NULL WHERE FALSE";
      args.push(...value);
      return value.map(() => "?").join(",");
    }
    args.push(value === undefined ? null : value);
    return "?";
  });
  return { sql: s, values: args };
}

const jsonFields = new Set([
  "settings",
  "payload",
  "recipients",
  "attachments",
  "headers",
  "criteria",
  "content",
  "metadata",
]);
const boolFields = new Set([
  "verified",
  "paused",
  "demo",
  "can_send",
  "unread",
  "enabled",
  "seen",
]);
export function mysql(url: string): DB {
  const pool = createPool({
    uri: url,
    connectionLimit: 4,
    timezone: "Z",
    charset: "utf8mb4",
    supportBigNumbers: true,
  });
  const wrap = (connection?: PoolConnection): DB => {
    const db: DB = {
      dialect: "mysql",
      transaction: async (fn) => {
        // Helpers compose inside the caller's transaction without changing its
        // connection or accidentally committing a larger operation.
        if (connection) return fn(db);
        const c = await pool.getConnection();
        try {
          await c.query("SET time_zone = '+00:00'");
          await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
          await c.beginTransaction();
          const value = await fn(wrap(c));
          await c.commit();
          return value;
        } catch (e) {
          await c.rollback();
          throw e;
        } finally {
          c.release();
        }
      },
      query: async <T = any>(s: string, values: any[] = []) => {
        if (s === "LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE")
          return db.query<T>(
            "SELECT version FROM migration_versions WHERE version=1 FOR UPDATE",
          );
        // Atomic quota reservation is serialized by the workspace row.
        if (s.startsWith("INSERT INTO ai_usage") && s.includes("RETURNING")) {
          return db.transaction(async (tx) => {
            await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
              values[0],
            ]);
            const r = await tx.query<any>(
              "SELECT count FROM ai_usage WHERE workspace_id=$1 AND day=CURRENT_DATE",
              [values[0]],
            );
            if ((r.rows[0]?.count || 0) >= values[1])
              return { rows: [], rowCount: 0 };
            await tx.query(
              "INSERT INTO ai_usage(workspace_id,day,count) VALUES($1,CURRENT_DATE,1) ON DUPLICATE KEY UPDATE count=count+1",
              [values[0]],
            );
            return tx.query<T>(
              "SELECT count FROM ai_usage WHERE workspace_id=$1 AND day=CURRENT_DATE",
              [values[0]],
            );
          });
        }
        if (s.includes(" RETURNING ")) {
          return db.transaction(async (tx) => {
            const [mutation] = s.split(" RETURNING ");
            if (s.startsWith("INSERT INTO messages(")) {
              await tx.query(mutation, values);
              return tx.query<T>(
                "SELECT * FROM messages WHERE mailbox_id=$1 AND folder=$2 AND uidvalidity=$3 AND uid=$4",
                values.slice(1, 5),
              );
            }
            if (s.startsWith("DELETE FROM tokens WHERE")) {
              const selected = await tx.query<T>(
                mutation.replace("DELETE FROM", "SELECT * FROM") +
                  " FOR UPDATE",
                values,
              );
              if (selected.rows.length) await tx.query(mutation, values);
              return selected;
            }
            if (s.startsWith("UPDATE drafts SET content=")) {
              await tx.query("SELECT id FROM drafts WHERE id=$1 FOR UPDATE", [
                values[1],
              ]);
              const r = await tx.query(mutation, values);
              return r.rowCount
                ? tx.query<T>("SELECT * FROM drafts WHERE id=$1", [values[1]])
                : { rows: [], rowCount: 0 };
            }
            if (s.startsWith("UPDATE outbox SET status='Delivery uncertain'")) {
              const where = mutation.slice(mutation.indexOf(" WHERE "));
              const r = await tx.query<T>(
                "SELECT draft_id FROM outbox" + where + " FOR UPDATE",
                values,
              );
              await tx.query(mutation, values);
              return r;
            }
            throw new Error("Unsupported RETURNING query");
          });
        }
        const q = compile(s, values);
        const run = async (c: PoolConnection) => {
          const [result] = await c.query(q.sql, q.values);
          if (!Array.isArray(result))
            return { rows: [] as T[], rowCount: result.affectedRows };
          const rows = result.map((row: any) => {
            for (const key of Object.keys(row)) {
              if (jsonFields.has(key) && typeof row[key] === "string")
                row[key] = JSON.parse(row[key]);
              if (boolFields.has(key) && row[key] !== null)
                row[key] = Boolean(row[key]);
            }
            return row as T;
          });
          return { rows, rowCount: rows.length };
        };
        if (connection) return run(connection);
        const c = await pool.getConnection();
        try {
          await c.query("SET time_zone = '+00:00'");
          return await run(c);
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
    return db;
  };
  return wrap();
}
