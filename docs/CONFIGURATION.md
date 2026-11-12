# Configuration reference

Copy `.env.example` to an ignored `.env` and supply values securely. Never commit real values. The web process and worker must use the same database and credential key.

| Variable | Default / use |
| --- | --- |
| NODE_ENV | Set `production` on the host |
| PORT / HOST | 3100 / 127.0.0.1; adapt to the trusted hosting runtime |
| APP_ORIGIN | http://localhost:3100; production requires the exact HTTPS origin |
| DATABASE_URL | Required in production; mysql:// selects MySQL/MariaDB; PostgreSQL also supported |
| CREDENTIAL_KEY | Required 64 hex characters representing 32 random bytes; back up separately |
| DEMO_MODE | false; must remain false in production |
| DATA_DIR | .data/db; embedded development storage only |
| SIGNUP_LIMIT | 100 |
| MAILBOX_LIMIT | 10 |
| MIN_POLL_SECONDS | Code default 60; explicitly set 900 or a host-compliant higher value on VentraIP |
| WORKER_BATCH_SIZE | 1; bounded 1–10 for one-shot worker |
| ACCOUNT_SENDMAIL | true selects local /usr/sbin/sendmail |
| ACCOUNT_SMTP_URL | SMTP account notification transport when sendmail is disabled |
| ACCOUNT_FROM | Sender for verification, reset and invitation notifications |
| TRUST_PROXY_HOPS | 0; set only for a known trusted proxy topology |
| AI_BASE_URL / AI_API_KEY / AI_MODEL | Optional; all required for server-side AI suggestions |
| MYSQL_TEST_URL | Test-only local server; never production |

Generate a key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and store it securely. Changing it without a migration makes existing encrypted credentials unreadable.

Messages are bounded to 10 MiB and attachments to 5 MiB in the current implementation. Optional AI requests disclose selected content to the configured provider; configure only after deciding the appropriate data-sharing policy. ChatGPT MCP mailbox access does not require an OpenAI API key.
