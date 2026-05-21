namespace PolyTrader.Infrastructure.Polymarket;

/// <summary>Result of attempting a live CLOB market buy (IOC).</summary>
public sealed record LiveMarketBuyOutcome(
    LiveMarketBuyResult? Result,
    string? FailureReason)
{
    public bool IsSuccess => Result != null;

    public static LiveMarketBuyOutcome Ok(LiveMarketBuyResult result) => new(result, null);

    public static LiveMarketBuyOutcome Fail(string reason) => new(null, reason);
}
