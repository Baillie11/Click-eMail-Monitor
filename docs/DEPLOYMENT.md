# Deployment without Docker

## Shared hosting compatibility

Do not treat Node.js support alone as proof that the complete application can run on a plan. The target needs:

| Requirement | Why it is needed |
| --- | --- |
| Node 22.12+ and npm installation | Web service, MCP and native Argon2 package |
| MariaDB 10.6+ / MySQL 8.0.16+ (or PostgreSQL 16+) | Shared durable state and separate web/worker processes |
| HTTPS application URL | Secure sessions and remote OAuth/MCP |
| Outbound public IMAP 993/143 and SMTP 465/587 | Direct mailbox connectivity; STARTTLS required on non-implicit TLS settings |
| Permitted cron or supervised worker | Monitoring must continue without browser traffic |
| Sufficient memory, CPU, disk and process time | MIME parsing, bounded imports and database operations |
| Durable private configuration and secret storage | Encryption key and service credentials outside public web roots |

**VentraIP account inspection (11 November 2026):** the user's `clickecommerce.com.au` service is **Select Hosting (Shared)** with 2 GB memory and 15 GB storage. cPanel exposes Node.js applications, Terminal, Cron Jobs and MySQL management. The runtime selector includes **Node 22.23.4** and 24.22.2. Existing Node applications were observed and left unchanged.

**MySQL adaptation:** the live database server reports MariaDB 11.4.13. A `mysql://` DATABASE_URL selects MySQL. The schema uses InnoDB, explicit foreign keys, utf8mb4, JSON and UTC timestamps. Transactions retain one connection. Token consumption and draft changes use row locks; worker claims use `FOR UPDATE SKIP LOCKED`. PostgreSQL and the isolated PGlite demo remain supported.

**VentraIP scheduling:** published rules require cron intervals of at least 15 minutes. Use `MIN_POLL_SECONDS=900`, `WORKER_BATCH_SIZE=10` and `*/15 * * * *`. The batch stops after ten iterations or two minutes between iterations; wrap it in `flock` and `timeout 180s` to prevent overlapping runs and bound execution. Interrupted sync resumes after its lease expires; interrupted sending requires reconciliation. This hosting suits modest periodic monitoring, not instant delivery or an unbounded public service.

References: https://ventraip.com.au/support-centre/setting-up-a-nodejs-application-in-cpanel/ and https://ventraip.com.au/support-centre/creating-automated-tasks-cron-jobs-in-cpanel/

**OrangeHost:** published terms prohibit cron intervals below 20 minutes and restrict resource use. If the worker runs on OrangeHost, configure at least `MIN_POLL_SECONDS=1200` and a compliant cron schedule, subject to confirmation of the particular account. Do not work around the limit with a hidden loop. Node and PostgreSQL support on the user's plan have not been verified. Source: https://v2.orangehost.com/legal/terms-of-service

Sources checked 11 November 2026; the VentraIP account was subsequently inspected read-only with the user's authorisation. Mailboxes can remain at either provider even when the application runs elsewhere. This application runs on Node with MySQL/MariaDB; PHP alone is insufficient.

## cPanel / Passenger candidate setup

1. Upload source and lockfile into a private application directory, outside `public_html`. Exclude `.env`, `.data`, `.git`, local `node_modules`, test results and demo storage.
2. In Setup Node.js App choose Node 22.12+, Production, the application root and desired HTTPS URL. Use `app.cjs` as the startup file; it imports the compiled ESM server.
3. Activate the cPanel-provided Node environment over SSH. Run `npm ci`, `npm run build` and `npm run migrate`. You can build elsewhere, but install production dependencies on the destination OS with `npm ci --omit=dev`.
4. Configure production environment values securely. The compiled migration command is `npm run migrate:prod`; it does not require dev dependencies.
5. Configure the host's required listening interface/port. `HOST` defaults to loopback; Passenger must support the app's listen call. Restart through the control panel and check `/health`.
6. Install a compliant cron invocation of `node /absolute/app/dist/server/worker-main.js --once` with its **working directory set to the application directory** and its environment loaded securely. For OrangeHost an example schedule is `*/20 * * * *`, only after confirming the account's rules.
7. Check the UI's last-successful-check timestamp after closing the browser. A running web process alone does not run the production worker.

One worker tick handles one due mailbox and one queued reply. WORKER_BATCH_SIZE (1-10) sets the ticks per cron invocation. With many mailboxes, the cron interval can create a long backlog; use an authorised continuous worker on suitable hosting or extend the bounded batch runner after measuring the provider's execution limit. Shared hosting suitability for an open multi-customer service is not established.

## Direct Linux services

Use systemd or the hosting service's process manager for two separate processes, both starting in the application directory:

```
node dist/server/main.js
node dist/server/worker-main.js
```

Run under a dedicated unprivileged account. Restart on failure. Terminate gracefully on deployment. Route HTTPS through a configured reverse proxy, preserve the expected host and allow the OAuth metadata, `/authorize`, `/token`, `/register`, `/revoke`, `/mcp` and application paths. Do not run the development server publicly.

## Backups and restore

For MySQL/MariaDB use cPanel backups or `mariadb-dump --single-transaction` with a protected defaults file. For PostgreSQL use `pg_dump --format=custom`. Back up the encryption key separately using a secrets manager; a database backup without its key cannot decrypt mailbox credentials. Do not place credentials in command arguments, public directories or build archives.

To restore: stop the worker, restore into an isolated database with the matching database client, restore the matching key, run migrations, verify user/mailbox permissions and only then resume monitoring. Any `Sending` outbox item older than five minutes becomes `Delivery uncertain`; reconcile it with the provider instead of re-queuing it. Test restore periodically without sending real email. Demo backup is a stopped-process copy of `.data/demo` plus `.data/demo-key`, never a production substitute.

## Updates

Back up, stop the worker, install from the lockfile, build, apply migrations and restart both processes. Test a staging mailbox before resuming customer traffic. Migration 1 is additive/idempotent; future destructive migrations require an explicit migration and recovery plan.

## Account notifications on cPanel

`ACCOUNT_SENDMAIL=true` selects `/usr/sbin/sendmail` for verification, reset and invitation messages. Configure ACCOUNT_FROM on the hosted domain with valid DNS authentication. Mailbox replies still use TLS SMTP and explicit approval. Set ACCOUNT_SENDMAIL=false to use ACCOUNT_SMTP_URL instead. Actual inbox delivery must be checked by the recipient.

## Integration testing without Docker

Use the official MariaDB Windows ZIP distribution, bound to 127.0.0.1 on a separate port. Supply MYSQL_TEST_URL to `npm test`. Each suite creates and drops only its randomly named cmm_test_* database. The helper rejects remote test hosts. Without the variable, tests use PGlite and the additional MySQL concurrency suite is skipped.


## Current VentraIP deployment (11 November 2026)

URL: https://mailmonitor.clickecommerce.com.au/; MCP path: `/mcp`.
Private app directory: `/home/clickeco/clickemailmonitor`; public directory: `/home/clickeco/mailmonitor-public`. MariaDB database/user: `clickeco_cmm2026`. Secrets exist only in the private server `.env` and are not included in archives.

The web launcher originally inherited RLIMIT_NPROC soft 50 / hard 60. Setting soft 65 failed; the corrected launcher sets soft 60, within the existing hard limit, and uses one V8 worker and one libuv worker. The running application process was updated to 60/60. No other application was modified. The account-wide CloudLinux limit remains 65; enough free capacity must remain for Node and mail helpers.

`deploy-worker.py` preserves all other cron entries and installs one bounded 15-minute job. `flock -F` and shell `exec` reduce unnecessary processes, and the cron command initially set the soft process limit to 60 before execution. The compiled worker prints a completion timestamp after database close. The exact deployed command completed successfully at 2026-11-11T07:11:36.853Z. Scheduling under live mailbox load remains to be verified.

HTTP requests redirect permanently to HTTPS. Public health returned 200 after requesting a web-process restart.

Confirmed a replacement web process inherited 60/60 limits and returned HTTP 200. The first corrected scheduled cron run completed at 2026-11-11T07:15:03.542Z. A pthread resource warning preceded completion, so account-wide process headroom remains limited; sustained live-mailbox load is not yet verified.

## Worker process-limit correction (12 November 2026)

Worker logs showed timeout failing to fork under the imposed 60-process soft limit. The worker now uses a 65-process soft limit, within the account CloudLinux allowance, and directly executes the configured Node binary with one V8 and one libuv worker. The web launcher remains at its existing 60/60 limit. The 15-minute cron, flock overlap guard and 180-second timeout are retained. Other hosted applications were not changed. Shared account capacity can still prevent execution at peak load; this change is not a capacity guarantee.

## OAuth deployment and account capacity — 12 November 2026

Applied additive migration 2 and deployed the refresh-token release. A graceful restart of the verified email application process exposed account-wide process exhaustion (`execve: Resource temporarily unavailable`). The attempted email-site RLimitNPROC override was ineffective and reverted.

With explicit owner approval, ClickPDF was restarted using `/home/clickeco/clickpdf/node-mailmonitor-capacity-launcher`. It sets the soft process limit to 60, `UV_THREADPOOL_SIZE=1`, and executes its existing Node 24 binary with `--v8-pool-size=1`. Only the PassengerNodejs directive in `/home/clickeco/public_html/clickpdf/.htaccess` was changed; its original is retained in a timestamped `htaccess-before-capacity-*.txt` backup in the private ClickPDF directory. Both sites subsequently returned HTTP 200. No other application was adjusted. Account capacity remains shared and limited.

ChatGPT automatic refresh was verified against production by expiring the current access token, making a successful MCP call without reconnecting, and confirming a consumed renewal token plus an active replacement.
