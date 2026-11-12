# ClickeMailMonitor

A standalone email workspace for existing hosted mailboxes. Read and search mail, monitor deterministic rules, prepare replies, approve exact draft versions, and connect ChatGPT through authenticated MCP.

**Status: initial release, deployed on VentraIP with MariaDB and HTTPS. No Docker required.** ChatGPT OAuth, mailbox listing/search and live IMAP/SMTP authentication have been verified. Reading an imported real email, real reply delivery and optional AI-provider calls still require end-to-end validation. The VentraIP mailbox adapter remains labelled Preview.

[Live application](https://mailmonitor.clickecommerce.com.au/) · [User guide](docs/USER_GUIDE.md) · [Architecture](docs/ARCHITECTURE.md) · [Operations](docs/OPERATIONS.md)

This is a source-code backup, not a backup of production messages, database records or encryption keys. No open-source licence has been granted; see [licensing](#licensing).

## Try the demo on Windows

From this folder:

```powershell
npm ci
npm run build
npm run demo
```

Open **http://localhost:3100** and choose **Open demo workspace**. The demo uses synthetic messages and an embedded PostgreSQL-compatible PGlite database in `.data/demo`. It cannot connect new live mailboxes and simulates SMTP acceptance without sending email. Demo sign-in is `demo@example.invalid` / `Demo-mail-only-2026`.

Node **22.12+** is required for deployment. A project-local Node 22 development dependency lets npm scripts run here without replacing the system Node installation. Do not upload Windows `node_modules` to a Linux host. `npm ci` installs native packages for the destination OS.

The demo key is generated locally and stored in ignored `.data/demo-key`; this is for synthetic data only. The production encryption key must be stored separately from the database and source.

## Run with MySQL/MariaDB, without containers

1. Install Node 22.12+ and MariaDB 10.6+ or MySQL 8.0.16+, or use existing shared hosting. Create a dedicated database and application user with access only to that database. PostgreSQL 16+ remains supported.
2. Copy `.env.example` to `.env` and configure `DATABASE_URL`, `APP_ORIGIN`, `CREDENTIAL_KEY`, and account notifications (SMTP or cPanel sendmail). Do not put real credentials in source control or chat.
3. Run `npm ci`, `npm run build`, then `npm run migrate`.
4. Run `npm start` and, in another terminal or service, `npm run worker:prod`.
5. Register, verify your email, and connect a mailbox through the secure web form.

For production set `NODE_ENV=production`, an HTTPS origin, and `DEMO_MODE=false`. Production refuses embedded storage. Put a TLS reverse proxy in front of the web process. Configure the exact trusted proxy hop count and network boundaries. Use a service manager to restart web and worker processes. A cron-compatible `npm run worker:once` performs a bounded batch and exits; WORKER_BATCH_SIZE defaults to 1 and is capped at 10. VentraIP requires at least 15 minutes between cron runs.

`npm run dev` watches server source; use `npm run build` after frontend edits. This deliberately serves built frontend assets from the same origin as the API, avoiding cross-origin cookies and credentials.

## What is implemented

- Public registration, email verification, sign-in, password recovery, session revocation, workspace invitations, roles and explicit member mailbox grants.
- AES-256-GCM credential encryption; public IP validation and pinned mail destinations with original-hostname TLS certificate verification; constrained ports; CSRF and request-rate controls.
- IMAP folder discovery, bounded imports, UIDVALIDITY-aware cursors, incremental message ingestion, unread-state preservation, flag/deletion refresh, sanitised HTML and authenticated on-demand attachments.
- Monitoring rules for sender/domain/recipient/subject/unread state, deduplicated alerts, pause/resume, retention, durable leases, retries and restart recovery.
- Manual drafts, reply/reply-all, signatures, attachments, optional bounded AI suggestions, immutable approval hashes and a durable outbox.
- OAuth authorisation-code + S256 PKCE, dynamic public-client registration, audience/resource checks, token revocation, stateless HTTP MCP and a browser approval route.
- Responsive inbox, review queue, monitoring, mailbox setup, team permissions, settings and content-minimising activity log.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm audit
```

Tests use isolated PGlite databases by default, or real local MySQL/MariaDB when MYSQL_TEST_URL is set. Each MariaDB suite creates and removes its own disposable database. Mail transports are mocked. They never contact real recipients. See [validation](docs/VALIDATION.md) for results and limitations.

## Documentation

- [Configuration reference](docs/CONFIGURATION.md)
- [API and MCP overview](docs/API.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Hosting and deployment](docs/DEPLOYMENT.md)
- [Mailbox onboarding](docs/PROVIDERS.md)
- [ChatGPT connection](docs/CHATGPT.md)
- [Security and operational boundaries](docs/SECURITY.md)
- [Validation and remaining live checks](docs/VALIDATION.md)

## Source layout

`server/schema.ts` is idempotent database migration 1. `server/app.ts` contains HTTP routes; `auth.ts`, `access.ts`, `security.ts` and `oauth.ts` enforce trust boundaries. `providers.ts` owns mail transport. `worker.ts` handles sync and the outbox; `worker-main.ts` is its independent entry point. `mail-service.ts` is shared by HTTP and MCP. `web/` is the React interface. `tests/` exercises the security and workflow boundaries.

No platform-administrator mailbox-reading endpoint exists. Database/server operators are still a trusted operational boundary: encryption does not protect against an operator who has both the database and runtime key.

## Licensing

No licence is currently granted for reuse or redistribution. The repository owner retains the applicable rights. Public visibility does not make this project open source. Contact the repository owner for permission; a licence can be added when the owner selects one.
