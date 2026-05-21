using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace PolyTrader.Infrastructure.Polymarket;

public sealed class PolymarketRedeemService : IPolymarketRedeemService
{
    private const string DataApiBase = "https://data-api.polymarket.com";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IPolymarketWalletResolver _wallet;
    private readonly IPolymarketCtfRedeemService _ctf;
    private readonly ILogger<PolymarketRedeemService> _logger;

    public PolymarketRedeemService(
        IHttpClientFactory httpClientFactory,
        IPolymarketWalletResolver wallet,
        IPolymarketCtfRedeemService ctf,
        ILogger<PolymarketRedeemService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _wallet = wallet;
        _ctf = ctf;
        _logger = logger;
    }

    public Task<CtfRedeemResult> TryRedeemConditionAsync(
        string conditionId,
        CancellationToken ct = default) =>
        _ctf.RedeemConditionAsync(conditionId, ct);

    public async Task<PolymarketRedeemBatchResult> TryRedeemAllRedeemableAsync(CancellationToken ct = default)
    {
        var address = _wallet.ResolveWalletAddress();
        if (string.IsNullOrWhiteSpace(address) || !_ctf.IsConfigured)
        {
            _logger.LogDebug(
                "Auto-redeem batch skipped (wallet={HasWallet}, ctf={CtfConfigured})",
                !string.IsNullOrWhiteSpace(address),
                _ctf.IsConfigured);
            return new PolymarketRedeemBatchResult(0, 0, 0, [], []);
        }

        _logger.LogInformation("Auto-redeem batch starting for wallet {Wallet}", address);

        var conditionIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var client = _httpClientFactory.CreateClient();
            var url =
                $"{DataApiBase}/positions?user={Uri.EscapeDataString(address)}&limit=500&offset=0&sizeThreshold=0&redeemable=true";
            var json = await client.GetStringAsync(url, ct);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var row in doc.RootElement.EnumerateArray())
                {
                    var redeemable = row.TryGetProperty("redeemable", out var r)
                        && r.ValueKind == JsonValueKind.True;
                    if (!redeemable)
                    {
                        continue;
                    }

                    var conditionId = ReadConditionId(row);
                    if (!string.IsNullOrWhiteSpace(conditionId))
                    {
                        conditionIds.Add(conditionId);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch redeemable positions for {Wallet}", address);
            return new PolymarketRedeemBatchResult(0, 0, 0, [], []);
        }

        var txHashes = new List<string>();
        var redeemedConditionIds = new List<string>();
        var attempted = 0;
        var succeeded = 0;

        _logger.LogInformation(
            "Auto-redeem found {Count} redeemable condition(s) for {Wallet}",
            conditionIds.Count,
            address);

        foreach (var conditionId in conditionIds)
        {
            attempted++;
            _logger.LogInformation(
                "Auto-redeem attempting condition {ConditionId} ({Index}/{Total})",
                conditionId,
                attempted,
                conditionIds.Count);
            var result = await _ctf.RedeemConditionAsync(conditionId, ct);
            if (result.Success && !string.IsNullOrWhiteSpace(result.TransactionHash))
            {
                succeeded++;
                txHashes.Add(result.TransactionHash);
                redeemedConditionIds.Add(conditionId);
                _logger.LogInformation(
                    "Redeemed condition {ConditionId} tx {TxHash}",
                    conditionId,
                    result.TransactionHash);
            }
            else if (result.Error != null)
            {
                _logger.LogWarning(
                    "Redeem failed for {ConditionId}: {Error}",
                    conditionId,
                    result.Error);
            }

            await Task.Delay(500, ct);
        }

        if (succeeded > 0)
        {
            _logger.LogInformation(
                "Auto-redeem: {Succeeded}/{Attempted} conditions for {Wallet}",
                succeeded,
                attempted,
                address);
        }

        return new PolymarketRedeemBatchResult(
            conditionIds.Count,
            attempted,
            succeeded,
            txHashes,
            redeemedConditionIds);
    }

    private static string? ReadConditionId(JsonElement row)
    {
        if (row.TryGetProperty("conditionId", out var camel) && camel.ValueKind == JsonValueKind.String)
        {
            return camel.GetString()?.Trim();
        }

        if (row.TryGetProperty("condition_id", out var snake) && snake.ValueKind == JsonValueKind.String)
        {
            return snake.GetString()?.Trim();
        }

        return null;
    }
}
