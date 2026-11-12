import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import sanitize from "sanitize-html";
import { config } from "./config.js";
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function encrypt(value: unknown, key = config.key) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((x) => x.toString("base64url"))
    .join(".");
}
export function decrypt<T = any>(value: string, key = config.key): T {
  const [iv, tag, bytes] = value
    .split(".")
    .map((x) => Buffer.from(x, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(bytes), cipher.final()]).toString(),
  );
}
export function publicAddress(address: string) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
export async function safeEndpoint(
  host: string,
  port: number,
  kind: "imap" | "smtp",
  resolve = lookup,
) {
  if (!(kind === "imap" ? [143, 993] : [465, 587]).includes(port))
    throw new Error("Unsupported mail port.");
  if (
    !/^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(host) ||
    host.includes("..")
  )
    throw new Error("Enter a valid public mail hostname.");
  const results = await resolve(host, { all: true, verbatim: true });
  if (!results.length || results.some((r) => !publicAddress(r.address)))
    throw new Error(
      "Mail servers must resolve only to public internet addresses.",
    );
  // Pin the actual TCP destination; retain the original hostname for TLS certificate validation.
  return { host: results[0].address, servername: host };
}
export function cleanHtml(html: string) {
  return sanitize(html, {
    allowedTags: [
      "p",
      "br",
      "div",
      "span",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "table",
      "tbody",
      "tr",
      "td",
      "th",
      "h1",
      "h2",
      "h3",
      "a",
      "hr",
    ],
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["https", "http", "mailto"],
    transformTags: {
      a: (_tag, attrs) => ({
        tagName: "a",
        attribs: { ...attrs, rel: "noreferrer noopener", target: "_blank" },
      }),
    },
  });
}
export function safeMailError(error: any) {
  const code = String(error?.code || "");
  if (/AUTH|LOGIN/.test(code))
    return "Authentication failed. Check the mailbox username and password.";
  if (/CERT|TLS|SSL/.test(code))
    return "TLS certificate validation failed. Check the server hostname.";
  if (/TIME|CONNECTION|ECONN|ETIMEDOUT/.test(code))
    return "Connection failed or timed out. Check the mail settings and firewall.";
  return "Mail connection failed. Check your settings and provider availability.";
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const assert = (
  condition: unknown,
  status: number,
  message: string,
): asserts condition => {
  if (!condition) throw new HttpError(status, message);
};
