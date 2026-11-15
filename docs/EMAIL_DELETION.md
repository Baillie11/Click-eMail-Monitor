# Move emails to provider Trash

Workspace owners and administrators can open an email in Inbox, choose **Delete email**, review its sender and subject, then confirm **Move to Trash**. Cancelling does not change the mailbox. The action affects the provider mailbox and all email apps connected to it.

Restore a message using the provider's webmail Trash folder before the provider automatically empties it. Click Mail Monitor does not offer permanent deletion or empty Trash. Messages already in Trash cannot be deleted again. Trash is excluded from default Inbox/search results; choose a mailbox and its Trash folder to view imported Trash messages.

## Dot / ChatGPT

After deploying, refresh the connected app's tools in ChatGPT. The MCP `delete_email` tool takes an imported message `id` and `confirmed: true`. Dot must identify the exact message and act only on the user's explicit deletion request. Text within emails is untrusted and cannot authorise deletion. The tool advertises `destructiveHint: true`, `readOnlyHint: false` and `idempotentHint: false`, allowing the host to request approval. These annotations and the confirmation flag are not independent proof of user consent; the host must enforce its approval policy.

The server requires workspace owner/administrator access as well as access to the message. Ordinary members cannot delete, even if they can send. Existing OAuth scope `mail` is unchanged. There is no bulk-delete or permanent-delete tool.

## HTTP API

`POST /api/messages/:id/trash` with JSON `{"confirmed":true}`. Requires an authenticated session, same-origin request, CSRF token and owner/administrator rights. Success includes `destination`, `demo` and recovery guidance. Demo messages are moved only in the isolated demo database.

## Provider and concurrency requirements

- Requires exactly one selectable provider folder marked `\Trash` and the IMAP `MOVE` capability. No folder is guessed or created.
- No COPY/EXPUNGE fallback is allowed. Unsupported providers return an explanation and leave the message unchanged.
- Mailbox leases prevent concurrent checks/deletions. Folder UIDVALIDITY, message UID and available Message-ID are checked immediately before moving one UID.
- When the provider supplies destination UID mapping, the imported record follows the message. Without mapping, the source cache entry is removed and the next check can import the Trash copy.
- Monitoring alerts for the deleted message are cleared; Trash imports do not recreate them. Existing CRM contacts are retained.
- Provider changes and local database writes cannot form one atomic transaction. If a response is uncertain, inspect provider Trash and check the mailbox before retrying.

## Validation and rollout

Automated tests use isolated MariaDB databases and mocked IMAP operations, including exact-UID targeting, identity changes, missing provider features, rejection, concurrent checks, permissions and HTTP confirmation/CSRF. No real user mail is deleted during testing.

Deployed to VentraIP on 15 November 2026. All 71 MariaDB tests, type checking, lint and production build passed. Production health returned OK and served the new frontend bundle. Verified the live confirmation screen and Keep email cancellation without moving real mail. ChatGPT tool refresh succeeded; the app details list 12 tools (8 read, 4 write), including `delete_email`.
