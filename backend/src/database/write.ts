import type { Insertable, Kysely, Transaction } from "kysely";
import { databaseClient } from "@/config.js";
import type { DatabaseSchema, MessagesTable, UsersTable } from "@/database/types.js";

export type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

async function insertWithId(
  executor: DatabaseExecutor,
  table: "users" | "messages",
  values: Insertable<UsersTable> | Insertable<MessagesTable>,
): Promise<number> {
  if (databaseClient === "postgresql") {
    const row = await executor
      .insertInto(table)
      .values(values as never)
      .returning("id")
      .executeTakeFirstOrThrow();
    return Number(row.id);
  }

  const result = await executor
    .insertInto(table)
    .values(values as never)
    .executeTakeFirstOrThrow();
  if (result.insertId === undefined) throw new Error(`Database did not return an id for ${table}`);
  return Number(result.insertId);
}

export function insertUser(executor: DatabaseExecutor, values: Insertable<UsersTable>): Promise<number> {
  return insertWithId(executor, "users", values);
}

export function insertMessage(executor: DatabaseExecutor, values: Insertable<MessagesTable>): Promise<number> {
  return insertWithId(executor, "messages", values);
}
