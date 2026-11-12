import { hash } from "@node-rs/argon2";
import { type DB, one } from "./db.js";
import { encrypt, id } from "./security.js";
import { storeMessage } from "./worker.js";
import { createDraft } from "./mail-service.js";
export async function seed(db: DB) {
  if (await one(db, "SELECT id FROM users WHERE email='demo@example.invalid'"))
    return;
  const uid = id(),
    wid = id();
  await db.query(
    "INSERT INTO users(id,email,password,name,verified) VALUES($1,$2,$3,$4,true)",
    [
      uid,
      "demo@example.invalid",
      await hash("Demo-mail-only-2026"),
      "Alex Morgan",
    ],
  );
  await db.query("INSERT INTO workspaces(id,name,settings) VALUES($1,$2,$3)", [
    wid,
    "Studio workspace",
    JSON.stringify({
      notifications: true,
      aiDailyLimit: 20,
      referenceMaterial: "",
    }),
  ]);
  await db.query("INSERT INTO members VALUES($1,$2,'owner')", [wid, uid]);
  const boxes = [];
  for (const [email, provider] of [
    ["hello@studio.example", "orangehost"],
    ["accounts@studio.example", "ventraip"],
  ]) {
    const mid = id();
    const settings = {
      imap: {
        host: "imap.example.invalid",
        port: 993,
        tls: "tls",
        username: email,
      },
      smtp: {
        host: "smtp.example.invalid",
        port: 465,
        tls: "tls",
        username: email,
      },
      importDays: 14,
      pollSeconds: 300,
      retentionDays: 30,
      signature: "Kind regards,\nAlex",
      tone: "Friendly and professional",
      serverSavesSent: false,
    };
    await db.query(
      "INSERT INTO mailboxes(id,workspace_id,email,provider,settings,secret,demo,status,last_check) VALUES($1,$2,$3,$4,$5,$6,true,'Demo — simulated connection',now())",
      [
        mid,
        wid,
        email,
        provider,
        JSON.stringify(settings),
        encrypt({ password: "synthetic-not-a-credential" }),
      ],
    );
    await db.query(
      "INSERT INTO folders(mailbox_id,path,special_use,uidvalidity) VALUES($1,'INBOX',NULL,'1')",
      [mid],
    );
    boxes.push({ id: mid, settings });
  }
  await db.query(
    "INSERT INTO rules(id,mailbox_id,name,criteria) VALUES($1,$2,$3,$4)",
    [
      id(),
      boxes[0].id,
      "New project enquiries",
      JSON.stringify({ subject: "project" }),
    ],
  );
  const examples = [
    [
      "Jamie Chen",
      "jamie@example.invalid",
      "A new project for December",
      "Hi Alex,\n\nWe’re planning a new project for December and would love to hear how you could help. Could you share a little about your process and arrange a time to chat?\n\nThanks,\nJamie",
    ],
    [
      "North & Co.",
      "team@example.invalid",
      "The final artwork is ready",
      "Hello Alex,\n\nThe final artwork is ready for your review. Let us know if you have any questions before we prepare the next version.\n\nBest,\nThe North & Co. team",
    ],
    [
      "Morgan Ellis",
      "morgan@example.invalid",
      "Re: Thursday catch-up",
      "Hi Alex,\n\nThursday afternoon works well for me. Let me know what time suits you.\n\nMorgan",
    ],
    [
      "Studio Supplies",
      "billing@example.invalid",
      "Your monthly statement",
      "Hello,\n\nYour monthly statement is available. This is a synthetic demonstration message, not a real bill.\n\nStudio Supplies",
    ],
    [
      "Taylor Brooks",
      "taylor@example.invalid",
      "Thanks for your help last week",
      "Hi Alex,\n\nJust a quick note to say thank you for your help last week. We really appreciated the thoughtful approach.\n\nTaylor",
    ],
  ];
  let first: any;
  for (let i = 0; i < examples.length; i++) {
    const [_name, sender, subject, body] = examples[i],
      box = boxes[i === 3 ? 1 : 0];
    const m = await storeMessage(db, box, "INBOX", "1", i + 1, {
      messageId: `<demo-${i}@example.invalid>`,
      threadKey: `demo-${i}`,
      subject,
      sender,
      recipients: {
        to: [
          {
            address:
              i === 3 ? "accounts@studio.example" : "hello@studio.example",
            name: "",
          },
        ],
        cc: [],
      },
      receivedAt: new Date(Date.now() - i * 3600000),
      unread: i < 3,
      body,
      html: "",
      attachments: [],
      headers: { references: [] },
    });
    if (!i) first = m;
  }
  await createDraft(
    db,
    uid,
    boxes[0].id,
    {
      to: [first.sender],
      cc: [],
      bcc: [],
      subject: "Re: " + first.subject,
      body: "Hi Jamie,\n\nThanks for getting in touch. I’d love to learn more about the project. Could you share your goals and preferred timeline?\n\nKind regards,\nAlex",
      attachments: [],
    },
    first.id,
  );
}
