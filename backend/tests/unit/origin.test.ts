import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHttpOrigin } from "@/utils/origin.js";

test("normalizeHttpOrigin accepts and normalizes exact HTTP origins", () => {
  assert.equal(normalizeHttpOrigin("https://chat.example.com/"), "https://chat.example.com");
  assert.equal(normalizeHttpOrigin("http://localhost:5173"), "http://localhost:5173");
});

test("normalizeHttpOrigin rejects non-origin URL components", () => {
  for (const value of [
    "https://user:password@chat.example.com",
    "https://chat.example.com/app",
    "https://chat.example.com?preview=true",
    "https://chat.example.com#fragment",
    "ftp://chat.example.com",
  ]) {
    assert.throws(() => normalizeHttpOrigin(value));
  }
});
