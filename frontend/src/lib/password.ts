const BCRYPT_MAX_BYTES = 72;

export function exceedsPasswordByteLimit(password: string): boolean {
  return new TextEncoder().encode(password).byteLength > BCRYPT_MAX_BYTES;
}
