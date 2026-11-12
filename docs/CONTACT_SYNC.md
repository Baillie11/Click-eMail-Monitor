# Automatic CRM contact capture

Click Mail Monitor can deliver sender contact details to the Click Marketing Agent CRM. Enable only after the receiving integration is deployed and authenticated.

## Behaviour

- Capture the email sender, not every address mentioned in a message.
- Read names from sender headers or a signature, and companies from explicit Organization headers, labelled signature fields or clear company suffixes.
- Read explicitly labelled signature phone numbers when available; otherwise leave fields blank.
- Skip own connected mailbox addresses, obvious automated senders, mailing-list headers and sent/draft/trash/junk folders.
- Ignore quoted/forwarded history when extracting signatures. No LLM or third-party enrichment call is made.
- Process retained imported messages from the configured starting timestamp, followed by new imports during scheduled worker runs.
- Deliver at most 25 messages per worker iteration, with a 15-second processing budget and 10-second request timeout. Failed deliveries retry on a later run. CRM availability does not block email synchronisation.

## Configuration

`MARKETING_CONTACT_TARGETS` is a private JSON array in the production environment. Each entry has `mailboxId`, `businessId`, `endpoint`, `token`, and ISO-8601 `since`. The token must be a receiver-issued business-scoped secret of at least 32 characters. Never commit this value or put it in chat. Endpoint must be HTTPS without embedded credentials, query or fragment. Redirects are refused. An empty array disables the integration.

Map each mailbox explicitly to its business UUID. Do not infer the destination from the sender's domain: the sender may belong to a customer, supplier or different company. For historical capture, set `since` before the earliest retained message; deleted/expired messages cannot be recovered from this database.

## Receiver contract

POST the configured endpoint with Bearer authentication and JSON:

```json
{
  "businessId": "receiver-business-uuid",
  "email": "person@example.com",
  "contactName": "Alex Smith",
  "businessName": "Example Pty Ltd",
  "contactNumber": "",
  "source": "click-mail-monitor",
  "sourceId": "mailbox-uuid:message-uuid"
}
```

Only extracted fields and opaque source IDs are transmitted, not message bodies, subjects, attachments or mailbox passwords. Receiver must enforce business-scoped credentials, deduplicate by business and normalized email, preserve existing populated/manual fields, allow blanks, and return success only after durable storage. A crash after delivery can repeat a request, so receiver idempotence is required. A saved contact does not represent marketing consent and must not automatically trigger outbound messages. Receiver should preserve suppressions for deleted imported contacts.

Migration creates `contact_deliveries` and schema version 3. Delivery receipts contain message IDs and status; tokens remain in private environment configuration. Token rotation preserves receipts because tokens are excluded from the target identity. Changing business or endpoint deliberately creates a new target identity.

## Current rollout

Sender deployed to VentraIP; all 63 tests, lint, typecheck and production build pass. Public health check is healthy. Delivery remains disabled until receiver credentials/mappings are provisioned. Receiver and production mailbox mapping are being coordinated with the Click Marketing Agent chat. Do not describe contact saving as live until a production end-to-end test succeeds.

Production activation is currently blocked on Click Marketing Agent database authentication during its OrangeHost deployment. The receiving integration is implemented there but its live migration/configuration is not yet verified. Finish that deployment, issue business-scoped tokens and mailbox mappings, then run a real import before enabling automatic delivery.
