import { type Kysely, sql } from "kysely";
import { databaseClient } from "@/config.js";
import type { DatabaseSchema } from "@/database/types.js";

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await db.schema
    .createTable("users")
    .ifNotExists()
    .addColumn("id", "integer", (column) =>
      databaseClient === "postgresql"
        ? column.generatedByDefaultAsIdentity().primaryKey()
        : column.primaryKey().autoIncrement(),
    )
    .addColumn("username", "varchar(32)", (column) => column.notNull().unique())
    .addColumn("username_normalized", "varchar(32)", (column) => column.notNull().unique())
    .addColumn("password", "varchar(255)", (column) => column.notNull())
    .addColumn("system_prompt", "text")
    .addColumn("temperature", "double precision", (column) => column.notNull().defaultTo(0.7))
    .addColumn("max_tokens", "integer", (column) => column.notNull().defaultTo(2048))
    .addColumn("session_version", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("credential_reset_required", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("active_provider", "varchar(32)")
    .addColumn("created_at", "varchar(32)", (column) => column.notNull())
    .addCheckConstraint("users_credential_reset_check", sql`credential_reset_required in (0, 1)`)
    .execute();

  await db.schema
    .createTable("chats")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (column) => column.primaryKey())
    .addColumn("user_id", "integer", (column) => column.notNull().references("users.id").onDelete("cascade"))
    .addColumn("title", "varchar(200)", (column) => column.notNull())
    .addColumn("created_at", "varchar(32)", (column) => column.notNull())
    .addColumn("updated_at", "varchar(32)", (column) => column.notNull())
    .addColumn("summary", "text")
    .addColumn("summary_through_message_id", "integer")
    .execute();

  await db.schema
    .createTable("messages")
    .ifNotExists()
    .addColumn("id", "integer", (column) =>
      databaseClient === "postgresql"
        ? column.generatedByDefaultAsIdentity().primaryKey()
        : column.primaryKey().autoIncrement(),
    )
    .addColumn("chat_id", "varchar(36)", (column) => column.notNull().references("chats.id").onDelete("cascade"))
    .addColumn("role", "varchar(16)", (column) => column.notNull())
    .addColumn("content", "text", (column) => column.notNull())
    .addColumn("status", "varchar(16)", (column) => column.notNull().defaultTo("completed"))
    .addColumn("error_code", "varchar(64)")
    .addColumn("created_at", "varchar(32)", (column) => column.notNull())
    .addCheckConstraint("messages_role_check", sql`role in ('user', 'assistant', 'system')`)
    .addCheckConstraint("messages_status_check", sql`status in ('completed', 'interrupted')`)
    .execute();

  await db.schema
    .createTable("provider_configs")
    .ifNotExists()
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
    .addCheckConstraint(
      "provider_configs_provider_check",
      sql`provider in ('openai-compatible', 'anthropic', 'gemini')`,
    )
    .addCheckConstraint("provider_configs_reasoning_check", sql`reasoning_effort in ('off', 'low', 'medium', 'high')`)
    .addCheckConstraint("provider_configs_active_check", sql`is_active in (0, 1)`)
    .execute();

  await db.schema
    .createTable("message_receipts")
    .ifNotExists()
    .addColumn("message_id", "integer", (column) => column.primaryKey().references("messages.id").onDelete("cascade"))
    .addColumn("provider", "varchar(32)", (column) => column.notNull())
    .addColumn("model", "varchar(200)", (column) => column.notNull())
    .addColumn("endpoint_host", "text")
    .addColumn("latency_ms", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("web_search_used", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("search_query", "text")
    .addColumn("sources_json", "text", (column) => column.notNull())
    .addColumn("reasoning_enabled", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("reasoning_effort", "varchar(16)", (column) => column.notNull().defaultTo("off"))
    .addColumn("input_tokens", "integer")
    .addColumn("output_tokens", "integer")
    .addColumn("reasoning_tokens", "integer")
    .addColumn("total_tokens", "integer")
    .addColumn("estimated_input_tokens", "integer")
    .addColumn("summarized_count", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("recent_count", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("created_at", "varchar(32)", (column) => column.notNull())
    .addCheckConstraint("message_receipts_search_check", sql`web_search_used in (0, 1)`)
    .addCheckConstraint("message_receipts_reasoning_check", sql`reasoning_enabled in (0, 1)`)
    .execute();

  await db.schema
    .createTable("app_metadata")
    .ifNotExists()
    .addColumn("key", "varchar(100)", (column) => column.primaryKey())
    .addColumn("value", "text", (column) => column.notNull())
    .addColumn("updated_at", "varchar(32)", (column) => column.notNull())
    .execute();
}
