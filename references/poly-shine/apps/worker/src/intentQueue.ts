import { and, asc, eq, getTableColumns, lt } from "drizzle-orm";
import type { Db } from "@poly-shine/db";
import { leaderEvents, mirrorIntents } from "@poly-shine/db";

/** Intents stuck in processing longer than this are returned to pending. */
export const PROCESSING_STALE_MS = 60_000;

export async function recoverStaleProcessingIntents(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - PROCESSING_STALE_MS).toISOString();
  const rows = await db
    .update(mirrorIntents)
    .set({ status: "pending", updatedAt: new Date().toISOString() })
    .where(and(eq(mirrorIntents.status, "processing"), lt(mirrorIntents.updatedAt, cutoff)))
    .returning({ id: mirrorIntents.id });
  return rows.length;
}

const intentColumns = getTableColumns(mirrorIntents);

/**
 * Pending intents claimed oldest-first by linked leader event order
 * (tradeTimestamp → createdAt → id), not mirror_intents.createdAt.
 */
export async function claimPendingMirrorIntents(
  db: Db,
  limit: number
): Promise<Array<typeof mirrorIntents.$inferSelect>> {
  const candidates = await db
    .select({ intent: intentColumns })
    .from(mirrorIntents)
    .innerJoin(leaderEvents, eq(mirrorIntents.leaderEventId, leaderEvents.id))
    .where(eq(mirrorIntents.status, "pending"))
    .orderBy(
      asc(leaderEvents.tradeTimestamp),
      asc(leaderEvents.createdAt),
      asc(leaderEvents.id)
    )
    .limit(limit * 3);

  const claimed: Array<typeof mirrorIntents.$inferSelect> = [];
  const now = new Date().toISOString();
  for (const row of candidates) {
    if (claimed.length >= limit) break;
    const intent = row.intent;
    const updated = await db
      .update(mirrorIntents)
      .set({ status: "processing", updatedAt: now })
      .where(and(eq(mirrorIntents.id, intent.id), eq(mirrorIntents.status, "pending")))
      .returning();
    if (updated[0]) claimed.push(updated[0]);
  }
  return claimed;
}
