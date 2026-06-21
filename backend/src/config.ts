import "dotenv/config";
import { z } from "zod";
import { logError } from "@/utils/logger.js";
import { normalizeHttpOrigin } from "@/utils/origin.js";
import { isClearlyUnsafeSecret, isValidCredentialEncryptionKey } from "@/utils/secret-policy.js";

const booleanFromEnv = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

const enabledFromEnv = z
  .enum(["true", "false", "1", "0"])
  .default("true")
  .transform((value) => value === "true" || value === "1");

const optionalBooleanFromEnv = z
  .preprocess((value) => (value === "" ? undefined : value), z.enum(["true", "false", "1", "0"]).optional())
  .transform((value) => (value === undefined ? undefined : value === "true" || value === "1"));

const optionalSameSiteFromEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.enum(["Lax", "Strict", "None"]).optional(),
);

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FRONTEND_URL: z.string().trim().min(1).default("http://localhost:5173"),
  DATABASE_URL: z.string().trim(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must contain at least 32 characters"),
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidCredentialEncryptionKey(value), {
      message: "CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as base64 or hex",
    })
    .optional(),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24 * 7),
  REGISTRATION_ENABLED: enabledFromEnv,
  COOKIE_SECURE: optionalBooleanFromEnv,
  COOKIE_SAME_SITE: optionalSameSiteFromEnv,
  TRUST_PROXY: booleanFromEnv,
  TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
  ALLOW_PRIVATE_AI_ENDPOINTS: booleanFromEnv,
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(180_000),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  SEARCH_PAGE_FETCH_LIMIT: z.coerce.number().int().min(0).max(5).default(3),
  BRAVE_SEARCH_API_KEY: z.string().default(""),
  SEARXNG_BASE_URL: z.string().default(""),
  MAX_CHATS_PER_USER: z.coerce.number().int().min(1).max(10_000).default(200),
  MAX_MESSAGES_PER_CHAT: z.coerce.number().int().min(10).max(100_000).default(1000),
  SESSION_IDLE_TIMEOUT_HOURS: z.coerce.number().int().min(0).max(720).default(2),
  SESSION_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  logError("invalid_environment_configuration", {
    fields: [...new Set(parseResult.error.issues.map((issue) => String(issue.path[0] || "environment")))],
  });
  process.exit(1);
}

export type DatabaseClient = "sqlite" | "postgresql" | "mysql" | "mariadb";

function resolveDatabaseClient(databaseUrl: string): DatabaseClient {
  if (!databaseUrl) return "sqlite";
  let protocol: string;
  try {
    protocol = new URL(databaseUrl).protocol;
  } catch {
    logError("invalid_database_url");
    process.exit(1);
  }
  if (protocol === "postgres:" || protocol === "postgresql:") return "postgresql";
  if (protocol === "mysql:") return "mysql";
  if (protocol === "mariadb:") return "mariadb";
  logError("invalid_database_url");
  process.exit(1);
}

export const databaseClient = resolveDatabaseClient(parseResult.data.DATABASE_URL);

if (parseResult.data.NODE_ENV === "production" && !process.env.FRONTEND_URL?.trim()) {
  logError("missing_production_frontend_origin");
  process.exit(1);
}

if (parseResult.data.NODE_ENV === "production" && !parseResult.data.CREDENTIAL_ENCRYPTION_KEY) {
  logError("missing_production_credential_encryption_key");
  process.exit(1);
}

if (
  parseResult.data.NODE_ENV === "production" &&
  (isClearlyUnsafeSecret(parseResult.data.JWT_SECRET) ||
    (parseResult.data.CREDENTIAL_ENCRYPTION_KEY && isClearlyUnsafeSecret(parseResult.data.CREDENTIAL_ENCRYPTION_KEY)))
) {
  logError("unsafe_production_secret");
  process.exit(1);
}

if (
  parseResult.data.NODE_ENV === "production" &&
  parseResult.data.CREDENTIAL_ENCRYPTION_KEY === parseResult.data.JWT_SECRET
) {
  logError("reused_production_secret");
  process.exit(1);
}

const configuredOrigins = parseResult.data.FRONTEND_URL.split(",")
  .map((value) => value.trim())
  .filter(Boolean);

let normalizedOrigins: string[];
try {
  normalizedOrigins = [...new Set(configuredOrigins.map(normalizeHttpOrigin))];
} catch {
  logError("invalid_frontend_origins");
  process.exit(1);
}

if (normalizedOrigins.length === 0) {
  logError("missing_frontend_origin");
  process.exit(1);
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const hasPublicFrontend = normalizedOrigins.some((origin) => !loopbackHosts.has(new URL(origin).hostname));
const cookieSecure =
  parseResult.data.COOKIE_SECURE ?? (parseResult.data.NODE_ENV === "production" && hasPublicFrontend);
const cookieSameSite =
  parseResult.data.COOKIE_SAME_SITE ??
  (parseResult.data.NODE_ENV === "production" && hasPublicFrontend ? "None" : "Lax");

if (cookieSameSite === "None" && !cookieSecure) {
  logError("insecure_cross_site_cookie_configuration");
  process.exit(1);
}

if (parseResult.data.NODE_ENV === "production") {
  const publicOrigins = normalizedOrigins
    .map((origin) => new URL(origin))
    .filter((url) => !loopbackHosts.has(url.hostname));
  if (publicOrigins.some((url) => url.protocol !== "https:")) {
    logError("insecure_production_frontend_origin");
    process.exit(1);
  }
  if (!cookieSecure && publicOrigins.length > 0) {
    logError("insecure_production_cookie_configuration");
    process.exit(1);
  }
}

export const config = {
  ...parseResult.data,
  COOKIE_SECURE: cookieSecure,
  COOKIE_SAME_SITE: cookieSameSite,
};
export const allowedOrigins = normalizedOrigins;
