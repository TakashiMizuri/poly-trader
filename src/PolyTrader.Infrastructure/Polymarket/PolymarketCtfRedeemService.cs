using System.Numerics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Nethereum.Contracts;
using Nethereum.Contracts.ContractHandlers;
using Nethereum.Hex.HexConvertors.Extensions;
using Nethereum.Hex.HexTypes;
using Nethereum.Web3;
using Nethereum.Web3.Accounts;
using PolyTrader.Infrastructure.Options;
using PolyTrader.Infrastructure.Polymarket.Ctf;

namespace PolyTrader.Infrastructure.Polymarket;

public sealed class PolymarketCtfRedeemService : IPolymarketCtfRedeemService
{
    private readonly PolyTraderOptions _options;
    private readonly IPolymarketWalletResolver _wallet;
    private readonly ILogger<PolymarketCtfRedeemService> _logger;
    private readonly RedeemDedupCache _dedup = new();

    public PolymarketCtfRedeemService(
        IOptions<PolyTraderOptions> options,
        IPolymarketWalletResolver wallet,
        ILogger<PolymarketCtfRedeemService> logger)
    {
        _options = options.Value;
        _wallet = wallet;
        _logger = logger;
    }

    public bool IsConfigured => _wallet.IsPrivateKeyConfigured;

    public async Task<CtfRedeemResult> RedeemConditionAsync(string conditionId, CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            _logger.LogWarning("CTF redeem skipped: private key not configured");
            return new CtfRedeemResult(false, null, "missing_private_key");
        }

        if (!TryParseConditionId(conditionId, out var conditionBytes, out var normalizedId))
        {
            _logger.LogWarning("CTF redeem skipped: invalid condition id {ConditionId}", conditionId);
            return new CtfRedeemResult(false, null, "invalid_condition_id");
        }

        if (_dedup.WasRedeemedRecently(normalizedId))
        {
            _logger.LogInformation(
                "CTF redeem deduplicated for condition {ConditionId} (cached tx {TxHash})",
                normalizedId,
                _dedup.GetTxHash(normalizedId));
            return new CtfRedeemResult(true, _dedup.GetTxHash(normalizedId), null);
        }

        _logger.LogInformation("CTF redeem starting for condition {ConditionId}", normalizedId);

        try
        {
            var rpc = ResolvePolygonRpcUrl();
            var account = new Account(
                _options.PolymarketPrivateKey!,
                PolymarketCtfConstants.PolygonChainId);
            var web3 = new Web3(account, rpc);
            var handler = web3.Eth.GetContractHandler(PolymarketCtfConstants.CtfContractAddress);

            var function = new RedeemPositionsFunction
            {
                ConditionId = conditionBytes,
            };

            var estimate = await handler.EstimateGasAsync(function);
            function.Gas = new HexBigInteger(estimate.Value * 120 / 100);
            var receipt = await handler.SendRequestAndWaitForReceiptAsync(function);

            var txHash = receipt.TransactionHash;
            if (string.IsNullOrWhiteSpace(txHash))
            {
                return new CtfRedeemResult(false, null, "empty_tx_hash");
            }

            if (receipt.Status?.Value == 0)
            {
                _logger.LogWarning(
                    "CTF redeem reverted for condition {ConditionId} tx {TxHash}",
                    normalizedId,
                    txHash);
                return new CtfRedeemResult(false, txHash, "transaction_reverted");
            }

            _dedup.RecordSuccess(normalizedId, txHash);
            _logger.LogInformation(
                "CTF redeem succeeded for condition {ConditionId} tx {TxHash}",
                normalizedId,
                txHash);

            return new CtfRedeemResult(true, txHash, null);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "CTF redeem failed for condition {ConditionId}",
                conditionId);
            return new CtfRedeemResult(false, null, ex.Message);
        }
    }

    private string ResolvePolygonRpcUrl()
    {
        var configured = _options.PolymarketPolygonRpc?.Trim();
        if (string.IsNullOrWhiteSpace(configured))
        {
            return PolymarketCtfConstants.DefaultPolygonRpc;
        }

        if (Uri.TryCreate(configured, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            return configured;
        }

        _logger.LogWarning(
            "POLYMARKET_POLYGON_RPC must be a full http(s) URL (got {Rpc}); using {Default}",
            configured,
            PolymarketCtfConstants.DefaultPolygonRpc);
        return PolymarketCtfConstants.DefaultPolygonRpc;
    }

    private static bool TryParseConditionId(
        string conditionId,
        out byte[] bytes,
        out string normalized)
    {
        bytes = [];
        normalized = "";
        var hex = conditionId.Trim();
        if (hex.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            hex = hex[2..];
        }

        if (hex.Length != 64)
        {
            return false;
        }

        try
        {
            bytes = hex.HexToByteArray();
            if (bytes.Length != 32)
            {
                return false;
            }

            normalized = "0x" + hex.ToLowerInvariant();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private sealed class RedeemDedupCache
    {
        private readonly Dictionary<string, (string TxHash, DateTime At)> _success = new(StringComparer.OrdinalIgnoreCase);
        private readonly TimeSpan _ttl = TimeSpan.FromHours(24);

        public bool WasRedeemedRecently(string conditionId)
        {
            lock (_success)
            {
                if (!_success.TryGetValue(conditionId, out var entry))
                {
                    return false;
                }

                if (DateTime.UtcNow - entry.At > _ttl)
                {
                    _success.Remove(conditionId);
                    return false;
                }

                return true;
            }
        }

        public string? GetTxHash(string conditionId)
        {
            lock (_success)
            {
                return _success.TryGetValue(conditionId, out var entry) ? entry.TxHash : null;
            }
        }

        public void RecordSuccess(string conditionId, string txHash)
        {
            lock (_success)
            {
                _success[conditionId] = (txHash, DateTime.UtcNow);
            }
        }
    }
}
