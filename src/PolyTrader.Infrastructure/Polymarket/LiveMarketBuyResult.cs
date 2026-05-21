namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>Result of a live CLOB market buy (IOC — partial fills allowed).</summary>
public sealed record LiveMarketBuyResult(
    string OrderId,
    double MatchedShares,
    double? AveragePrice,
    double RequestedStakeUsd,
    double FilledStakeUsd)
{
    /// <summary>True when filled notional is materially below the requested USD size.</summary>
    public bool IsPartialFill => FilledStakeUsd + 0.01 < RequestedStakeUsd;
}
