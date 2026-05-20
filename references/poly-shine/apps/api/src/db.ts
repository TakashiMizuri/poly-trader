import fs from "node:fs";
import path from "node:path";
import { createDb, resolveSqliteDatabasePath, runMigrations, type Db } from "@poly-shine/db";

export const sqlitePath = resolveSqliteDatabasePath(import.meta.url);
fs.mkdirSync(path.dirname(path.resolve(sqlitePath)), { recursive: true });
runMigrations(sqlitePath);
export const db: Db = createDb(sqlitePath);
