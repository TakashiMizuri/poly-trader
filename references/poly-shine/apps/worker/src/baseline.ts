import { and, eq } from "drizzle-orm";
import type { Db } from "@poly-shine/db";
import { leaderEvents, mirrorIntents, subscriptions } from "@poly-shine/db";
import { fetchPolymarketOpenPositions, tradeTimestampToMs } from "@poly-shine/shared";
import { gateSideForActivity } from "./leaderActivity.js";
import {
  evaluateLineGate,
  getFollowLineState,
  LEADER_POSITION_EPSILON,
  PRE_EXISTING_POSITION_REASON,
  reconstructLeaderPositionBefore,
  setFollowLineState,
} from "./positionState.js";

export { PRE_EXISTING_POSITION_REASON };

export function isBeforeFollowBaseline(eventTradeTimestamp: number, followFromMs: number | null | undefined): boolean {
  if (followFromMs == null) return false;
  return tradeTimestampToMs(eventTradeTimestamp) < followFromMs;
}

/**
 * Snapshot leader open positions, mark them abandoned (pre-existing), set follow watermark,
 * and skip queued mirrors for those lines and older activity.
 */
export async function applySubscriptionBaseline(
  db: Db,
  sub: typeof subscriptions.$inferSelect
): Promise<{ followFromMs: number; markedAssets: number; skippedIntents: number }> {
  const followFromMs = Date.now();
  const open = await fetchPolymarketOpenPositions(sub.address);
  const assets = open
    .filter((p: { size: number }) => p.size > LEADER_POSITION_EPSILON)
    .map((p: { asset: string }) => p.asset);
  const assetSet = new Set(assets);

  for (const asset of assets) {
    const line = await getFollowLineState(db, sub.id, asset);
    if (line.state === "active" || line.state === "watching" || line.state === "shadow_active") {
      assetSet.delete(asset);
      continue;
    }
    await setFollowLineState(db, {
      subscriptionId: sub.id,
      asset,
      state: "abandoned",
      abandonedReason: PRE_EXISTING_POSITION_REASON,
      entryLeaderEventId: null,
    });
  }

  const skippedIntents = await skipPendingForBaseline(db, sub.id, followFromMs, assetSet);

  await db
    .update(subscriptions)
    .set({
      followFromTimestamp: followFromMs,
      baselineAt: followFromMs,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(subscriptions.id, sub.id));

  return { followFromMs, markedAssets: assets.length, skippedIntents };
}

async function skipPendingForBaseline(
  db: Db,
  subscriptionId: string,
  followFromMs: number,
  preExistingAssets: Set<string>
): Promise<number> {
  const rows = await db
    .select({
      id: mirrorIntents.id,
      status: mirrorIntents.status,
      tradeTimestamp: leaderEvents.tradeTimestamp,
      asset: leaderEvents.asset,
    })
    .from(mirrorIntents)
    .innerJoin(leaderEvents, eq(mirrorIntents.leaderEventId, leaderEvents.id))
    .where(and(eq(mirrorIntents.subscriptionId, subscriptionId), eq(mirrorIntents.status, "pending")));

  const now = new Date().toISOString();
  let n = 0;
  for (const row of rows) {
    const beforeBaseline = isBeforeFollowBaseline(row.tradeTimestamp, followFromMs);
    const preExisting = preExistingAssets.has(row.asset);
    if (!beforeBaseline && !preExisting) continue;

    await db
      .update(mirrorIntents)
      .set({
        status: "skipped",
        skipReason: beforeBaseline ? "before_follow_baseline" : PRE_EXISTING_POSITION_REASON,
        updatedAt: now,
      })
      .where(eq(mirrorIntents.id, row.id));
    n += 1;
  }
  return n;
}

/** Block mirrors on pre-baseline activity and pre-existing leader lines (all sizing modes). */
export async function checkMirrorBaselineGate(
  db: Db,
  sub: typeof subscriptions.$inferSelect,
  ev: typeof leaderEvents.$inferSelect
): Promise<{ blocked: true; skipReason: string } | { blocked: false }> {
  if (isBeforeFollowBaseline(ev.tradeTimestamp, sub.followFromTimestamp)) {
    return { blocked: true, skipReason: "before_follow_baseline" };
  }

  const line = await getFollowLineState(db, sub.id, ev.asset);
  if (line.state !== "abandoned" || line.abandonedReason !== PRE_EXISTING_POSITION_REASON) {
    return { blocked: false };
  }

  const leaderPositionBefore = await reconstructLeaderPositionBefore(db, sub.id, ev.asset, {
    tradeTimestamp: ev.tradeTimestamp,
    createdAt: ev.createdAt,
    id: ev.id,
  });

  const gate = evaluateLineGate({
    lineState: "abandoned",
    side: gateSideForActivity(ev.side),
    leaderPositionBefore,
  });

  if (!gate.allow) {
    return { blocked: true, skipReason: gate.skipReason };
  }

  return { blocked: false };
}

export async function ensureSubscriptionBaselined(
  db: Db,
  sub: typeof subscriptions.$inferSelect
): Promise<typeof subscriptions.$inferSelect> {
  if (sub.baselineAt != null) return sub;
  await applySubscriptionBaseline(db, sub);
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)).limit(1);
  return row ?? sub;
}
