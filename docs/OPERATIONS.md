# Operations and recovery

## Deployment

Follow DEPLOYMENT.md. Use the lockfile, install dependencies for the target OS, build and migrate before restarting the web process. Keep configuration outside the public directory. No Docker is used.

The root deploy-*.py scripts are account-specific historical deployment helpers, not generic installers. Review their paths, account guards, database privileges, process limits and cron behaviour before using them. Do not rerun provisioning against an existing installation.

For frontend-only changes, retain previous assets, upload new hashed assets first and replace dist/web/index.html last. Back up replaced source/index files. Backend or schema updates require a maintenance/rollback plan and worker coordination.

## Routine checks

Check HTTPS /health, worker completion logs, last successful mailbox checks, queued/uncertain sends and hosting disk/process capacity. Avoid logging message bodies, passwords, tokens or raw provider errors. A healthy web process does not prove the worker is running.

## Backups

Git preserves source only. Separately back up the database with the matching database tools and store the encryption key in protected secret storage. Record the source commit and runtime configuration associated with each backup. Keep backups outside web roots and restrict access. Establish retention and recovery objectives appropriate to the operator; none are guaranteed by this initial release.

Restore first into an isolated environment with outgoing mail disabled at the network/transport level. Restore the matching key, verify migration compatibility, permissions and cached content. Reconcile queued/uncertain sends before resuming the worker. Do not blindly retry a possibly accepted SMTP message.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Empty inbox | Initial import window, worker schedule, pause/status and provider folder |
| Test button | Wait for inline IMAP/SMTP results; authentication tests do not import |
| Verification email absent | Account transport, provider logs, spam folder and host process capacity |
| Failed to fetch | HTTPS origin, service health, browser network failure and proxy configuration |
| ChatGPT connection expired | Reconnect; one-hour access tokens have no refresh flow yet |
| Worker not updating | Cron working directory, lock, environment, limits and completion log |
| Delivery uncertain | Provider evidence and recipient state; manual reconciliation |

## Rollback

Retain the previous build and dependency lockfile. Frontend rollback restores the previous index and assets. Backend rollback must remain compatible with the database schema; restore a database backup only under a reviewed recovery plan because it can lose subsequent changes. Preserve logs and send-state evidence during an incident.
