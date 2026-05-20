import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@poly-shine/db";
import { executions, mirrorIntents } from "@poly-shine/db";
import type { ClobClient } from "@polymarket/clob-client-v2";
import { MIN_SHARES } from "./sizing.js";

export function extractOrderId(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  const id = raw.orderID ?? raw.orderId ?? raw.order_id ?? raw.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export async function fetchOrderMatchedShares(
  client: ClobClient,
  orderId: string
): Promise<number | null> {
  try {
    const order = await client.getOrder(orderId);
    const matched = Number(order.size_matched);
    if (!Number.isFinite(matched)) return null;
    return matched;
  } catch {
    return null;
  }
}

export function isFillSufficient(matchedShares: number | null, minShares = MIN_SHARES): boolean {
  return matchedShares != null && Number.isFinite(matchedShares) && matchedShares >= minShares;
}

/** Promote posted mirrors once CLOB reports a fill. */
export async function reconcilePostedMirrorFills(
  db: Db,
  client: ClobClient,
  limit = 20
): Promise<Array<{ intentId: string; matchedShares: number }>> {
  const posted = await db
    .select({ id: mirrorIntents.id })
    .from(mirrorIntents)
    .where(eq(mirrorIntents.status, "posted"))
    .limit(limit);
  if (posted.length === 0) return [];

  const intentIds = posted.map((p) => p.id);
  const execRows = await db
    .select()
    .from(executions)
    .where(
      and(eq(executions.success, true), inArray(executions.mirrorIntentId, intentIds))
    );

  const filled: Array<{ intentId: string; matchedShares: number }> = [];
  const now = new Date().toISOString();

  for (const ex of execRows) {
    const orderId = extractOrderId(ex.raw ?? undefined);
    if (!orderId) continue;
    const matched = await fetchOrderMatchedShares(client, orderId);
    if (!isFillSufficient(matched)) continue;

    await db
      .update(mirrorIntents)
      .set({ status: "filled", updatedAt: now })
      .where(eq(mirrorIntents.id, ex.mirrorIntentId));

    filled.push({ intentId: ex.mirrorIntentId, matchedShares: matched! });
  }

  return filled;
}
