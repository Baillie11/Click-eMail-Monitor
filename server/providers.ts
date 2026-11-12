import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { simpleParser } from "mailparser";
import { z } from "zod";
import { safeEndpoint, decrypt, cleanHtml } from "./security.js";
import { config } from "./config.js";
export const connectionSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int(),
  tls: z.enum(["tls", "starttls"]),
  username: z.string().min(1).max(254),
});
export const mailboxSchema = z.object({
  workspaceId: z.string(),
  email: z.string().email(),
  provider: z.enum(["orangehost", "ventraip", "generic"]),
  imap: connectionSchema,
  smtp: connectionSchema,
  password: z.string().min(1).max(1000),
  smtpPassword: z.string().max(1000).optional(),
  importDays: z.number().int().min(1).max(90).default(14),
  pollSeconds: z.number().int().min(60).max(86400).default(300),
  retentionDays: z.number().int().min(1).max(365).default(30),
  signature: z.string().max(3000).default(""),
  tone: z.string().max(100).default("Friendly and professional"),
  serverSavesSent: z.boolean().default(false),
});
export const providers = {
  orangehost: {
    name: "OrangeHost",
    status: "Ready to connect — not live verified",
    instructions:
      "Copy the secure manual settings from your hosting control panel. Confirm hostnames with OrangeHost; no server hostname is assumed.",
  },
  ventraip: {
    name: "VentraIP",
    status: "Preview — not live verified",
    instructions:
      "Use the settings for your particular VentraIP email service. Dedicated email and cPanel email may use different hosts.",
  },
  generic: {
    name: "Other IMAP/SMTP",
    status: "Preview — not live verified",
    instructions:
      "Use the secure connection settings supplied by your email provider.",
  },
};
export async function imapClient(box: any) {
  const s = box.settings.imap;
  const endpoint = await safeEndpoint(s.host, s.port, "imap");
  const secret = decrypt(box.secret);
  return new ImapFlow({
    host: endpoint.host,
    port: s.port,
    secure: s.tls === "tls",
    doSTARTTLS: s.tls === "starttls",
    auth: { user: s.username, pass: secret.password },
    tls: {
      servername: endpoint.servername,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    disableAutoIdle: true,
  });
}
export async function smtpClient(box: any) {
  const s = box.settings.smtp;
  const endpoint = await safeEndpoint(s.host, s.port, "smtp");
  const secret = decrypt(box.secret);
  return nodemailer.createTransport({
    host: endpoint.host,
    port: s.port,
    secure: s.tls === "tls",
    requireTLS: true,
    auth: { user: s.username, pass: secret.smtpPassword || secret.password },
    tls: {
      servername: endpoint.servername,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
export async function parseMessage(source: Buffer) {
  if (source.length > config.maxMessageBytes)
    throw new Error("Message exceeds import size limit.");
  const p = await simpleParser(source, {
    skipHtmlToText: true,
    skipTextToHtml: true,
  });
  const addresses = (a: any) =>
    (Array.isArray(a) ? a.flatMap((x: any) => x.value) : a?.value || []).map(
      (x: any) => ({ name: x.name || "", address: x.address || "" }),
    );
  return {
    messageId: p.messageId || null,
    threadKey:
      (Array.isArray(p.references) ? p.references[0] : p.references) ||
      p.inReplyTo ||
      p.messageId ||
      "",
    subject: p.subject || "(No subject)",
    sender: addresses(p.from)[0]?.address || "",
    recipients: { to: addresses(p.to), cc: addresses(p.cc) },
    receivedAt: p.date || new Date(),
    body: (p.text || "").slice(0, 200000),
    html: cleanHtml(p.html || ""),
    attachments: p.attachments.map((a, index) => ({
      index,
      filename: a.filename || "attachment",
      size: a.size,
      contentType: a.contentType,
    })),
    headers: {
      senderName: addresses(p.from)[0]?.name || "",
      organization: typeof p.headers.get("organization") === "string" ? p.headers.get("organization") : "",
      autoSubmitted: String(p.headers.get("auto-submitted") || ""),
      precedence: String(p.headers.get("precedence") || ""),
      listId: Boolean(p.headers.get("list-id")),
      inReplyTo: p.inReplyTo || null,
      references: p.references || [],
      replyTo: addresses(p.replyTo),
    },
    parsed: p,
  };
}
export async function attachment(box: any, message: any, index: number) {
  const client = await imapClient(box);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(message.folder);
    try {
      if (
        !client.mailbox ||
        String(client.mailbox.uidValidity) !== message.uidvalidity
      )
        throw new Error("Folder changed; synchronise before downloading.");
      const item = await client.fetchOne(
        Number(message.uid),
        { source: { start: 0, maxLength: config.maxMessageBytes + 1 } },
        { uid: true },
      );
      if (!item || !item.source)
        throw new Error("Message no longer available.");
      const parsed = await parseMessage(item.source);
      const a = parsed.parsed.attachments[index];
      if (!a || a.size > config.maxAttachmentBytes)
        throw new Error("Attachment unavailable or exceeds 5 MB limit.");
      return a;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}
export function compose(box: any, content: any, messageId: string) {
  return new MailComposer({
    from: box.email,
    to: content.to,
    cc: content.cc,
    bcc: content.bcc,
    subject: content.subject,
    text: content.body,
    messageId,
    inReplyTo: content.inReplyTo || undefined,
    references: content.references || undefined,
    attachments: (content.attachments || []).map((a: any) => ({
      filename: a.filename,
      content: Buffer.from(a.base64, "base64"),
      contentType: a.contentType,
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
  })
    .compile()
    .build();
}
