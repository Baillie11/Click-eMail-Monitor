import { type DB, one } from "./db.js";
import { id, safeMailError, HttpError } from "./security.js";
import { imapClient, smtpClient, parseMessage, compose } from "./providers.js";
import { matches, approvalHash } from "./mail-service.js";
import { mailbox, audit } from "./access.js";
import { syncContacts } from "./contact-sync.js";
import { config } from "./config.js";
export async function storeMessage(
  db: DB,
  box: any,
  folder: string,
  validity: string,
  uid: number,
  message: any,
) {
  const mid = id();
  const m = await one(
    db,
    `INSERT INTO messages(id,mailbox_id,folder,uidvalidity,uid,message_id,thread_key,subject,sender,recipients,received_at,unread,body,html,attachments,headers) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(mailbox_id,folder,uidvalidity,uid) DO UPDATE SET unread=excluded.unread RETURNING *`,
    [
      mid,
      box.id,
      folder,
      validity,
      uid,
      message.messageId,
      message.threadKey || `${box.id}:${folder}:${validity}:${uid}`,
      message.subject,
      message.sender,
      JSON.stringify(message.recipients),
      message.receivedAt,
      message.unread,
      message.body,
      message.html,
      JSON.stringify(message.attachments),
      JSON.stringify(message.headers),
    ],
  );
  const rules = (
    await db.query("SELECT * FROM rules WHERE mailbox_id=$1 AND enabled=true", [
      box.id,
    ])
  ).rows;
  for (const r of rules) {
    if (matches(r.criteria, m))
      await db.query(
        "INSERT INTO alerts(id,mailbox_id,rule_id,message_id) VALUES($1,$2,$3,$4) ON CONFLICT(rule_id,message_id) DO NOTHING",
        [id(), box.id, r.id, m.id],
      );
  }
  return m;
}
export async function syncMailbox(db: DB, box: any, makeClient = imapClient) {
  const client = await makeClient(box);
  let imported = 0;
  try {
    await client.connect();
    const folders = await client.list();
    const available = folders.filter((f) => !f.flags.has("\\Noselect"));
    await db.query(
      "DELETE FROM folders WHERE mailbox_id=$1 AND NOT(path=ANY($2::text[]))",
      [box.id, available.map((f) => f.path)],
    );
    for (const f of available) {
      const lock = await client.getMailboxLock(f.path);
      try {
        if (!client.mailbox) continue;
        const validity = String(client.mailbox.uidValidity);
        await db.transaction(async (tx) => {
          const prev = await one(
            tx,
            "SELECT * FROM folders WHERE mailbox_id=$1 AND path=$2",
            [box.id, f.path],
          );
          if (prev && prev.uidvalidity !== validity)
            await tx.query(
              "DELETE FROM messages WHERE mailbox_id=$1 AND folder=$2",
              [box.id, f.path],
            );
          await tx.query(
            `INSERT INTO folders(mailbox_id,path,special_use,uidvalidity) VALUES($1,$2,$3,$4) ON CONFLICT(mailbox_id,path) DO UPDATE SET special_use=excluded.special_use,last_uid=CASE WHEN folders.uidvalidity=excluded.uidvalidity THEN folders.last_uid ELSE 0 END,uidvalidity=excluded.uidvalidity`,
            [box.id, f.path, f.specialUse || null, validity],
          );
        });
        const folder = await one(
          db,
          "SELECT * FROM folders WHERE mailbox_id=$1 AND path=$2",
          [box.id, f.path],
        );
        const since = new Date(Date.now() - box.settings.importDays * 86400000);
        const found = await client.search(
          { since, uid: `${Number(folder.last_uid) + 1}:*` },
          { uid: true },
        );
        const uids = (found || [])
          .filter((u) => u > Number(folder.last_uid))
          .sort((a, b) => a - b)
          .slice(0, 100);
        for (const uid of uids) {
          const envelope = await client.fetchOne(
            uid,
            { size: true, flags: true },
            { uid: true },
          );
          if (!envelope) continue;
          if ((envelope.size ?? Infinity) <= config.maxMessageBytes) {
            const item = await client.fetchOne(
              uid,
              { source: { start: 0, maxLength: config.maxMessageBytes + 1 } },
              { uid: true },
            );
            if (item && item.source) {
              const msg = await parseMessage(item.source);
              await storeMessage(db, box, f.path, validity, uid, {
                ...msg,
                unread: !envelope.flags?.has("\\Seen"),
              });
              imported++;
            }
          }
          await db.query(
            "UPDATE folders SET last_uid=$1 WHERE mailbox_id=$2 AND path=$3",
            [uid, box.id, f.path],
          );
        }
        // Refresh flags/deletions for the bounded retained window without changing read state.
        const retained = (
          await db.query(
            "SELECT uid FROM messages WHERE mailbox_id=$1 AND folder=$2 AND uidvalidity=$3",
            [box.id, f.path, validity],
          )
        ).rows.map((r) => Number(r.uid));
        for (let i = 0; i < retained.length; i += 200) {
          const batch = retained.slice(i, i + 200),
            seen: number[] = [];
          for await (const item of client.fetch(
            batch,
            { uid: true, flags: true },
            { uid: true },
          )) {
            seen.push(item.uid);
            await db.query(
              "UPDATE messages SET unread=$1 WHERE mailbox_id=$2 AND folder=$3 AND uidvalidity=$4 AND uid=$5",
              [!item.flags?.has("\\Seen"), box.id, f.path, validity, item.uid],
            );
          }
          const removed = batch.filter((u) => !seen.includes(u));
          if (removed.length)
            await db.query(
              "DELETE FROM messages WHERE mailbox_id=$1 AND folder=$2 AND uid=ANY($3::bigint[])",
              [box.id, f.path, removed],
            );
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return imported;
}
export async function claimMailbox(db: DB, owner: string) {
  return db.transaction(async (tx) => {
    const b = await one(
      tx,
      `SELECT * FROM mailboxes WHERE paused=false AND demo=false AND next_check<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_check FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    if (!b) return;
    await tx.query(
      "UPDATE mailboxes SET lease_until=now()+interval '2 minutes',lease_owner=$1 WHERE id=$2",
      [owner, b.id],
    );
    return b;
  });
}
export async function recoverOutbox(db: DB) {
  await db.transaction(async (tx) => {
    const stale = (
      await tx.query(
        `UPDATE outbox SET status='Delivery uncertain',result='Worker stopped during sending. Reconcile with Sent folder before any resend.',completed_at=now() WHERE status='Sending' AND started_at<now()-interval '5 minutes' RETURNING draft_id`,
      )
    ).rows;
    for (const s of stale)
      await tx.query(
        `UPDATE drafts SET status='Delivery uncertain' WHERE id=$1`,
        [s.draft_id],
      );
  });
}
// Fence every sync database operation. An expired/replaced worker may finish a
// network read but cannot commit stale data after another worker takes the lease.
export function leasedDatabase(db: DB, mid: string, owner: string): DB {
  const fence = async (tx: DB) => {
    const valid = await one(
      tx,
      "SELECT id FROM mailboxes WHERE id=$1 AND lease_owner=$2 AND lease_until>now() FOR UPDATE",
      [mid, owner],
    );
    if (!valid) throw new Error("Mailbox sync lease was lost.");
  };
  return {
    query: async (s, v) =>
      db.transaction(async (tx) => {
        await fence(tx);
        return tx.query(s, v);
      }),
    transaction: async (fn) =>
      db.transaction(async (tx) => {
        await fence(tx);
        return fn(tx);
      }),
    close: async () => {},
  };
}
export async function sendNext(
  db: DB,
  send?: (box: any, draft: any) => Promise<string>,
) {
  const item = await db.transaction(async (tx) => {
    const o = await one(
      tx,
      `SELECT * FROM outbox WHERE status='Approved' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    if (!o) return;
    const d = await one(tx, "SELECT * FROM drafts WHERE id=$1 FOR UPDATE", [
      o.draft_id,
    ]);
    const b = await one(tx, "SELECT * FROM mailboxes WHERE id=$1 FOR UPDATE", [
      d.mailbox_id,
    ]);
    try {
      await mailbox(tx, d.approved_by, d.mailbox_id, true);
      if (
        o.version !== d.version ||
        o.content_hash !== approvalHash(d) ||
        d.approved_hash !== o.content_hash ||
        d.status !== "Approved"
      )
        throw new Error("Approval is no longer valid.");
    } catch {
      await tx.query(
        `UPDATE outbox SET status='Failed',result='Approval or mailbox permission is no longer valid.' WHERE id=$1`,
        [o.id],
      );
      await tx.query(
        `UPDATE drafts SET status='Needs review',approved_hash=NULL,approved_by=NULL WHERE id=$1`,
        [d.id],
      );
      return;
    }
    await tx.query(
      `UPDATE outbox SET status='Sending',started_at=now() WHERE id=$1`,
      [o.id],
    );
    await tx.query(`UPDATE drafts SET status='Sending' WHERE id=$1`, [d.id]);
    return { o, d, b };
  });
  if (!item) return;
  const { o, d, b } = item;
  let status = "Accepted by mail server",
    result = "";
  try {
    if (send) result = await send(b, d);
    else if (b.demo) {
      result = "DEMO: simulated acceptance; no email was sent.";
    } else {
      const messageId = `<${o.id}@${b.email.split("@")[1]}>`;
      const raw = await compose(b, d.content, messageId);
      const transport = await smtpClient(b);
      let accepted = false;
      try {
        const sent = await transport.sendMail({
          envelope: {
            from: b.email,
            to: [...d.content.to, ...d.content.cc, ...d.content.bcc],
          },
          raw,
        });
        accepted = sent.accepted.length > 0;
        result = sent.rejected.length
          ? "SMTP accepted some recipients; others were rejected. Reconcile before resending."
          : "Accepted by SMTP server; delivery is not confirmed.";
        if (!accepted) throw new Error("No recipients accepted.");
      } finally {
        transport.close();
      }
      if (!b.settings.serverSavesSent) {
        try {
          const client = await imapClient(b);
          await client.connect();
          try {
            const folders = await client.list();
            const sent = folders.find((f) => f.specialUse === "\\Sent");
            if (sent) await client.append(sent.path, raw, ["\\Seen"]);
            else result += " Sent folder not identified; copy not saved.";
          } finally {
            await client.logout().catch(() => client.close());
          }
        } catch {
          result +=
            " Sent copy could not be saved; SMTP acceptance is recorded.";
        }
      }
    }
  } catch (e: any) {
    const definite =
      ["EAUTH", "ECONNECTION", "EDNS", "ETLS"].includes(e.code) ||
      Number(e.responseCode) >= 400;
    status = definite ? "Failed" : "Delivery uncertain";
    result = definite
      ? safeMailError(e)
      : "Sending ended without a definitive result. Check the provider Sent folder or logs before creating another reply.";
  }
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE outbox SET status=$1,result=$2,completed_at=now() WHERE id=$3",
      [status, result, o.id],
    );
    await tx.query("UPDATE drafts SET status=$1 WHERE id=$2", [status, d.id]);
    await audit(tx, b.workspace_id, null, "send." + status, d.id);
  });
}
// Manual and scheduled checks share the same lease, heartbeat and failure handling.
export async function checkMailboxNow(db: DB, user: string, mid: string, sync = syncMailbox) {
  const owner = id();
  const box = await db.transaction(async (tx) => {
    await mailbox(tx, user, mid);
    const b = await one(tx, "SELECT * FROM mailboxes WHERE id=$1 FOR UPDATE", [mid]);
    if (!b || b.demo) throw new HttpError(400, "Demo mailboxes cannot check for new email.");
    const busy = await one(tx, "SELECT id FROM mailboxes WHERE id=$1 AND lease_until>now()", [mid]);
    if (busy) throw new HttpError(409, "This mailbox is already being checked. Please try again shortly.");
    await tx.query("UPDATE mailboxes SET lease_until=now()+interval '2 minutes',lease_owner=$1 WHERE id=$2", [owner, mid]);
    return b;
  });
  return runMailboxCheck(db, box, owner, sync);
}
async function runMailboxCheck(db: DB, box: any, owner: string, sync = syncMailbox) {
    const heartbeat = setInterval(() => {
      void db
        .query(
          "UPDATE mailboxes SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND lease_owner=$2",
          [box.id, owner],
        )
        .catch(() => {});
    }, 20000);
    try {
      const imported = await sync(leasedDatabase(db, box.id, owner), box);
      await db.query(
        `UPDATE mailboxes SET status='Connected',last_check=now(),failures=0,next_check=now()+($1*interval '1 second') WHERE id=$2 AND lease_owner=$3`,
        [Math.max(config.minPoll, box.settings.pollSeconds), box.id, owner],
      );
      return { ok: true as const, imported };
    } catch (e) {
      await db.query(
        `UPDATE mailboxes SET status=$1,failures=failures+1,next_check=now()+($2*interval '1 second') WHERE id=$3 AND lease_owner=$4`,
        [
          safeMailError(e),
          Math.min(
            86400,
            Math.max(config.minPoll, box.settings.pollSeconds) *
              2 ** Math.min(box.failures + 1, 8),
          ),
          box.id,
          owner,
        ],
      );
      return { ok: false as const, error: safeMailError(e) };
    } finally {
      clearInterval(heartbeat);
      await db.query(
        "UPDATE mailboxes SET lease_until=NULL,lease_owner=NULL WHERE id=$1 AND lease_owner=$2",
        [box.id, owner],
      );
    }
}
export async function tick(db: DB) {
  await recoverOutbox(db);
  await sendNext(db);
  const owner = id(),
    box = await claimMailbox(db, owner);
  if (box) await runMailboxCheck(db, box, owner);
  // CRM outages must not prevent mailbox checks or retention cleanup.
  try {
    const result = await syncContacts(db);
    if (result.failed) console.error("Contact sync delivery failed; will retry on the next worker run.");
  } catch {
    console.error("Contact sync unavailable; check its configuration and migration.");
  }
  await db.query(
    `DELETE FROM messages m USING mailboxes b WHERE m.mailbox_id=b.id AND m.received_at<now()-((b.settings->>'retentionDays')::int*interval '1 day')`,
  );
  await db.query("DELETE FROM sessions WHERE expires_at<now()");
  await db.query("DELETE FROM tokens WHERE expires_at<now()");
  await db.query("DELETE FROM oauth_codes WHERE expires_at<now()");
  await db.query("DELETE FROM oauth_tokens WHERE expires_at<now()");
  await db.query("DELETE FROM oauth_refresh_tokens WHERE expires_at<now()");
}
