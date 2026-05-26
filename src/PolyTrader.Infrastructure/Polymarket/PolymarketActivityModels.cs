namespace PolyTrader.Infrastructure.Polymarket;

public sealed record PolymarketActivityEvent(
    long TimestampUnix,
    string? Type,
    string? Side,
    double UsdcSize,
    string? ConditionId,
    string? EventSlug,
    string? Slug);

/// <summary>USDC flows for one Polymarket condition / event (wallet perspective).</summary>
public sealed class PolymarketMarketCashSummary
{
    public double BuyUsdc { get; set; }
    public double SellUsdc { get; set; }
    public double RedeemUsdc { get; set; }
    public double RebateUsdc { get; set; }
    public bool HasRedeem { get; set; }
    public long? LastRedeemTimestampUnix { get; set; }

    /// <summary>Net USDC: −BUY + SELL + REDEEM + rebates.</summary>
    public double NetUsdc => -BuyUsdc + SellUsdc + RedeemUsdc + RebateUsdc;
}

public sealed class LiveTradeReconcileResult
{
    public int TradesChecked { get; init; }
    public int OutcomesCorrected { get; init; }
    public int RedeemedAtSynced { get; init; }
    public int SettledFromOpen { get; init; }
}
