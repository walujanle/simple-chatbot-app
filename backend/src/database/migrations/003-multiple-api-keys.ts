import crypto from "node:crypto";
import { type Kysely, sql } from "kysely";
import { databaseClient } from "@/config.js";

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Rename existing table
  await db.schema.alterTable("provider_configs").renameTo("provider_configs_old").execute();

  // 2. Create the new table
  await db.schema
    .createTable("provider_configs")
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("user_id", "integer", (column) => column.notNull().references("users.id").onDelete("cascade"))
    .addColumn("name", "varchar(100)", (column) => column.notNull())
    .addColumn("provider", "varchar(32)", (column) => column.notNull())
    .addColumn("api_key_encrypted", "text", (column) => column.notNull())
    .addColumn("base_url", "text")
    .addColumn("api_version", "varchar(32)")
    .addColumn("model", "varchar(200)", (column) => column.notNull())
    .addColumn("context_window", "integer", (column) => column.notNull().defaultTo(32768))
    .addColumn("max_output_tokens", "integer", (column) => column.notNull().defaultTo(2048))
    .addColumn("temperature", "double precision", (column) => column.notNull().defaultTo(0.7))
    .addColumn("reasoning_effort", "varchar(16)", (column) => column.notNull().defaultTo("off"))
    .addColumn("is_active", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("created_at", "varchar(32)", (column) => column.notNull())
    .addColumn("updated_at", "varchar(32)", (column) => column.notNull())
    .addCheckConstraint(
      "provider_configs_provider_check",
      sql`provider in ('openai-compatible', 'anthropic', 'gemini')`,
    )
    .addCheckConstraint("provider_configs_reasoning_check", sql`reasoning_effort in ('off', 'low', 'medium', 'high')`)
    .addCheckConstraint("provider_configs_active_check", sql`is_active in (0, 1)`)
    .execute();

  // 3. Migrate data
  // biome-ignore lint/suspicious/noExplicitAny: migration queries are dynamic
  const anyDb = db as any;
  const oldConfigs = await anyDb.selectFrom("provider_configs_old").selectAll().execute();
  for (const config of oldConfigs) {
    const id = crypto.randomUUID();
    const displayName = `${config.provider === "openai-compatible" ? "OpenAI" : config.provider.charAt(0).toUpperCase() + config.provider.slice(1)} (${config.model})`;

    await anyDb
      .insertInto("provider_configs")
      .values({
        id,
        user_id: config.user_id,
        name: displayName,
        provider: config.provider,
        api_key_encrypted: config.api_key_encrypted,
        base_url: config.base_url,
        api_version: config.api_version,
        model: config.model,
        context_window: config.context_window,
        max_output_tokens: config.max_output_tokens,
        temperature: config.temperature,
        reasoning_effort: config.reasoning_effort,
        is_active: config.is_active,
        created_at: config.created_at,
        updated_at: config.updated_at,
      })
      .execute();
  }

  // 4. Drop the old table
  await db.schema.dropTable("provider_configs_old").execute();

  // 5. Create index on the new table
  const index = db.schema
    .createIndex("idx_provider_configs_user")
    .on("provider_configs")
    .columns(["user_id", "is_active"]);
  await (databaseClient === "mysql" || databaseClient === "mariadb" ? index : index.ifNotExists()).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // We can recreate the old table, but since this is a migration from composite key to UUID primary key
  // we do not expect to roll back in local development or beta.
  await db.schema.dropTable("provider_configs").execute();

  await db.schema
    .createTable("provider_configs")
    .addColumn("user_id", "integer", (column) => column.notNull().references("users.id").onDelete("cascade"))
    .addColumn("provider", "varchar(32)", (column) => column.notNull())
    .addColumn("api_key_encrypted", "text", (column) => column.notNull())
    .addColumn("base_url", "text")
    .addColumn("api_version", "varchar(32)")
    .addColumn("model", "varchar(200)", (column) => column.notNull())
    .addColumn("context_window", "integer", (column) => column.notNull().defaultTo(32768))
    .addColumn("max_output_tokens", "integer", (column) => column.notNull().defaultTo(2048))
    .addColumn("temperature", "double precision", (column) => column.notNull().defaultTo(0.7))
    .addColumn("reasoning_effort", "varchar(16)", (column) => column.notNull().defaultTo("off"))
    .addColumn("is_active", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("created_at", "varchar(32)", (column) => column.notNull())
    .addColumn("updated_at", "varchar(32)", (column) => column.notNull())
    .addPrimaryKeyConstraint("provider_configs_primary", ["user_id", "provider"])
    .execute();
}
