namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>Result of a live CLOB entry buy (maker limit or IOC — partial fills allowed).</summary>
public sealed record LiveMarketBuyResult(
    string OrderId,
    double MatchedShares,
    double? AveragePrice,
    double RequestedStakeUsd,
    double FilledStakeUsd,
    IReadOnlyList<LiveEntryWaveFill>? EntryWaves = null)
{
    /// <summary>True when filled notional is materially below the requested USD size.</summary>
    public bool IsPartialFill => FilledStakeUsd + 0.01 < RequestedStakeUsd;
}
