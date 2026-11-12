import type { Express, Request, Response, NextFunction } from "express";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import nodemailer from "nodemailer";
import { type DB, one } from "./db.js";
import { token, digest, id, HttpError, equal } from "./security.js";
import { config } from "./config.js";
declare global {
  // Express's published type extension point is a namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      csrf?: string;
    }
  }
}
const account = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((x) => x.toLowerCase()),
  password: z.string().min(12).max(200),
  name: z.string().min(1).max(100),
  workspace: z.string().min(1).max(100),
});
export async function notifyAccount(email: string, kind: string, raw: string) {
  if (config.demo) return;
  const url = new URL("/", config.origin);
  url.searchParams.set("action", kind);
  url.searchParams.set("token", raw);
  const sendmail = process.env.ACCOUNT_SENDMAIL === "true";
  if (!sendmail && !process.env.ACCOUNT_SMTP_URL)
    throw new HttpError(503, "Account email delivery is not configured.");
  const smtp = sendmail ? null : new URL(process.env.ACCOUNT_SMTP_URL!);
  if (smtp && !["smtps:", "smtp:"].includes(smtp.protocol))
    throw new HttpError(503, "Account email service configuration is invalid.");
  const transport = smtp
    ? nodemailer.createTransport({
        host: smtp.hostname,
        port: Number(smtp.port || (smtp.protocol === "smtps:" ? 465 : 587)),
        secure: smtp.protocol === "smtps:",
        requireTLS: true,
        auth: {
          user: decodeURIComponent(smtp.username),
          pass: decodeURIComponent(smtp.password),
        },
        tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
        connectionTimeout: 15000,
        socketTimeout: 30000,
      })
    : nodemailer.createTransport({
        sendmail: true,
        newline: "unix",
        path: "/usr/sbin/sendmail",
      });
  await transport.sendMail({
    from: process.env.ACCOUNT_FROM,
    to: email,
    subject: `Click Mail Monitor: ${kind === "verify" ? "verify your email" : kind === "invite" ? "workspace invitation" : "reset your password"}`,
    text: `Open this link to continue: ${url.toString()}\n\nIf you did not request this, ignore this email.`,
  });
}
export async function issueToken(
  db: DB,
  user: string | null,
  kind: string,
  payload: any = {},
  minutes = 60,
) {
  const raw = token();
  await db.query(
    "INSERT INTO tokens(hash,user_id,kind,payload,expires_at) VALUES($1,$2,$3,$4,now()+($5*interval '1 minute'))",
    [digest(raw), user, kind, JSON.stringify(payload), minutes],
  );
  return raw;
}
export async function session(db: DB, user: string, res: Response) {
  const raw = token(),
    csrf = token();
  await db.query(
    "INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
    [digest(raw), user, csrf],
  );
  res.cookie("cmm_session", raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.production,
    maxAge: 7 * 86400000,
    path: "/",
  });
  return csrf;
}
export function loadSession(db: DB) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const raw = req.cookies?.cmm_session;
      if (raw) {
        const s = await one(
          db,
          "SELECT * FROM sessions WHERE hash=$1 AND expires_at>now()",
          [digest(raw)],
        );
        if (s) {
          req.userId = s.user_id;
          req.csrf = s.csrf;
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.userId) return next(new HttpError(401, "Please sign in."));
  next();
}
export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (
      req.get("origin") !== config.origin ||
      !equal(req.get("x-csrf-token") || "", req.csrf || "missing")
    )
      return next(
        new HttpError(403, "Security check failed. Reload the page."),
      );
  }
  next();
}
export function authRoutes(app: Express, db: DB) {
  app.post("/api/auth/register", async (req, res) => {
    if (config.demo)
      throw new HttpError(403, "Public registration is disabled in demo mode.");
    const data = account.parse(req.body);
    if (
      !process.env.ACCOUNT_SMTP_URL &&
      process.env.ACCOUNT_SENDMAIL !== "true"
    )
      throw new HttpError(
        503,
        "Account email delivery must be configured before registration.",
      );
    const uid = id(),
      wid = id(),
      pw = await hash(data.password);
    await db.transaction(async (tx) => {
      await tx.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
      const n = await one(tx, "SELECT count(*)::int AS count FROM users");
      if (n.count >= config.signupLimit)
        throw new HttpError(503, "Registration capacity reached.");
      await tx.query(
        "INSERT INTO users(id,email,password,name) VALUES($1,$2,$3,$4)",
        [uid, data.email, pw, data.name],
      );
      await tx.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [
        wid,
        data.workspace,
      ]);
      await tx.query(
        "INSERT INTO members(workspace_id,user_id,role) VALUES($1,$2,'owner')",
        [wid, uid],
      );
    });
    const raw = await issueToken(db, uid, "verify");
    await notifyAccount(data.email, "verify", raw);
    res
      .status(201)
      .json({ message: "Check your email to verify your account." });
  });
  app.post("/api/auth/login", async (req, res) => {
    const data = z
      .object({ email: z.string().email(), password: z.string().max(200) })
      .parse(req.body);
    const u = await one(db, "SELECT * FROM users WHERE email=$1", [
      data.email.toLowerCase(),
    ]);
    if (!u || !(await verify(u.password, data.password)))
      throw new HttpError(401, "Email or password is incorrect.");
    if (!u.verified)
      throw new HttpError(403, "Verify your email before signing in.");
    const csrf = await session(db, u.id, res);
    res.json({ csrf });
  });
  app.post("/api/auth/verify", async (req, res) => {
    await db.transaction(async (tx) => {
      const t = await one(
        tx,
        "DELETE FROM tokens WHERE hash=$1 AND kind='verify' AND expires_at>now() RETURNING *",
        [digest(String(req.body.token))],
      );
      if (!t) throw new HttpError(400, "Link is invalid or expired.");
      await tx.query("UPDATE users SET verified=true WHERE id=$1", [t.user_id]);
    });
    res.json({ message: "Email verified. You can sign in." });
  });
  app.post("/api/auth/resend", async (req, res) => {
    const email = z.string().email().parse(req.body.email).toLowerCase();
    const u = await one(
      db,
      "SELECT * FROM users WHERE email=$1 AND verified=false",
      [email],
    );
    if (u)
      await notifyAccount(
        email,
        "verify",
        await issueToken(db, u.id, "verify"),
      );
    res.json({ message: "If eligible, a verification link has been sent." });
  });
  app.post("/api/auth/forgot", async (req, res) => {
    const email = z.string().email().parse(req.body.email).toLowerCase();
    const u = await one(db, "SELECT * FROM users WHERE email=$1", [email]);
    if (u)
      await notifyAccount(email, "reset", await issueToken(db, u.id, "reset"));
    res.json({ message: "If the account exists, a reset link has been sent." });
  });
  app.post("/api/auth/reset", async (req, res) => {
    const data = z
      .object({ token: z.string(), password: z.string().min(12).max(200) })
      .parse(req.body);
    const pw = await hash(data.password);
    await db.transaction(async (tx) => {
      const t = await one(
        tx,
        "DELETE FROM tokens WHERE hash=$1 AND kind='reset' AND expires_at>now() RETURNING *",
        [digest(data.token)],
      );
      if (!t) throw new HttpError(400, "Link is invalid or expired.");
      await tx.query("UPDATE users SET password=$1 WHERE id=$2", [
        pw,
        t.user_id,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [t.user_id]);
      await tx.query("DELETE FROM oauth_refresh_tokens WHERE user_id=$1", [t.user_id]);
      await tx.query("DELETE FROM oauth_tokens WHERE user_id=$1", [t.user_id]);
      await tx.query("DELETE FROM tokens WHERE user_id=$1 AND kind='reset'", [
        t.user_id,
      ]);
    });
    res.json({ message: "Password reset. Please sign in." });
  });
  app.post("/api/auth/logout", requireUser, requireCsrf, async (req, res) => {
    await db.query("DELETE FROM sessions WHERE hash=$1", [
      digest(req.cookies.cmm_session),
    ]);
    res.clearCookie("cmm_session", { path: "/" });
    res.json({ ok: true });
  });
}
