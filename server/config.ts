import "dotenv/config";
export const config = {
  port: Number(process.env.PORT || 3100),
  origin: process.env.APP_ORIGIN || "http://localhost:3100",
  production: process.env.NODE_ENV === "production",
  demo: process.env.DEMO_MODE === "true",
  databaseUrl: process.env.DATABASE_URL,
  dataDir: process.env.DATA_DIR || ".data/db",
  key: process.env.CREDENTIAL_KEY || "",
  signupLimit: Number(process.env.SIGNUP_LIMIT || 100),
  mailboxLimit: Number(process.env.MAILBOX_LIMIT || 10),
  minPoll: Number(process.env.MIN_POLL_SECONDS || 60),
  maxMessageBytes: 10 * 1024 * 1024,
  maxAttachmentBytes: 5 * 1024 * 1024,
};
export function validateConfig() {
  if (!/^[a-f\d]{64}$/i.test(config.key))
    throw new Error(
      "CREDENTIAL_KEY must be a 32-byte hex key. Run npm run demo for isolated demo setup.",
    );
  if (
    config.production &&
    (!config.databaseUrl ||
      !config.origin.startsWith("https://") ||
      config.demo)
  )
    throw new Error(
      "Production requires DATABASE_URL, HTTPS APP_ORIGIN and DEMO_MODE=false.",
    );
}
