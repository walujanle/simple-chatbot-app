import type { Migration, MigrationProvider } from "kysely/migration";
import * as initial from "@/database/migrations/001-initial.js";
import * as portableSchema from "@/database/migrations/002-portable-schema.js";
import * as multipleApiKeys from "@/database/migrations/003-multiple-api-keys.js";

const migrations: Record<string, Migration> = {
  "001_initial": initial,
  "002_portable_schema": portableSchema,
  "003_multiple_api_keys": multipleApiKeys,
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
