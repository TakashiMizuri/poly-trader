import { DATA_API_BASE } from "./constants.js";
import { withFetchRetry } from "./fetch-retry.js";
import { isValidEthAddress, normalizeAddress } from "./polymarket-profile.js";

export type PolymarketPositionsSummary = {
  count: number;
  openCashPnl: number;
  openCurrentValue: number;
};

type PositionRow = {
  asset?: string;
  size?: number;
  conditionId?: string;
  cashPnl?: number;
  currentValue?: number;
};

export type PolymarketOpenPosition = {
  asset: string;
  size: number;
  conditionId: string | null;
};

/** Open outcome-token positions for a wallet (CLOB token id per row). */
export async function fetchPolymarketOpenPositions(userAddress: string): Promise<PolymarketOpenPosition[]> {
  const user = normalizeAddress(userAddress);
  if (!isValidEthAddress(user)) throw new Error("Invalid Ethereum address");

  const out: PolymarketOpenPosition[] = [];
  const limit = 500;
  let offset = 0;

  while (offset <= 10_000) {
    const url = new URL(`${DATA_API_BASE}/positions`);
    url.searchParams.set("user", user);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("sizeThreshold", "0");

    const res = await withFetchRetry(() => fetch(url, { signal: AbortSignal.timeout(30_000) }));
    if (!res.ok) throw new Error(`Positions HTTP ${res.status}`);

    const rows = (await res.json()) as PositionRow[];
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      const asset = row.asset?.trim();
      const size = Number(row.size);
      if (!asset || !Number.isFinite(size) || size <= 0) continue;
      out.push({
        asset,
        size,
        conditionId: row.conditionId?.trim() ?? null,
      });
    }

    if (rows.length < limit) break;
    offset += limit;
  }

  return out;
}

export async function fetchPolymarketPositionsSummary(
  userAddress: string
): Promise<PolymarketPositionsSummary> {
  const user = normalizeAddress(userAddress);
  if (!isValidEthAddress(user)) throw new Error("Invalid Ethereum address");

  const limit = 500;
  let offset = 0;
  let count = 0;
  let openCashPnl = 0;
  let openCurrentValue = 0;

  while (offset <= 10_000) {
    const url = new URL(`${DATA_API_BASE}/positions`);
    url.searchParams.set("user", user);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("sizeThreshold", "0");

    const res = await withFetchRetry(() => fetch(url, { signal: AbortSignal.timeout(30_000) }));
    if (!res.ok) throw new Error(`Positions HTTP ${res.status}`);

    const rows = (await res.json()) as PositionRow[];
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      count += 1;
      openCashPnl += Number(row.cashPnl) || 0;
      openCurrentValue += Number(row.currentValue) || 0;
    }

    if (rows.length < limit) break;
    offset += limit;
  }

  return { count, openCashPnl, openCurrentValue };
}
