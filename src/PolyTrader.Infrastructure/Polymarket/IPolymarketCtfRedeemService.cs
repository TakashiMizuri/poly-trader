namespace PolyTrader.Infrastructure.Polymarket;

public sealed record CtfRedeemResult(bool Success, string? TransactionHash, string? Error);

public interface IPolymarketCtfRedeemService
{
    bool IsConfigured { get; }

    Task<CtfRedeemResult> RedeemConditionAsync(string conditionId, CancellationToken ct = default);
}
