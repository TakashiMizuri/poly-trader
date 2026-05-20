import { and, eq, lt, or } from "drizzle-orm";
import type { Db } from "@poly-shine/db";
import { leaderEvents, mirrorIntents } from "@poly-shine/db";
import { isLeaderEventBefore } from "./positionState.js";

/** Paper position from prior shadow/live mirror plans (no CLOB fills required). */
export async function reconstructShadowFollowerPosition(
  db: Db,
  subscriptionId: string,
  asset: string,
  before: { tradeTimestamp: number; createdAt: string; id: string }
): Promise<number> {
  const rows = await db
    .select({
      side: leaderEvents.side,
      planned: mirrorIntents.planned,
      tradeTimestamp: leaderEvents.tradeTimestamp,
      createdAt: leaderEvents.createdAt,
      eventId: leaderEvents.id,
    })
    .from(mirrorIntents)
    .innerJoin(leaderEvents, eq(mirrorIntents.leaderEventId, leaderEvents.id))
    .where(
      and(
        eq(mirrorIntents.subscriptionId, subscriptionId),
        eq(leaderEvents.asset, asset),
        or(eq(mirrorIntents.status, "posted"), eq(mirrorIntents.skipReason, "shadow_mode")),
        lt(leaderEvents.tradeTimestamp, before.tradeTimestamp)
      )
    );

  const sameTsRows = await db
    .select({
      side: leaderEvents.side,
      planned: mirrorIntents.planned,
      tradeTimestamp: leaderEvents.tradeTimestamp,
      createdAt: leaderEvents.createdAt,
      eventId: leaderEvents.id,
    })
    .from(mirrorIntents)
    .innerJoin(leaderEvents, eq(mirrorIntents.leaderEventId, leaderEvents.id))
    .where(
      and(
        eq(mirrorIntents.subscriptionId, subscriptionId),
        eq(leaderEvents.asset, asset),
        eq(leaderEvents.tradeTimestamp, before.tradeTimestamp),
        or(eq(mirrorIntents.status, "posted"), eq(mirrorIntents.skipReason, "shadow_mode"))
      )
    );

  const priorSameTs = sameTsRows.filter((row) =>
    isLeaderEventBefore(
      { tradeTimestamp: row.tradeTimestamp, createdAt: row.createdAt, id: row.eventId },
      before
    )
  );

  let position = 0;
  for (const row of [...rows, ...priorSameTs]) {
    const planned = row.planned as { size?: number } | null;
    const size = planned?.size != null ? Number(planned.size) : NaN;
    if (!Number.isFinite(size) || size <= 0) continue;
    if (row.side === "BUY" || row.side === "SPLIT") position += size;
    else if (row.side === "SELL" || row.side === "MERGE" || row.side === "REDEEM") position -= size;
  }
  return Math.max(0, position);
}
