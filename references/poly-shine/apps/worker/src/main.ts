import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import {
  createDb,
  resolveSqliteDatabasePath,
  runMigrations,
  leaderEvents,
  subscriptions,
  mirrorIntents,
  executions,
  engineState,
} from "@poly-shine/db";
import { fetchPolymarketEquityBatch } from "@poly-shine/shared";
import { gateSideForActivity, isCtfActivitySide } from "./leaderActivity.js";
import { ingestSubscription } from "./ingest.js";
import {
  capMergeSetsByBalances,
  executeMergePositions,
  executeRedeemPositions,
  executeSplitPosition,
  fetchConditionTokenIds,
} from "./ctf.js";
import { computeMirrorShares, finalizeMirrorShares, type MirrorSizingMeta } from "./sizing.js";
import { commitProportionalLineOutcome, prepareProportionalLine } from "./lineStateHooks.js";
import { reconstructShadowFollowerPosition } from "./shadowPosition.js";
import {
  getTradingClient,
  getFollowerWalletAddress,
  postMirrorLimitOrder,
  fetchCollateralBalance,
  fetchConditionalBalance,
  Side,
} from "./clob.js";
import { allowOrder } from "./rateLimit.js";
import { formatWorkerError, notifyTelegram, notifyTelegramThrottled } from "./notify.js";
import { claimPendingMirrorIntents, recoverStaleProcessingIntents } from "./intentQueue.js";
import {
  extractOrderId,
  fetchOrderMatchedShares,
  isFillSufficient,
  reconcilePostedMirrorFills,
} from "./orderFill.js";
import {
  checkMaxDailyLoss,
  checkMaxOpenExposure,
  checkMaxSlippage,
  fetchFollowerEquity,
} from "./riskLimits.js";
import { reopenReadOnlySkippedIntents, resetShadowActiveLines } from "./engineTransitions.js";
import {
  applySubscriptionBaseline,
  checkMirrorBaselineGate,
  ensureSubscriptionBaselined,
} from "./baseline.js";
import type { FollowLineState } from "./positionState.js";
import type { ClobClient } from "@polymarket/clob-client-v2";

const sqlitePath = resolveSqliteDatabasePath(import.meta.url);
fs.mkdirSync(path.dirname(path.resolve(sqlitePath)), { recursive: true });
runMigrations(sqlitePath);

const db = createDb(sqlitePath);

let prevEnginePaused: boolean | null = null;
let lastHeartbeat = 0;
let prevEngineMode: string | null = null;

function buildPlanned(
  ev: typeof leaderEvents.$inferSelect,
  leaderShares: number,
  leaderPrice: number,
  shares: number,
  meta?: MirrorSizingMeta
) {
  const raw = ev.raw as { type?: string } | null;
  return {
    tokenID: ev.asset,
    side: ev.side,
    activityType: raw?.type ?? ev.side,
    conditionId: ev.conditionId,
    price: leaderPrice,
    size: shares,
    leaderShares,
    leaderPrice,
    ...meta,
  };
}

async function loadEngine() {
  const rows = await db.select().from(engineState).where(eq(engineState.id, 1)).limit(1);
  return rows[0] ?? null;
}

async function fetchLeaderCashByAddress(
  subs: Array<typeof subscriptions.$inferSelect>
): Promise<Map<string, number>> {
  const addresses = [
    ...new Set(
      subs.filter((s) => s.sizingMode === "proportional_equity").map((s) => s.address.toLowerCase())
    ),
  ];
  if (addresses.length === 0) return new Map();

  const batch = await fetchPolymarketEquityBatch(addresses);
  const out = new Map<string, number>();
  for (const addr of addresses) {
    const entry = batch[addr];
    if (entry && "cashBalance" in entry && Number.isFinite(entry.cashBalance)) {
      out.set(addr, entry.cashBalance);
    }
  }
  return out;
}

async function commitFilledIntentLineState(
  intentId: string,
  client: ClobClient | null,
  engineMode: string
) {
  const [intent] = await db.select().from(mirrorIntents).where(eq(mirrorIntents.id, intentId)).limit(1);
  if (!intent) return;
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, intent.subscriptionId)).limit(1);
  const [ev] = await db.select().from(leaderEvents).where(eq(leaderEvents.id, intent.leaderEventId)).limit(1);
  if (!sub || !ev || sub.sizingMode !== "proportional_equity") return;
  const planned = intent.planned as { followLineState?: FollowLineState } | null;
  const lineState = planned?.followLineState;
  if (!lineState) return;
  await commitProportionalLineOutcome(db, client, sub, ev, lineState, "filled", null, engineMode);
}

async function processMirrorIntents(engine: typeof engineState.$inferSelect) {
  if (prevEngineMode === "shadow" && engine.mode === "live") {
    const n = await resetShadowActiveLines(db);
    if (n > 0) {
      console.log(`reset ${n} shadow_active line(s) before live`);
    }
  }
  if (engine.mode === "read_only" && prevEngineMode !== "read_only") {
    await db
      .update(mirrorIntents)
      .set({ status: "skipped", skipReason: "read_only_mode", updatedAt: new Date().toISOString() })
      .where(eq(mirrorIntents.status, "pending"));
  }
  if (engine.mode !== "read_only" && prevEngineMode === "read_only") {
    const reopened = await reopenReadOnlySkippedIntents(db);
    if (reopened > 0) {
      console.log(`reopened ${reopened} mirror intent(s) after read_only`);
    }
  }
  prevEngineMode = engine.mode;
  if (engine.mode === "read_only") {
    return;
  }
  if (engine.paused) return;

  const recovered = await recoverStaleProcessingIntents(db);
  if (recovered > 0) {
    console.log(`recovered ${recovered} stale processing intent(s)`);
  }

  const client = await getTradingClient();
  if (engine.mode === "live" && client) {
    const filled = await reconcilePostedMirrorFills(db, client);
    for (const f of filled) {
      await commitFilledIntentLineState(f.intentId, client, engine.mode);
    }
  }

  const pending = await claimPendingMirrorIntents(db, 40);
  const followerUsdc = client ? await fetchCollateralBalance(client) : null;
  const followerAddress = getFollowerWalletAddress();

  const subIds = [...new Set(pending.map((i) => i.subscriptionId))];
  const subRows =
    subIds.length > 0
      ? await db.select().from(subscriptions).where(inArray(subscriptions.id, subIds))
      : [];
  const subById = new Map(subRows.map((s) => [s.id, s]));
  const leaderCashByAddress = await fetchLeaderCashByAddress(subRows);

  for (const intent of pending) {
    const sub = subById.get(intent.subscriptionId);
    const evRows = await db.select().from(leaderEvents).where(eq(leaderEvents.id, intent.leaderEventId)).limit(1);
    const ev = evRows[0];
    if (!sub || !ev) {
      await db
        .update(mirrorIntents)
        .set({ status: "skipped", skipReason: "missing_subscription_or_event", updatedAt: new Date().toISOString() })
        .where(eq(mirrorIntents.id, intent.id));
      continue;
    }
    const maxOps = sub.maxOrdersPerSecond ?? 5;
    if (!allowOrder(sub.id, maxOps)) {
      await db
        .update(mirrorIntents)
        .set({ status: "pending", updatedAt: new Date().toISOString() })
        .where(eq(mirrorIntents.id, intent.id));
      continue;
    }
    const leaderShares = Number(ev.size);
    const leaderPrice = Number(ev.price);
    const baselineGate = await checkMirrorBaselineGate(db, sub, ev);
    if (baselineGate.blocked) {
      await db
        .update(mirrorIntents)
        .set({
          status: "skipped",
          skipReason: baselineGate.skipReason,
          planned: {
            tokenID: ev.asset,
            side: ev.side,
            leaderShares,
            leaderPrice,
          },
          updatedAt: new Date().toISOString(),
        })
        .where(eq(mirrorIntents.id, intent.id));
      continue;
    }

    const isProportional = sub.sizingMode === "proportional_equity";
    const leaderCash = isProportional
      ? (leaderCashByAddress.get(sub.address.toLowerCase()) ?? null)
      : null;

    let lineStateAtStart: FollowLineState | null = null;
    let leaderPositionBefore: number | null = null;
    let followerTokenPosition: number | null = null;

    if (isProportional) {
      const line = await prepareProportionalLine(db, sub, ev, engine.mode);
      lineStateAtStart = line.lineState;
      leaderPositionBefore = line.leaderPositionBefore;
      if (!line.proceed) {
        await db
          .update(mirrorIntents)
          .set({
            status: "skipped",
            skipReason: line.skipReason,
            planned: {
              tokenID: ev.asset,
              side: ev.side,
              leaderShares,
              leaderPrice,
              followLineState: line.lineState,
              leaderPositionBefore: line.leaderPositionBefore,
            },
            updatedAt: new Date().toISOString(),
          })
          .where(eq(mirrorIntents.id, intent.id));
        continue;
      }
      if (gateSideForActivity(ev.side) === "SELL") {
        if (engine.mode === "shadow") {
          followerTokenPosition = await reconstructShadowFollowerPosition(db, sub.id, ev.asset, {
            tradeTimestamp: ev.tradeTimestamp,
            createdAt: ev.createdAt,
            id: ev.id,
          });
        } else if (client) {
          followerTokenPosition = await fetchConditionalBalance(client, ev.asset);
        }
      }
    } else if (gateSideForActivity(ev.side) === "SELL" && engine.mode === "live" && client) {
      followerTokenPosition = await fetchConditionalBalance(client, ev.asset);
    }

    let { shares, skipReason, meta } = computeMirrorShares({
      sizingMode: sub.sizingMode,
      side: ev.side,
      fixedUsd: sub.fixedUsd,
      pctBalance: sub.pctBalance,
      pctLeaderNotional: sub.pctLeaderNotional,
      leaderShares,
      leaderPrice,
      followerUsdc,
      leaderCash,
      leaderPositionBefore,
      followerTokenPosition,
    });
    if (meta && lineStateAtStart) {
      meta = { ...meta, followLineState: lineStateAtStart };
    }
    if (skipReason) {
      if (isProportional && lineStateAtStart) {
        await commitProportionalLineOutcome(
          db,
          client,
          sub,
          ev,
          lineStateAtStart,
          "skipped",
          skipReason,
          engine.mode
        );
      }
      await db
        .update(mirrorIntents)
        .set({
          status: "skipped",
          skipReason,
          planned: buildPlanned(ev, leaderShares, leaderPrice, shares, meta),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(mirrorIntents.id, intent.id));
      continue;
    }

    const finalized = finalizeMirrorShares({
      shares,
      price: leaderPrice,
      side: ev.side,
      maxNotionalPerTrade: sub.maxNotionalPerTrade,
      followerUsdc: ev.side === "BUY" ? followerUsdc : null,
      tokenPosition: ev.side === "SELL" ? followerTokenPosition : null,
      meta,
    });
    shares = finalized.shares;
    skipReason = finalized.skipReason;
    meta = finalized.meta;

    if (ev.side === "MERGE" && !skipReason) {
      if (!ev.conditionId) {
        skipReason = "missing_condition_id";
      } else if (engine.mode === "live" && client) {
        const tokenIds = await fetchConditionTokenIds(ev.conditionId);
        if (!tokenIds || tokenIds.length < 2) {
          skipReason = "merge_tokens_unavailable";
        } else {
          const balances = await Promise.all(tokenIds.map((id) => fetchConditionalBalance(client, id)));
          const capped = capMergeSetsByBalances(shares, balances);
          shares = capped.sets;
          skipReason = capped.skipReason;
        }
      } else if (engine.mode === "shadow") {
        const tokenIds = ev.conditionId ? await fetchConditionTokenIds(ev.conditionId) : null;
        if (tokenIds && tokenIds.length >= 2) {
          const shadowBalances = await Promise.all(
            tokenIds.map((id) =>
              reconstructShadowFollowerPosition(db, sub.id, id, {
                tradeTimestamp: ev.tradeTimestamp,
                createdAt: ev.createdAt,
                id: ev.id,
              })
            )
          );
          const capped = capMergeSetsByBalances(shares, shadowBalances);
          shares = capped.sets;
          skipReason = capped.skipReason;
        }
      }
    }

    if (skipReason) {
      if (isProportional && lineStateAtStart) {
        await commitProportionalLineOutcome(
          db,
          client,
          sub,
          ev,
          lineStateAtStart,
          "skipped",
          skipReason,
          engine.mode
        );
      }
      await db
        .update(mirrorIntents)
        .set({
          status: "skipped",
          skipReason,
          planned: buildPlanned(ev, leaderShares, leaderPrice, shares, meta),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(mirrorIntents.id, intent.id));
      continue;
    }

    const planned = buildPlanned(ev, leaderShares, leaderPrice, shares, meta);
    const isCtf = isCtfActivitySide(ev.side);

    if (engine.mode === "shadow") {
      if (isProportional && lineStateAtStart) {
        await commitProportionalLineOutcome(
          db,
          client,
          sub,
          ev,
          lineStateAtStart,
          "skipped",
          "shadow_mode",
          engine.mode,
          { executedShares: shares }
        );
      }
      await db
        .update(mirrorIntents)
        .set({
          planned,
          status: "skipped",
          skipReason: "shadow_mode",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(mirrorIntents.id, intent.id));
      continue;
    }

    if (engine.mode === "live") {
      if (!client) {
        await db
          .update(mirrorIntents)
          .set({
            planned,
            status: "failed",
            skipReason: "missing_trading_client",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(mirrorIntents.id, intent.id));
        await notifyTelegram({
          severity: "critical",
          title: "Mirror failed",
          body: `Intent ${intent.id}: POLYMARKET_PRIVATE_KEY not configured`,
        });
        continue;
      }

      if (!isCtf && ev.side === "BUY" && followerAddress) {
        const equityResult = await fetchFollowerEquity(followerAddress);
        if ("skipReason" in equityResult) {
          skipReason = equityResult.skipReason;
        } else {
          const buyNotional = shares * leaderPrice;
          const exposure = checkMaxOpenExposure({
            equity: equityResult,
            additionalBuyNotional: buyNotional,
            maxOpenExposureUsd: sub.maxOpenExposureUsd,
          });
          if ("skipReason" in exposure) skipReason = exposure.skipReason;
          else {
            const daily = await checkMaxDailyLoss(db, {
              followerAddress,
              equity: equityResult,
              maxDailyLossUsd: sub.maxDailyLossUsd,
            });
            if ("skipReason" in daily) skipReason = daily.skipReason;
          }
        }
      }

      if (!skipReason && !isCtf) {
        const slip = await checkMaxSlippage({
          client,
          tokenId: ev.asset,
          leaderPrice,
          side: ev.side as "BUY" | "SELL",
          maxSlippageBps: sub.maxSlippageBps,
        });
        if ("skipReason" in slip) skipReason = slip.skipReason;
      }

      if (skipReason) {
        if (isProportional && lineStateAtStart) {
          await commitProportionalLineOutcome(
            db,
            client,
            sub,
            ev,
            lineStateAtStart,
            "skipped",
            skipReason,
            engine.mode
          );
        }
        await db
          .update(mirrorIntents)
          .set({
            planned,
            status: "skipped",
            skipReason,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(mirrorIntents.id, intent.id));
        continue;
      }

      try {
        let raw: Record<string, unknown>;
        let intentStatus: "posted" | "filled" = "filled";

        if (isCtf) {
          if (!ev.conditionId) {
            skipReason = "missing_condition_id";
            throw new Error("missing_condition_id");
          }
          if (ev.side === "MERGE") {
            const result = await executeMergePositions(ev.conditionId, shares);
            if ("error" in result) throw new Error(result.error);
            raw = { ctf: "merge", txHash: result.txHash, sets: shares };
          } else if (ev.side === "SPLIT") {
            const result = await executeSplitPosition(ev.conditionId, shares);
            if ("error" in result) throw new Error(result.error);
            raw = { ctf: "split", txHash: result.txHash, sets: shares };
          } else if (ev.side === "REDEEM") {
            const result = await executeRedeemPositions(ev.conditionId);
            if ("error" in result) throw new Error(result.error);
            raw = { ctf: "redeem", txHash: result.txHash };
          } else {
            throw new Error(`unsupported_ctf_side:${ev.side}`);
          }
        } else {
          const side = ev.side === "SELL" ? Side.SELL : Side.BUY;
          const res = await postMirrorLimitOrder(client, {
            tokenID: ev.asset,
            side,
            price: leaderPrice,
            size: shares,
          });
          raw = res as Record<string, unknown>;
          intentStatus = "posted";
          const orderId = extractOrderId(raw);
          if (orderId) {
            const matched = await fetchOrderMatchedShares(client, orderId);
            if (isFillSufficient(matched)) {
              intentStatus = "filled";
            }
          }
        }

        await db.insert(executions).values({
          mirrorIntentId: intent.id,
          success: true,
          raw,
        });

        await db
          .update(mirrorIntents)
          .set({ planned, status: intentStatus, updatedAt: new Date().toISOString() })
          .where(eq(mirrorIntents.id, intent.id));

        if (isProportional && lineStateAtStart) {
          await commitProportionalLineOutcome(
            db,
            client,
            sub,
            ev,
            lineStateAtStart,
            intentStatus === "filled" ? "filled" : "posted",
            null,
            engine.mode
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.insert(executions).values({
          mirrorIntentId: intent.id,
          success: false,
          raw: { error: msg } as Record<string, unknown>,
        });
        await db
          .update(mirrorIntents)
          .set({
            planned,
            status: "failed",
            skipReason: msg.slice(0, 500),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(mirrorIntents.id, intent.id));
        if (isProportional && lineStateAtStart) {
          await commitProportionalLineOutcome(
            db,
            client,
            sub,
            ev,
            lineStateAtStart,
            "failed",
            msg.slice(0, 200),
            engine.mode
          );
        }
        await notifyTelegram({
          severity: "warning",
          title: "Order post failed",
          body: `Intent ${intent.id}: ${msg}`,
        });
      }
    }
  }
}

async function maybeHeartbeat(engine: typeof engineState.$inferSelect) {
  if (engine.paused || engine.mode !== "live") return;
  const client = await getTradingClient();
  if (!client) return;
  const now = Date.now();
  if (now - lastHeartbeat < 25_000) return;
  lastHeartbeat = now;
  try {
    await client.postHeartbeat();
  } catch (e) {
    console.error("heartbeat failed", e);
  }
}

async function maybeCancelAll(engine: typeof engineState.$inferSelect) {
  const nowPaused = engine.paused;
  if (prevEnginePaused !== null && prevEnginePaused === false && nowPaused && engine.cancelAllOnKill) {
    const client = await getTradingClient();
    if (client) {
      try {
        await client.cancelAll();
        await notifyTelegram({
          severity: "info",
          title: "Kill switch",
          body: "cancelAll executed after pause",
        });
      } catch (e) {
        console.error("cancelAll failed", e);
      }
    }
  }
  prevEnginePaused = nowPaused;
}

async function tick() {
  try {
    const engine = await loadEngine();
    if (!engine) return;
    await maybeCancelAll(engine);
    const subs = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.active, true)));
    for (let sub of subs) {
      try {
        if (sub.baselineAt == null) {
          sub = await ensureSubscriptionBaselined(db, sub);
        }
        const ingest = await ingestSubscription(db, sub, engine.mode);
        if (ingest.backfilledIntents > 0) {
          console.log(
            `backfilled ${ingest.backfilledIntents} mirror intent(s) for ${sub.address.slice(0, 10)}…`
          );
        }
      } catch (e) {
        console.error("ingest", sub.address, e);
        await notifyTelegramThrottled(`ingestion:${sub.address.toLowerCase()}`, {
          severity: "warning",
          title: "Ingestion error",
          body: `${sub.address}: ${formatWorkerError(e)}`,
        });
      }
    }
    await processMirrorIntents(engine);
    await maybeHeartbeat(engine);
  } catch (e) {
    console.error("tick error", e);
  }
}

async function baselineAllActiveSubscriptions() {
  const subs = await db.select().from(subscriptions).where(eq(subscriptions.active, true));
  for (const sub of subs) {
    try {
      const r = await applySubscriptionBaseline(db, sub);
      if (r.markedAssets > 0 || r.skippedIntents > 0) {
        console.log(
          `baseline ${sub.address.slice(0, 10)}… followFrom=${r.followFromMs} marked=${r.markedAssets} skipped=${r.skippedIntents}`
        );
      }
    } catch (e) {
      console.error("baseline", sub.address, e);
      await notifyTelegramThrottled(`baseline:${sub.address.toLowerCase()}`, {
        severity: "warning",
        title: "Baseline error",
        body: `${sub.address}: ${formatWorkerError(e)}`,
      });
    }
  }
}

async function main() {
  console.log("poly-shine worker starting");
  await baselineAllActiveSubscriptions();
  setInterval(() => void tick(), 2500);
  await tick();
}

main();
