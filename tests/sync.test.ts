import { testDatabase } from "./database.js";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { one, type DB } from "../server/db.js";
import { migrate } from "../server/schema.js";
import { seed } from "../server/seed.js";
import { config } from "../server/config.js";
import { syncMailbox, leasedDatabase, sendNext } from "../server/worker.js";
import {
  createDraft,
  approveDraft,
  queueDraft,
  getDraft,
} from "../server/mail-service.js";
let db: DB, box: any, user: string;
beforeAll(async () => {
  config.key = "ab".repeat(32);
  config.demo = true;
  db = await testDatabase();
  await migrate(db);
  await seed(db);
  box = await one(db, "SELECT * FROM mailboxes WHERE provider='orangehost'");
  user = (
    await one(db, "SELECT id FROM users WHERE email='demo@example.invalid'")
  ).id;
}, 30000);
afterAll(async () => db.close());
function fakeImap(validity: bigint, uids: number[]) {
  const source = (uid: number) =>
    Buffer.from(
      `From: Sender <sender@example.invalid>\r\nTo: hello@studio.example\r\nSubject: Project ${uid}\r\nMessage-ID: <${uid}@example.invalid>\r\n\r\nSynthetic email.`,
    );
  return {
    connect: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    list: vi
      .fn()
      .mockResolvedValue([
        { path: "INBOX", flags: new Set(), specialUse: null },
      ]),
    mailbox: { uidValidity: validity },
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    search: vi.fn().mockResolvedValue(uids),
    fetchOne: vi.fn(async (uid: number, fields: any) =>
      fields.source
        ? { uid, source: source(uid) }
        : { uid, size: source(uid).length, flags: new Set() },
    ),
    fetch: async function* (batch: number[]) {
      for (const uid of batch)
        if (uids.includes(uid))
          yield { uid, flags: new Set(uid === 1 ? ["\\Seen"] : []) };
    },
  };
}
it("resets UIDVALIDITY safely, imports out-of-order UIDs in order and refreshes read flags", async () => {
  const client = fakeImap(99n, [2, 1]);
  await syncMailbox(db, box, async () => client as any);
  const messages = (
    await db.query(
      "SELECT uid,uidvalidity,unread FROM messages WHERE mailbox_id=$1 ORDER BY uid",
      [box.id],
    )
  ).rows;
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatchObject({
    uid: 1,
    uidvalidity: "99",
    unread: false,
  });
  expect(messages[1].unread).toBe(true);
  expect(
    (
      await one(db, "SELECT last_uid FROM folders WHERE mailbox_id=$1", [
        box.id,
      ])
    ).last_uid,
  ).toBe(2);
  expect(client.logout).toHaveBeenCalled();
  expect(client.fetchOne.mock.calls.every((c) => !("markSeen" in c[1]))).toBe(
    true,
  );
});
it("does not duplicate messages on repeated sync and reflects provider deletion", async () => {
  await syncMailbox(db, box, async () => fakeImap(99n, [2, 1]) as any);
  expect(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM messages WHERE mailbox_id=$1",
        [box.id],
      )
    ).n,
  ).toBe(2);
  await syncMailbox(db, box, async () => fakeImap(99n, [2]) as any);
  expect(
    (await db.query("SELECT uid FROM messages WHERE mailbox_id=$1", [box.id]))
      .rows,
  ).toEqual([{ uid: 2 }]);
});
it("rejects stale-worker database writes after lease replacement", async () => {
  await db.query(
    "UPDATE mailboxes SET lease_owner='new-worker',lease_until=now()+interval '1 minute' WHERE id=$1",
    [box.id],
  );
  const stale = leasedDatabase(db, box.id, "old-worker");
  await expect(
    stale.query("UPDATE mailboxes SET status='stale overwrite' WHERE id=$1", [
      box.id,
    ]),
  ).rejects.toThrow("lease");
  expect(
    (await one(db, "SELECT status FROM mailboxes WHERE id=$1", [box.id]))
      .status,
  ).not.toBe("stale overwrite");
});
it("retries a definitive failure only after fresh human approval", async () => {
  const d = await createDraft(db, user, box.id, {
    to: ["recipient@example.invalid"],
    subject: "Failure test",
    body: "Synthetic",
    cc: [],
    bcc: [],
    attachments: [],
  });
  await approveDraft(db, user, d.id, 1);
  await queueDraft(db, user, d.id);
  await sendNext(db, async () => {
    throw Object.assign(new Error("Rejected"), { code: "EAUTH" });
  });
  expect((await getDraft(db, user, d.id)).status).toBe("Failed");
  const success = vi.fn().mockResolvedValue("SMTP accepted");
  await sendNext(db, success);
  expect(success).not.toHaveBeenCalled();
  await approveDraft(db, user, d.id, 1);
  await queueDraft(db, user, d.id);
  await sendNext(db, success);
  expect(success).toHaveBeenCalledTimes(1);
  expect((await getDraft(db, user, d.id)).status).toBe(
    "Accepted by mail server",
  );
});
