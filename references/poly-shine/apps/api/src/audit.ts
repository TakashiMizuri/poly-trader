import { auditLog } from "@poly-shine/db";
import { db } from "./db.js";

export async function audit(action: string, detail: Record<string, unknown>) {
  await db.insert(auditLog).values({ action, detail });
}
