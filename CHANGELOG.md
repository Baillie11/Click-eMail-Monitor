# Changelog

## 0.1.0 — 2026-11-12

Initial source backup of the deployed application.

- Multi-workspace mailbox access, IMAP imports, search, monitoring rules and alerts.
- Reviewed drafts, exact-version approval and durable outgoing queue.
- OAuth/PKCE and authenticated MCP integration for ChatGPT.
- MySQL/MariaDB support alongside PostgreSQL and an isolated PGlite demo.
- VentraIP deployment and bounded cron worker without Docker.
- About page and visible connection-test progress/results.
- Brand styling corrected so only “Click” is bold and “eMailMonitor” uses the lighter weight.
- Developer, architecture, configuration, operations, API and user documentation.

Live send coverage remains incomplete; see docs/VALIDATION.md.

## 12 November 2026 — OAuth renewal

- Added one-time rotating refresh tokens with a 90-day absolute grant lifetime, client/resource binding and replay revocation.
- Added additive migration 2, disconnect/password-reset revocation and renewal consent text.
- Verified 51 tests on local MariaDB, including concurrent refresh/replay, expiry and HTTP refresh exchange. Deployed successfully. ChatGPT listed four mailboxes, searched and fetched a test message, and automatically renewed after deliberate access-token expiry.

## 12 November 2026 — Manual checks and simpler setup

- Added Check Now to each mailbox with disabled progress state, imported-message count and clear failure feedback.
- Manual checks run immediately using the scheduled worker's lease protection, without sending queued replies. Paused monitoring remains paused.
- Consolidated OrangeHost, VentraIP and generic setup cards into one Other email (IMAP/SMTP) form; existing mailboxes are preserved.
- Passed all 53 MariaDB tests, build, typecheck and lint. The live manual check imported two new messages and updated its timestamp.
- Gmail and Outlook/Hotmail OAuth integration is deferred at the owner's request.
