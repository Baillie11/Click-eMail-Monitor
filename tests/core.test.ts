import { testDatabase } from "./database.js";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { one, type DB } from "../server/db.js";
import { migrate } from "../server/schema.js";
import { config } from "../server/config.js";
import { seed } from "../server/seed.js";
import { createApp, errorHandler } from "../server/app.js";
import {
  id,
  encrypt,
  decrypt,
  publicAddress,
  safeEndpoint,
  cleanHtml,
  safeMailError,
  digest,
} from "../server/security.js";
import { mailbox } from "../server/access.js";
import {
  createDraft,
  approveDraft,
  queueDraft,
  updateDraft,
  getDraft,
  matches,
} from "../server/mail-service.js";
import {
  sendNext,
  recoverOutbox,
  storeMessage,
  claimMailbox,
  checkMailboxNow,
} from "../server/worker.js";
import { parseMessage, providers, mailboxSchema } from "../server/providers.js";
import { oauthProvider } from "../server/oauth.js";
import { issueToken } from "../server/auth.js";
let db: DB, user: string, box: any, agent: any, csrf: string, app: any;
const draftContent = {
  to: ["recipient@example.invalid"],
  cc: [],
  bcc: [],
  subject: "Test reply",
  body: "A reviewed reply",
  attachments: [],
};
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
  app = createApp(db);
  app.use(errorHandler);
  agent = request.agent(app);
  const r = await agent
    .post("/api/auth/login")
    .send({ email: "demo@example.invalid", password: "Demo-mail-only-2026" });
  expect(r.status).toBe(200);
  csrf = r.body.csrf;
}, 30000);
afterAll(async () => {
  await db.close();
});
const post = (url: string, data: any) =>
  agent
    .post(url)
    .set("origin", config.origin)
    .set("x-csrf-token", csrf)
    .send(data);
describe("Credentials and network boundaries", () => {
  it("encrypts with authenticated encryption and rejects tampering or the wrong key", () => {
    const value = encrypt({ password: "private-value" });
    expect(value).not.toContain("private-value");
    expect(decrypt(value).password).toBe("private-value");
    expect(() => decrypt(value, "cd".repeat(32))).toThrow();
    const parts = value.split(".");
    parts[1] = "A" + parts[1].slice(1);
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it.each([
    "127.0.0.1",
    "10.1.1.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ])("blocks nonpublic address %s", (ip) =>
    expect(publicAddress(ip)).toBe(false),
  );
  it("rejects mixed public/private DNS answers and unsupported ports", async () => {
    const mixed = vi.fn().mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(
      safeEndpoint("mail.example.com", 993, "imap", mixed as any),
    ).rejects.toThrow("public");
    await expect(
      safeEndpoint("mail.example.com", 22, "imap", mixed as any),
    ).rejects.toThrow("port");
  });
  it("pins a validated address and preserves the TLS hostname, preventing re-resolution", async () => {
    const endpoint = await safeEndpoint(
      "mail.example.com",
      993,
      "imap",
      vi.fn().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]) as any,
    );
    expect(endpoint).toEqual({
      host: "8.8.8.8",
      servername: "mail.example.com",
    });
  });
  it("strips scripts, trackers, event handlers and unsafe links from HTML", () => {
    const html = cleanHtml(
      '<script>alert(1)</script><img src="https://tracker.invalid/x"><p onclick="evil()">Hi <a href="javascript:evil()">link</a></p><iframe src="evil"></iframe>',
    );
    expect(html).not.toMatch(/script|img|onclick|iframe|javascript/);
    expect(html).toContain("Hi");
  });
  it("redacts arbitrary provider error contents", () => {
    expect(
      safeMailError({ message: "password=TOPSECRET", code: "UNKNOWN" }),
    ).not.toContain("TOPSECRET");
  });
});
describe("Authentication and tenant isolation", () => {
  it("registers, verifies and resets an account through single-use delivered links", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const mock = vi
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({ sendMail } as any);
    const old = process.env.ACCOUNT_SMTP_URL;
    process.env.ACCOUNT_SMTP_URL =
      "smtps://account:synthetic@service.example.invalid:465";
    config.demo = false;
    try {
      const email = "new-user@example.invalid",
        password = "A-long-test-password";
      const r = await request(app).post("/api/auth/register").send({
        email,
        password,
        name: "New User",
        workspace: "New Workspace",
      });
      expect(r.status).toBe(201);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(
        (await request(app).post("/api/auth/login").send({ email, password }))
          .status,
      ).toBe(403);
      const link = sendMail.mock.calls[0][0].text.match(/http[^\s]+/)[0];
      const raw = new URL(link).searchParams.get("token");
      expect(
        (await request(app).post("/api/auth/verify").send({ token: raw }))
          .status,
      ).toBe(200);
      const signedIn = request.agent(app);
      expect(
        (await signedIn.post("/api/auth/login").send({ email, password }))
          .status,
      ).toBe(200);
      const uid = (
        await one(db, "SELECT id FROM users WHERE email=$1", [email])
      ).id;
      const reset = await issueToken(db, uid, "reset");
      expect(
        (
          await request(app)
            .post("/api/auth/reset")
            .send({ token: reset, password: "A-new-long-password" })
        ).status,
      ).toBe(200);
      expect((await signedIn.get("/api/me")).status).toBe(401);
      expect(
        (
          await request(app)
            .post("/api/auth/reset")
            .send({ token: reset, password: "Another-long-password" })
        ).status,
      ).toBe(400);
    } finally {
      config.demo = true;
      if (old === undefined) delete process.env.ACCOUNT_SMTP_URL;
      else process.env.ACCOUNT_SMTP_URL = old;
      mock.mockRestore();
    }
  });
  it("rejects unauthenticated mailbox and MCP access", async () => {
    expect((await request(app).get("/api/mailboxes")).status).toBe(401);
    expect((await request(app).post("/mcp").send({})).status).toBe(401);
  });
  it("rejects absent and cross-origin CSRF tokens", async () => {
    expect((await agent.post("/api/drafts").send({})).status).toBe(403);
    expect(
      (
        await agent
          .post("/api/drafts")
          .set("origin", "https://evil.invalid")
          .set("x-csrf-token", csrf)
          .send({})
      ).status,
    ).toBe(403);
  });
  it("does not expose encrypted secrets through mailbox APIs", async () => {
    const r = await agent.get("/api/mailboxes");
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain("secret");
    expect(JSON.stringify(r.body)).not.toContain("synthetic-not-a-credential");
  });
  it("blocks cross-tenant access even when a mailbox ID is supplied", async () => {
    const outsider = id();
    await db.query(
      "INSERT INTO users(id,email,password,name,verified) VALUES($1,$2,$3,$4,true)",
      [outsider, "outsider@example.invalid", "unused", "Outsider"],
    );
    await expect(mailbox(db, outsider, box.id)).rejects.toMatchObject({
      status: 403,
    });
    const second = id();
    await db.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [
      second,
      "Other workspace",
    ]);
    await db.query("INSERT INTO members VALUES($1,$2,'owner')", [
      second,
      outsider,
    ]);
    await expect(mailbox(db, outsider, box.id)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("enforces explicit member mailbox read and send grants", async () => {
    const uid = id();
    await db.query(
      "INSERT INTO users(id,email,password,name) VALUES($1,$2,$3,$4)",
      [uid, "member@example.invalid", "unused", "Member"],
    );
    await db.query("INSERT INTO members VALUES($1,$2,'member')", [
      box.workspace_id,
      uid,
    ]);
    await expect(mailbox(db, uid, box.id)).rejects.toMatchObject({
      status: 403,
    });
    await db.query("INSERT INTO mailbox_permissions VALUES($1,$2,false)", [
      box.id,
      uid,
    ]);
    expect((await mailbox(db, uid, box.id)).id).toBe(box.id);
    await expect(mailbox(db, uid, box.id, true)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("uses single-use email verification tokens", async () => {
    const raw = await issueToken(db, user, "verify");
    expect(
      (await request(app).post("/api/auth/verify").send({ token: raw })).status,
    ).toBe(200);
    expect(
      (await request(app).post("/api/auth/verify").send({ token: raw })).status,
    ).toBe(400);
  });
  it("disables live mailbox connections in demo mode", async () => {
    expect((await post("/api/mailboxes", {})).status).toBe(403);
  });
});
describe("Approval and durable sending", () => {
  it("does not accept model-supplied approval flags", async () => {
    const d = await createDraft(db, user, box.id, draftContent);
    expect(
      (await post("/api/drafts/" + d.id + "/send", { approved: true })).status,
    ).toBe(409);
  });
  it("invalidates approval on edits and rejects stale versions", async () => {
    const d = await createDraft(db, user, box.id, draftContent);
    await approveDraft(db, user, d.id, 1);
    const changed = await updateDraft(
      db,
      user,
      d.id,
      { ...draftContent, body: "Changed" },
      1,
    );
    expect(changed.version).toBe(2);
    expect(changed.approved_hash).toBeNull();
    await expect(queueDraft(db, user, d.id)).rejects.toThrow();
    await expect(approveDraft(db, user, d.id, 1)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("queues once, sends once, and records SMTP acceptance without claiming delivery", async () => {
    const d = await createDraft(db, user, box.id, draftContent);
    await approveDraft(db, user, d.id, 1);
    await queueDraft(db, user, d.id);
    await queueDraft(db, user, d.id);
    const send = vi.fn().mockResolvedValue("Accepted, not confirmed delivered");
    await sendNext(db, send);
    await sendNext(db, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await getDraft(db, user, d.id)).status).toBe(
      "Accepted by mail server",
    );
    await expect(
      updateDraft(db, user, d.id, draftContent, 1),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("leaves ambiguous delivery for reconciliation and never automatically retries", async () => {
    const d = await createDraft(db, user, box.id, draftContent);
    await approveDraft(db, user, d.id, 1);
    await queueDraft(db, user, d.id);
    const send = vi
      .fn()
      .mockRejectedValue(new Error("Connection ended after DATA"));
    await sendNext(db, send);
    await sendNext(db, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await getDraft(db, user, d.id)).status).toBe("Delivery uncertain");
  });
  it("recovers a worker crash as uncertain, not a new send", async () => {
    const d = await createDraft(db, user, box.id, draftContent);
    await approveDraft(db, user, d.id, 1);
    await queueDraft(db, user, d.id);
    await db.query(
      "UPDATE outbox SET status='Sending',started_at=now()-interval '10 minutes' WHERE draft_id=$1",
      [d.id],
    );
    await db.query("UPDATE drafts SET status='Sending' WHERE id=$1", [d.id]);
    await recoverOutbox(db);
    expect((await getDraft(db, user, d.id)).status).toBe("Delivery uncertain");
  });
  it("prevents a queued draft from sending after the approver loses permission", async () => {
    const uid = (
      await one(db, "SELECT id FROM users WHERE email='member@example.invalid'")
    ).id;
    await db.query(
      "UPDATE mailbox_permissions SET can_send=true WHERE user_id=$1",
      [uid],
    );
    const d = await createDraft(db, uid, box.id, draftContent);
    await approveDraft(db, uid, d.id, 1);
    await queueDraft(db, uid, d.id);
    await db.query("DELETE FROM mailbox_permissions WHERE user_id=$1", [uid]);
    const send = vi.fn();
    await sendNext(db, send);
    expect(send).not.toHaveBeenCalled();
    expect((await getDraft(db, user, d.id)).status).toBe("Needs review");
  });
});
describe("Synchronisation, rules and provider contracts", () => {
  it("deduplicates by mailbox, folder, UIDVALIDITY and UID; rule alerts are idempotent", async () => {
    const message = {
      messageId: "<unique@example.invalid>",
      threadKey: "unique",
      subject: "New project",
      sender: "sender@example.invalid",
      recipients: { to: [], cc: [] },
      receivedAt: new Date(),
      unread: true,
      body: "Hi",
      html: "",
      attachments: [],
      headers: {},
    };
    const a = await storeMessage(db, box, "INBOX", "2", 100, message);
    const b = await storeMessage(db, box, "INBOX", "2", 100, message);
    expect(a.id).toBe(b.id);
    const c = await storeMessage(db, box, "INBOX", "3", 100, message);
    expect(c.id).not.toBe(a.id);
    const n = await one(
      db,
      "SELECT count(*)::int AS count FROM alerts WHERE message_id=$1",
      [a.id],
    );
    expect(n.count).toBeLessThanOrEqual(1);
  });
  it("matches only the requested deterministic conditions", () => {
    const m = {
      sender: "Alex@Example.com",
      subject: "New PROJECT",
      recipients: { to: [{ address: "team@example.com" }], cc: [] },
      unread: true,
    };
    expect(
      matches(
        {
          domain: "example.com",
          subject: "project",
          recipient: "team@example.com",
          unread: true,
        },
        m,
      ),
    ).toBe(true);
    expect(matches({ sender: "other@example.com" }, m)).toBe(false);
    expect(matches({ unread: false }, m)).toBe(false);
  });
  it("claims one mailbox per lease and can recover an expired lease", async () => {
    const mid = id();
    await db.query(
      "INSERT INTO mailboxes(id,workspace_id,email,provider,settings,secret) VALUES($1,$2,$3,$4,$5,$6)",
      [
        mid,
        box.workspace_id,
        "lease@example.invalid",
        "orangehost",
        JSON.stringify(box.settings),
        box.secret,
      ],
    );
    expect((await claimMailbox(db, "one"))?.id).toBe(mid);
    expect(await claimMailbox(db, "two")).toBeUndefined();
    await db.query(
      "UPDATE mailboxes SET lease_until=now()-interval '1 minute' WHERE id=$1",
      [mid],
    );
    expect((await claimMailbox(db, "two"))?.id).toBe(mid);
    await db.query("DELETE FROM mailboxes WHERE id=$1", [mid]);
  });
  it("parses MIME and strips executable HTML", async () => {
    const parsed = await parseMessage(
      Buffer.from(
        'From: Alex <alex@example.invalid>\r\nTo: team@example.invalid\r\nSubject: Hello\r\nMessage-ID: <mime@example.invalid>\r\nContent-Type: text/html\r\n\r\n<p>Hello</p><script>evil()</script><img src="https://track.invalid">',
      ),
    );
    expect(parsed.sender).toBe("alex@example.invalid");
    expect(parsed.html).toBe("<p>Hello</p>");
  });
  it("keeps VentraIP explicitly preview-only and supports user-supplied connection settings", () => {
    expect(providers.ventraip.status).toContain("not live verified");
    const input = {
      workspaceId: box.workspace_id,
      email: "test@example.invalid",
      provider: "ventraip",
      imap: box.settings.imap,
      smtp: box.settings.smtp,
      password: "secret",
    };
    expect(mailboxSchema.parse(input).provider).toBe("ventraip");
    expect(mailboxSchema.safeParse({ ...input, importDays: 500 }).success).toBe(
      false,
    );
  });
});
describe("OAuth and authenticated MCP", () => {
  it("binds codes to client, redirect, resource, and PKCE; revokes access", async () => {
    const provider = oauthProvider(db);
    const client = await provider.clientsStore.registerClient!({
      redirect_uris: ["https://client.example/callback"],
      token_endpoint_auth_method: "none",
      client_name: "Test client",
    } as any);
    const raw = "authorization-code",
      verifier = "x".repeat(43),
      challenge = createHash("sha256").update(verifier).digest("base64url");
    await db.query(
      "INSERT INTO oauth_codes VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')",
      [
        digest(raw),
        client.client_id,
        user,
        "https://client.example/callback",
        challenge,
        config.origin + "/mcp",
      ],
    );
    expect(await provider.challengeForAuthorizationCode(client, raw)).toBe(
      challenge,
    );
    await expect(
      provider.exchangeAuthorizationCode(
        client,
        raw,
        verifier,
        "https://wrong.example",
        new URL(config.origin + "/mcp"),
      ),
    ).rejects.toThrow();
    const tokens = await provider.exchangeAuthorizationCode(
      client,
      raw,
      verifier,
      "https://client.example/callback",
      new URL(config.origin + "/mcp"),
    );
    expect(
      (await provider.verifyAccessToken(tokens.access_token)).extra?.userId,
    ).toBe(user);
    await expect(
      provider.exchangeAuthorizationCode(
        client,
        raw,
        verifier,
        "https://client.example/callback",
        new URL(config.origin + "/mcp"),
      ),
    ).rejects.toThrow();
    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer " + tokens.access_token)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(response.status).toBe(200);
    expect(response.body.result.tools.map((x: any) => x.name)).toContain(
      "request_send_approval",
    );
    expect(response.body.result.tools.map((x: any) => x.name)).not.toContain(
      "approve_draft",
    );
    await provider.revokeToken!(client, { token: tokens.access_token });
    await expect(
      provider.verifyAccessToken(tokens.access_token),
    ).rejects.toThrow();
  });
  it("renews expired access through HTTP, binds refresh tokens and revokes replayed families", async () => {
    const p = oauthProvider(db);
    const c = await p.clientsStore.registerClient!({redirect_uris:["https://client.example/refresh"],token_endpoint_auth_method:"none"} as any);
    const code = id();
    await db.query("INSERT INTO oauth_codes VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')",
      [digest(code),c.client_id,user,"https://client.example/refresh","challenge",config.origin+"/mcp"]);
    const original = await p.exchangeAuthorizationCode(c,code,undefined,"https://client.example/refresh",new URL(config.origin+"/mcp"));
    expect(original.refresh_token).toBeTruthy();
    await db.query("UPDATE oauth_tokens SET expires_at=now()-interval '1 second' WHERE hash=$1",[digest(original.access_token)]);
    await expect(p.verifyAccessToken(original.access_token)).rejects.toThrow();
    const refresh = (value: string, extra = {}) => request(app).post("/token").type("form").send({grant_type:"refresh_token",client_id:c.client_id,refresh_token:value,...extra});
    expect((await refresh(original.refresh_token!,{resource:"https://wrong.example/mcp"})).status).toBe(400);
    expect((await refresh(original.refresh_token!,{scope:"admin"})).status).toBe(400);
    await expect(p.exchangeRefreshToken({...c,client_id:id()},original.refresh_token!)).rejects.toThrow();
    const renewed = await refresh(original.refresh_token!);
    expect(renewed.status).toBe(200);
    expect(renewed.body.refresh_token).not.toBe(original.refresh_token);
    expect((await p.verifyAccessToken(renewed.body.access_token)).extra?.userId).toBe(user);
    const stored = await one(db,"SELECT hash,used_at FROM oauth_refresh_tokens WHERE hash=$1",[digest(original.refresh_token!)]);
    expect(stored.used_at).toBeTruthy();
    expect(stored.hash).not.toBe(original.refresh_token);
    expect((await refresh(original.refresh_token!)).body.error).toBe("invalid_grant");
    await expect(p.verifyAccessToken(renewed.body.access_token)).rejects.toThrow();
    expect((await refresh(renewed.body.refresh_token)).status).toBe(400);
  });
  it("revokes refresh tokens with access tokens and rejects expiry", async () => {
    const p = oauthProvider(db);
    const c = await p.clientsStore.registerClient!({redirect_uris:["https://client.example/revoke"],token_endpoint_auth_method:"none"} as any);
    for (const expired of [false,true]) {
      const code=id();
      await db.query("INSERT INTO oauth_codes VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')",[digest(code),c.client_id,user,"https://client.example/revoke","challenge",config.origin+"/mcp"]);
      const t=await p.exchangeAuthorizationCode(c,code,undefined,"https://client.example/revoke",new URL(config.origin+"/mcp"));
      if (expired) await db.query("UPDATE oauth_refresh_tokens SET expires_at=now()-interval '1 second' WHERE hash=$1",[digest(t.refresh_token!)]);
      else await p.revokeToken!(c,{token:t.access_token});
      await expect(p.exchangeRefreshToken(c,t.refresh_token!)).rejects.toThrow();
    }
    const metadata=await request(app).get("/.well-known/oauth-authorization-server");
    expect(metadata.body.grant_types_supported).toContain("refresh_token");
  });
  it("rejects invalid PKCE through the real token endpoint", async () => {
    const p = oauthProvider(db);
    const c = await p.clientsStore.registerClient!({
      redirect_uris: ["https://client.example/return"],
      token_endpoint_auth_method: "none",
    } as any);
    await db.query(
      "INSERT INTO oauth_codes VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')",
      [
        digest("pkce-test"),
        c.client_id,
        user,
        "https://client.example/return",
        "correct-challenge",
        config.origin + "/mcp",
      ],
    );
    const r = await request(app)
      .post("/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: c.client_id,
        code: "pkce-test",
        redirect_uri: "https://client.example/return",
        code_verifier: "wrong".repeat(12),
        resource: config.origin + "/mcp",
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_grant");
  });
});


describe("Manual mailbox checks", () => {
  it("checks immediately while paused, updates timestamps and releases the lease", async () => {
    const mid = id();
    await db.query("INSERT INTO mailboxes(id,workspace_id,email,provider,settings,secret,paused,next_check) VALUES($1,$2,$3,'generic',$4,$5,true,now()+interval '1 day')", [mid,box.workspace_id,"manual@example.invalid",JSON.stringify(box.settings),box.secret]);
    const sync = vi.fn(async (leased: DB) => {
      await leased.query("SELECT id FROM mailboxes WHERE id=$1", [mid]);
      await expect(checkMailboxNow(db,user,mid)).rejects.toThrow("already being checked");
      return 3;
    });
    expect(await checkMailboxNow(db,user,mid,sync)).toEqual({ok:true,imported:3});
    const checked = await one(db,"SELECT * FROM mailboxes WHERE id=$1",[mid]);
    expect(checked.paused).toBe(true);
    expect(checked.last_check).toBeTruthy();
    expect(checked.lease_owner).toBeNull();
    expect(sync).toHaveBeenCalledOnce();
    const result = await checkMailboxNow(db,user,mid,async () => { throw new Error("private transport detail"); });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private transport detail");
    expect((await one(db,"SELECT * FROM mailboxes WHERE id=$1",[mid])).lease_owner).toBeNull();
    await db.query("DELETE FROM mailboxes WHERE id=$1",[mid]);
  });
  it("requires mailbox access and CSRF, and refuses demo checks", async () => {
    await expect(checkMailboxNow(db,id(),box.id)).rejects.toThrow("access denied");
    expect((await request(app).post("/api/mailboxes/"+box.id+"/check").send({})).status).toBe(401);
    expect((await agent.post("/api/mailboxes/"+box.id+"/check").send({})).status).toBe(403);
    expect((await post("/api/mailboxes/"+box.id+"/check",{})).status).toBe(400);
  });
});


describe("Mailbox card counts", () => {
  it("returns the imported message count for each visible mailbox", async () => {
    const response = await agent.get("/api/mailboxes");
    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    for (const b of response.body) {
      const expected = await one(db, "SELECT count(*)::int AS total FROM messages WHERE mailbox_id=$1", [b.id]);
      expect(Number(b.email_count)).toBe(Number(expected.total));
    }
  });
});
