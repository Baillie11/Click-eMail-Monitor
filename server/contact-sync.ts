import { createHash } from "node:crypto";
import { z } from "zod";
import { type DB } from "./db.js";
import { extractContact } from "./contact-capture.js";

const targetSchema = z.object({
  mailboxId: z.string().min(1).max(64),
  businessId: z.string().uuid(),
  endpoint: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !url.search
      );
    }, "Use a credential-free HTTPS endpoint"),
  token: z.string().min(32).max(1024),
  since: z.string().datetime(),
});
export type ContactTarget = z.infer<typeof targetSchema>;
export function contactTargets(
  value = process.env.MARKETING_CONTACT_TARGETS || "[]",
): ContactTarget[] {
  return z.array(targetSchema).max(100).parse(JSON.parse(value));
}
export async function migrateContactSync(db: DB) {
  await db.query(
    db.dialect === "mysql"
      ? "CREATE TABLE IF NOT EXISTS contact_deliveries(target_key varchar(64) NOT NULL,message_id varchar(64) NOT NULL,status varchar(20) NOT NULL,processed_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(target_key,message_id),FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin"
      : "CREATE TABLE IF NOT EXISTS contact_deliveries(target_key text NOT NULL,message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,status text NOT NULL,processed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(target_key,message_id))",
  );
}
/** Bounded, retryable delivery. The receiver MUST upsert by business + normalised email. */
export async function syncContacts(
  db: DB,
  targets = contactTargets(),
  send: typeof fetch = fetch,
) {
  let delivered = 0,
    skipped = 0,
    failed = 0;
  const started = Date.now();
  let processed = 0;
  for (const target of targets) {
    if (processed >= 25 || Date.now() - started > 15000) break;
    const targetKey = createHash("sha256")
      .update(
        JSON.stringify([target.mailboxId, target.businessId, target.endpoint]),
      )
      .digest("hex");
    const boxes = (
      await db.query(
        "SELECT id,email,workspace_id,demo FROM mailboxes WHERE id=$1",
        [target.mailboxId],
      )
    ).rows;
    const box = boxes[0];
    if (!box || box.demo) continue;
    const own = (
      await db.query("SELECT email FROM mailboxes WHERE workspace_id=$1", [
        box.workspace_id,
      ])
    ).rows.map((b) => b.email);
    const pending = (
      await db.query(
        "SELECT m.id,m.sender,m.body,m.headers,m.folder,f.special_use FROM messages m LEFT JOIN folders f ON f.mailbox_id=m.mailbox_id AND f.path=m.folder WHERE m.mailbox_id=$1 AND m.received_at>=$2 AND NOT EXISTS(SELECT 1 FROM contact_deliveries d WHERE d.target_key=$3 AND d.message_id=m.id) ORDER BY m.received_at,m.id LIMIT 25",
        [box.id, new Date(target.since), targetKey],
      )
    ).rows;
    for (const message of pending) {
      if (processed >= 25 || Date.now() - started > 15000) break;
      processed++;
      const excludedFolder = /^\\(?:Sent|Drafts|Trash|Junk)$/i.test(
        message.special_use || "",
      );
      const contact = excludedFolder ? null : extractContact(message, own);
      if (contact) {
        try {
          const response = await send(target.endpoint, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(10000),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${target.token}`,
            },
            body: JSON.stringify({
              businessId: target.businessId,
              ...contact,
              source: "click-mail-monitor",
              sourceId: `${box.id}:${message.id}`,
            }),
          });
          // Bodies can include contact details: never log them and always release the connection.
          await response.body?.cancel();
          if (!response.ok) {
            failed++;
            break;
          }
          delivered++;
        } catch {
          failed++;
          break;
        }
      } else skipped++;
      await db.query(
        "INSERT INTO contact_deliveries(target_key,message_id,status) VALUES($1,$2,$3) ON CONFLICT(target_key,message_id) DO NOTHING",
        [targetKey, message.id, contact ? "delivered" : "skipped"],
      );
    }
  }
  return { delivered, skipped, failed };
}
