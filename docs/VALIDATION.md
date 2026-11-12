# Validation record

Status as of 12 November 2026. Implemented features and verified live behaviour are different; this record distinguishes them.

## Automated checks

Build, TypeScript checks and ESLint passed for the deployed About page and connection feedback update. Tests cover authentication, tenant isolation, encrypted credentials, CSRF, OAuth/PKCE, approval invalidation, outbox behaviour, provider destination validation, message import and worker leases. Default tests use isolated PGlite and mocked mail transports. Prior local MariaDB 11.4.13 testing exercised migrations, foreign keys, JSON/boolean decoding, token consumption, quota reservation and mailbox leases. See CONTRIBUTING.md to reproduce checks without Docker.

## Live checks completed

- VentraIP Node/Passenger deployment with MariaDB, HTTPS, health endpoint and HTTP-to-HTTPS redirect.
- Account verification email delivery and successful email verification.
- ChatGPT OAuth connection and discovery of 11 MCP tools.
- Mailbox listing, message listing and search through the connected MCP app. The initial results were empty; the subsequent OAuth release successfully searched and fetched an imported test message (empty body) and listed four mailboxes.
- IMAP and SMTP authentication against the connected provider; no mail sent.
- Scheduled worker completion and last-successful-check timestamp.
- About navigation and content; Test connection displayed a disabled Testing indicator and inline successful IMAP/SMTP results.

## Still requiring live validation

- Non-empty message body rendering, attachments and folder changes.
- Send an explicitly approved reply to a controlled recipient; verify delivery and Sent copy.
- Recovery email delivery (verification delivery alone does not establish this).
- Deployed permission isolation with separate users, concurrency, restart recovery and sustained load.
- VentraIP mailbox-provider adapter, optional AI-provider calls and quota behaviour.
- Independent security review and production restore exercise.

## Known limits

OAuth access tokens expire after one hour; rotating refresh tokens now support automatic renewal for up to 90 days. ChatGPT reconnection and automatic renewal after deliberate access-token expiry both passed; the database confirmed refresh rotation and an active replacement. Shared-hosting worker checks are periodic, not instant, and process headroom is limited. An empty inbox can mean messages are outside the configured initial import window. This version is not established as suitable for an unrestricted public multi-customer launch.

Private browser evidence remains outside this public repository.

Repository preparation check, 12 November 2026: 43 tests passed, 5 MySQL-specific tests skipped using default isolated PGlite. The source was compared with the working application before publication. Generated assets, private evidence and runtime data are excluded.

## OAuth renewal release — 12 November 2026

Build, typecheck and lint passed. All 51 tests passed against local MariaDB, including concurrent refresh, replay revocation, expiry, binding and HTTP exchange. Production migration 2 completed. ChatGPT mailbox listing, search and test-message fetch passed. A forced access-token expiry triggered automatic renewal without reconnecting. The temporary expiry diagnostic file was removed. Both ClickeMailMonitor health and ClickPDF returned HTTP 200 after deployment. No mailbox message was sent.

## Manual check release — 12 November 2026

All 53 MariaDB tests passed; build, typecheck and lint passed. Added coverage for checking a paused/not-due mailbox immediately, rejecting an overlapping check, releasing leases on success/failure, sanitising errors, and requiring authentication, mailbox access and CSRF. Live browser validation showed the disabled Checking state, then two newly imported messages and an updated last-check timestamp at 4:04 pm Australia/Brisbane. The consolidated IMAP/SMTP form was visually verified. No email was sent. Google/Microsoft OAuth work was deferred by the owner.

## Inbox bulk-check interface — 12 November 2026

Build, typecheck and lint passed. Live browser validation confirmed disabled in-progress Check All Now, sequential progress across all five connected mailboxes, five successful no-new-message results, re-enabled control and refreshed Inbox. Mailbox timestamps advanced. The matching Check Now, Test connection and Pause controls were visually verified on a shared row. Existing backend sync/permission/lease logic is unchanged; the preceding 53-test MariaDB run covers that backend. No mailbox email was sent.


### 12 November 2026 — mailbox counts

Build, TypeScript checks, lint, and all 54 MariaDB tests passed. The mailbox API test compares returned counts against stored messages for each visible mailbox. Deployed to VentraIP and verified all six live mailbox cards display their imported email count.
