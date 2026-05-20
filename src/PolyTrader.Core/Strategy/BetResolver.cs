using PolyTrader.Core.Models;

namespace PolyTrader.Core.Strategy;

/// <summary>
/// BoS flow bet at bar open (1:1 with trading-cursor-models strategies/bos_flow).
/// </summary>
public static class BetResolver
{
    public static MarketTrend? ResolveAtOpen(
        int index,
        IReadOnlyList<ChartCandle> candles,
        BosFlowConfig? config = null) =>
        BosFlowSignals.ResolveAtOpen(index, candles, config);

    public static MarketTrend? ResolveForUpcomingBar(
        IReadOnlyList<ChartCandle> candles,
        long nextBarOpenTimeMs,
        BosFlowConfig? config = null) =>
        BosFlowSignals.ResolveAtOpen(candles.Count, candles, config, nextBarOpenTimeMs);
}
