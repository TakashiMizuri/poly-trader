namespace PolyTrader.Infrastructure.Polymarket;

public sealed record PolymarketRedeemBatchResult(
    int RedeemableFound,
    int RedeemAttempted,
    int RedeemSucceeded,
    IReadOnlyList<string> TransactionHashes,
    IReadOnlyList<string> RedeemedConditionIds);

public interface IPolymarketRedeemService
{
    /// <summary>Redeem all redeemable positions (Data API + on-chain CTF).</summary>
    Task<PolymarketRedeemBatchResult> TryRedeemAllRedeemableAsync(CancellationToken ct = default);

    /// <summary>Redeem a single resolved market by condition id.</summary>
    Task<CtfRedeemResult> TryRedeemConditionAsync(string conditionId, CancellationToken ct = default);
}
