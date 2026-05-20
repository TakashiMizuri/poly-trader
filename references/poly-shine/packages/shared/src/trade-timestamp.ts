/** Values below this are treated as Unix seconds; at or above as Unix milliseconds. */
const MS_EPOCH_CUTOFF = 1e12;

export function tradeTimestampToMs(ts: number): number {
  if (!Number.isFinite(ts)) return 0;
  return ts < MS_EPOCH_CUTOFF ? ts * 1000 : ts;
}

/**
 * Polymarket Data API `timestamp` is whole seconds. Add a 0–999 ms offset so fills in
 * the same second remain ordered and display with non-zero milliseconds.
 */
export function normalizeTradeTimestampFromApi(apiTs: number, subMsOffset = 0): number {
  const baseMs = tradeTimestampToMs(apiTs);
  if (baseMs % 1000 !== 0) return baseMs;
  const offset = Math.max(0, Math.min(999, Math.floor(subMsOffset)));
  return baseMs + offset;
}

/** Backfill second-precision rows using ISO `created_at` milliseconds. */
export function tradeTimestampMsFromCreatedAt(tradeTs: number, createdAtIso: string): number {
  const baseMs = tradeTimestampToMs(tradeTs);
  if (baseMs % 1000 !== 0) return baseMs;
  const parsed = Date.parse(createdAtIso);
  if (Number.isNaN(parsed)) return baseMs;
  return baseMs + (parsed % 1000);
}
