import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret, getCredentialEncryptionIdentity } from "@/utils/crypto.js";

test("credentials round-trip through authenticated encryption", () => {
  const encrypted = encryptSecret("provider-secret-value");

  assert.notEqual(encrypted, "provider-secret-value");
  assert.equal(decryptSecret(encrypted), "provider-secret-value");
});

test("credential encryption identity is stable and versioned", () => {
  const identity = getCredentialEncryptionIdentity();

  assert.match(identity, /^v1\.[A-Za-z0-9_-]{43}$/);
  assert.equal(getCredentialEncryptionIdentity(), identity);
});

test("tampered credentials cannot be decrypted", () => {
  const encrypted = encryptSecret("provider-secret-value");
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;

  assert.throws(() => decryptSecret(tampered));
});
