import { eq } from "drizzle-orm";
import type { Db } from "@poly-shine/db";
import { leaderEvents, subscriptions } from "@poly-shine/db";
import {
  activityDedupeKey,
  expandLeaderActivities,
  fetchUserActivitySince,
  type NormalizedLeaderActivity,
} from "./dataApi.js";
import { isBeforeFollowBaseline } from "./baseline.js";
import { backfillMirrorIntents, createMirrorIntentForLeaderEvent } from "./mirrorIntents.js";

function serializeActivity(a: NormalizedLeaderActivity): Record<string, unknown> {
  return a.raw;
}

function leaderEventDedupeKey(subscriptionId: string, a: NormalizedLeaderActivity): string {
  return `s:${subscriptionId}:${activityDedupeKey(a)}`;
}

export async function ingestSubscription(
  db: Db,
  sub: typeof subscriptions.$inferSelect,
  mode: string
): Promise<{ newEvents: number; newIntents: number; backfilledIntents: number }> {
  const sinceSec =
    sub.lastTradeTimestamp != null && sub.lastTradeTimestamp > 0
      ? Math.floor(sub.lastTradeTimestamp)
      : null;

  const activities = await fetchUserActivitySince(sub.address, sinceSec);
  let maxTs = sub.lastTradeTimestamp ?? 0;
  let newEvents = 0;
  let newIntents = 0;

  for (const row of activities) {
    const expanded = await expandLeaderActivities(row);
    for (const normalized of expanded) {
      const ts = normalized.timestamp;
      maxTs = Math.max(maxTs, ts);
      const dedupe = leaderEventDedupeKey(sub.id, normalized);
      const inserted = await db
        .insert(leaderEvents)
        .values({
          subscriptionId: sub.id,
          dedupeKey: dedupe,
          txHash: normalized.transactionHash,
          asset: normalized.asset,
          conditionId: normalized.conditionId,
          side: normalized.side,
          size: String(normalized.size),
          price: String(normalized.price),
          tradeTimestamp: ts,
          raw: serializeActivity(normalized),
        })
        .onConflictDoNothing({ target: leaderEvents.dedupeKey })
        .returning({ id: leaderEvents.id });

      if (inserted.length === 0) continue;
      newEvents += 1;
      const eventId = inserted[0].id;

      if (mode === "read_only") continue;
      if (isBeforeFollowBaseline(ts, sub.followFromTimestamp)) continue;

      const created = await createMirrorIntentForLeaderEvent(db, sub, eventId, normalized);
      if (created) newIntents += 1;
    }
  }

  if (maxTs > (sub.lastTradeTimestamp ?? 0)) {
    await db
      .update(subscriptions)
      .set({ lastTradeTimestamp: maxTs, updatedAt: new Date().toISOString() })
      .where(eq(subscriptions.id, sub.id));
  }

  const backfilledIntents = await backfillMirrorIntents(db, sub, mode);
  return { newEvents, newIntents, backfilledIntents };
}
