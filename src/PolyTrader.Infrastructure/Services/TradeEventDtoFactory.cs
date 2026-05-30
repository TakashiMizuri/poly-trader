using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Entities;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

internal static class TradeEventDtoFactory
{
    public static object FromEntity(TradeEntity t) => new
    {
        t.Id,
        t.CandleTime,
        side = t.Side.ToString(),
        trend = t.Trend.ToString(),
        mode = t.Mode.ToString(),
        t.StakeUsd,
        requestedStakeUsd = t.RequestedStakeUsd,
        isPartialFill = t.RequestedStakeUsd is > 0
            && t.RequestedStakeUsd.Value > t.StakeUsd + 0.01,
        t.StakeBalanceUsd,
        betStakeMode = t.BetStakeMode?.ToString(),
        t.BetStakePercent,
        t.BetStakeFixedUsd,
        t.EntryPrice,
        entryShares = TrendBetStrategySimulator.ComputeEntryShares(t.StakeUsd, t.EntryPrice),
        t.Won,
        t.PnlUsd,
        t.WinPayoutRatio,
        settlementStatus = t.SettlementStatus.ToString().ToLowerInvariant(),
        t.SettlementSource,
        t.PaperAccountId,
        t.PolymarketOrderId,
        entryWaves = TradeEntryWavesJson.Deserialize(t.EntryWavesJson)?.Select(w => new
        {
            wave = w.Wave,
            label = w.Label,
            requestedUsd = w.RequestedUsd,
            filledUsd = w.FilledUsd,
            fillPercent = w.FillPercent,
            entryPrice = w.EntryPrice,
            orderId = w.OrderId,
        }),
        market = t.Market == null
            ? null
            : new
            {
                t.Market.Title,
                t.Market.Slug,
                windowStartUtc = t.Market.WindowStartUtc,
                windowEndUtc = t.Market.WindowEndUtc,
            },
        t.CreatedAt,
    };
}
