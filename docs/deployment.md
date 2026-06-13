# Deployment

## Supported Release Target

For `v0.1.3`, the fully verified topology is:

- a static frontend host that applies SPA rewrites and the generated security headers
- one long-lived Node.js 24+ backend process
- SQLite on durable local storage, or one supported remote relational database

Serverless deployment is possible only as an integration project. No AWS Lambda, Azure Functions, Vercel, Netlify Functions, Cloudflare Workers, or other runtime adapter is included or verified by this repository.

## Frontend

Build from `frontend`:

```sh
npm ci
npm run build
```

Publish `frontend/dist`.

| Host setting | Value |
| --- | --- |
| Base directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` when the base directory is applied |
| API environment | `VITE_API_BASE_URL=https://api.example.com` when the API uses another origin |

The build copies `_redirects` and generates `_headers` in `dist`. Netlify and Cloudflare Pages support these files for SPA routing and response headers. Other static hosts must translate both files into their native routing/header configuration. Merely uploading `_headers` to a host that does not interpret it does not activate CSP or the other security headers.

Leave `VITE_API_BASE_URL` empty only when `/api` is routed to the backend on the frontend's origin. The value is public and embedded at build time; changing it requires rebuilding.

Optional comma-separated CSP origin allowlists:

```env
VITE_CSP_SCRIPT_ORIGINS=https://static.cloudflareinsights.com
VITE_CSP_CONNECT_ORIGINS=https://cloudflareinsights.com
```

Entries must be exact HTTP(S) origins without paths, credentials, queries, or fragments. Production non-loopback origins must use HTTPS. Keep script and connection origins separate so a telemetry collector is not also authorized to execute JavaScript.

References: [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/), [Cloudflare Pages redirects](https://developers.cloudflare.com/pages/configuration/redirects/), [Netlify headers](https://docs.netlify.com/manage/routing/headers/), and [Netlify redirects](https://docs.netlify.com/manage/routing/redirects/overview/).

## Backend

Build and start the Node process:

```sh
cd backend
npm ci
npm run build
npm start
```

Package scripts explicitly set `NODE_ENV`: development for `dev`, test for tests, and production for `build` and `start`. Do not add `NODE_ENV` to `.env` when using those scripts.

### Required Production Environment

```env
FRONTEND_URL=https://chat.example.com
JWT_SECRET=<independent high-entropy secret of at least 32 characters>
CREDENTIAL_ENCRYPTION_KEY=<independent 32-byte base64 or hex key>
DATABASE_URL=
```

`DATABASE_URL` is a required selector even when empty. `FRONTEND_URL` accepts comma-separated exact origins. All optional settings and enforced ranges are documented in `backend/.env.example`.

Production startup fails closed when frontend origins are missing/insecure, secrets are obvious placeholders or reused, the encryption key is invalid, or cookie settings are unsafe.

## Database Selection

### SQLite

An empty `DATABASE_URL` selects `backend/database/chatbot.db`. Mount `backend/database` on durable storage and run only one backend replica against that volume.

SQLite uses WAL mode. For a live backup, use a SQLite-aware online backup tool. For a file copy, stop the backend first and preserve the database plus any `-wal` and `-shm` files. Back up `CREDENTIAL_ENCRYPTION_KEY` separately; losing or changing it causes stored provider credentials to be deleted as unreadable. Restore-test the database and key together.

### Remote Database

A non-empty URL selects the driver by scheme:

```env
DATABASE_URL=postgresql://user:password@database.example:5432/chatbot?sslmode=require
```

Supported schemes are `postgresql://`, `postgres://`, `mysql://`, and `mariadb://`. PostgreSQL receives the configured connection string. MariaDB URLs are normalized to the `mysql://` scheme for the MySQL driver. TLS and provider-specific options must be expressed in a form supported by the selected driver and database service.

Startup applies versioned migrations. Before routing production traffic to a new remote database, run:

```sh
npm run test:database
```

The script migrates the target, creates a user/chat/message, verifies the relation, and deletes its user. Use a disposable or newly provisioned database because migrations are not rolled back by the smoke test.

Ephemeral platforms must use a remote database. A non-empty `DATABASE_URL` alone does not make the complete application serverless-ready.

## Cookies And Origins

All browser requests include credentials. Every state-changing API request must carry an `Origin` exactly present in `FRONTEND_URL`; wildcards are not supported.

The automatic production default for any public frontend origin is `Secure` plus `SameSite=None`. For a same-site frontend/API deployment, explicitly use the stricter mode when compatible:

```env
COOKIE_SAME_SITE=Lax
COOKIE_SECURE=true
```

For genuinely cross-site origins:

```env
FRONTEND_URL=https://app.example,https://preview.example
COOKIE_SAME_SITE=None
COOKIE_SECURE=true
```

Secure mode uses `__Host-chatbot_session`, which has no `Domain` attribute and uses `Path=/`. TLS termination must preserve HTTPS behavior. Browsers or privacy tools can still block third-party cookies for unrelated sites, so same-origin or same-site frontend/API deployment is the most reliable option.

## Reverse Proxy

The proxy must:

- terminate HTTPS before public production traffic reaches the app
- preserve SSE and disable response buffering for `/api/chats/*/messages/stream`
- allow request bodies up to 64 KiB
- overwrite untrusted client forwarding headers with the actual client chain
- set `TRUST_PROXY=true` only behind known proxies
- set `TRUST_PROXY_HOPS` to the exact trusted hop count
- use infrastructure request limits in addition to the application's process-local limits

## Serverless And Horizontal Scale

`backend/src/app.ts` can be imported by a Node-compatible adapter, but a deployment must independently solve:

- streaming duration and response buffering
- database connection reuse and pool sizing
- process-local rate limits across instances
- one-active-stream-per-chat coordination across instances
- graceful cancellation and platform shutdown semantics
- cold-start migration behavior

Use a long-lived Node process for the supported beta path. Treat serverless and multi-replica deployments as unverified until they have platform-specific integration and load tests.

## Operational Checklist

- Use HTTPS for frontend, API, and remote database transport.
- Restrict `FRONTEND_URL` to deployed origins only.
- Set `REGISTRATION_ENABLED=false` after account creation for private deployments.
- Keep `ALLOW_PRIVATE_AI_ENDPOINTS=false` unless internal inference access is intentional and isolated.
- Set storage quotas appropriate to the deployment.
- Back up and restore-test the database and encryption key.
- Monitor disk usage, database connections, provider errors, HTTP 429 responses, and interrupted streams.
- Run `npm run verify` from the repository root.
- Run `npm audit` in the root, backend, and frontend and evaluate results rather than applying forced upgrades blindly.
- Test at least one real chat, provider validation, web-search request, logout, and history reload in the deployed browser environment.
