# Connecting ChatGPT

The application implements a stateless Streamable HTTP MCP endpoint at `https://mailmonitor.clickecommerce.com.au/mcp`, with OAuth authorisation-code, S256 PKCE, dynamic registration of public clients and revocable one-hour access tokens. Access tokens expire after one hour and can be renewed with rotating refresh tokens. A renewal family expires 90 days after authorisation. Reusing a consumed refresh token revokes its entire family. Disconnect, password reset or family expiry requires reconnection. Client ID Metadata Documents are not implemented.

## Prerequisites

- A deployed HTTPS service reachable from ChatGPT, with the web process and MySQL/MariaDB working.
- A verified ClickeMailMonitor user and explicit access to the required mailboxes.
- A ChatGPT account/workspace that exposes custom MCP connection creation; availability and workspace policy must be checked in the actual account.
- Public access to OAuth metadata and the OAuth routes. Mailbox data routes remain authenticated.

## Setup and test

In a ChatGPT account that supports custom MCP connections, add the deployed `/mcp` URL and select OAuth with dynamic public-client registration where offered. Follow the current account UI. Sign in to ClickeMailMonitor, review the requesting client and return URI, then allow the connection.

As of 12 November 2026, OAuth connection and discovery of all 11 tools succeeded. Four live mailboxes are connected. ChatGPT listed the mailboxes, searched for an imported test message and fetched it through `read_message` (the test message had an empty body). After deliberately expiring only this connection's current access token, `list_mailboxes` succeeded without manual reconnection. Database checks confirmed one consumed refresh token and one active replacement. No mailbox email was sent.

Test `list_mailboxes`, `list_messages`, `search_messages` and `read_message`. Check that a member cannot see an unassigned mailbox. Prepare a draft with `create_reply_draft`, then call `request_send_approval`. The returned URL opens the exact draft in this application. Review recipients, text and attachments, then approve it in the browser. `send_approved_draft` can only queue that approved version. Editing invalidates approval. A model-supplied approval flag is never accepted.

All tools use the same server-side permission checks as the web API. Email content is returned as untrusted data. The server exposes no tool for approving drafts, fetching secrets or making arbitrary network calls. MCP does not run background monitoring; the independent worker does.

Users can revoke active connections in Settings. Password reset revokes sessions and MCP tokens. The short-lived authorisation codes are single-use and bound to client ID, redirect URI and resource.

## Implemented tools

`list_mailboxes`, `list_messages`, `search_messages`, `read_message`, `list_monitoring_alerts`, `create_reply_draft`, `get_reply_draft`, `update_reply_draft`, `request_send_approval`, `get_send_status`, `send_approved_draft`.

## Official references checked 11 November 2026

- Authentication: https://developers.openai.com/plugins/build/auth
- MCP integration and connection steps: https://developers.openai.com/api/docs/mcp
- MCP SDKs: https://modelcontextprotocol.io/docs/sdk
- Optional AI draft API shape: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create

No OpenAI API key is needed for mailbox access through MCP or manual drafting. Optional server-side AI suggestions require an administrator-configured provider key, base URL and model; they have not been tested against a live AI API. Prompts include only the selected email and configured reference material, with daily workspace request limits. This is a review aid, not factual verification.


## Plugin branding package (12 November 2026)

`chatgpt-plugin/` preserves the existing registered app mapping and contains the version 1.0.1 manifest, matching 512px favicon artwork, and website URL https://www.clickecommerce.com.au. Package the contents of this directory at the ZIP root and use the existing plugin details page → More actions → Upload new version. No reconnect or permission changes are needed for these metadata changes.

Status: package prepared; ChatGPT upload remains pending because the browser automation extension refuses local file access. This is not yet verified as applied in ChatGPT.
