import crypto from "node:crypto";
import { databaseClient } from "@/config.js";
import db, { nowIso } from "@/db.js";
import type { AIProvider, ProviderCredential, ReasoningEffort } from "@/providers/index.js";
import { decryptSecret, encryptSecret, getCredentialEncryptionIdentity } from "@/utils/crypto.js";

const ENCRYPTION_IDENTITY_METADATA_KEY = "credential_encryption_identity";

interface ProviderRow {
  id: string;
  user_id: number;
  name: string;
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
  created_at: string;
  updated_at: string;
}

export interface ProviderPublicConfig {
  id: string;
  name: string;
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
    await transaction.deleteFrom("provider_configs").where("id", "=", row.id).execute();

    const activeExists = await transaction
      .selectFrom("provider_configs")
      .select("id")
      .where("user_id", "=", row.user_id)
      .where("is_active", "=", 1)
      .executeTakeFirst();

    if (!activeExists) {
      await transaction
        .updateTable("users")
        .set({ credential_reset_required: 1, active_provider: null })
        .where("id", "=", row.user_id)
        .execute();
    }
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
        await transaction.deleteFrom("provider_configs").where("id", "=", row.id).execute();
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

function toPublic(row: ProviderRow): ProviderPublicConfig {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.base_url,
    apiVersion: row.api_version,
    model: row.model,
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    temperature: row.temperature,
    reasoningEffort: row.reasoning_effort,
    isActive: row.is_active === 1,
    hasApiKey: true,
    maskedApiKey: "Configured",
    updatedAt: row.updated_at,
  };
}

export async function listProviderConfigs(userId: number): Promise<ProviderPublicConfig[]> {
  const rows = await db
    .selectFrom("provider_configs")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at")
    .execute();
  return rows.map((row) => toPublic(row));
}

export async function getProviderCredential(userId: number, configId?: string): Promise<ProviderCredential | null> {
  let query = db.selectFrom("provider_configs").selectAll().where("user_id", "=", userId);

  if (configId) {
    query = query.where("id", "=", configId);
  } else {
    query = query.where("is_active", "=", 1);
  }

  const row = await query.executeTakeFirst();
  if (!row) return null;
  try {
    return toCredential(row);
  } catch {
    await removeUnreadableCredential(row);
    return null;
  }
}

export interface SaveProviderInput extends Omit<ProviderCredential, "apiKey"> {
  id?: string;
  name: string;
  apiKey?: string;
  reuseApiKeyFromConfigId?: string;
  isActive: boolean;
}

export async function saveProviderConfig(userId: number, input: SaveProviderInput): Promise<ProviderPublicConfig> {
  let encryptedKey = "";
  if (input.apiKey) {
    encryptedKey = encryptSecret(input.apiKey);
  } else if (input.reuseApiKeyFromConfigId) {
    const reuseConfig = await db
      .selectFrom("provider_configs")
      .select("api_key_encrypted")
      .where("user_id", "=", userId)
      .where("id", "=", input.reuseApiKeyFromConfigId)
      .executeTakeFirst();
    if (!reuseConfig) throw new Error("Referenced configuration for API key reuse not found");
    encryptedKey = reuseConfig.api_key_encrypted;
  } else if (input.id) {
    const existing = await db
      .selectFrom("provider_configs")
      .select("api_key_encrypted")
      .where("user_id", "=", userId)
      .where("id", "=", input.id)
      .executeTakeFirst();
    if (!existing) throw new Error("Configuration not found");
    encryptedKey = existing.api_key_encrypted;
  } else {
    throw new Error("API key is required for a new configuration");
  }

  const timestamp = nowIso();
  const configId = input.id || crypto.randomUUID();

  await db.transaction().execute(async (transaction) => {
    if (input.isActive) {
      await transaction.updateTable("provider_configs").set({ is_active: 0 }).where("user_id", "=", userId).execute();
    }

    const values = {
      name: input.name,
      provider: input.provider,
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

    if (input.id) {
      await transaction
        .updateTable("provider_configs")
        .set(values)
        .where("user_id", "=", userId)
        .where("id", "=", input.id)
        .execute();
    } else {
      await transaction
        .insertInto("provider_configs")
        .values({
          ...values,
          id: configId,
          user_id: userId,
          created_at: timestamp,
        })
        .execute();
    }

    const activeProvider = input.isActive ? input.provider : null;

    if (input.isActive) {
      await transaction
        .updateTable("users")
        .set({ active_provider: activeProvider, credential_reset_required: 0 })
        .where("id", "=", userId)
        .execute();
    } else {
      const activeExists = await transaction
        .selectFrom("provider_configs")
        .select("provider")
        .where("user_id", "=", userId)
        .where("is_active", "=", 1)
        .executeTakeFirst();
      await transaction
        .updateTable("users")
        .set({ active_provider: activeExists?.provider || null, credential_reset_required: 0 })
        .where("id", "=", userId)
        .execute();
    }
  });

  const row = await db
    .selectFrom("provider_configs")
    .selectAll()
    .where("user_id", "=", userId)
    .where("id", "=", configId)
    .executeTakeFirstOrThrow();
  return toPublic(row);
}

export async function deleteProviderConfig(userId: number, id: string): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    const configToDelete = await transaction
      .selectFrom("provider_configs")
      .select("is_active")
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .executeTakeFirst();

    if (!configToDelete) return;

    await transaction.deleteFrom("provider_configs").where("user_id", "=", userId).where("id", "=", id).execute();

    if (configToDelete.is_active === 1) {
      const nextActive = await transaction
        .selectFrom("provider_configs")
        .select(["id", "provider"])
        .where("user_id", "=", userId)
        .orderBy("updated_at", "desc")
        .executeTakeFirst();

      if (nextActive) {
        await transaction
          .updateTable("provider_configs")
          .set({ is_active: 1 })
          .where("id", "=", nextActive.id)
          .execute();
        await transaction
          .updateTable("users")
          .set({ active_provider: nextActive.provider })
          .where("id", "=", userId)
          .execute();
      } else {
        await transaction.updateTable("users").set({ active_provider: null }).where("id", "=", userId).execute();
      }
    }
  });
}

export async function activateProviderConfig(userId: number, id: string): Promise<ProviderPublicConfig> {
  await db.transaction().execute(async (transaction) => {
    await transaction.updateTable("provider_configs").set({ is_active: 0 }).where("user_id", "=", userId).execute();

    await transaction
      .updateTable("provider_configs")
      .set({ is_active: 1 })
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .execute();

    const activeConfig = await transaction
      .selectFrom("provider_configs")
      .select("provider")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

    await transaction
      .updateTable("users")
      .set({ active_provider: activeConfig.provider })
      .where("id", "=", userId)
      .execute();
  });

  const row = await db
    .selectFrom("provider_configs")
    .selectAll()
    .where("user_id", "=", userId)
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  return toPublic(row);
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
