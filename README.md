# Simple Chatbot App

A self-hosted, multi-provider AI chatbot built with React and Hono. Users bring their own provider credentials and can stream responses, opt into web research or provider reasoning, preserve long conversations with rolling summaries, and inspect response metadata.

> **Release status:** `v0.2.3` is a public beta. The fully verified backend target is one long-lived Node.js process. Static frontend deployment is supported on hosts that can apply SPA rewrites and security headers. Serverless adapters are not included in this release.

## Highlights

- OpenAI Chat Completions-compatible, native Anthropic Messages, and native Gemini `generateContent` protocols
- Custom endpoints for gateways that implement one of those wire protocols
- Per-user provider credentials encrypted at rest with AES-256-GCM
- Portable bcrypt password hashing with cost factor 12
- Signed HttpOnly cookie sessions, exact-origin checks, and process-local rate limits
- In-chat provider setup guidance when no active API credential is configured
- Web search and reasoning disabled by default for every message
- Estimated token-aware context selection and rolling AI-generated summaries
- AI-generated first-message titles with a deterministic local fallback
- Response receipts containing provider, model, endpoint host, latency, reported usage, context estimates, and candidate web sources
- Markdown export and a responsive, keyboard-accessible chat interface
- SQLite by default, or PostgreSQL, MySQL, and MariaDB through Kysely
- Brave Search API and SearXNG JSON support with a bounded DuckDuckGo/Bing HTML fallback
- Vendor-neutral static frontend and Node.js backend

## Architecture

```text
React SPA -> Hono API -> SQLite / PostgreSQL / MySQL / MariaDB
                    |-> OpenAI-compatible Chat Completions
                    |-> Anthropic Messages
                    |-> Gemini generateContent
                    |-> public web search and page extraction
```

The Hono application in `backend/src/app.ts` is separated from the Node listener in `backend/src/index.ts`. It remains a Node-targeted application because the provider SDKs, database drivers, and streaming lifecycle use Node APIs. See [Architecture](docs/architecture.md) for the request flow, storage model, failure behavior, and runtime boundaries.

## Development

Use Node.js 24 LTS or a newer supported LTS release.

1. Install dependencies:

   ```powershell
   npm ci
   npm ci --prefix backend
   npm ci --prefix frontend
   ```

2. Copy `backend/.env.example` to `backend/.env`.
3. Run the following command twice and assign different outputs to `JWT_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

4. Keep `DATABASE_URL=` empty for local SQLite.
5. Run `npm run dev` from `backend` and `frontend` in separate terminals.
6. Open `http://localhost:5173`, register an account, and configure a provider.

The Vite development server proxies `/api` to `http://localhost:3000`. No frontend env file is needed for this local setup. Copy `frontend/.env.example` only when the browser must call a different backend origin or the static build needs additional CSP origins.

## Provider Compatibility

Choose a provider by wire protocol, not by the model brand exposed by a gateway:

| Setting | Required endpoint behavior |
| --- | --- |
| **OpenAI Compatible** | OpenAI-style `POST /chat/completions`, including streaming chat-completion chunks |
| **Claude** | Native Anthropic Messages API semantics |
| **Gemini** | Native Gemini `generateContent` and `streamGenerateContent` semantics |

Use **OpenAI Compatible** for a gateway serving Claude or Gemini models through an OpenAI-style interface. OpenAI itself can be configured with `https://api.openai.com/v1`. Custom Claude and Gemini endpoints must implement their selected native protocol; a model name alone does not make an endpoint compatible.

Reasoning controls are best-effort and provider/model dependent. The OpenAI-compatible adapter retries without modern reasoning parameters after a `400` or `422`, so a compatible text endpoint can still work while exposing no reasoning text. Provider validation sends a real eight-token completion and may consume provider quota. The first message can trigger a separate title completion, and long conversations can trigger separate summary completions.

Protocol references: [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [Anthropic Messages](https://docs.anthropic.com/en/api/messages), and [Gemini content generation](https://ai.google.dev/api/generate-content).

## Deployment

- **Frontend:** publish `frontend/dist` to Netlify, Cloudflare Pages, or another static host. Set `VITE_API_BASE_URL` at build time when the API is on another origin.
- **Backend:** run the compiled Node.js process. An empty `DATABASE_URL` uses `backend/database/chatbot.db`; a supported database URL selects a remote database.
- **Serverless:** the app export can be integrated with a Node-compatible adapter, but this repository does not provide or verify one. The platform must support streaming responses, remote database connections, and replacements for process-local coordination when scaling horizontally.

Production requires `FRONTEND_URL`, `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, and the `DATABASE_URL` variable. `DATABASE_URL` must exist even when its value is empty. See [Deployment](docs/deployment.md) before publishing.

## Verification

```powershell
npm run verify
```

This runs Biome checks, backend unit and SQLite migration integration tests, production builds, and a Node HTTP smoke test. The smoke test covers authentication, exact-origin enforcement, quotas, recent-history loading, credential redaction/deletion, and receipt loading. It does not call real AI/search providers, run browser automation, test every remote database driver, or replace dependency and infrastructure security scans.

Use `npm --prefix backend run test:database` against a disposable or newly provisioned remote database before production traffic. The script creates and deletes its own test user, but it still runs the current migrations against that database.

## Documentation

- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Security model](docs/security.md)
- [Web search](docs/web-search.md)
- [Changelog](CHANGELOG.md)

## License

Repository-authored source code, documentation, and assets are licensed under the [MIT License](LICENSE), unless a file states otherwise. Third-party dependencies keep their own licenses.
