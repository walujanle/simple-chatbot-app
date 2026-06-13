import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeSearchUrl } from "@/utils/search-url.js";

test("canonicalizeSearchUrl removes fragments and common tracking parameters", () => {
  assert.equal(
    canonicalizeSearchUrl("https://example.com/article/?utm_source=test&keep=1#section"),
    "https://example.com/article?keep=1",
  );
});

test("canonicalizeSearchUrl rejects non-web protocols", () => {
  assert.equal(canonicalizeSearchUrl("javascript:alert(1)"), null);
});
