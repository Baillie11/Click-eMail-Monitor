import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { testDatabase } from "./database.js";
import { migrate } from "../server/schema.js";
import { seed } from "../server/seed.js";
import { config } from "../server/config.js";
import { type DB, one } from "../server/db.js";
import { storeMessage } from "../server/worker.js";
import {
  contactTargets,
  syncContacts,
  type ContactTarget,
} from "../server/contact-sync.js";
let db: DB, target: ContactTarget;
beforeAll(async () => {
  config.key = "ab".repeat(32);
  config.demo = true;
  db = await testDatabase();
  await migrate(db);
  await seed(db);
  const box = await one(
    db,
    "SELECT * FROM mailboxes WHERE provider='orangehost'",
  );
  await db.query("DELETE FROM messages WHERE mailbox_id=$1", [box.id]);
  await db.query("UPDATE mailboxes SET demo=false WHERE id=$1", [box.id]);
  await storeMessage(db, box, "INBOX", "1", 100, {
    messageId: "contact-test",
    subject: "Hello",
    sender: "alex@example.com",
    recipients: {},
    receivedAt: new Date(),
    unread: true,
    body: "Regards\nAlex Smith\nCompany: Example Pty Ltd",
    html: "",
    attachments: [],
    headers: {},
  });
  target = {
    mailboxId: box.id,
    businessId: "00000000-0000-4000-8000-000000000001",
    endpoint:
      "https://marketing.example.com/api/integrations/mail-monitor/contacts",
    token: "a".repeat(40),
    since: "2020-01-01T00:00:00.000Z",
  };
}, 30000);
afterAll(async () => db.close());
it("retries failed delivery and records successful delivery without sending message bodies", async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValue(new Response(null, { status: 200 }));
  expect(await syncContacts(db, [target], send)).toMatchObject({
    failed: 1,
    delivered: 0,
  });
  expect(await syncContacts(db, [target], send)).toMatchObject({
    failed: 0,
    delivered: 1,
  });
  const request = send.mock.calls[1][1];
  expect(JSON.parse(request.body)).toMatchObject({
    email: "alex@example.com",
    businessName: "Example Pty Ltd",
    contactName: "Alex Smith",
    businessId: target.businessId,
  });
  expect(JSON.parse(request.body)).not.toHaveProperty("body");
  expect(request.redirect).toBe("error");
  expect(await syncContacts(db, [target], send)).toMatchObject({
    delivered: 0,
  });
  expect(send).toHaveBeenCalledTimes(2);
});
it("rejects insecure destinations and missing credentials", () => {
  expect(() =>
    contactTargets(
      JSON.stringify([{ ...target, endpoint: "http://marketing.example.com" }]),
    ),
  ).toThrow();
  expect(() =>
    contactTargets(JSON.stringify([{ ...target, token: "" }])),
  ).toThrow();
  expect(contactTargets("[]")).toEqual([]);
});
