# Contributing

Use Node 22.12+ and npm. No Docker is required. Install with `npm ci`, then run `npm run build` and `npm run demo` for an isolated synthetic workspace. Frontend edits require rebuilding; `npm run dev` watches only the server.

## Before a pull request

Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. Describe the problem, changed behaviour, validation and any migration or operational impact. Use a focused branch and preserve the lockfile. Do not include credentials, mailbox contents, local databases or account screenshots.

Default tests use isolated PGlite and mocked mail transports. For MariaDB tests, set `MYSQL_TEST_URL` securely to a dedicated local server with permission to create/drop disposable databases. The helper accepts localhost/127.0.0.1 only and creates randomly named `cmm_test_*` databases. Never use production credentials. The MySQL suite skips when this variable is absent.

Security changes must preserve mailbox authorisation in HTTP, MCP and worker paths, exact-version send approval, TLS verification and destination validation. Test failure and retry paths as well as success. Report suspected vulnerabilities privately; see SECURITY.md.

Repository contributions do not imply a licence grant by the owner. Resolve reuse/licensing terms with the owner before distributing a derivative.
