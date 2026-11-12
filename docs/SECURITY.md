# Security and operational boundaries

## Implemented controls

- Argon2 password hashing; high-entropy session/token values stored only as hashes; verified-email sign-in; HTTP-only SameSite cookies; HTTPS-only production cookies.
- Workspace membership and mailbox grants are rechecked by HTTP, attachment, draft, MCP and send-worker paths. Platform-level mailbox reading is not implemented.
- Credential encryption uses AES-256-GCM with random IVs and a separate 32-byte key. Runtime errors return categorised messages without raw provider strings or credentials.
- Hostnames resolve to exclusively public unicast addresses. The actual IMAP/SMTP TCP destination is a validated IP, retaining the original hostname for TLS SNI and certificate verification. Only IMAP 143/993 and SMTP 465/587 are allowed. Certificate validation is never disabled.
- Session mutations require same-origin and session-bound CSRF tokens. Auth/API/OAuth routes are rate limited. Request bodies, import windows, message and attachment sizes are bounded.
- Sanitised email HTML excludes scripts, styles, forms, frames, inline event handlers and remote images. Attachments download through authenticated routes as attachments/octet-stream. They are not malware-scanned; downloading does not establish safety.
- Draft hashes bind mailbox ID, version and all content including recipients/attachments. Browser approval is required. Edits clear approval and replace any not-yet-sent queue entry.
- Outbox uniqueness, transactional claims and send-status recording prevent blind retries. Ambiguous SMTP results and stale Sending jobs become Delivery uncertain. Acceptance by the server is not confirmed delivery.
- UIDVALIDITY + folder + UID identifies imported messages. Message-ID is used for conversation grouping, not deduplication. Reading uses IMAP fetch without setting Seen.
- Database leases protect mailbox sync jobs, with heartbeat renewal and exponential retry delays. MySQL/MariaDB and PostgreSQL transactions provide durable claims. Tests cover PGlite and local MariaDB; deployed multi-process recovery and load still need staging validation.

## Deployment responsibilities and known limits

- The runtime operator can access credentials if they possess both the database and encryption key. Protect host accounts, backups and keys. There is no automatic key rotation tool yet.
- TLS terminates at a correctly configured proxy. Set `TRUST_PROXY_HOPS` only for the actual trusted topology. Host-level outbound firewall rules remain an additional protection.
- Rate limits are process-local. Multi-instance deployment needs shared rate limiting. This build is intended for a single web instance plus its worker, not an unbounded public launch.
- Account email delivery uses administrator-configured SMTP or cPanel sendmail. Registration and password recovery require it. Demo mode never sends account emails.
- AI output must be reviewed. The provider is configured by the server operator, not by email/model input. Quotas are conservative request counts; billing/token-cost accounting is not implemented.
- Local retention deletes cached messages and associated alerts; sent draft records and minimal audit history remain until mailbox deletion. Audit history does not store message bodies. A complete legal retention/export policy is outside this initial implementation.
- SMTP partial-recipient acceptance is recorded for reconciliation. The application will not resend automatically to rejected recipients. Failed/uncertain sends need human attention.
- Folder rename removes stale folder metadata; cached messages from a removed folder remain until retention and may not support attachment retrieval. Thread grouping uses References/In-Reply-To heuristics and is not a universal provider conversation identifier.
- Large mailboxes are imported incrementally (100 new UIDs per folder/pass). Oversized messages are skipped. An IMAP search result itself can be large for a very busy bounded date window; staging load tests are required before opening public registration widely.
- One-hour MCP access tokens require reconnection. OAuth refresh tokens and CIMD are future work, not represented as implemented.

See [validation](VALIDATION.md) for the dated deployment and live-test record.
