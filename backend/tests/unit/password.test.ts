import assert from "node:assert/strict";
import test from "node:test";
import { exceedsBcryptInputLimit, hashPassword, verifyPassword } from "@/utils/password.js";

test("hashPassword creates a verifiable bcrypt hash", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.deepEqual(await verifyPassword(hash, "correct horse battery staple"), {
    valid: true,
    needsRehash: false,
  });
  assert.deepEqual(await verifyPassword(hash, "incorrect"), { valid: false, needsRehash: false });
});

test("exceedsBcryptInputLimit measures UTF-8 bytes", () => {
  assert.equal(exceedsBcryptInputLimit("a".repeat(72)), false);
  assert.equal(exceedsBcryptInputLimit("a".repeat(73)), true);
  assert.equal(exceedsBcryptInputLimit("界".repeat(25)), true);
});
