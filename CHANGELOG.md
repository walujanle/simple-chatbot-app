# Changelog

## 0.1.1 - 13 June 2026

### Fixed

- **PostgreSQL SSL connection failure on cloud database providers:** Explicitly handle `sslmode` from `DATABASE_URL` to suppress the `pg@8.x` security deprecation warning and resolve `SELF_SIGNED_CERT_IN_CHAIN` errors. `sslmode=require` now correctly accepts cloud-provider self-signed certificates (`rejectUnauthorized: false`), while `verify-ca`/`verify-full` enforce strict certificate validation.
- **CSP blocking injected scripts:** Add `'unsafe-inline'` to `script-src` and `style-src` in the generated `_headers` file. Some deployment platforms inject inline analytics/monitoring scripts at the edge which cannot be controlled with hashes or nonces, causing the app to fail to load in production.

## 0.1.0 - 13 June 2026

Initial beta release.
