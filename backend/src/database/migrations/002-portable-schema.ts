import type { Kysely } from "kysely";
import { databaseClient } from "@/config.js";
import type { DatabaseSchema } from "@/database/types.js";

type ColumnType = "double precision" | "integer" | "text" | "varchar(32)";

const columns: Array<[keyof DatabaseSchema, string, ColumnType, boolean]> = [
  ["users", "system_prompt", "text", false],
  ["users", "username_normalized", "varchar(32)", false],
  ["users", "temperature", "double precision", true],
  ["users", "max_tokens", "integer", true],
  ["users", "session_version", "integer", true],
  ["users", "credential_reset_required", "integer", true],
  ["users", "active_provider", "varchar(32)", false],
  ["chats", "summary", "text", false],
  ["chats", "summary_through_message_id", "integer", false],
  ["messages", "status", "varchar(32)", true],
  ["messages", "error_code", "varchar(32)", false],
  ["provider_configs", "api_version", "varchar(32)", false],
];

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  const tables = await db.introspection.getTables();
  const tableMap = new Map(tables.map((table) => [table.name, new Set(table.columns.map((column) => column.name))]));

  for (const [table, column, type, notNull] of columns) {
    if (tableMap.get(table)?.has(column)) continue;
    await db.schema
      .alterTable(table)
      .addColumn(column, type, (definition) => {
        if (!notNull) return definition;
        if (column === "temperature") return definition.notNull().defaultTo(0.7);
        if (column === "max_tokens") return definition.notNull().defaultTo(2048);
        if (column === "status") return definition.notNull().defaultTo("completed");
        return definition.notNull().defaultTo(0);
      })
      .execute();
  }

  const activeRows = await db
    .selectFrom("provider_configs")
    .select(["user_id", "provider"])
    .where("is_active", "=", 1)
    .execute();
  for (const row of activeRows) {
    await db
      .updateTable("users")
      .set({ active_provider: row.provider })
      .where("id", "=", row.user_id)
      .where("active_provider", "is", null)
      .execute();
  }

  const users = await db.selectFrom("users").select(["id", "username", "username_normalized"]).execute();
  for (const user of users) {
    if (user.username_normalized) continue;
    await db
      .updateTable("users")
      .set({ username_normalized: user.username.toLowerCase() })
      .where("id", "=", user.id)
      .execute();
  }

  const indexes = [
    db.schema.createIndex("idx_users_username_normalized").unique().on("users").column("username_normalized"),
    db.schema.createIndex("idx_chats_user_updated").on("chats").columns(["user_id", "updated_at desc"]),
    db.schema.createIndex("idx_messages_chat_id").on("messages").columns(["chat_id", "id"]),
    db.schema.createIndex("idx_provider_configs_user").on("provider_configs").columns(["user_id", "provider"]),
  ];
  for (const index of indexes) {
    await (databaseClient === "mysql" || databaseClient === "mariadb" ? index : index.ifNotExists()).execute();
  }
}
