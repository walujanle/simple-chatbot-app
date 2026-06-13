import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

export function exceedsBcryptInputLimit(password: string): boolean {
  return bcrypt.truncates(password);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
    const valid = await bcrypt.compare(password, storedHash);
    const cost = Number(storedHash.split("$")[2]);
    return { valid, needsRehash: valid && cost < BCRYPT_COST };
  }
  return { valid: false, needsRehash: false };
}
