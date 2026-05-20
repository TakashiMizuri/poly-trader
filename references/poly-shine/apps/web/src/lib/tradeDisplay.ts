import { compareLeaderEvents, type LeaderEventOrderKey } from "@poly-shine/shared";
import type { MirrorPlanned, TradeFeedItem } from "../types";
import type { StatusBadgeTone } from "../components/app-ui";

export function tradeFeedLeaderOrderKey(item: TradeFeedItem): LeaderEventOrderKey {
  return {
    tradeTimestamp: item.tradeTimestamp,
    createdAt: item.eventCreatedAt ?? "",
    id: item.eventId,
  };
}

/** Ascending fill order (oldest first), aligned with worker leader-event ordering. */
export function compareTradeFeedItems(a: TradeFeedItem, b: TradeFeedItem): number {
  return compareLeaderEvents(tradeFeedLeaderOrderKey(a), tradeFeedLeaderOrderKey(b));
}

/** Newest first — grouped / flat UI lists (worker still uses ascending order). */
export function compareTradeFeedItemsNewestFirst(a: TradeFeedItem, b: TradeFeedItem): number {
  return compareTradeFeedItems(b, a);
}

export function toEpochMs(ts: number | null | undefined): number | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  return ts < 1e12 ? ts * 1000 : ts;
}

/** 0–1 progress through [startMs, endMs]; null when the window is unknown or invalid. */
export function eventProgressPercent(
  startMs: number | null,
  endMs: number | null,
  nowMs: number = Date.now()
): number | null {
  if (startMs == null || endMs == null) return null;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  if (nowMs <= startMs) return 0;
  if (nowMs >= endMs) return 1;
  return (nowMs - startMs) / (endMs - startMs);
}

/** Event window for a grouped position: market dates when present, else first–last fill. */
export function tradeFeedEventWindow(items: TradeFeedItem[]): { startMs: number; endMs: number } | null {
  const head = items[0];
  if (!head) return null;

  const marketStart = toEpochMs(head.marketStartAt ?? undefined);
  const marketEnd = toEpochMs(head.marketEndAt ?? undefined);
  const MAX_EVENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  if (
    marketStart != null &&
    marketEnd != null &&
    marketEnd > marketStart &&
    marketEnd - marketStart <= MAX_EVENT_WINDOW_MS
  ) {
    return { startMs: marketStart, endMs: marketEnd };
  }

  const tradeMs = items
    .map((i) => toEpochMs(i.tradeTimestamp))
    .filter((n): n is number => n != null);
  if (tradeMs.length === 0) return null;
  const startMs = Math.min(...tradeMs);
  const endMs = Math.max(...tradeMs);
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

export function fmtTs(ts: number | string | null | undefined) {
  if (ts == null) return "—";
  const n = typeof ts === "number" ? ts : Date.parse(ts);
  if (Number.isNaN(n)) return "—";
  const epochMs = toEpochMs(n);
  if (epochMs == null) return "—";
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function shortAddr(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function fmtVol(shares: number, price: number) {
  if (!Number.isFinite(shares) || !Number.isFinite(price)) return "—";
  const usd = shares * price;
  const sh =
    shares >= 1000
      ? shares.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : shares.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${sh} @ ${price.toFixed(3)} · ${usd.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
}

export function formatRatio(planned: MirrorPlanned | null | undefined) {
  if (planned?.closeFraction != null && Number.isFinite(planned.closeFraction)) {
    const pct = (planned.closeFraction * 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const cap = planned.cappedBy ? ` · ${planned.cappedBy}` : "";
    return `${pct}% pos${cap}`;
  }
  if (planned?.balanceRatio == null || !Number.isFinite(planned.balanceRatio)) return "—";
  const pct = (planned.balanceRatio * 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const cap = planned.cappedBy ? ` · ${planned.cappedBy}` : "";
  const scale =
    planned.proportionalScale != null && planned.proportionalScale !== 1
      ? ` · scale ${planned.proportionalScale}`
      : "";
  return `${pct}% cash${cap}${scale}`;
}

export function formatMirrorVol(
  leaderShares: number,
  leaderPrice: number,
  planned: MirrorPlanned | null | undefined
) {
  const mirrorShares = planned?.size != null ? Number(planned.size) : null;
  const mirrorPrice =
    planned?.price != null
      ? Number(planned.price)
      : planned?.leaderPrice != null
        ? Number(planned.leaderPrice)
        : leaderPrice;
  if (mirrorShares == null || !Number.isFinite(mirrorShares)) return "—";
  const leaderStr = Number.isFinite(leaderShares)
    ? leaderShares.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "—";
  const mirrorStr = mirrorShares.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${leaderStr} → ${mirrorStr} sh · ${fmtVol(mirrorShares, mirrorPrice)}`;
}

const SKIP_LABELS: Record<string, string> = {
  shadow_mode: "Shadow (no order)",
  read_only_mode: "Read-only",
  rate_limited: "Rate limited",
  size_too_small: "Too small",
  missing_follower_balance: "No balance",
  invalid_leader_price: "Bad price",
  invalid_fixed_usd: "Bad fixed USD",
  invalid_pct_balance: "Bad % balance",
  invalid_pct_leader: "Bad % leader",
  missing_leader_cash: "No leader cash",
  leader_cash_zero: "Leader cash zero",
  invalid_proportional_scale: "Bad scale",
  no_position_to_sell: "No position",
  insufficient_cash_for_buy: "Insufficient cash",
  below_min_notional: "Below $1 min",
  line_abandoned: "Line abandoned",
  pre_existing_position: "Pre-existing (skipped)",
  before_follow_baseline: "Before baseline",
  leader_already_in_position: "Leader already in",
  entry_not_established: "No entry",
  invalid_leader_position: "Bad leader pos.",
  unknown_sizing_mode: "Unknown sizing",
  max_notional_too_small_for_tick: "Min notional",
  missing_subscription_or_event: "Missing data",
  missing_trading_client: "No client",
  max_slippage_exceeded: "Slippage cap",
  slippage_mid_unavailable: "No midpoint",
  slippage_check_failed: "Slippage check failed",
  max_open_exposure_exceeded: "Exposure cap",
  exposure_snapshot_invalid: "Exposure snapshot",
  max_daily_loss_exceeded: "Daily loss cap",
  equity_snapshot_failed: "Equity snapshot",
  missing_condition_id: "No condition ID",
  merge_tokens_unavailable: "Merge tokens N/A",
  merge_pair_balance_unavailable: "Merge pair balance N/A",
  insufficient_merge_pair: "Insufficient merge pair",
  merge_amount_too_small: "Merge too small",
  split_amount_too_small: "Split too small",
  order_failed: "Order failed",
};

const LINE_ABANDON_HINTS: Record<string, string> = {
  pre_existing_position:
    "Leader already held this outcome when follow started. No mid-position entry until flat + new BUY.",
};

export function skipLabel(reason: string | null) {
  if (!reason) return null;
  return SKIP_LABELS[reason] ?? reason.replaceAll("_", " ");
}

/** Planned mirror notional (shares × price) when a skip still recorded sizing. */
export function formatPlannedNotionalUsd(planned: MirrorPlanned | null | undefined): string | null {
  if (!planned) return null;
  const shares =
    planned.roundedShares != null && Number.isFinite(planned.roundedShares)
      ? planned.roundedShares
      : planned.rawShares != null && Number.isFinite(planned.rawShares)
        ? planned.rawShares
        : planned.size != null && Number(planned.size) > 0
          ? Number(planned.size)
          : null;
  if (shares == null) return null;
  const price =
    planned.price != null
      ? Number(planned.price)
      : planned.leaderPrice != null
        ? Number(planned.leaderPrice)
        : null;
  if (price == null || !Number.isFinite(price)) return null;
  const notional = shares * price;
  if (!Number.isFinite(notional)) return null;
  return notional.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function skipLabelWithPlanned(
  reason: string | null,
  planned: MirrorPlanned | null | undefined
): string | null {
  const label = skipLabel(reason);
  if (!label) return null;
  if (reason === "below_min_notional") {
    const notional = formatPlannedNotionalUsd(planned);
    if (notional) return `${label} (${notional})`;
  }
  return label;
}

/** Skip / mirror label for feed rows (`line_abandoned` is not suffixed — root cause is on the abandoning fill or group summary). */
export function skipDisplayLabel(
  reason: string | null,
  planned?: MirrorPlanned | null
): string | null {
  return skipLabelWithPlanned(reason, planned);
}

export function followLineAbandonHint(reason: string | null | undefined): string | undefined {
  if (!reason) return undefined;
  return LINE_ABANDON_HINTS[reason];
}

export function intentTone(status: string | null): StatusBadgeTone {
  if (!status) return "neutral";
  if (status === "posted" || status === "filled") return "live";
  if (status === "skipped") return "shadow";
  if (status === "failed") return "danger";
  if (status === "processing") return "accent";
  return "warn";
}

export type TradeFeedGroup = {
  key: string;
  items: TradeFeedItem[];
};

export function tradeFeedGroupKey(item: TradeFeedItem): string {
  return `${item.subscriptionId}:${item.asset}`;
}

export function isTradeFeedMarketClosed(item: TradeFeedItem): boolean {
  return item.marketClosed === true;
}

/** Market resolved on Polymarket or the event time window has ended. */
export function isTradeFeedItemCompleted(
  item: TradeFeedItem,
  eventWindow?: { startMs: number; endMs: number } | null,
  nowMs: number = Date.now()
): boolean {
  if (isTradeFeedMarketClosed(item)) return true;
  const window = eventWindow ?? tradeFeedEventWindow([item]);
  if (window != null && nowMs >= window.endMs) return true;
  return false;
}

/** All trades for the same subscription + outcome token (position), ordered by latest activity. */
export function groupTradeFeedItems(items: TradeFeedItem[]): TradeFeedGroup[] {
  const byKey = new Map<string, TradeFeedItem[]>();
  for (const item of items) {
    const key = tradeFeedGroupKey(item);
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }

  const groups: TradeFeedGroup[] = [];
  for (const [key, groupItems] of byKey) {
    groupItems.sort(compareTradeFeedItemsNewestFirst);
    groups.push({ key, items: groupItems });
  }

  groups.sort((a, b) => {
    const latest = (g: TradeFeedGroup) =>
      Math.max(...g.items.map((i) => i.tradeTimestamp));
    return latest(b) - latest(a);
  });

  return groups;
}

export function formatGroupTimeRange(items: TradeFeedItem[]): string {
  const window = tradeFeedEventWindow(items);
  if (window) {
    const { startMs, endMs } = window;
    return startMs === endMs ? fmtTs(startMs) : `${fmtTs(startMs)} – ${fmtTs(endMs)}`;
  }
  const ts = items.map((i) => i.tradeTimestamp);
  const max = Math.max(...ts);
  const min = Math.min(...ts);
  return max === min ? fmtTs(max) : `${fmtTs(min)} – ${fmtTs(max)}`;
}

export function formatGroupSides(items: TradeFeedItem[]): string {
  const counts = new Map<string, number>();
  for (const i of items) {
    counts.set(i.side, (counts.get(i.side) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [side, n] of counts) {
    parts.push(`${n}× ${side}`);
  }
  return parts.length ? parts.join(", ") : `${items.length} trade${items.length === 1 ? "" : "s"}`;
}

function signedFillShares(shares: number, side: string): number {
  if (side === "SELL" || side === "MERGE" || side === "REDEEM") return -shares;
  if (side === "BUY" || side === "SPLIT") return shares;
  return 0;
}

export function formatShareAmount(shares: number): string {
  const abs = Math.abs(shares);
  const formatted =
    abs >= 1000
      ? abs.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : abs.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (shares < -1e-9) return `−${formatted}`;
  return formatted;
}

export function formatGroupUsd(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export type TradeFeedGroupSummary = {
  fills: number;
  leaderNetShares: number | null;
  leaderTradedUsd: number | null;
  mirrorNetShares: number | null;
  mirrorTradedUsd: number | null;
  followerPosition: number | null;
  leaderPositionBefore: number | null;
};

/** Roll up leader/mirror volume and latest position hints for a grouped feed block. */
export function summarizeTradeFeedGroup(items: TradeFeedItem[]): TradeFeedGroupSummary {
  let leaderNet = 0;
  let leaderUsd = 0;
  let mirrorNet = 0;
  let mirrorUsd = 0;
  let hasLeader = false;
  let hasMirror = false;

  for (const item of items) {
    const leaderShares = Number(item.leaderSize);
    const leaderPrice = Number(item.leaderPrice);
    if (Number.isFinite(leaderShares)) {
      hasLeader = true;
      leaderNet += signedFillShares(leaderShares, item.side);
      if (Number.isFinite(leaderPrice)) leaderUsd += Math.abs(leaderShares * leaderPrice);
    }

    const planned = item.planned;
    const mirrorShares = planned?.size != null ? Number(planned.size) : null;
    if (mirrorShares != null && Number.isFinite(mirrorShares)) {
      hasMirror = true;
      mirrorNet += signedFillShares(mirrorShares, item.side);
      const mirrorPrice =
        planned?.price != null
          ? Number(planned.price)
          : planned?.leaderPrice != null
            ? Number(planned.leaderPrice)
            : leaderPrice;
      if (Number.isFinite(mirrorPrice)) mirrorUsd += Math.abs(mirrorShares * mirrorPrice);
    }
  }

  const byLatest = [...items].sort((a, b) => compareTradeFeedItems(b, a));
  const lastFollower = byLatest.find((i) => i.planned?.followerPosition != null);
  const lastLeaderPos = byLatest.find((i) => i.planned?.leaderPositionBefore != null);

  return {
    fills: items.length,
    leaderNetShares: hasLeader ? leaderNet : null,
    leaderTradedUsd: hasLeader ? leaderUsd : null,
    mirrorNetShares: hasMirror ? mirrorNet : null,
    mirrorTradedUsd: hasMirror ? mirrorUsd : null,
    followerPosition:
      lastFollower?.planned?.followerPosition != null
        ? Number(lastFollower.planned.followerPosition)
        : null,
    leaderPositionBefore:
      lastLeaderPos?.planned?.leaderPositionBefore != null
        ? Number(lastLeaderPos.planned.leaderPositionBefore)
        : null,
  };
}

export function mirrorResultTitle(item: TradeFeedItem): string | undefined {
  const hint = followLineAbandonHint(item.followLineAbandonedReason);
  if (hint) return hint;
  const detail = skipDisplayLabel(item.skipReason, item.planned);
  return detail ?? undefined;
}

export function mirrorResult(item: TradeFeedItem): string {
  if (item.skipReason === "shadow_mode" && item.planned?.size != null) {
    return "Shadow (planned)";
  }
  if (item.executed === true) return "Filled";
  if (item.executed === false) return "Exec failed";
  if (item.intentStatus === "skipped")
    return skipDisplayLabel(item.skipReason, item.planned) ?? "Skipped";
  if (item.intentStatus === "failed")
    return skipDisplayLabel(item.skipReason, item.planned) ?? "Failed";
  if (item.intentStatus === "filled") return "Filled";
  if (item.intentStatus === "posted") return "Posted (awaiting fill)";
  if (item.intentStatus === "pending" || item.intentStatus === "processing") return "Pending";
  if (!item.intentId) return "No mirror";
  return item.intentStatus ?? "—";
}

function formatPlannedDetails(planned: MirrorPlanned | null | undefined): string[] {
  if (!planned) return [];
  const lines: string[] = [];
  if (planned.size != null) {
    const price =
      planned.price != null
        ? Number(planned.price)
        : planned.leaderPrice != null
          ? Number(planned.leaderPrice)
          : null;
    lines.push(
      price != null && Number.isFinite(price)
        ? `Planned mirror: ${planned.size} sh @ ${Number(price).toFixed(3)}`
        : `Planned mirror size: ${planned.size} sh`
    );
  }
  if (planned.leaderCash != null && planned.followerCash != null) {
    lines.push(
      `Cash: leader $${planned.leaderCash.toLocaleString()} · follower $${planned.followerCash.toLocaleString()}`
    );
  }
  if (planned.leaderPositionBefore != null) {
    lines.push(`Leader position before: ${planned.leaderPositionBefore} sh`);
  }
  if (planned.followerPosition != null) {
    lines.push(`Follower position: ${planned.followerPosition} sh`);
  }
  if (planned.followLineState) {
    lines.push(`Follow line: ${planned.followLineState}`);
  }
  if (planned.sizingBasis) {
    lines.push(`Sizing basis: ${planned.sizingBasis}`);
  }
  return lines;
}

/** Markdown summary of a grouped feed position for clipboard / LLM context. */
export function formatTradeFeedGroupForCopy(
  items: TradeFeedItem[],
  nowMs: number = Date.now()
): string {
  if (items.length === 0) return "";

  const head = items[0]!;
  const eventWindow = tradeFeedEventWindow(items);
  const completed = isTradeFeedItemCompleted(head, eventWindow, nowMs);
  const progress =
    eventWindow != null
      ? eventProgressPercent(eventWindow.startMs, eventWindow.endMs, nowMs)
      : null;
  const leaderName = head.subscriptionLabel || shortAddr(head.subscriptionAddress);
  const chronological = [...items].sort(compareTradeFeedItems);
  const summary = summarizeTradeFeedGroup(chronological);

  const lines: string[] = [
    "# Trade feed position",
    "",
    "## Market",
    `- **Title:** ${head.marketTitle?.trim() || "Unknown market"}`,
    `- **Outcome:** ${head.marketOutcome?.trim() || "—"}`,
    `- **Status:** ${completed ? "Ended" : head.marketClosed ? "Closed" : "Active"}`,
    `- **Event window:** ${formatGroupTimeRange(items)}`,
  ];

  if (progress != null) {
    lines.push(`- **Progress:** ${Math.round(progress * 100)}%`);
  }

  lines.push(
    "",
    "## Leader",
    `- **Name:** ${leaderName}`,
    `- **Address:** ${head.subscriptionAddress}`,
    `- **Subscription ID:** ${head.subscriptionId}`,
    `- **Following active:** ${head.subscriptionActive ? "yes" : "no"}`,
    "",
    "## Position",
    `- **Outcome token (asset):** ${head.asset}`,
  );

  if (summary.leaderNetShares != null) {
    lines.push(
      `- **Leader net shares (fills):** ${formatShareAmount(summary.leaderNetShares)} sh`
    );
  }
  if (summary.leaderTradedUsd != null) {
    lines.push(`- **Leader traded volume:** ${formatGroupUsd(summary.leaderTradedUsd)}`);
  }
  if (summary.mirrorNetShares != null) {
    lines.push(`- **Mirror net shares (planned):** ${formatShareAmount(summary.mirrorNetShares)} sh`);
  }
  if (summary.mirrorTradedUsd != null) {
    lines.push(`- **Mirror traded volume:** ${formatGroupUsd(summary.mirrorTradedUsd)}`);
  }
  if (summary.followerPosition != null) {
    lines.push(
      `- **Follower position (latest planned):** ${formatShareAmount(summary.followerPosition)} sh`
    );
  }
  if (summary.leaderPositionBefore != null) {
    lines.push(
      `- **Leader position before (latest fill):** ${formatShareAmount(summary.leaderPositionBefore)} sh`
    );
  }
  if (head.followLineState === "abandoned") {
    const root = head.followLineAbandonedReason
      ? skipLabel(head.followLineAbandonedReason)
      : null;
    lines.push(
      `- **Follow line:** abandoned${root ? ` — ${root}` : ""}`
    );
    const hint = followLineAbandonHint(head.followLineAbandonedReason);
    if (hint) {
      lines.push(`- **Why:** ${hint}`);
    }
  }

  lines.push(
    "",
    "## Summary",
    `- **Fills:** ${items.length} (${formatGroupSides(items)})`,
    "",
    "## Trades (chronological)",
    ""
  );

  chronological.forEach((item, index) => {
    const leaderShares = Number(item.leaderSize);
    const leaderPrice = Number(item.leaderPrice);
    const planned = item.planned;

    lines.push(`### ${index + 1}. ${fmtTs(item.tradeTimestamp)} — ${item.side}`);
    lines.push(`- **Leader volume:** ${fmtVol(leaderShares, leaderPrice)}`);
    lines.push(
      `- **Mirror volume:** ${formatMirrorVol(leaderShares, leaderPrice, planned)}`
    );
    lines.push(`- **Sizing / ratio:** ${formatRatio(planned)}`);
    lines.push(`- **Mirror result:** ${mirrorResult(item)}`);

    if (item.intentStatus) {
      lines.push(`- **Intent status:** ${item.intentStatus}`);
    }
    if (item.skipReason) {
      lines.push(
        `- **Skip reason:** ${skipDisplayLabel(item.skipReason, planned) ?? item.skipReason}`
      );
    }
    if (item.executed != null) {
      lines.push(`- **Executed:** ${item.executed ? "yes" : "no"}`);
    }
    if (item.intentId) {
      lines.push(`- **Intent ID:** ${item.intentId}`);
    }
    lines.push(`- **Event ID:** ${item.eventId}`);

    for (const detail of formatPlannedDetails(planned)) {
      lines.push(`- ${detail}`);
    }

    lines.push("");
  });

  return lines.join("\n").trimEnd();
}
