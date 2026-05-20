import { DATA_API_BASE } from "./constants.js";
import { normalizeAddress, isValidEthAddress } from "./polymarket-profile.js";
import { withFetchRetry } from "./fetch-retry.js";

export type MarketParticipant = {
  address: string;
  /** Outcome-token size in this market when known (holders API). */
  marketStake: number | null;
  displayName: string | null;
  sources: ("holder" | "trade")[];
};

type HolderRow = {
  proxyWallet?: string;
  amount?: number;
  name?: string;
  pseudonym?: string;
};

type MetaHolder = {
  token?: string;
  holders?: HolderRow[];
};

type TradeRow = {
  proxyWallet?: string;
};

const TRADE_PAGES = 3;
const TRADES_PER_PAGE = 100;

async function fetchHolders(conditionId: string): Promise<MarketParticipant[]> {
  const url = new URL(`${DATA_API_BASE}/holders`);
  url.searchParams.set("market", conditionId);
  url.searchParams.set("limit", "20");

  const res = await withFetchRetry(() => fetch(url, { signal: AbortSignal.timeout(20_000) }));
  if (!res.ok) throw new Error(`Holders HTTP ${res.status}`);

  const groups = (await res.json()) as MetaHolder[];
  const out: MarketParticipant[] = [];

  for (const group of groups) {
    for (const h of group.holders ?? []) {
      const addr = h.proxyWallet?.trim();
      if (!addr || !isValidEthAddress(addr)) continue;
      const amount = Number(h.amount);
      out.push({
        address: normalizeAddress(addr),
        marketStake: Number.isFinite(amount) ? amount : null,
        displayName: h.name?.trim() || h.pseudonym?.trim() || null,
        sources: ["holder"],
      });
    }
  }
  return out;
}

async function fetchTradePage(conditionId: string, offset: number): Promise<TradeRow[]> {
  const url = new URL(`${DATA_API_BASE}/trades`);
  url.searchParams.set("market", conditionId);
  url.searchParams.set("limit", String(TRADES_PER_PAGE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("takerOnly", "false");

  const res = await withFetchRetry(() => fetch(url, { signal: AbortSignal.timeout(20_000) }));
  if (!res.ok) throw new Error(`Trades HTTP ${res.status}`);
  const rows = (await res.json()) as TradeRow[];
  return Array.isArray(rows) ? rows : [];
}

/** Wallets seen on a market via top holders and recent trades. */
export async function fetchMarketParticipants(conditionId: string): Promise<MarketParticipant[]> {
  const [holders, ...tradePages] = await Promise.all([
    fetchHolders(conditionId).catch(() => [] as MarketParticipant[]),
    ...Array.from({ length: TRADE_PAGES }, (_, i) =>
      fetchTradePage(conditionId, i * TRADES_PER_PAGE).catch(() => [] as TradeRow[])
    ),
  ]);

  const byAddress = new Map<string, MarketParticipant>();

  const merge = (p: MarketParticipant) => {
    const existing = byAddress.get(p.address);
    if (!existing) {
      byAddress.set(p.address, { ...p, sources: [...p.sources] });
      return;
    }
    if (p.marketStake != null && (existing.marketStake == null || p.marketStake > existing.marketStake)) {
      existing.marketStake = p.marketStake;
    }
    if (!existing.displayName && p.displayName) existing.displayName = p.displayName;
    for (const s of p.sources) {
      if (!existing.sources.includes(s)) existing.sources.push(s);
    }
  };

  for (const p of holders) merge(p);

  for (const page of tradePages) {
    for (const t of page) {
      const addr = t.proxyWallet?.trim();
      if (!addr || !isValidEthAddress(addr)) continue;
      merge({
        address: normalizeAddress(addr),
        marketStake: null,
        displayName: null,
        sources: ["trade"],
      });
    }
  }

  return [...byAddress.values()];
}
