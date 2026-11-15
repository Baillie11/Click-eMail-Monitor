import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import request from "supertest";
import { testDatabase } from "./database.js";
import { type DB, one } from "../server/db.js";
import { migrate } from "../server/schema.js";
import { seed } from "../server/seed.js";
import { config } from "../server/config.js";
import { storeMessage } from "../server/worker.js";
import { listMessages } from "../server/mail-service.js";
import { trashMessage } from "../server/message-actions.js";
import { createApp, errorHandler } from "../server/app.js";
import { id } from "../server/security.js";
let db: DB,
  user: string,
  box: any,
  message: any,
  uid = 100;
beforeAll(async () => {
  config.key = "ab".repeat(32);
  config.demo = true;
  db = await testDatabase();
  await migrate(db);
  await seed(db);
  user = (
    await one(db, "SELECT id FROM users WHERE email='demo@example.invalid'")
  ).id;
  box = await one(db, "SELECT * FROM mailboxes LIMIT 1");
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.query(
    "UPDATE mailboxes SET demo=false,lease_owner=NULL,lease_until=NULL WHERE id=$1",
    [box.id],
  );
  message = await storeMessage(db, box, "INBOX", "1", ++uid, {
    messageId: `<${uid}@example.invalid>`,
    subject: "Synthetic deletion test",
    sender: "synthetic@example.invalid",
    recipients: { to: [], cc: [] },
    receivedAt: new Date(),
    unread: true,
    body: "Disposable test fixture",
    html: "",
    attachments: [],
    headers: {},
  });
});
function client() {
  return {
    connect: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    list: vi
      .fn()
      .mockResolvedValue([
        { path: "Trash", specialUse: "\\Trash", flags: new Set() },
      ]),
    capabilities: new Map([["MOVE", true]]),
    mailbox: { uidValidity: 1n },
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    fetchOne: vi
      .fn()
      .mockResolvedValue({
        uid: message.uid,
        envelope: { messageId: message.message_id },
      }),
    messageMove: vi
      .fn()
      .mockResolvedValue({
        uidValidity: 2n,
        uidMap: new Map([[Number(message.uid), Number(message.uid) + 1000]]),
      }),
  };
}
it("moves exactly one UID, updates local identity and hides Trash from default search", async () => {
  const c = client();
  const result = await trashMessage(db, user, message.id, async () => c as any);
  expect(c.messageMove).toHaveBeenCalledWith(String(message.uid), "Trash", {
    uid: true,
  });
  expect(result.destination).toBe("Trash");
  expect(
    await one(db, "SELECT folder,uidvalidity,uid FROM messages WHERE id=$1", [
      message.id,
    ]),
  ).toMatchObject({
    folder: "Trash",
    uidvalidity: "2",
    uid: Number(message.uid) + 1000,
  });
  expect((await listMessages(db, user)).some((m) => m.id === message.id)).toBe(
    false,
  );
  expect(
    (await listMessages(db, user, { folder: "Trash" })).some(
      (m) => m.id === message.id,
    ),
  ).toBe(true);
  expect(
    (await one(db, "SELECT lease_owner FROM mailboxes WHERE id=$1", [box.id]))
      .lease_owner,
  ).toBeNull();
  await expect(
    trashMessage(db, user, message.id, async () => c as any),
  ).rejects.toThrow("already in Trash");
  expect(c.messageMove).toHaveBeenCalledTimes(1);
});
it("refuses UIDVALIDITY changes without moving anything", async () => {
  const c = client();
  c.mailbox.uidValidity = 99n;
  await expect(
    trashMessage(db, user, message.id, async () => c as any),
  ).rejects.toThrow("folder changed");
  expect(c.messageMove).not.toHaveBeenCalled();
});
it("refuses a mismatched Message-ID", async () => {
  const c = client();
  c.fetchOne.mockResolvedValue({
    uid: message.uid,
    envelope: { messageId: "other" },
  });
  await expect(
    trashMessage(db, user, message.id, async () => c as any),
  ).rejects.toThrow("message changed");
  expect(c.messageMove).not.toHaveBeenCalled();
});
it("refuses unsafe COPY/EXPUNGE fallback and missing Trash", async () => {
  const c = client();
  c.capabilities.clear();
  await expect(
    trashMessage(db, user, message.id, async () => c as any),
  ).rejects.toThrow("safe message moves");
  c.capabilities.set("MOVE", true);
  c.list.mockResolvedValue([]);
  await expect(
    trashMessage(db, user, message.id, async () => c as any),
  ).rejects.toThrow("unique Trash");
  expect(c.messageMove).not.toHaveBeenCalled();
});
it("preserves the local message when the provider refuses the move", async () => {
  const c = client();
  c.messageMove.mockResolvedValue(false as any);
  await expect(
    trashMessage(db, user, message.id, async () => c as any),
  ).rejects.toThrow("did not confirm");
  expect(
    (await one(db, "SELECT folder FROM messages WHERE id=$1", [message.id]))
      .folder,
  ).toBe("INBOX");
});
it("does not interfere with an active mailbox sync", async () => {
  await db.query(
    "UPDATE mailboxes SET lease_until=now()+interval '2 minutes',lease_owner='other' WHERE id=$1",
    [box.id],
  );
  const c = client();
  await expect(
    trashMessage(db, user, message.id, async () => c as any),
  ).rejects.toThrow("busy");
  expect(c.connect).not.toHaveBeenCalled();
});
it("denies ordinary members even when they can send, and denies strangers", async () => {
  const member = id();
  await db.query(
    "INSERT INTO users(id,email,password,name,verified) VALUES($1,$2,'unused','Member',true)",
    [member, member + "@example.invalid"],
  );
  await db.query("INSERT INTO members VALUES($1,$2,'member')", [
    box.workspace_id,
    member,
  ]);
  await db.query(
    "INSERT INTO mailbox_permissions(mailbox_id,user_id,can_send) VALUES($1,$2,true)",
    [box.id, member],
  );
  const c = client();
  await expect(
    trashMessage(db, member, message.id, async () => c as any),
  ).rejects.toThrow("access denied");
  await expect(
    trashMessage(db, id(), message.id, async () => c as any),
  ).rejects.toThrow("access denied");
  expect(c.connect).not.toHaveBeenCalled();
});
it("requires HTTP confirmation and CSRF; demo deletion makes no mail connection", async () => {
  await db.query("UPDATE mailboxes SET demo=true WHERE id=$1", [box.id]);
  const app = createApp(db);
  app.use(errorHandler);
  const agent = request.agent(app);
  const login = await agent
    .post("/api/auth/login")
    .send({ email: "demo@example.invalid", password: "Demo-mail-only-2026" });
  const url = "/api/messages/" + message.id + "/trash";
  expect((await agent.post(url).send({ confirmed: true })).status).toBe(403);
  expect(
    (
      await agent
        .post(url)
        .set("origin", config.origin)
        .set("x-csrf-token", login.body.csrf)
        .send({})
    ).status,
  ).toBe(400);
  const result = await agent
    .post(url)
    .set("origin", config.origin)
    .set("x-csrf-token", login.body.csrf)
    .send({ confirmed: true });
  expect(result.status).toBe(200);
  expect(result.body.demo).toBe(true);
});
