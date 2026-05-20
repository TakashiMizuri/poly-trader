import { eq } from "drizzle-orm";
import { subscriptions } from "@poly-shine/db";
import { db } from "./db.js";

export async function resolveSubscriptionId(arg: string): Promise<string | null> {
  const trimmed = arg.trim();
  const a = trimmed.toLowerCase();
  if (a.startsWith("0x") && a.length === 42) {
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.address, a)).limit(1);
    return row?.id ?? null;
  }
  const [byId] = await db.select().from(subscriptions).where(eq(subscriptions.id, trimmed)).limit(1);
  return byId?.id ?? null;
}
