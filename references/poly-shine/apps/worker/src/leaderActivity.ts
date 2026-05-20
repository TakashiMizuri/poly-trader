/** Polymarket Data API activity types we mirror (plus TRADE). */
export const INGEST_ACTIVITY_TYPES = ["TRADE", "MERGE", "SPLIT", "REDEEM"] as const;

export type IngestActivityType = (typeof INGEST_ACTIVITY_TYPES)[number];

export function isCtfActivitySide(side: string): boolean {
  return side === "MERGE" || side === "SPLIT" || side === "REDEEM";
}

/** Map CTF ops to trade-like sides for line gates and proportional sizing. */
export function gateSideForActivity(side: string): string {
  if (side === "MERGE" || side === "REDEEM") return "SELL";
  if (side === "SPLIT") return "BUY";
  return side;
}

export function netLeaderSharesFromActivityFills(
  fills: Array<{ side: string; size: string | number }>
): number {
  let pos = 0;
  for (const e of fills) {
    const sz = Number(e.size);
    if (!Number.isFinite(sz)) continue;
    switch (e.side) {
      case "BUY":
      case "SPLIT":
        pos += sz;
        break;
      case "SELL":
      case "MERGE":
      case "REDEEM":
        pos -= sz;
        break;
      default:
        break;
    }
  }
  return Math.max(0, pos);
}

export function ctfMirrorDedupeKey(
  subscriptionId: string,
  params: {
    side: string;
    conditionId: string | null;
    txHash: string | null;
    size: string;
    tradeTimestamp: number;
  }
): string {
  const cond = params.conditionId ?? "unknown";
  const tx = params.txHash ?? "unknown";
  return `m:${subscriptionId}:ctf:${params.side}:${tx}:${cond}:${params.size}:${params.tradeTimestamp}`;
}
