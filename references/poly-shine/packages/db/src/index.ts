import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export * from "./schema.js";
export { resolveSqliteDatabasePath } from "./resolveSqlitePath.js";

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

/** Apply pending Drizzle SQL migrations (idempotent). Call before `createDb`. */
export function runMigrations(sqlitePath: string): void {
  const sqlite = new Database(sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  sqlite.close();
}

export function createDb(sqlitePath: string) {
  const sqlite = new Database(sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 8000");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;
