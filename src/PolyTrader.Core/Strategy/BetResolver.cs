using PolyTrader.Core.Models;

namespace PolyTrader.Core.Strategy;

/// <summary>
/// Blend fade 2 bet at bar open (1:1 with trading-cursor-models strategies/blend_fade2).
/// </summary>
public static class BetResolver
{
    public static MarketTrend? ResolveAtOpen(
        int index,
        IReadOnlyList<ChartCandle> candles,
        BlendFade2Config? config = null) =>
        BlendFade2Signals.ResolveAtOpen(index, candles, config);

    public static MarketTrend? ResolveForUpcomingBar(
        IReadOnlyList<ChartCandle> candles,
        long nextBarOpenTimeMs,
        BlendFade2Config? config = null) =>
        BlendFade2Signals.ResolveAtOpen(candles.Count, candles, config, nextBarOpenTimeMs);
}
