import { databaseClient } from "@/config.js";
import db, { nowIso } from "@/db.js";
import type { AIProvider, ProviderCredential, ReasoningEffort } from "@/providers/index.js";
import { decryptSecret, encryptSecret, getCredentialEncryptionIdentity } from "@/utils/crypto.js";

const ENCRYPTION_IDENTITY_METADATA_KEY = "credential_encryption_identity";

interface ProviderRow {
  user_id: number;
  provider: AIProvider;
  api_key_encrypted: string;
  base_url: string | null;
  api_version: string | null;
  model: string;
  context_window: number;
  max_output_tokens: number;
  temperature: number;
  reasoning_effort: ReasoningEffort;
  is_active: number;
  updated_at: string;
}

export interface ProviderPublicConfig {
  provider: AIProvider;
  baseUrl: string | null;
  apiVersion: string | null;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  temperature: number;
  reasoningEffort: ReasoningEffort;
  isActive: boolean;
  hasApiKey: boolean;
  maskedApiKey: string;
  updatedAt: string;
}

function toCredential(row: ProviderRow): ProviderCredential {
  return {
    provider: row.provider,
    apiKey: decryptSecret(row.api_key_encrypted),
    baseUrl: row.base_url,
    apiVersion: row.api_version,
    model: row.model,
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    temperature: row.temperature,
    reasoningEffort: row.reasoning_effort,
  };
}

async function removeUnreadableCredential(row: ProviderRow): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    await transaction
      .deleteFrom("provider_configs")
      .where("user_id", "=", row.user_id)
      .where("provider", "=", row.provider)
      .execute();
    await transaction
      .updateTable("users")
      .set({ credential_reset_required: 1, active_provider: null })
      .where("id", "=", row.user_id)
      .execute();
  });
}

export interface CredentialReconciliationResult {
  identityChanged: boolean;
  deletedCredentials: number;
  affectedUsers: number;
}

export async function reconcileCredentialEncryption(): Promise<CredentialReconciliationResult> {
  const currentIdentity = getCredentialEncryptionIdentity();
  const storedIdentity = await db
    .selectFrom("app_metadata")
    .select("value")
    .where("key", "=", ENCRYPTION_IDENTITY_METADATA_KEY)
    .executeTakeFirst();
  const rows = await db.selectFrom("provider_configs").selectAll().execute();
  const identityChanged = Boolean(storedIdentity && storedIdentity.value !== currentIdentity);
  const unreadableRows = identityChanged
    ? rows
    : rows.filter((row) => {
        try {
          decryptSecret(row.api_key_encrypted);
          return false;
        } catch {
          return true;
        }
      });
  const affectedUserIds = new Set(unreadableRows.map((row) => row.user_id));
  const timestamp = nowIso();

  await db.transaction().execute(async (transaction) => {
    if (identityChanged) {
      await transaction.deleteFrom("provider_configs").execute();
    } else {
      for (const row of unreadableRows) {
        await transaction
          .deleteFrom("provider_configs")
          .where("user_id", "=", row.user_id)
          .where("provider", "=", row.provider)
          .execute();
      }
    }
    for (const userId of affectedUserIds) {
      await transaction
        .updateTable("users")
        .set({ credential_reset_required: 1, active_provider: null })
        .where("id", "=", userId)
        .execute();
    }
    const metadata = { key: ENCRYPTION_IDENTITY_METADATA_KEY, value: currentIdentity, updated_at: timestamp };
    const insertion = transaction.insertInto("app_metadata").values(metadata);
    if (databaseClient === "mysql" || databaseClient === "mariadb") {
      await insertion.onDuplicateKeyUpdate({ value: currentIdentity, updated_at: timestamp }).execute();
    } else {
      await insertion
        .onConflict((conflict) => conflict.column("key").doUpdateSet({ value: currentIdentity, updated_at: timestamp }))
        .execute();
    }
  });

  return {
    identityChanged,
    deletedCredentials: unreadableRows.length,
    affectedUsers: affectedUserIds.size,
  };
}

function toPublic(row: ProviderRow, activeProvider: AIProvider | null): ProviderPublicConfig {
  return {
    provider: row.provider,
    baseUrl: row.base_url,
    apiVersion: row.api_version,
    model: row.model,
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    temperature: row.temperature,
    reasoningEffort: row.reasoning_effort,
    isActive: row.provider === activeProvider,
    hasApiKey: true,
    maskedApiKey: "Configured",
    updatedAt: row.updated_at,
  };
}

export async function listProviderConfigs(userId: number): Promise<ProviderPublicConfig[]> {
  const [rows, user] = await Promise.all([
    db.selectFrom("provider_configs").selectAll().where("user_id", "=", userId).orderBy("provider").execute(),
    db.selectFrom("users").select("active_provider").where("id", "=", userId).executeTakeFirst(),
  ]);
  return rows.map((row) => toPublic(row, user?.active_provider || null));
}

export async function getProviderCredential(userId: number, provider?: AIProvider): Promise<ProviderCredential | null> {
  let selectedProvider = provider;
  if (!selectedProvider) {
    const user = await db.selectFrom("users").select("active_provider").where("id", "=", userId).executeTakeFirst();
    selectedProvider = user?.active_provider || undefined;
  }
  if (!selectedProvider) return null;
  const row = await db
    .selectFrom("provider_configs")
    .selectAll()
    .where("user_id", "=", userId)
    .where("provider", "=", selectedProvider)
    .executeTakeFirst();
  if (!row) return null;
  try {
    return toCredential(row);
  } catch {
    await removeUnreadableCredential(row);
    return null;
  }
}

export interface SaveProviderInput extends Omit<ProviderCredential, "apiKey"> {
  apiKey?: string;
  isActive: boolean;
}

export async function saveProviderConfig(userId: number, input: SaveProviderInput): Promise<ProviderPublicConfig> {
  const existing = await db
    .selectFrom("provider_configs")
    .select("api_key_encrypted")
    .where("user_id", "=", userId)
    .where("provider", "=", input.provider)
    .executeTakeFirst();
  if (!existing && !input.apiKey) throw new Error("API key is required for a new provider configuration");
  const encryptedKey = input.apiKey ? encryptSecret(input.apiKey) : existing?.api_key_encrypted;
  if (!encryptedKey) throw new Error("API key is required");
  const timestamp = nowIso();

  await db.transaction().execute(async (transaction) => {
    const values = {
      api_key_encrypted: encryptedKey,
      base_url: input.baseUrl,
      api_version: input.apiVersion,
      model: input.model,
      context_window: input.contextWindow,
      max_output_tokens: input.maxOutputTokens,
      temperature: input.temperature,
      reasoning_effort: input.reasoningEffort,
      is_active: input.isActive ? 1 : 0,
      updated_at: timestamp,
    };
    const current = await transaction
      .selectFrom("provider_configs")
      .select("provider")
      .where("user_id", "=", userId)
      .where("provider", "=", input.provider)
      .executeTakeFirst();
    if (current) {
      await transaction
        .updateTable("provider_configs")
        .set(values)
        .where("user_id", "=", userId)
        .where("provider", "=", input.provider)
        .execute();
    } else {
      await transaction
        .insertInto("provider_configs")
        .values({ ...values, user_id: userId, provider: input.provider, created_at: timestamp })
        .execute();
    }
    if (input.isActive) {
      await transaction
        .updateTable("provider_configs")
        .set({ is_active: 0 })
        .where("user_id", "=", userId)
        .where("provider", "!=", input.provider)
        .execute();
    }
    const user = await transaction
      .selectFrom("users")
      .select("active_provider")
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    const activeProvider = input.isActive
      ? input.provider
      : user.active_provider === input.provider
        ? null
        : user.active_provider;
    await transaction
      .updateTable("users")
      .set({ active_provider: activeProvider, credential_reset_required: 0 })
      .where("id", "=", userId)
      .execute();
  });

  const row = await db
    .selectFrom("provider_configs")
    .selectAll()
    .where("user_id", "=", userId)
    .where("provider", "=", input.provider)
    .executeTakeFirstOrThrow();
  const user = await db.selectFrom("users").select("active_provider").where("id", "=", userId).executeTakeFirst();
  return toPublic(row, user?.active_provider || null);
}

export async function deleteProviderConfig(userId: number, provider: AIProvider): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    await transaction
      .deleteFrom("provider_configs")
      .where("user_id", "=", userId)
      .where("provider", "=", provider)
      .execute();
    await transaction
      .updateTable("users")
      .set({ active_provider: null })
      .where("id", "=", userId)
      .where("active_provider", "=", provider)
      .execute();
  });
}

export async function deleteAllProviderConfigs(userId: number): Promise<number> {
  return db.transaction().execute(async (transaction) => {
    const result = await transaction.deleteFrom("provider_configs").where("user_id", "=", userId).executeTakeFirst();
    await transaction
      .updateTable("users")
      .set({ credential_reset_required: 0, active_provider: null })
      .where("id", "=", userId)
      .execute();
    return Number(result.numDeletedRows);
  });
}

export async function acknowledgeCredentialReset(userId: number): Promise<void> {
  await db.updateTable("users").set({ credential_reset_required: 0 }).where("id", "=", userId).execute();
}
