import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { Migrator } from "kysely/migration";
import { migrationProvider } from "@/database/migrations/index.js";
import type { DatabaseSchema } from "@/database/types.js";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "chatbot-database-test-"));
const databasePath = path.join(temporaryDirectory, "legacy.db");
const legacyDatabase = new BetterSqlite3(databasePath);
legacyDatabase.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  INSERT INTO users (username, password, created_at)
  VALUES ('Legacy_User', 'legacy-password-hash', '2026-01-01T00:00:00.000Z');
`);
legacyDatabase.close();

test("database migrations preserve legacy SQLite users and add portable columns", async () => {
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(databasePath) }),
  });
  try {
    const migration = await new Migrator({ db, provider: migrationProvider }).migrateToLatest();
    if (migration.error) throw migration.error;

    const user = await db
      .selectFrom("users")
      .select(["username", "username_normalized", "active_provider"])
      .where("username", "=", "Legacy_User")
      .executeTakeFirstOrThrow();
    assert.equal(user.username_normalized, "legacy_user");
    assert.equal(user.active_provider, null);
  } finally {
    await db.destroy();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
