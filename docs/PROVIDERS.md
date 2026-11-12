# Mailbox onboarding

## OrangeHost

1. Sign in to your hosting control panel yourself. Find the mailbox's secure manual mail-client settings. In cPanel, use Email Accounts → Connect Devices.
2. Copy the incoming IMAP hostname, port, TLS mode and username, and the outgoing SMTP equivalents. No OrangeHost hostname is hard-coded or inferred from your domain.
3. In ClickeMailMonitor choose Mailboxes → Connect mailbox → OrangeHost. Enter settings and credentials directly in the form over HTTPS. SMTP can use a separate password if required.
4. Select a bounded import window (7, 14 or 30 days in the UI), polling interval and local retention. Use TLS for implicit TLS ports (normally 993/465) and STARTTLS for explicit upgrades (143/587), exactly as your provider specifies. Certificate verification is always enabled.
5. Save, then choose Test. Incoming and outgoing authentication are tested separately; **no test message is sent**.
6. Start the worker and check the connection state. Inspect folder listings, unread flags, message text and attachments. The initial import is capped at 100 new UIDs per folder per worker pass, 10 MB per message; oversized messages are skipped rather than fully downloaded.
7. Only after explicit authorisation, create a reply to a controlled test mailbox. Review all recipients, approve the exact version and queue it. Verify SMTP acceptance and the Sent folder. This live step has not been performed.

Determine whether the provider automatically saves SMTP messages to Sent. Enable that setting if it does; otherwise the application attempts to append the composed message to the IMAP folder marked `\\Sent`. A failed Sent copy does not trigger another SMTP send.

Reference for the cPanel configuration screen: https://docs.cpanel.net/cpanel/email/set-up-mail-client/

## VentraIP — Preview, not live verified

The provider descriptor, configuration schema, onboarding choice and adapter path are implemented and contract-tested. VentraIP may provide dedicated email or cPanel email with different settings. Use the settings for the actual service, not a guessed hostname.

Before changing the Preview label, verify incoming and outgoing authentication, folder special-use flags, MIME parsing, reconnects, Sent copy behaviour, attachment limits and approved sending against an explicitly authorised mailbox. Source: https://ventraip.com.au/support-centre/troubleshooting-email-client-problems/

## Other providers

The generic adapter supports secure username/password IMAP and SMTP. OAuth-only mail providers are not implemented. Server hostnames must resolve exclusively to public unicast IPs; private servers, VPN-only servers and custom mail ports are intentionally not accepted. No plaintext mail transport is permitted.

Credentials are encrypted when saved, never returned to the browser or MCP. There is no mailbox password-edit UI in this version; disconnect/reconnect to change connection credentials. Disconnect deletes local messages, drafts, alerts and credentials, not provider-hosted email. Pause first and wait for active operations to finish.
