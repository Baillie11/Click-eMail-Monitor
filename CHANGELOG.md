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

Live read/send coverage remains incomplete; see docs/VALIDATION.md.

## Unreleased — OAuth renewal

- Added one-time rotating refresh tokens with a 90-day absolute grant lifetime, client/resource binding and replay revocation.
- Added additive migration 2, disconnect/password-reset revocation and renewal consent text.
- Verified 51 tests on local MariaDB, including concurrent refresh/replay, expiry and HTTP refresh exchange. Hosting startup and ChatGPT reconnection checks are in progress.
