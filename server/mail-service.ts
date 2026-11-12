import { z } from "zod";
import { type DB, one } from "./db.js";
import { mailbox, audit, visibleMailboxes } from "./access.js";
import { id, digest, HttpError } from "./security.js";
const email = z.string().email().max(254);
export const contentSchema = z
  .object({
    to: z.array(email).min(1).max(30),
    cc: z.array(email).max(30).default([]),
    bcc: z.array(email).max(30).default([]),
    subject: z
      .string()
      .max(998)
      .refine((x) => !/[\r\n]/.test(x)),
    body: z.string().max(200000),
    attachments: z
      .array(
        z.object({
          filename: z
            .string()
            .min(1)
            .max(200)
            .refine((x) => !/[\r\n/\\]/.test(x)),
          contentType: z.string().max(100),
          base64: z
            .string()
            .max(7_000_000)
            .refine((x) => /^[A-Za-z0-9+/]*={0,2}$/.test(x)),
        }),
      )
      .max(5)
      .default([]),
  })
  .refine(
    (x) =>
      x.attachments.reduce(
        (n, a) => n + Buffer.from(a.base64, "base64").length,
        0,
      ) <=
      5 * 1024 * 1024,
    "Attachments must total at most 5 MB.",
  );
export const ruleSchema = z.object({
  sender: z.string().max(254).optional(),
  domain: z.string().max(253).optional(),
  recipient: z.string().max(254).optional(),
  subject: z.string().max(200).optional(),
  unread: z.boolean().optional(),
});
export function matches(criteria: any, message: any) {
  const lower = (s: string) => s.toLowerCase();
  return (
    (!criteria.sender || lower(message.sender) === lower(criteria.sender)) &&
    (!criteria.domain ||
      lower(message.sender.split("@")[1] || "") === lower(criteria.domain)) &&
    (!criteria.recipient ||
      [...message.recipients.to, ...message.recipients.cc].some(
        (r: any) => lower(r.address) === lower(criteria.recipient),
      )) &&
    (!criteria.subject ||
      lower(message.subject).includes(lower(criteria.subject))) &&
    (criteria.unread === undefined || criteria.unread === message.unread)
  );
}
export async function listMessages(db: DB, user: string, options: any = {}) {
  const boxes = (await db.query(visibleMailboxes, [user])).rows
    .filter(
      (x) => !options.workspaceId || x.workspace_id === options.workspaceId,
    )
    .map((x) => x.id);
  if (options.mailboxId) await mailbox(db, user, options.mailboxId);
  return (
    await db.query(
      `SELECT id,mailbox_id,folder,subject,sender,recipients,received_at,unread,thread_key,attachments,left(body,180) AS preview FROM messages WHERE mailbox_id=ANY($1::text[]) AND ($2::text IS NULL OR mailbox_id=$2) AND ($3::text IS NULL OR folder=$3) AND ($4::text IS NULL OR subject ILIKE '%'||$4||'%' OR sender ILIKE '%'||$4||'%' OR body ILIKE '%'||$4||'%') ORDER BY received_at DESC,id LIMIT 40 OFFSET $5`,
      [
        boxes,
        options.mailboxId || null,
        options.folder || null,
        options.q || null,
        Math.max(0, Number(options.page) || 0) * 40,
      ],
    )
  ).rows;
}
export async function readMessage(db: DB, user: string, mid: string) {
  const message = await one(db, "SELECT * FROM messages WHERE id=$1", [mid]);
  if (!message) throw new HttpError(404, "Message not found.");
  await mailbox(db, user, message.mailbox_id);
  return message;
}
export async function getDraft(db: DB, user: string, did: string) {
  const d = await one(db, "SELECT * FROM drafts WHERE id=$1", [did]);
  if (!d) throw new HttpError(404, "Draft not found.");
  await mailbox(db, user, d.mailbox_id, true);
  return d;
}
export function approvalHash(d: any) {
  return digest(
    JSON.stringify({
      mailboxId: d.mailbox_id,
      version: d.version,
      content: d.content,
    }),
  );
}
export async function createDraft(
  db: DB,
  user: string,
  mid: string,
  content: any,
  messageId?: string,
) {
  const box = await mailbox(db, user, mid, true);
  const parsed = contentSchema.parse(content);
  let headers: any = {};
  if (messageId) {
    const m = await readMessage(db, user, messageId);
    if (m.mailbox_id !== mid)
      throw new HttpError(400, "Reply must use the original mailbox.");
    headers = {
      inReplyTo: m.message_id,
      references: [
        ...(Array.isArray(m.headers.references) ? m.headers.references : []),
        m.message_id,
      ].filter(Boolean),
    };
  }
  const did = id();
  await db.query(
    "INSERT INTO drafts(id,mailbox_id,message_id,author_id,content) VALUES($1,$2,$3,$4,$5)",
    [
      did,
      mid,
      messageId || null,
      user,
      JSON.stringify({ ...parsed, ...headers }),
    ],
  );
  await audit(db, box.workspace_id, user, "draft.created", did);
  return getDraft(db, user, did);
}
export async function updateDraft(
  db: DB,
  user: string,
  did: string,
  content: any,
  version: number,
) {
  const old = await getDraft(db, user, did);
  const parsed = contentSchema.parse(content);
  return db.transaction(async (tx) => {
    const changed = await one(
      tx,
      `UPDATE drafts SET content=$1,version=version+1,status='Needs review',approved_hash=NULL,approved_by=NULL,approved_at=NULL WHERE id=$2 AND version=$3 AND status IN ('Needs review','Approved','Failed') AND NOT EXISTS (SELECT 1 FROM outbox WHERE draft_id=$2 AND status IN ('Sending','Accepted by mail server','Delivery uncertain')) RETURNING *`,
      [
        JSON.stringify({
          ...parsed,
          inReplyTo: old.content.inReplyTo,
          references: old.content.references,
        }),
        did,
        version,
      ],
    );
    if (!changed)
      throw new HttpError(
        409,
        "Draft changed or is already being sent. Reload it.",
      );
    await tx.query("DELETE FROM outbox WHERE draft_id=$1", [did]);
    return changed;
  });
}
export async function approveDraft(
  db: DB,
  user: string,
  did: string,
  version: number,
) {
  await getDraft(db, user, did);
  return db.transaction(async (tx) => {
    const d = await one(tx, "SELECT * FROM drafts WHERE id=$1 FOR UPDATE", [
      did,
    ]);
    await mailbox(tx, user, d.mailbox_id, true);
    if (d.version !== version || !["Needs review", "Failed"].includes(d.status))
      throw new HttpError(409, "Review the latest draft before approval.");
    const hash = approvalHash(d);
    // A definitively failed send needs fresh human approval before a new attempt.
    if (d.status === "Failed")
      await tx.query(
        "DELETE FROM outbox WHERE draft_id=$1 AND status='Failed'",
        [did],
      );
    await tx.query(
      `UPDATE drafts SET status='Approved',approved_hash=$1,approved_by=$2,approved_at=now() WHERE id=$3`,
      [hash, user, did],
    );
    const box = await mailbox(tx, user, d.mailbox_id, true);
    await audit(tx, box.workspace_id, user, "draft.approved", did);
    return { status: "Approved", version };
  });
}
export async function queueDraft(db: DB, user: string, did: string) {
  await getDraft(db, user, did);
  return db.transaction(async (tx) => {
    const d = await one(tx, "SELECT * FROM drafts WHERE id=$1 FOR UPDATE", [
      did,
    ]);
    const box = await mailbox(tx, user, d.mailbox_id, true);
    if (d.status !== "Approved" || d.approved_hash !== approvalHash(d))
      throw new HttpError(
        409,
        "This exact draft needs approval in the web application.",
      );
    await mailbox(tx, d.approved_by || "", d.mailbox_id, true);
    await tx.query(
      `INSERT INTO outbox(id,draft_id,version,content_hash) VALUES($1,$2,$3,$4) ON CONFLICT(draft_id) DO NOTHING`,
      [id(), did, d.version, d.approved_hash],
    );
    await audit(tx, box.workspace_id, user, "send.queued", did);
    return { status: "Approved", queued: true };
  });
}
