import assert from "node:assert/strict";
import test from "node:test";
import { isClearlyUnsafeSecret, isValidCredentialEncryptionKey } from "@/utils/secret-policy.js";

test("isClearlyUnsafeSecret rejects placeholders and repeated values", () => {
  assert.equal(isClearlyUnsafeSecret("replace-with-at-least-32-random-characters"), true);
  assert.equal(isClearlyUnsafeSecret("a".repeat(64)), true);
});

test("isClearlyUnsafeSecret accepts generated secret material", () => {
  assert.equal(isClearlyUnsafeSecret("Q7cFv9H2mK4xP8sT1wY6zB3nR5jL0dUaEoIiGgCcVvM="), false);
});

test("isValidCredentialEncryptionKey accepts exact 32-byte base64 and hex keys", () => {
  assert.equal(isValidCredentialEncryptionKey(Buffer.alloc(32, 7).toString("base64")), true);
  assert.equal(isValidCredentialEncryptionKey("ab".repeat(32)), true);
});

test("isValidCredentialEncryptionKey rejects malformed and wrong-length keys", () => {
  assert.equal(isValidCredentialEncryptionKey(Buffer.alloc(31, 7).toString("base64")), false);
  assert.equal(isValidCredentialEncryptionKey("not-a-valid-key"), false);
});
