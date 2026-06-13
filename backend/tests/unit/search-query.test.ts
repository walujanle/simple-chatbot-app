import assert from "node:assert/strict";
import test from "node:test";
import { formulateSearchQuery } from "@/utils/search-query.js";

test("formulateSearchQuery removes request boilerplate", () => {
  assert.equal(formulateSearchQuery("mohon cari di internet harga emas terbaru").query, "harga emas terbaru");
});

test("formulateSearchQuery assigns a recent time filter", () => {
  assert.equal(formulateSearchQuery("latest TypeScript news").timeFilter, "w");
  assert.equal(formulateSearchQuery("news today").timeFilter, "d");
});
