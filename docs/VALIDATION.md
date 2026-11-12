# Validation record

Status as of 12 November 2026. Implemented features and verified live behaviour are different; this record distinguishes them.

## Automated checks

Build, TypeScript checks and ESLint passed for the deployed About page and connection feedback update. Tests cover authentication, tenant isolation, encrypted credentials, CSRF, OAuth/PKCE, approval invalidation, outbox behaviour, provider destination validation, message import and worker leases. Default tests use isolated PGlite and mocked mail transports. Prior local MariaDB 11.4.13 testing exercised migrations, foreign keys, JSON/boolean decoding, token consumption, quota reservation and mailbox leases. See CONTRIBUTING.md to reproduce checks without Docker.

## Live checks completed

- VentraIP Node/Passenger deployment with MariaDB, HTTPS, health endpoint and HTTP-to-HTTPS redirect.
- Account verification email delivery and successful email verification.
- ChatGPT OAuth connection and discovery of 11 MCP tools.
- Mailbox listing, message listing and search through the connected MCP app. The message results were empty.
- IMAP and SMTP authentication against the connected provider; no mail sent.
- Scheduled worker completion and last-successful-check timestamp.
- About navigation and content; Test connection displayed a disabled Testing indicator and inline successful IMAP/SMTP results.

## Still requiring live validation

- Read an imported real message through ChatGPT, attachments and folder changes.
- Send an explicitly approved reply to a controlled recipient; verify delivery and Sent copy.
- Recovery email delivery (verification delivery alone does not establish this).
- Deployed permission isolation with separate users, concurrency, restart recovery and sustained load.
- VentraIP mailbox-provider adapter, optional AI-provider calls and quota behaviour.
- Independent security review and production restore exercise.

## Known limits

OAuth access tokens expire after one hour; rotating refresh tokens now support automatic renewal for up to 90 days. The ChatGPT reconnection and live renewal check for this update remain pending. Shared-hosting worker checks are periodic, not instant, and process headroom is limited. An empty inbox can mean messages are outside the configured initial import window. This version is not established as suitable for an unrestricted public multi-customer launch.

Private browser evidence remains outside this public repository.

Repository preparation check, 12 November 2026: 43 tests passed, 5 MySQL-specific tests skipped using default isolated PGlite. The source was compared with the working application before publication. Generated assets, private evidence and runtime data are excluded.
