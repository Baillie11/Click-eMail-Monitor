import { one, type DB } from "./db.js";
import { HttpError, id } from "./security.js";
export async function workspace(
  db: DB,
  user: string,
  wid: string,
  admin = false,
) {
  const m = await one(
    db,
    "SELECT * FROM members WHERE workspace_id=$1 AND user_id=$2",
    [wid, user],
  );
  if (!m || (admin && m.role === "member"))
    throw new HttpError(403, "Workspace access denied.");
  return m;
}
export async function mailbox(db: DB, user: string, mid: string, send = false) {
  const m = await one(
    db,
    `SELECT b.*,m.role,p.can_send FROM mailboxes b JOIN members m ON m.workspace_id=b.workspace_id AND m.user_id=$2 LEFT JOIN mailbox_permissions p ON p.mailbox_id=b.id AND p.user_id=$2 WHERE b.id=$1 AND (m.role IN ('owner','administrator') OR p.user_id IS NOT NULL)`,
    [mid, user],
  );
  if (!m || (send && m.role === "member" && !m.can_send))
    throw new HttpError(403, "Mailbox access denied.");
  return m;
}
export async function audit(
  db: DB,
  wid: string,
  user: string | null,
  action: string,
  entity: string,
) {
  await db.query(
    "INSERT INTO audit(id,workspace_id,user_id,action,entity_id) VALUES($1,$2,$3,$4,$5)",
    [id(), wid, user, action, entity],
  );
}
export const visibleMailboxes = `SELECT b.id,b.workspace_id,b.email,b.provider,b.paused,b.demo,b.status,b.last_check,b.next_check,b.settings,(SELECT count(*)::int FROM messages msg WHERE msg.mailbox_id=b.id) AS email_count FROM mailboxes b JOIN members m ON m.workspace_id=b.workspace_id AND m.user_id=$1 LEFT JOIN mailbox_permissions p ON p.mailbox_id=b.id AND p.user_id=$1 WHERE (m.role IN ('owner','administrator') OR p.user_id IS NOT NULL)`;
