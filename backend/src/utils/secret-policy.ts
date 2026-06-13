const unsafeMarkers = ["replace-with", "change-me", "changeme", "your-secret", "example", "default"];

export function isClearlyUnsafeSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return unsafeMarkers.some((marker) => normalized.includes(marker)) || new Set(normalized).size < 12;
}

export function isValidCredentialEncryptionKey(value: string): boolean {
  const normalized = value.trim();
  if (/^[a-fA-F0-9]{64}$/.test(normalized)) return true;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(normalized)) return false;
  return Buffer.from(normalized, "base64").length === 32;
}
