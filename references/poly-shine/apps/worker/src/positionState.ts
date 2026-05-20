import { and, asc, eq, lt } from "drizzle-orm";
import type { Db } from "@poly-shine/db";
import { leaderEvents, positionFollowState } from "@poly-shine/db";
import { isLeaderEventBefore, type LeaderEventOrderKey } from "@poly-shine/shared";
import { gateSideForActivity, netLeaderSharesFromActivityFills } from "./leaderActivity.js";

export type { LeaderEventOrderKey } from "@poly-shine/shared";
export { compareLeaderEvents, isLeaderEventBefore } from "@poly-shine/shared";

export type FollowLineState =
  | "untracked"
  | "watching"
  | "active"
  | "shadow_active"
  | "abandoned"
  | "closed";

export const LEADER_POSITION_EPSILON = 0.01;

/** Leader already held this token when subscription/worker baseline ran. */
export const PRE_EXISTING_POSITION_REASON = "pre_existing_position";

/** Skip reasons that mean we could not establish the line on opening BUY → abandoned */
export const OPENING_ABANDON_REASONS = new Set([
  "size_too_small",
  "below_min_notional",
  "missing_follower_balance",
  "missing_leader_cash",
  "leader_cash_zero",
  "invalid_proportional_scale",
  "max_notional_too_small_for_tick",
  "invalid_leader_price",
  "invalid_leader_position",
  "unknown_sizing_mode",
  "max_daily_loss_exceeded",
  "max_open_exposure_exceeded",
  "max_slippage_exceeded",
  "slippage_mid_unavailable",
  "slippage_check_failed",
  "exposure_snapshot_invalid",
  "equity_snapshot_failed",
]);

export function isOpeningAbandonReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return OPENING_ABANDON_REASONS.has(reason);
}

export function netLeaderSharesFromFills(
  fills: Array<{ side: string; size: string | number }>
): number {
  return netLeaderSharesFromActivityFills(fills);
}

export async function getFollowLineState(
  db: Db,
  subscriptionId: string,
  asset: string
): Promise<{ state: FollowLineState; abandonedReason: string | null; entryLeaderEventId: string | null }> {
  const rows = await db
    .select()
    .from(positionFollowState)
    .where(and(eq(positionFollowState.subscriptionId, subscriptionId), eq(positionFollowState.asset, asset)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { state: "untracked", abandonedReason: null, entryLeaderEventId: null };
  }
  return {
    state: row.state as FollowLineState,
    abandonedReason: row.abandonedReason,
    entryLeaderEventId: row.entryLeaderEventId,
  };
}

export async function setFollowLineState(
  db: Db,
  params: {
    subscriptionId: string;
    asset: string;
    state: FollowLineState;
    abandonedReason?: string | null;
    entryLeaderEventId?: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(positionFollowState)
    .values({
      subscriptionId: params.subscriptionId,
      asset: params.asset,
      state: params.state,
      abandonedReason: params.abandonedReason ?? null,
      entryLeaderEventId: params.entryLeaderEventId ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [positionFollowState.subscriptionId, positionFollowState.asset],
      set: {
        state: params.state,
        abandonedReason: params.abandonedReason ?? null,
        entryLeaderEventId: params.entryLeaderEventId ?? null,
        updatedAt: now,
      },
    });
}

/** Leader net shares in token before processing `beforeEvent` (exclusive). */
export async function reconstructLeaderPositionBefore(
  db: Db,
  subscriptionId: string,
  asset: string,
  before: LeaderEventOrderKey
): Promise<number> {
  const rows = await db
    .select({
      side: leaderEvents.side,
      size: leaderEvents.size,
      id: leaderEvents.id,
      tradeTimestamp: leaderEvents.tradeTimestamp,
      createdAt: leaderEvents.createdAt,
    })
    .from(leaderEvents)
    .where(
      and(
        eq(leaderEvents.subscriptionId, subscriptionId),
        eq(leaderEvents.asset, asset),
        lt(leaderEvents.tradeTimestamp, before.tradeTimestamp)
      )
    )
    .orderBy(asc(leaderEvents.tradeTimestamp), asc(leaderEvents.createdAt), asc(leaderEvents.id));

  const sameTs = await db
    .select({
      side: leaderEvents.side,
      size: leaderEvents.size,
      id: leaderEvents.id,
      tradeTimestamp: leaderEvents.tradeTimestamp,
      createdAt: leaderEvents.createdAt,
    })
    .from(leaderEvents)
    .where(
      and(
        eq(leaderEvents.subscriptionId, subscriptionId),
        eq(leaderEvents.asset, asset),
        eq(leaderEvents.tradeTimestamp, before.tradeTimestamp)
      )
    )
    .orderBy(asc(leaderEvents.createdAt), asc(leaderEvents.id));

  const prior = [...rows, ...sameTs.filter((e) => isLeaderEventBefore(e, before))];
  return netLeaderSharesFromFills(prior);
}

export type LineGateResult =
  | { allow: true; lineState: FollowLineState; leaderPositionBefore: number }
  | { allow: false; skipReason: string; lineState: FollowLineState; leaderPositionBefore: number };

/**
 * Per-(subscription, asset) gate for proportional_equity mirroring.
 */
/** Map DB line state to effective state for the current engine mode. */
export function effectiveLineState(
  lineState: FollowLineState,
  engineMode: string
): FollowLineState {
  if (lineState === "shadow_active" && engineMode === "live") {
    return "watching";
  }
  if (lineState === "shadow_active" && engineMode === "shadow") {
    return "active";
  }
  return lineState;
}

export function evaluateLineGate(params: {
  lineState: FollowLineState;
  side: string;
  leaderPositionBefore: number;
  engineMode?: string;
}): LineGateResult {
  const lineState = effectiveLineState(params.lineState, params.engineMode ?? "live");
  const side = gateSideForActivity(params.side);
  const leaderPositionBefore = params.leaderPositionBefore;
  const leaderFlat = leaderPositionBefore <= LEADER_POSITION_EPSILON;

  if (lineState === "abandoned") {
    if (!leaderFlat) {
      return {
        allow: false,
        skipReason: "line_abandoned",
        lineState,
        leaderPositionBefore,
      };
    }
    if (side === "SELL") {
      return {
        allow: false,
        skipReason: "line_abandoned",
        lineState,
        leaderPositionBefore,
      };
    }
    // Leader flat at a new timestamp + BUY → new line (caller sets watching)
    return { allow: true, lineState: "watching", leaderPositionBefore };
  }

  if (lineState === "untracked" || lineState === "closed") {
    if (side === "SELL") {
      return {
        allow: false,
        skipReason: "entry_not_established",
        lineState,
        leaderPositionBefore,
      };
    }
    if (side === "BUY" && leaderPositionBefore > LEADER_POSITION_EPSILON) {
      return {
        allow: false,
        skipReason: "leader_already_in_position",
        lineState,
        leaderPositionBefore,
      };
    }
    return { allow: true, lineState: "watching", leaderPositionBefore };
  }

  if (lineState === "watching") {
    if (side === "SELL") {
      return {
        allow: false,
        skipReason: "entry_not_established",
        lineState,
        leaderPositionBefore,
      };
    }
    return { allow: true, lineState, leaderPositionBefore };
  }

  // active
  if (side === "SELL" && leaderPositionBefore <= LEADER_POSITION_EPSILON) {
    return {
      allow: false,
      skipReason: "invalid_leader_position",
      lineState,
      leaderPositionBefore,
    };
  }

  return { allow: true, lineState, leaderPositionBefore };
}
