import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { testDatabase } from "./database.js";
import { migrate } from "../server/schema.js";
import { type DB, one } from "../server/db.js";
import { config } from "../server/config.js";
import { seed } from "../server/seed.js";
import { claimMailbox, tick } from "../server/worker.js";

describe.skipIf(!process.env.MYSQL_TEST_URL)(
  "MariaDB production dialect",
  () => {
    let db: DB, box: any, user: string;
    beforeAll(async () => {
      config.key = "ab".repeat(32);
      config.demo = true;
      db = await testDatabase();
      await migrate(db);
      await migrate(db);
      await seed(db);
      box = await one(db, "SELECT * FROM mailboxes LIMIT 1");
      user = (await one(db, "SELECT id FROM users LIMIT 1")).id;
    }, 30000);
    afterAll(async () => db?.close());

    it("consumes a token exactly once across independent transactions", async () => {
      await db.query(
        "INSERT INTO tokens(hash,user_id,kind,expires_at) VALUES('race',$1,'verify',now()+interval '1 hour')",
        [user],
      );
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          db.transaction((tx) =>
            tx.query(
              "DELETE FROM tokens WHERE hash=$1 AND kind='verify' AND expires_at>now() RETURNING *",
              ["race"],
            ),
          ),
        ),
      );
      expect(results.reduce((sum, r) => sum + r.rows.length, 0)).toBe(1);
    });
    it("reserves an AI quota without exceeding its limit", async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          db.transaction((tx) =>
            tx.query(
              "INSERT INTO ai_usage(workspace_id,count) VALUES($1,1) ON CONFLICT(workspace_id,day) DO UPDATE SET count=ai_usage.count+1 WHERE ai_usage.count<$2 RETURNING count",
              [box.workspace_id, 3],
            ),
          ),
        ),
      );
      expect(results.reduce((sum, r) => sum + r.rows.length, 0)).toBe(3);
      expect(
        (
          await one(db, "SELECT count FROM ai_usage WHERE workspace_id=$1", [
            box.workspace_id,
          ])
        ).count,
      ).toBe(3);
    });
    it("grants a due mailbox lease to one concurrent worker", async () => {
      await db.query("UPDATE mailboxes SET demo=false WHERE id=$1", [box.id]);
      const claims = await Promise.all([
        claimMailbox(db, "a"),
        claimMailbox(db, "b"),
        claimMailbox(db, "c"),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      await db.query(
        "UPDATE mailboxes SET demo=true,lease_owner=NULL,lease_until=NULL WHERE id=$1",
        [box.id],
      );
    });
    it("merges settings and decodes booleans and JSON", async () => {
      await db.query(
        "UPDATE mailboxes SET paused=$1,settings=settings||$2::jsonb,next_check=now() WHERE id=$3",
        [true, JSON.stringify({ signature: "Updated" }), box.id],
      );
      const updated = await one(db, "SELECT * FROM mailboxes WHERE id=$1", [
        box.id,
      ]);
      expect(updated.paused).toBe(true);
      expect(updated.settings.signature).toBe("Updated");
      expect(updated.settings.imap).toEqual(box.settings.imap);
    });
    it("enforces foreign keys and runs worker retention cleanup", async () => {
      await expect(
        db.query(
          "INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES('bad','missing','csrf',now())",
        ),
      ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
      await db.query(
        "UPDATE messages SET received_at=now()-interval '90 days' WHERE mailbox_id=$1",
        [box.id],
      );
      await tick(db);
      expect(
        (
          await one(
            db,
            "SELECT count(*)::int AS n FROM messages WHERE mailbox_id=$1",
            [box.id],
          )
        ).n,
      ).toBe(0);
    });
  },
);
