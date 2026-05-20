import fs from "node:fs";
import path from "node:path";
import { resolveSqliteDatabasePath } from "./resolveSqlitePath.js";
import { runMigrations } from "./index.js";

function main() {
  const sqlitePath = resolveSqliteDatabasePath(import.meta.url);
  fs.mkdirSync(path.dirname(path.resolve(sqlitePath)), { recursive: true });
  runMigrations(sqlitePath);
  console.log("Migrations complete:", sqlitePath);
}

main();
