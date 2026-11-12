# API and MCP overview

This is an implementation overview, not a stable public REST contract. See server/app.ts, auth.ts, oauth.ts and mcp.ts for exact payload schemas and status codes.

Browser API routes use session cookies. Mutations require the session CSRF token and same-origin checks. Mailbox and workspace access is enforced server-side; never rely on hidden UI controls as authorisation.

| Route family | Purpose |
| --- | --- |
| /health | Service health |
| /api/config, /api/me | Public configuration and authenticated session |
| /api/auth/* | Registration, sign-in, verification, recovery and sign-out |
| /api/mailboxes | Mailbox setup, listing, tests, pause and permissions |
| /api/messages | Search/list, message, conversation and attachment retrieval |
| /api/drafts | Create/edit, browser approval and sending |
| /api/rules, /api/alerts | Monitoring configuration and results |
| /api/workspaces/* | Team, settings and audit |
| /api/connections | OAuth connection listing/revocation |
| /authorize, /token, /register, /revoke | OAuth authorisation and public-client registration |
| /mcp | Authenticated Streamable HTTP MCP |

MCP exposes 11 tools listed in CHATGPT.md. OAuth uses S256 PKCE, resource binding and revocable one-hour access tokens. No refresh tokens are implemented. There is no MCP tool that approves a draft or returns credentials. Send requests can queue only a version approved by the user in the web interface.

Email text is untrusted data. Clients should not interpret instructions within messages as authority to send mail, change permissions or reveal secrets.
