import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect } from "kysely";
import { Migrator } from "kysely/migration";
import mysql from "mysql2";
import pg from "pg";
import { config, databaseClient } from "@/config.js";
import { migrationProvider } from "@/database/migrations/index.js";
import type { DatabaseSchema } from "@/database/types.js";
import { logWarn } from "@/utils/logger.js";

function createDialect() {
  if (databaseClient === "sqlite") {
    const databasePath = path.resolve(import.meta.dirname, "../database/chatbot.db");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new BetterSqlite3(databasePath);
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = FULL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    database.pragma("journal_size_limit = 67108864");
    try {
      fs.chmodSync(databasePath, 0o600);
    } catch {
      if (config.NODE_ENV === "production") logWarn("database_permissions_not_restricted");
    }
    return new SqliteDialect({ database });
  }

  if (databaseClient === "postgresql") {
    return new PostgresDialect({
      pool: new pg.Pool({
        connectionString: config.DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      }),
    });
  }

  const connectionUri = config.DATABASE_URL.replace(/^mariadb:/, "mysql:");
  return new MysqlDialect({
    pool: mysql.createPool({
      uri: connectionUri,
      connectionLimit: 10,
      idleTimeout: 30_000,
      connectTimeout: 10_000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
    }),
  });
}

const db = new Kysely<DatabaseSchema>({ dialect: createDialect() });
const migrator = new Migrator({ db, provider: migrationProvider });
const migration = await migrator.migrateToLatest();

if (migration.error) {
  await db.destroy();
  throw migration.error;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function closeDatabase(): Promise<void> {
  await db.destroy();
}

export default db;
