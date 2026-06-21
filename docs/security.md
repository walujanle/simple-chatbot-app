# Security Model

## Trust Boundaries

The browser, self-hosted backend, database, AI providers, search providers, fetched web pages, and deployment operator are separate trust boundaries.

- The backend is trusted with plaintext prompts, conversation history, session claims, and temporarily decrypted provider keys.
- AI providers receive the prompt and selected conversation context.
- Search providers receive the generated query; fetched result hosts observe a server-side page request.
- The database stores conversations, password hashes, encrypted provider credentials, and operational receipts.
- Web content and model output are always untrusted application data.

This design is encrypted at rest for provider keys, not end-to-end encrypted or zero-knowledge.

## Implemented Controls

### Authentication And Authorization

- Passwords use `bcryptjs` cost 12. Lower-cost bcrypt hashes are upgraded after successful login.
- New and changed passwords are limited to bcrypt's 72-byte UTF-8 input boundary.
- Sessions are HS256-signed JWTs stored only in HttpOnly cookies.
- Session expiry is checked cryptographically; a database `session_version` revokes existing sessions after logout or password change.
- Every chat and provider route resolves data under the authenticated user ID.
- State-changing requests require an exact configured `Origin` in addition to CORS.
- Secure cookies use the `__Host-` prefix, `Path=/`, no `Domain`, and `Secure`.

### Credential Protection

- Provider keys use AES-256-GCM authenticated encryption with a fresh nonce.
- API responses return only `Configured`; keys are not returned to the browser or placed in browser storage.
- A non-secret encryption identity marker detects key changes at startup.
- When the key identity changes, or a credential cannot be decrypted, affected provider configuration rows are deleted. If no active configurations remain, the active provider state is cleared and the user receives a persistent reset notification.
- The same secret is rejected for JWT signing and credential encryption in production.

The backend process can decrypt credentials and an operator with runtime or secret access can do the same. Database encryption does not protect against a compromised backend host.

### Network And SSRF Controls

- Production AI endpoints require HTTPS, reject embedded URL credentials, disable redirects, and block private/reserved addresses unless `ALLOW_PRIVATE_AI_ENDPOINTS=true`.
- DNS answers are checked before a request and again by the socket lookup to reduce DNS-rebinding exposure.
- Web-search requests always block private/reserved destinations, including when private AI endpoints are allowed.
- Search follows at most three validated redirects and accepts public HTTP pages because search results may link to them. This is not transport confidentiality; prefer HTTPS sources.
- Response byte limits and content-type checks reduce exposure to oversized or unexpected search content.

These controls reduce SSRF risk but do not replace outbound firewall or egress policy. See the [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

### Input, Storage, And Rendering

- Zod validates request shapes and bounds usernames, messages, prompts, provider fields, model limits, and URLs.
- Hono rejects request bodies above 64 KiB.
- Per-user chat and per-chat message quotas bound durable growth.
- Kysely parameterizes application queries; versioned migrations run under a database lock.
- Markdown rendering disables raw HTML and filters link/image protocols.
- Web evidence is labeled as untrusted and separated from system instructions before model submission.
- Provider/search responses, extracted pages, summaries, reasoning text, and visible output have explicit size bounds.

### Runtime And Logging

- Provider requests have deadlines and active streams are aborted during graceful shutdown.
- Database and outbound connection pools are closed during shutdown.
- Current structured log call sites emit operational event names, request IDs, counts, hosts, or error types and intentionally omit prompts, credentials, queries, and response bodies.
- Rate limits are bounded, process-local, route-specific, and primarily keyed by client IP. Trusted proxy parsing is disabled unless explicitly configured.

Future log fields must follow the same privacy rule; the logger does not automatically redact arbitrary values.

## Security Header Scope

The frontend build emits CSP, HSTS, clickjacking, MIME-sniffing, referrer, permissions, and cross-origin headers in `dist/_headers`. These protections exist only when the static host interprets that file or equivalent headers are configured manually. The backend also applies Hono secure headers to API responses.

External scripts and connections are denied by the generated CSP unless their exact origins are added through `VITE_CSP_SCRIPT_ORIGINS` or `VITE_CSP_CONNECT_ORIGINS` at build time.

## Explicit Limitations

- No MFA, email verification, password reset, account recovery, or administrative role system is implemented.
- Application rate limits and active-stream locks are not shared across replicas and reset on restart.
- Response receipts are mutable database records, not signed or tamper-evident audit logs.
- Candidate sources in a receipt are the evidence supplied to the model, not proof that the model cited or interpreted each source correctly.
- Token counts can be absent or provider-reported; context input counts are local estimates.
- HTML search parsing can break when upstream markup or anti-automation policy changes.
- The project has not undergone an independent penetration test or compliance certification.
- `npm run verify` does not test live providers, browser security behavior, infrastructure policy, or every remote database.
- AI and web results can be false, malicious, stale, or unsafe. High-impact decisions require independent verification.

## Secret Rotation

- Rotating `JWT_SECRET` invalidates all existing session cookies.
- Rotating `CREDENTIAL_ENCRYPTION_KEY` intentionally deletes stored provider credentials at the next startup; it does not re-encrypt them.
- Back up the current encryption key with the database if credentials must survive restore.
- Never reuse production secrets between environments.

## Production Checklist

- Use a currently supported Node.js LTS release and apply security updates promptly.
- Use HTTPS and verify the deployed cookie attributes in a real browser.
- Generate independent high-entropy JWT and credential-encryption secrets.
- Restrict `FRONTEND_URL` and frontend CSP origin variables to necessary exact origins.
- Keep `ALLOW_PRIVATE_AI_ENDPOINTS=false` unless the risk is explicitly accepted.
- Disable open registration when it is no longer needed.
- Configure trusted proxy hops exactly and overwrite inbound forwarding headers at the proxy.
- Add infrastructure rate limiting, monitoring, backups, and outbound network policy.
- Require TLS for remote databases using settings supported by the selected driver/provider.
- Run repository verification, dependency audits, and deployed smoke tests before release.
- Establish an incident process for secret compromise, credential deletion, database restore, and user notification.

Session guidance is aligned with the [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) cheat sheets.
