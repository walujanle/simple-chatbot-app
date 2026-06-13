# Web Search

Web search is an opt-in server-side research pipeline. It does not use a provider-native browsing tool. The backend formulates a local query, calls configured search engines, optionally extracts public pages, and supplies bounded evidence to the active chat provider.

## Execution Order

1. `formulateSearchQuery` normalizes the user message and applies a day/week freshness filter for clearly time-sensitive wording.
2. Brave Search runs when `BRAVE_SEARCH_API_KEY` is configured.
3. SearXNG runs when `SEARXNG_BASE_URL` is configured.
4. If the combined structured results contain fewer than five unique URLs, DuckDuckGo HTML and Bing HTML run in parallel.
5. Results are interleaved by rank, canonicalized, and deduplicated.
6. The first configured number of result pages are fetched in parallel and reduced to text evidence.
7. Up to six sources enter model context and the response receipt.

SearXNG must enable JSON output for `/search?format=json`; many public instances disable it. Its endpoint must also be reachable on the public network because the search dispatcher never permits private or loopback addresses. Structured APIs are the intended production path. The HTML engines are a best-effort fallback, not a stable API contract.

References: [Brave Search API](https://api-dashboard.search.brave.com/documentation), [Brave Web Search endpoint](https://api-dashboard.search.brave.com/api-reference/web/search/get), and [SearXNG Search API](https://docs.searxng.org/dev/search_api.html).

## Enforced Bounds

| Limit | Implementation |
| --- | --- |
| Returned search results | 8 maximum |
| Sources supplied to the model/receipt | 6 maximum |
| Search response body | 1,000,000 bytes per request |
| Fetched page body | 750,000 bytes per page |
| Extracted page evidence | 3,500 characters per page |
| Page extraction count | `SEARCH_PAGE_FETCH_LIMIT`, default 3, allowed 0-5 |
| Redirects | 3 validated redirects maximum |
| Per-request timeout | `SEARCH_TIMEOUT_MS`, default 10 seconds, allowed 1-30 seconds |

Search snippets are capped at 1,200 characters and titles at 300 characters. Tracking parameters and fragments are removed during URL canonicalization. There is no persistent search cache in this release.

## Safety Model

- Search and page requests always use the public-only network dispatcher.
- Private, loopback, link-local, carrier-grade NAT, and other reserved destinations are rejected before the request and during socket lookup.
- Redirect targets are revalidated before every follow.
- Public HTTP result pages are allowed, but private/reserved addresses remain blocked. HTTP evidence has no transport confidentiality or integrity and should be treated with additional caution.
- Only `text/html` and `text/plain` result pages are extracted.
- Script, style, navigation, form, and other non-content elements are removed before text extraction.
- Evidence is labeled `UNTRUSTED CONTENT`, and the model is instructed to ignore embedded commands and cite supplied source numbers.

Prompt boundaries reduce prompt-injection risk but cannot guarantee model compliance. Search evidence and generated answers remain untrusted.

## Privacy And Receipt Semantics

- Brave receives the generated query and API key when configured.
- A configured SearXNG instance receives the generated query.
- DuckDuckGo and Bing receive the query when fallback runs.
- Extracted source hosts receive a request from the backend host.
- Logs record provider name and error type, not the query, key, or response body.

The response receipt stores the search query and candidate sources supplied to the model. It does not verify factual correctness, confirm that every source was cited, or prove that inline citation numbers correspond to the stored source list.

## Failure Behavior

Each search provider fails independently. If no result survives, the SSE stream reports `search_unavailable` and chat generation continues without research context. Page extraction failure keeps the result snippet. Search errors are not exposed with upstream response bodies.

## Maintenance Notes

Brave and SearXNG parsing is schema-validated against their documented JSON shapes. DuckDuckGo and Bing selectors can change without notice. When fallback results disappear:

1. Reproduce the upstream HTML change without weakening SSRF, redirect, timeout, or body limits.
2. Update selectors and URL unwrapping in `backend/src/utils/search.ts`.
3. Add or update parser fixtures/tests.
4. Prefer Brave or a controlled, public-network-reachable SearXNG deployment for reliability.

Review upstream terms, quotas, and automated-access policies before operating the fallback at public scale.
