/** Conservative contact extraction: message content is data, never instructions. */
export interface CapturedContact {
  email: string;
  contactName: string;
  businessName: string;
  contactNumber: string;
}
const clean = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .replace(/[\x00-\x1f\x7f]/g, " ")
        .trim()
        .slice(0, max)
    : "";
const validEmail = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

export function extractContact(
  message: {
    sender: string;
    body: string;
    headers?: Record<string, any>;
    folder?: string;
  },
  ownAddresses: string[] = [],
): CapturedContact | null {
  const email = clean(message.sender, 255).toLowerCase();
  const headers = message.headers || {};
  if (
    !validEmail.test(email) ||
    ownAddresses.some((a) => a.toLowerCase() === email)
  )
    return null;
  if (
    /^(no[._-]?reply|do[._-]?not[._-]?reply|mailer-daemon|postmaster|bounce[s]?)([+._-]|@)/i.test(
      email,
    )
  )
    return null;
  if (
    headers.listId ||
    (headers.autoSubmitted &&
      String(headers.autoSubmitted).toLowerCase() !== "no") ||
    /^(bulk|list|junk)$/i.test(headers.precedence || "")
  )
    return null;
  if (
    /(^|[\/ ._-])(sent|drafts?|trash|deleted|junk|spam)([\/ ._-]|$)/i.test(
      message.folder || "",
    )
  )
    return null;
  // Stop at quoted/forwarded history, so someone else's signature is not attributed to the sender.
  const body = (message.body || "")
    .slice(0, 20000)
    .split(
      /\r?\n(?:On .{0,300}wrote:|[- ]*(?:Original Message|Forwarded message)[- ]*|From:\s|>)/i,
    )[0];
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const signoff =
    lines
      .map((line, index) => ({ line, index }))
      .reverse()
      .find(({ line }) =>
        /^(?:kind regards|best regards|regards|best wishes|sincerely|cheers|thanks|thank you)[,!]?$|^--$/.test(
          line.toLowerCase(),
        ),
      )?.index ?? -1;
  const signature = signoff >= 0 ? lines.slice(signoff + 1, signoff + 13) : [];
  const plausibleName = (value: string) =>
    value.length <= 150 &&
    /[a-z]/i.test(value) &&
    !/[@<>:/\d]|\b(team|support|sales|newsletter|notification|admin)\b/i.test(
      value,
    ) &&
    value.split(/\s+/).length <= 6;
  const displayName = clean(headers.senderName, 150);
  const signatureName = clean(
    signature.find((line) => line),
    150,
  );
  const contactName = plausibleName(displayName)
    ? displayName
    : plausibleName(signatureName)
      ? signatureName
      : "";
  const organization = clean(headers.organization, 150);
  const companyLine = signature.find((line) =>
    /^(?:company|business|organisation|organization)\s*:/i.test(line),
  );
  const companyWithSuffix = signature.find(
    (line) =>
      /\b(?:pty\.?\s+ltd\.?|limited|ltd\.?|llc|inc\.?|incorporated)\s*$/i.test(
        line,
      ) && !/[@<>]|https?:/i.test(line),
  );
  const businessName =
    organization ||
    clean(companyLine?.replace(/^[^:]+:\s*/, ""), 150) ||
    clean(companyWithSuffix, 150);
  const phoneLine = signature.find((line) =>
    /^(?:tel(?:ephone)?|phone|mobile|mob|[tm])\s*[:.]\s*\+?[\d(]/i.test(line),
  );
  const phone = clean(phoneLine?.replace(/^[^:.]+[:.]\s*/, ""), 50);
  const contactNumber =
    /^[+()\d .-]+$/.test(phone) && (phone.match(/\d/g) || []).length >= 7
      ? phone
      : "";
  return { email, contactName, businessName, contactNumber };
}
