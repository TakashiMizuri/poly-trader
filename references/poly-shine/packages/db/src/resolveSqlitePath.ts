import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads `.env` from the monorepo root and returns an absolute SQLite file path.
 * Relative `SQLITE_PATH` values are resolved against the repo root so
 * `npm run dev -w @poly-shine/worker` works even when cwd is `apps/worker`.
 */
export function resolveSqliteDatabasePath(importMetaUrl: string): string {
  const here = path.dirname(fileURLToPath(importMetaUrl));
  const repoRoot = path.join(here, "..", "..", "..");
  const envFile = path.join(repoRoot, ".env");
  if (fs.existsSync(envFile)) {
    config({ path: envFile });
  }
  const raw = process.env.SQLITE_PATH?.trim() || path.join("data", "polyshine.sqlite");
  return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw.replace(/^\.\//, ""));
}
