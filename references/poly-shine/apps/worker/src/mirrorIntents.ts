import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@poly-shine/db";
import { leaderEvents, mirrorIntents, subscriptions } from "@poly-shine/db";
import type { NormalizedLeaderActivity } from "./dataApi.js";
import { ctfMirrorDedupeKey, isCtfActivitySide } from "./leaderActivity.js";
import { isBeforeFollowBaseline } from "./baseline.js";

export function mirrorDedupeKeyForEvent(
  subscriptionId: string,
  eventId: string,
  normalized: Pick<NormalizedLeaderActivity, "side" | "conditionId" | "transactionHash" | "size" | "timestamp">
): string {
  if (isCtfActivitySide(normalized.side)) {
    return ctfMirrorDedupeKey(subscriptionId, {
      side: normalized.side,
      conditionId: normalized.conditionId,
      txHash: normalized.transactionHash,
      size: String(normalized.size),
      tradeTimestamp: normalized.timestamp,
    });
  }
  return `m:${subscriptionId}:${eventId}`;
}

export async function createMirrorIntentForLeaderEvent(
  db: Db,
  sub: typeof subscriptions.$inferSelect,
  eventId: string,
  normalized: Pick<
    NormalizedLeaderActivity,
    "side" | "conditionId" | "transactionHash" | "size" | "timestamp"
  >
): Promise<boolean> {
  const dedupeKey = mirrorDedupeKeyForEvent(sub.id, eventId, normalized);
  const inserted = await db
    .insert(mirrorIntents)
    .values({
      subscriptionId: sub.id,
      leaderEventId: eventId,
      dedupeKey,
      status: "pending",
    })
    .onConflictDoNothing({ target: mirrorIntents.dedupeKey })
    .returning({ id: mirrorIntents.id });
  return inserted.length > 0;
}

/** Leader events ingested during read_only that never received mirror intents. */
export async function backfillMirrorIntents(
  db: Db,
  sub: typeof subscriptions.$inferSelect,
  mode: string
): Promise<number> {
  if (mode === "read_only") return 0;

  const rows = await db
    .select({
      eventId: leaderEvents.id,
      side: leaderEvents.side,
      conditionId: leaderEvents.conditionId,
      txHash: leaderEvents.txHash,
      size: leaderEvents.size,
      tradeTimestamp: leaderEvents.tradeTimestamp,
    })
    .from(leaderEvents)
    .leftJoin(mirrorIntents, eq(mirrorIntents.leaderEventId, leaderEvents.id))
    .where(
      and(eq(leaderEvents.subscriptionId, sub.id), isNull(mirrorIntents.id))
    );

  let created = 0;
  for (const row of rows) {
    if (isBeforeFollowBaseline(row.tradeTimestamp, sub.followFromTimestamp)) continue;
    const ok = await createMirrorIntentForLeaderEvent(db, sub, row.eventId, {
      side: row.side,
      conditionId: row.conditionId,
      transactionHash: row.txHash,
      size: Number(row.size),
      timestamp: row.tradeTimestamp,
    });
    if (ok) created += 1;
  }
  return created;
}

/** Safety cap so a corrupted cursor does not loop forever. */
export async function countOrphanLeaderEvents(db: Db, subscriptionId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(leaderEvents)
    .leftJoin(mirrorIntents, eq(mirrorIntents.leaderEventId, leaderEvents.id))
    .where(and(eq(leaderEvents.subscriptionId, subscriptionId), isNull(mirrorIntents.id)));
  return Number(row?.count ?? 0);
}
