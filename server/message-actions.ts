import { type DB, one } from "./db.js";
import { mailbox, workspace, audit } from "./access.js";
import { readMessage } from "./mail-service.js";
import { imapClient } from "./providers.js";
import { HttpError, id } from "./security.js";

/** Move precisely one authorised message; never use DELETE/EXPUNGE fallback. */
export async function trashMessage(
  db: DB,
  user: string,
  messageId: string,
  makeClient = imapClient,
) {
  const original = await readMessage(db, user, messageId);
  const box = await mailbox(db, user, original.mailbox_id);
  await workspace(db, user, box.workspace_id, true);
  const owner = id();
  await db.transaction(async (tx) => {
    const current = await one(
      tx,
      "SELECT id FROM mailboxes WHERE id=$1 FOR UPDATE",
      [box.id],
    );
    if (!current) throw new HttpError(404, "Mailbox not found.");
    const busy = await one(
      tx,
      "SELECT id FROM mailboxes WHERE id=$1 AND lease_until>now()",
      [box.id],
    );
    if (busy)
      throw new HttpError(
        409,
        "This mailbox is busy. Please try again shortly.",
      );
    await tx.query(
      "UPDATE mailboxes SET lease_until=now()+interval '2 minutes',lease_owner=$1 WHERE id=$2",
      [owner, box.id],
    );
  });
  const heartbeat = setInterval(() => {
    void db
      .query(
        "UPDATE mailboxes SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND lease_owner=$2",
        [box.id, owner],
      )
      .catch(() => {});
  }, 20000);
  let client: Awaited<ReturnType<typeof imapClient>> | undefined;
  try {
    const message = await readMessage(db, user, messageId);
    // Recheck authority after acquiring the lease.
    await workspace(db, user, box.workspace_id, true);
    let destination = "Trash",
      validity = "demo-trash",
      uid = 0;
    if (!box.demo) {
      client = await makeClient(box);
      await client.connect();
      const folders = await client.list();
      const trash = folders.filter(
        (f) => f.specialUse === "\\Trash" && !f.flags.has("\\Noselect"),
      );
      if (trash.length !== 1)
        throw new HttpError(
          409,
          "The provider has not identified a unique Trash folder. No message was moved.",
        );
      destination = trash[0].path;
      if (message.folder === destination)
        throw new HttpError(
          409,
          "This message is already in Trash. Permanent deletion is not supported.",
        );
      if (!client.capabilities.has("MOVE"))
        throw new HttpError(
          409,
          "This provider does not support safe message moves. Use your provider's webmail to move this message to Trash.",
        );
      const lock = await client.getMailboxLock(message.folder);
      try {
        if (
          !client.mailbox ||
          String(client.mailbox.uidValidity) !== message.uidvalidity
        )
          throw new HttpError(
            409,
            "The folder changed. Check this mailbox before trying again.",
          );
        const current = await client.fetchOne(
          Number(message.uid),
          { uid: true, envelope: true },
          { uid: true },
        );
        if (
          !current ||
          (message.message_id &&
            current.envelope?.messageId !== message.message_id)
        )
          throw new HttpError(
            409,
            "The message changed or is no longer in this folder. Check the mailbox before trying again.",
          );
        const active = await one(
          db,
          "SELECT id FROM mailboxes WHERE id=$1 AND lease_owner=$2 AND lease_until>now()",
          [box.id, owner],
        );
        if (!active)
          throw new HttpError(
            409,
            "The mailbox operation expired. Please try again.",
          );
        const moved = await client.messageMove(
          String(message.uid),
          destination,
          { uid: true },
        );
        if (!moved)
          throw new HttpError(
            409,
            "The provider did not confirm moving the message. Check the mailbox before trying again.",
          );
        validity = moved.uidValidity ? String(moved.uidValidity) : "";
        uid = Number(moved.uidMap?.get(Number(message.uid)) || 0);
      } finally {
        lock.release();
      }
    } else {
      if (message.folder === destination)
        throw new HttpError(409, "This message is already in Trash.");
      uid =
        Number(
          (
            await one(
              db,
              "SELECT max(uid) AS highest FROM messages WHERE mailbox_id=$1 AND folder=$2",
              [box.id, destination],
            )
          )?.highest || 0,
        ) + 1;
    }
    await db.transaction(async (tx) => {
      const held = await one(
        tx,
        "SELECT lease_owner FROM mailboxes WHERE id=$1 FOR UPDATE",
        [box.id],
      );
      if (held?.lease_owner !== owner)
        throw new HttpError(
          409,
          "The mailbox operation expired. Check your provider's Trash and refresh this mailbox before retrying.",
        );
      if (uid && validity) {
        await tx.query(
          "UPDATE messages SET folder=$1,uidvalidity=$2,uid=$3 WHERE id=$4",
          [destination, validity, uid, message.id],
        );
        await tx.query(
          "INSERT INTO folders(mailbox_id,path,special_use,uidvalidity) VALUES($1,$2,$3,$4) ON CONFLICT(mailbox_id,path) DO NOTHING",
          [box.id, destination, "\\Trash", validity],
        );
        await tx.query(
          "UPDATE folders SET special_use=$1 WHERE mailbox_id=$2 AND path=$3",
          ["\\Trash", box.id, destination],
        );
      } else {
        // UID mapping is optional in IMAP: the next sync imports the destination copy.
        await tx.query("DELETE FROM messages WHERE id=$1", [message.id]);
      }
      await tx.query("DELETE FROM alerts WHERE message_id=$1", [message.id]);
      await audit(
        tx,
        box.workspace_id,
        user,
        "message.moved_to_trash",
        message.id,
      );
    });
    return {
      ok: true,
      id: messageId,
      destination,
      demo: Boolean(box.demo),
      message: box.demo
        ? "Demo message moved to Trash."
        : "Moved to your provider's Trash. Restore it in webmail before your provider empties Trash.",
    };
  } finally {
    clearInterval(heartbeat);
    if (client) await client.logout().catch(() => client?.close());
    await db.query(
      "UPDATE mailboxes SET lease_until=NULL,lease_owner=NULL WHERE id=$1 AND lease_owner=$2",
      [box.id, owner],
    );
  }
}
