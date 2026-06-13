import crypto from "node:crypto";
import { config } from "@/config.js";
import { isValidCredentialEncryptionKey } from "@/utils/secret-policy.js";

const VERSION = "v1";
const IDENTITY_CONTEXT = "simple-chatbot:credential-encryption";

function resolveEncryptionKey(): Buffer {
  const configured = config.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!configured) {
    return crypto.createHash("sha256").update(`credential-key:${config.JWT_SECRET}`).digest();
  }

  if (!isValidCredentialEncryptionKey(configured)) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as base64 or hex");
  }

  if (/^[a-fA-F0-9]{64}$/.test(configured)) {
    return Buffer.from(configured, "hex");
  }

  return Buffer.from(configured, "base64");
}

const encryptionKey = resolveEncryptionKey();

export function getCredentialEncryptionIdentity(): string {
  return `${VERSION}.${crypto.createHmac("sha256", encryptionKey).update(IDENTITY_CONTEXT).digest("base64url")}`;
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Unsupported encrypted credential format");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
