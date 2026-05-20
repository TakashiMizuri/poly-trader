import type { Db } from "@poly-shine/db";
import type { leaderEvents, subscriptions } from "@poly-shine/db";
import {
  evaluateLineGate,
  getFollowLineState,
  isOpeningAbandonReason,
  reconstructLeaderPositionBefore,
  setFollowLineState,
  type FollowLineState,
} from "./positionState.js";
import { fetchConditionalBalance } from "./clob.js";
import type { ClobClient } from "@polymarket/clob-client-v2";
import { LEADER_POSITION_EPSILON } from "./positionState.js";
import { gateSideForActivity } from "./leaderActivity.js";
import { reconstructShadowFollowerPosition } from "./shadowPosition.js";

type Sub = typeof subscriptions.$inferSelect;
type Ev = typeof leaderEvents.$inferSelect;

export async function prepareProportionalLine(
  db: Db,
  sub: Sub,
  ev: Ev,
  engineMode: string
): Promise<
  | { proceed: false; skipReason: string; lineState: FollowLineState; leaderPositionBefore: number }
  | { proceed: true; lineState: FollowLineState; leaderPositionBefore: number }
> {
  const beforeKey = {
    tradeTimestamp: ev.tradeTimestamp,
    createdAt: ev.createdAt,
    id: ev.id,
  };
  const leaderPositionBefore = await reconstructLeaderPositionBefore(db, sub.id, ev.asset, beforeKey);

  const current = await getFollowLineState(db, sub.id, ev.asset);
  const gate = evaluateLineGate({
    lineState: current.state as FollowLineState,
    side: gateSideForActivity(ev.side),
    leaderPositionBefore,
    engineMode,
  });

  if (!gate.allow) {
    return {
      proceed: false,
      skipReason: gate.skipReason,
      lineState: gate.lineState,
      leaderPositionBefore: gate.leaderPositionBefore,
    };
  }

  if (
    gate.lineState === "watching" &&
    (current.state === "untracked" || current.state === "closed" || current.state === "abandoned")
  ) {
    await setFollowLineState(db, {
      subscriptionId: sub.id,
      asset: ev.asset,
      state: "watching",
      abandonedReason: null,
      entryLeaderEventId: ev.id,
    });
  }

  return {
    proceed: true,
    lineState: gate.lineState,
    leaderPositionBefore: gate.leaderPositionBefore,
  };
}

const RETRYABLE_OPENING_SKIPS = new Set(["rate_limited", "shadow_mode"]);

export async function commitProportionalLineOutcome(
  db: Db,
  client: ClobClient | null,
  sub: Sub,
  ev: Ev,
  lineStateAtStart: FollowLineState,
  outcome: "filled" | "posted" | "skipped" | "failed",
  skipReason: string | null,
  engineMode: string,
  options?: { executedShares?: number }
): Promise<void> {
  if (ev.side === "BUY" && lineStateAtStart === "watching") {
    if (outcome === "filled") {
      await setFollowLineState(db, {
        subscriptionId: sub.id,
        asset: ev.asset,
        state: "active",
        abandonedReason: null,
        entryLeaderEventId: ev.id,
      });
      return;
    }
    if (outcome === "posted") {
      return;
    }
    if (outcome === "skipped" && skipReason === "shadow_mode" && engineMode === "shadow") {
      await setFollowLineState(db, {
        subscriptionId: sub.id,
        asset: ev.asset,
        state: "shadow_active",
        abandonedReason: null,
        entryLeaderEventId: ev.id,
      });
      return;
    }
    if (outcome === "skipped" && skipReason && RETRYABLE_OPENING_SKIPS.has(skipReason)) {
      return;
    }
    if (outcome === "failed" || isOpeningAbandonReason(skipReason)) {
      await setFollowLineState(db, {
        subscriptionId: sub.id,
        asset: ev.asset,
        state: "abandoned",
        abandonedReason: skipReason ?? "order_failed",
        entryLeaderEventId: ev.id,
      });
    }
    return;
  }

  if (
    ev.side === "BUY" &&
    lineStateAtStart === "active" &&
    outcome === "skipped" &&
    engineMode === "shadow" &&
    skipReason === "shadow_mode"
  ) {
    return;
  }

  const closingSide = ev.side === "SELL" || ev.side === "MERGE" || ev.side === "REDEEM";
  const shadowExit =
    engineMode === "shadow" && outcome === "skipped" && skipReason === "shadow_mode";
  const liveExit = outcome === "filled";

  if (closingSide && lineStateAtStart === "active" && (liveExit || shadowExit)) {
    let remaining: number | null = null;
    if (liveExit && client) {
      remaining = await fetchConditionalBalance(client, ev.asset);
    } else if (shadowExit) {
      const before = await reconstructShadowFollowerPosition(db, sub.id, ev.asset, {
        tradeTimestamp: ev.tradeTimestamp,
        createdAt: ev.createdAt,
        id: ev.id,
      });
      const executed = options?.executedShares ?? 0;
      remaining = Math.max(0, before - executed);
    }
    if (remaining != null && remaining <= LEADER_POSITION_EPSILON) {
      await setFollowLineState(db, {
        subscriptionId: sub.id,
        asset: ev.asset,
        state: "closed",
        abandonedReason: null,
        entryLeaderEventId: null,
      });
    }
  }
}
