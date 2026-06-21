# Architecture

## Runtime Topology

```text
Browser
  -> React SPA
  -> credentialed HTTP/SSE requests
  -> Hono application
       -> authentication and exact-origin middleware
       -> chat, provider, and account routes
       -> provider protocol adapters
       -> public web-search pipeline
       -> Kysely database layer
  -> SQLite, PostgreSQL, MySQL, or MariaDB
```

The frontend and backend are independently deployable. `backend/src/app.ts` owns the Hono application, while `backend/src/index.ts` owns the Node listener, timeouts, signals, and resource shutdown. This separation makes a Node runtime adapter possible, but the application is not an edge-runtime bundle and this release includes no serverless adapter.

## Source Boundaries

| Boundary | Responsibility |
| --- | --- |
| `frontend/src/api` | Credentialed API calls and SSE parsing |
| `frontend/src/components` | Chat, authentication, settings, receipts, and responsive layout |
| `frontend/src/hooks` | Chat history, optimistic messages, stream lifecycle, and UI state |
| `backend/src/app.ts` | Hono middleware, health endpoint, and route composition |
| `backend/src/index.ts` | Node server lifecycle and graceful shutdown |
| `backend/src/routes` | Validation, authorization, quotas, persistence, and streaming protocol |
| `backend/src/providers` | OpenAI-compatible, Anthropic, and Gemini wire-protocol adapters |
| `backend/src/services` | Provider credential lifecycle and response receipt persistence |
| `backend/src/database` | Portable schema types, writes, and versioned migrations |
| `backend/src/utils` | Cryptography, context selection, search, network policy, and logging |
| `backend/tests` | Unit tests and SQLite migration integration tests |

Frontend and backend source imports use `@/` for their respective `src` directories. Vite resolves the frontend alias. The backend build type-checks with TypeScript and bundles entry points with esbuild while leaving third-party packages external; production therefore uses standard Node.js without a runtime alias loader or post-build rewrite script.

## Message Flow

1. The browser submits content with explicit `webSearch` and `thinking` booleans. Both default to `false` in the UI and API schema.
2. The backend validates the signed cookie, checks the database-backed session version, and verifies chat ownership.
3. The user message is committed before the provider call. This preserves the prompt even if search or generation fails.
4. When requested, web search produces at most eight deduplicated results. Up to six candidate sources are placed in model context and stored in the receipt.
5. The backend builds system context, including the active model identity (`"You are currently responding as {model} ({provider})"`), the current UTC time, the user's optional system prompt, and untrusted research evidence.
6. Before context selection, assistant messages from prior provider/model configurations are annotated with their origin metadata from `message_receipts`. This gives the active model awareness when previous responses came from a different AI. Annotations are in-memory only and do not modify stored messages.
7. Context selection uses a conservative character-based token estimate. It reserves configured output space, retains recent messages, and summarizes older unsummarized messages only when needed.
8. The selected provider adapter normalizes streamed content, provider-emitted reasoning text when available, and usage metadata.
9. A completed or partial assistant response and its receipt are committed in one database transaction. Partial output is stored with `interrupted` status; a failure before any output leaves only the user message.
10. On the first turn, a separate completion can replace the local fallback title with an AI-generated title. Failure leaves the fallback unchanged.
11. SSE reports persisted identifiers and completion metadata. Reloading the chat reads the same durable messages and receipts, including interrupted responses.

## Provider Contract

| Provider setting | Adapter contract | Reasoning behavior |
| --- | --- | --- |
| OpenAI Compatible | OpenAI Chat Completions request and chunk shapes | Sends modern reasoning fields first, then retries a basic `max_tokens` request on `400` or `422` |
| Claude | Native Anthropic Messages requests and events | Requests adaptive summarized thinking only when enabled and configured above `off` |
| Gemini | Native `generateContent` and SSE `streamGenerateContent` | Maps configured effort to Gemini thinking level/budget fields |

Custom endpoints are validated for URL syntax and network policy, not for protocol conformance until the user runs the provider test or sends a chat message. Validation is a real provider request and can consume quota.

## Context And Token Efficiency

- `contextWindow` and `maxOutputTokens` are user-supplied provider settings; the application cannot discover or verify a model's true limits.
- Input usage in context receipts is an estimate, not provider tokenizer output.
- Provider-reported usage is stored only when the upstream protocol returns it.
- The first-message title uses at most 24 output tokens.
- Conversation summaries are capped at 12,000 characters and are generated through the active provider.
- Message API reads return the newest 1,000 messages in chronological order.
- Provider output is capped by both configured output tokens and a hard one-million-character ceiling.

These limits reduce memory and token use but do not provide exact billing prediction across models or providers.

## Data Model

- `users`: identity, bcrypt password hash, custom system prompt, session revocation version, active provider, and credential-reset notification
- `chats`: ownership, title, rolling summary, and summary checkpoint
- `messages`: durable user and assistant content plus completion status
- `message_receipts`: provider/model metadata, endpoint host, latency, candidate search sources, reasoning settings, reported token usage, and context estimates
- `provider_configs`: multiple encrypted configurations per user, each identified by a unique ID and custom name
- `app_metadata`: non-secret encryption-key identity marker

Chat history and optional receipts are loaded in one query using a derived newest-message set plus a `LEFT JOIN`; provider credentials are never joined into chat reads. Kysely supplies parameterized queries for SQLite, PostgreSQL, MySQL, and MariaDB. Startup runs versioned migrations under Kysely's database migration lock.

## State And Consistency

- Durable state lives in the selected database.
- SQLite uses WAL, full synchronous writes, foreign keys, and one backend replica per database volume.
- Active stream locks and rate-limit counters are process-local and disappear on restart.
- Provider and search connection pools are closed during graceful shutdown; active chat requests are aborted first.
- Response receipts are operational provenance, not tamper-evident audit records. Stored sources show evidence supplied to the model, not proof that the answer cited or interpreted them correctly.

## Trade-offs

| Concern | Current decision | Consequence |
| --- | --- | --- |
| Performance | SSE, indexed reads, SQLite WAL, and pooled remote connections | Low local overhead with a path to shared database storage |
| Memory | Bounded response bodies, output caps, quotas, and newest-history limits | Request memory is bounded, but long provider responses can still approach configured caps |
| Security | Encrypted credentials, exact origins, SSRF controls, and HttpOnly cookies | The backend must decrypt credentials and receives all conversation content |
| Maintainability | Protocol adapters, Kysely, and app/listener separation | New providers or runtimes still require an explicit adapter and verification |
| Scale | Remote relational databases are supported | Horizontal replicas still require shared rate limiting and stream coordination |

## Verification Boundary

Automated checks cover utility behavior, SQLite migrations, production builds, and a local Node HTTP workflow. They do not currently include browser end-to-end tests, live provider contract tests, live search integration tests, load tests, failover tests, or automated PostgreSQL/MySQL/MariaDB CI. Those remain release-operator responsibilities for a public beta deployment.
