import {
  fetchTradeMarketsByAssets,
  mergeTradeMarket,
  tradeMarketFromRaw,
  type TradeMarketDisplay,
} from "@poly-shine/shared";

export type MarketEnrichInput = {
  asset: string;
  raw: Record<string, unknown> | null;
};

export type MarketEnriched = TradeMarketDisplay;

export async function enrichMarketsForAssets(
  items: MarketEnrichInput[]
): Promise<Map<string, MarketEnriched>> {
  const byAsset = new Map<string, TradeMarketDisplay>();
  for (const item of items) {
    if (!item.asset || byAsset.has(item.asset)) continue;
    byAsset.set(item.asset, tradeMarketFromRaw(item.raw));
  }

  const assets = [...byAsset.keys()];
  const gamma = assets.length > 0 ? await fetchTradeMarketsByAssets(assets) : new Map();

  const out = new Map<string, MarketEnriched>();
  for (const [asset, fromRaw] of byAsset) {
    out.set(asset, mergeTradeMarket(asset, fromRaw, gamma));
  }
  return out;
}

export function marketFields(
  asset: string,
  raw: Record<string, unknown> | null,
  cache: Map<string, MarketEnriched>
) {
  const meta = cache.get(asset) ?? tradeMarketFromRaw(raw);
  return {
    marketTitle: meta.title,
    marketIcon: meta.icon,
    marketOutcome: meta.outcome,
    marketSlug: meta.slug,
    marketClosed: meta.closed === true,
    marketStartAt: meta.startAt,
    marketEndAt: meta.endAt,
  };
}
