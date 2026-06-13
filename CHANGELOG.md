# Changelog

## 0.1.3 - 13 June 2026

### Added

- **Guided API key setup in chat:** Detect when no active AI provider credential is configured, show an in-chat setup prompt, disable the unavailable composer, and open AI Provider settings with focus placed directly on the API key field.

## 0.1.2 - 13 June 2026

### Fixed

- **Crash in rate limit middleware on serverless environments:** Wrap `getConnInfo(c)` in a try-catch block and implement fallback checking for standard HTTP proxy headers (`cf-connecting-ip`, `x-real-ip`, `x-forwarded-for`) to prevent `TypeError` when running outside a Node-native socket environment.
- **Enhanced production request error logging:** Update global `onError` handler to log full error messages and stack traces to simplify troubleshooting.

## 0.1.1 - 13 June 2026

### Fixed

- **PostgreSQL SSL connection failure on cloud database providers:** Explicitly handle `sslmode` from `DATABASE_URL` to suppress the `pg@8.x` security deprecation warning and resolve `SELF_SIGNED_CERT_IN_CHAIN` errors. `sslmode=require` now correctly accepts cloud-provider self-signed certificates (`rejectUnauthorized: false`), while `verify-ca`/`verify-full` enforce strict certificate validation.
- **CSP blocking injected scripts:** Add `'unsafe-inline'` to `script-src` and `style-src` in the generated `_headers` file. Some deployment platforms inject inline analytics/monitoring scripts at the edge which cannot be controlled with hashes or nonces, causing the app to fail to load in production.

## 0.1.0 - 13 June 2026

Initial beta release.
