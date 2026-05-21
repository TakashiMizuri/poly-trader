using System.Collections.Concurrent;
using System.Net;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Polymarket.Net.Clients;
using Polymarket.Net.Enums;
using Polymarket.Net.Objects.Models;
using Polymarket.Net;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Infrastructure.Polymarket;

public sealed class PolymarketRestTradingClient : IPolymarketRestTradingClient
{
    /// <summary>Minimum filled outcome shares to treat the order as successful (small $1 bets are ~2 shares).</summary>
    public const double MinMatchedShares = 0.01;

    private const int TransientRetryCount = 5;
    private static readonly TimeSpan TransientRetryDelay = TimeSpan.FromSeconds(1);

    private readonly PolyTraderOptions _options;
    private readonly IPolymarketWalletResolver _wallet;
    private readonly ILogger<PolymarketRestTradingClient> _logger;
    private readonly SemaphoreSlim _initLock = new(1, 1);
    private readonly SemaphoreSlim _balanceLock = new(1, 1);
    private PolymarketRestClient? _client;
    private double? _lastGoodBalanceUsd;
    private DateTime _lastGoodBalanceUtc;
    private readonly ConcurrentDictionary<long, string> _orderIdByClientOrderId = new();
    private static readonly TimeSpan FreshBalanceTtl = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan StaleBalanceTtl = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan EntryRecoveryLookback = TimeSpan.FromMinutes(2);

    public PolymarketRestTradingClient(
        IOptions<PolyTraderOptions> options,
        IPolymarketWalletResolver wallet,
        ILogger<PolymarketRestTradingClient> logger)
    {
        _options = options.Value;
        _wallet = wallet;
        _logger = logger;
    }

    public bool IsConfigured => _wallet.IsPrivateKeyConfigured;

    public async Task<double?> GetCollateralBalanceUsdAsync(
        CancellationToken ct = default,
        int maxAttempts = 5)
    {
        if (maxAttempts < 1)
        {
            maxAttempts = 1;
        }

        if (_lastGoodBalanceUsd is { } fresh
            && DateTime.UtcNow - _lastGoodBalanceUtc < FreshBalanceTtl)
        {
            return fresh;
        }

        try
        {
            await _balanceLock.WaitAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return TryReturnStaleBalance();
        }

        try
        {
            if (_lastGoodBalanceUsd is { } cached
                && DateTime.UtcNow - _lastGoodBalanceUtc < FreshBalanceTtl)
            {
                return cached;
            }

            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                ct.ThrowIfCancellationRequested();

                var (fetched, retryable) = await FetchCollateralBalanceOnceAsync(ct);
                if (fetched is { } usd)
                {
                    _lastGoodBalanceUsd = usd;
                    _lastGoodBalanceUtc = DateTime.UtcNow;
                    return usd;
                }

                if (!retryable || attempt >= maxAttempts)
                {
                    break;
                }

                _logger.LogDebug(
                    "CLOB balance attempt {Attempt}/{Max} failed; retrying in {DelaySeconds}s",
                    attempt,
                    maxAttempts,
                    TransientRetryDelay.TotalSeconds);

                try
                {
                    await Task.Delay(TransientRetryDelay, ct);
                }
                catch (OperationCanceledException)
                {
                    return TryReturnStaleBalance();
                }
            }

            return TryReturnStaleBalance(logOnUse: true) ?? null;
        }
        finally
        {
            _balanceLock.Release();
        }
    }

    private double? TryReturnStaleBalance(bool logOnUse = false)
    {
        if (_lastGoodBalanceUsd is not { } stale
            || DateTime.UtcNow - _lastGoodBalanceUtc >= StaleBalanceTtl)
        {
            return null;
        }

        if (logOnUse)
        {
            _logger.LogWarning(
                "CLOB balance fetch failed; using last known ${Balance:F2} from {AgeSeconds:F0}s ago",
                stale,
                (DateTime.UtcNow - _lastGoodBalanceUtc).TotalSeconds);
        }

        return stale;
    }

    private async Task<(double? Balance, bool Retryable)> FetchCollateralBalanceOnceAsync(
        CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        if (client == null)
        {
            return (null, false);
        }

        try
        {
            var result = await client.ClobApi.Account.GetBalanceAllowanceAsync(
                AssetType.Collateral,
                tokenId: string.Empty,
                ct);

            if (!result.Success || result.Data == null)
            {
                _logger.LogWarning("CLOB balance failed: {Error}", result.Error);
                return (null, IsRetryableClobErrorMessage(result.Error?.Message));
            }

            if (result.Data.BalanceUsd is >= 0)
            {
                return ((double)result.Data.BalanceUsd, true);
            }

            if (result.Data.Balance is >= 0)
            {
                return ((double)result.Data.Balance / 1_000_000d, true);
            }

            return (null, true);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "CLOB balance fetch failed");
            return (null, !IsNonRetryableClobError(ex));
        }
    }

    private static bool IsNonRetryableClobError(Exception ex)
    {
        for (var current = ex; current != null; current = current.InnerException)
        {
            if (IsNonRetryableClobMessage(current.Message))
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsRetryableClobErrorMessage(string? message) =>
        !IsNonRetryableClobMessage(message);

    private static bool IsNonRetryableClobMessage(string? message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return false;
        }

        return message.Contains("Layer 2 credentials", StringComparison.OrdinalIgnoreCase)
            || message.Contains("authenticate request", StringComparison.OrdinalIgnoreCase)
            || message.Contains("API credentials", StringComparison.OrdinalIgnoreCase)
            || message.Contains("not configured", StringComparison.OrdinalIgnoreCase);
    }

    public async Task<LiveMarketBuyOutcome> PlaceMarketBuyUsdAsync(
        string tokenId,
        double stakeUsd,
        double? entryPriceHint = null,
        LiveEntryOrderKey? entryKey = null,
        CancellationToken ct = default)
    {
        if (stakeUsd < 0.01)
        {
            var minStakeReason = $"Stake ${stakeUsd:F2} below minimum ($0.01)";
            _logger.LogWarning("{Reason}", minStakeReason);
            return LiveMarketBuyOutcome.Fail(minStakeReason);
        }

        var client = await GetClientAsync(ct);
        if (client == null)
        {
            const string clientReason =
                "CLOB trading client unavailable (check private key, signature type, and funder address)";
            _logger.LogWarning("Market buy aborted for {TokenId}: {Reason}", tokenId, clientReason);
            return LiveMarketBuyOutcome.Fail(clientReason);
        }

        var clientOrderId = entryKey?.DeriveClientOrderId();
        string? lastReason = null;

        for (var attempt = 1; attempt <= TransientRetryCount; attempt++)
        {
            var outcome = await PlaceMarketBuyUsdAttemptAsync(
                client,
                tokenId,
                stakeUsd,
                entryPriceHint,
                clientOrderId,
                ct);

            if (outcome.IsSuccess)
            {
                return outcome;
            }

            lastReason = outcome.FailureReason;

            if (entryKey != null && clientOrderId is long salt)
            {
                var recovered = await TryRecoverEntryOrderAsync(
                    client,
                    salt,
                    entryKey,
                    tokenId,
                    stakeUsd,
                    entryPriceHint,
                    ct);
                if (recovered is { IsSuccess: true })
                {
                    _logger.LogInformation(
                        "Recovered live entry order for candle {CandleTime} token {TokenId} (attempt {Attempt})",
                        entryKey.CandleTimeMs,
                        tokenId,
                        attempt);
                    return recovered;
                }
            }

            if (IsDuplicateFailure(lastReason))
            {
                const string duplicateReason =
                    "CLOB reported duplicate order but existing fill could not be recovered (no double-place retry)";
                _logger.LogError(
                    "{Reason} candle {CandleTime} token {TokenId}",
                    duplicateReason,
                    entryKey?.CandleTimeMs,
                    tokenId);
                return LiveMarketBuyOutcome.Fail(duplicateReason);
            }

            if (!IsTransientFailure(lastReason) || attempt == TransientRetryCount)
            {
                return outcome;
            }

            _logger.LogWarning(
                "Market buy attempt {Attempt}/{Max} for {TokenId} ${Stake:F2} failed ({Reason}); retrying in {DelaySeconds}s",
                attempt,
                TransientRetryCount,
                tokenId,
                stakeUsd,
                lastReason,
                TransientRetryDelay.TotalSeconds);
            await Task.Delay(TransientRetryDelay, ct);
        }

        return LiveMarketBuyOutcome.Fail(lastReason ?? "Market buy failed after retries");
    }

    private async Task<LiveMarketBuyOutcome> PlaceMarketBuyUsdAttemptAsync(
        PolymarketRestClient client,
        string tokenId,
        double stakeUsd,
        double? entryPriceHint,
        long? clientOrderId,
        CancellationToken ct)
    {
        try
        {
            var place = await client.ClobApi.Trading.PlaceOrderAsync(
                tokenId,
                OrderSide.Buy,
                OrderType.Market,
                quantity: (decimal)stakeUsd,
                price: null,
                timeInForce: TimeInForce.ImmediateOrCancel,
                postOnly: null,
                clientOrderId: clientOrderId,
                expiration: null,
                quantityType: QuantityType.Value,
                ct: ct);

            if (!place.Success || place.Data == null)
            {
                var placeReason = FormatApiError(place.Error)
                    ?? FormatApiError(place.Data?.Error)
                    ?? "Order placement rejected by CLOB";
                if (!IsTransientFailure(placeReason) && !IsDuplicateFailure(placeReason))
                {
                    _logger.LogWarning(
                        "Market buy failed for {TokenId} ${Stake:F2}: {Reason}",
                        tokenId,
                        stakeUsd,
                        placeReason);
                }

                return LiveMarketBuyOutcome.Fail(placeReason);
            }

            if (place.Data.Success == false)
            {
                var placeReason = FormatApiError(place.Data.Error) ?? "Order placement rejected by CLOB";
                return LiveMarketBuyOutcome.Fail(placeReason);
            }

            var orderId = place.Data.OrderId;
            if (string.IsNullOrWhiteSpace(orderId))
            {
                const string noIdReason = "Order placement returned no order id";
                _logger.LogWarning("{Reason} for token {TokenId}", noIdReason, tokenId);
                return LiveMarketBuyOutcome.Fail(noIdReason);
            }

            if (clientOrderId is long salt)
            {
                _orderIdByClientOrderId[salt] = orderId;
            }

            return await BuildOutcomeFromOrderIdAsync(
                client,
                orderId,
                tokenId,
                stakeUsd,
                entryPriceHint,
                ct);
        }
        catch (Exception ex)
        {
            if (clientOrderId is long salt
                && _orderIdByClientOrderId.TryGetValue(salt, out var cachedOrderId))
            {
                var recovered = await BuildOutcomeFromOrderIdAsync(
                    client,
                    cachedOrderId,
                    tokenId,
                    stakeUsd,
                    entryPriceHint,
                    ct);
                if (recovered.IsSuccess)
                {
                    _logger.LogInformation(
                        "Recovered market buy from cached order id {OrderId} after exception",
                        cachedOrderId);
                    return recovered;
                }
            }

            if (IsTransientException(ex))
            {
                _logger.LogWarning(ex, "Transient error placing market buy for token {TokenId}", tokenId);
            }
            else
            {
                _logger.LogError(ex, "PlaceMarketBuyUsd failed for token {TokenId}", tokenId);
            }

            return LiveMarketBuyOutcome.Fail(ex.Message);
        }
    }

    private async Task<LiveMarketBuyOutcome> BuildOutcomeFromOrderIdAsync(
        PolymarketRestClient client,
        string orderId,
        string tokenId,
        double stakeUsd,
        double? entryPriceHint,
        CancellationToken ct)
    {
        var (matched, avgPrice, terminalStatus) = await WaitForFillAsync(client, orderId, ct);
        var filledStake = ComputeFilledStakeUsd(matched, avgPrice, entryPriceHint, stakeUsd);
        if (matched < MinMatchedShares)
        {
            var fillReason = terminalStatus is { } status
                ? $"Insufficient fill on order {orderId}: {matched:F4} shares (status {status}, min {MinMatchedShares:F2})"
                : $"Insufficient fill on order {orderId}: {matched:F4} shares (min {MinMatchedShares:F2})";
            _logger.LogWarning("{Reason}", fillReason);
            return LiveMarketBuyOutcome.Fail(fillReason);
        }

        var result = new LiveMarketBuyResult(orderId, matched, avgPrice, stakeUsd, filledStake);
        if (result.IsPartialFill)
        {
            _logger.LogWarning(
                "Live market buy partially filled order {OrderId} token {TokenId}: ${Filled:F2} of ${Requested:F2} ({Matched:F4} shares @ {Price:F4})",
                orderId,
                tokenId,
                filledStake,
                stakeUsd,
                matched,
                avgPrice ?? entryPriceHint ?? 0);
        }
        else
        {
            _logger.LogInformation(
                "Live market buy filled order {OrderId} token {TokenId} {Matched:F4} shares for ${Stake:F2}",
                orderId,
                tokenId,
                matched,
                stakeUsd);
        }

        return LiveMarketBuyOutcome.Ok(result);
    }

    private async Task<LiveMarketBuyOutcome?> TryRecoverEntryOrderAsync(
        PolymarketRestClient client,
        long clientOrderId,
        LiveEntryOrderKey entryKey,
        string tokenId,
        double stakeUsd,
        double? entryPriceHint,
        CancellationToken ct)
    {
        if (_orderIdByClientOrderId.TryGetValue(clientOrderId, out var cachedOrderId))
        {
            var fromCache = await BuildOutcomeFromOrderIdAsync(
                client,
                cachedOrderId,
                tokenId,
                stakeUsd,
                entryPriceHint,
                ct);
            if (fromCache.IsSuccess)
            {
                return fromCache;
            }
        }

        var candleStart = DateTimeOffset.FromUnixTimeMilliseconds(entryKey.CandleTimeMs).UtcDateTime;

        var openOrders = await client.ClobApi.Trading.GetOpenOrdersAsync(
            orderId: null,
            marketId: null,
            tokenId: tokenId,
            cursor: null,
            ct: ct);
        if (openOrders.Success && openOrders.Data?.Data is { } orders)
        {
            var buyOrderId = SelectRecoveryBuyOrderId(orders, candleStart);
            if (buyOrderId != null)
            {
                _orderIdByClientOrderId[clientOrderId] = buyOrderId;
                var fromOpen = await BuildOutcomeFromOrderIdAsync(
                    client,
                    buyOrderId,
                    tokenId,
                    stakeUsd,
                    entryPriceHint,
                    ct);
                if (fromOpen.IsSuccess)
                {
                    return fromOpen;
                }
            }
        }

        var tradeLookbackStart = candleStart.Subtract(EntryRecoveryLookback);
        var trades = await client.ClobApi.Trading.GetUserTradesAsync(
            tradeId: null,
            makerAddress: null,
            marketId: null,
            tokenId: tokenId,
            startTime: tradeLookbackStart,
            endTime: null,
            cursor: null,
            ct: ct);
        if (trades.Success && trades.Data?.Data is { } tradeList)
        {
            var takerOrderId = SelectRecoveryTakerOrderId(tradeList, candleStart);
            if (takerOrderId != null)
            {
                _orderIdByClientOrderId[clientOrderId] = takerOrderId;
                return await BuildOutcomeFromOrderIdAsync(
                    client,
                    takerOrderId,
                    tokenId,
                    stakeUsd,
                    entryPriceHint,
                    ct);
            }
        }

        return null;
    }

    private static string? SelectRecoveryBuyOrderId(
        IEnumerable<PolymarketOrder> orders,
        DateTime candleStartUtc)
    {
        PolymarketOrder? best = null;
        foreach (var order in orders)
        {
            if (order.Side != OrderSide.Buy)
            {
                continue;
            }

            if (order.CreateTime < candleStartUtc.AddSeconds(-30))
            {
                continue;
            }

            if (best == null || order.CreateTime > best.CreateTime)
            {
                best = order;
            }
        }

        return best?.OrderId;
    }

    private static string? SelectRecoveryTakerOrderId(
        IEnumerable<PolymarketTrade> trades,
        DateTime candleStartUtc)
    {
        PolymarketTrade? best = null;
        foreach (var trade in trades)
        {
            if (trade.Side != OrderSide.Buy)
            {
                continue;
            }

            if (trade.MatchTime < candleStartUtc.AddSeconds(-30))
            {
                continue;
            }

            if (string.IsNullOrWhiteSpace(trade.TakerOrderId))
            {
                continue;
            }

            if (best == null || trade.MatchTime > best.MatchTime)
            {
                best = trade;
            }
        }

        return best?.TakerOrderId;
    }

    private static bool IsDuplicateFailure(string? reason)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            return false;
        }

        var r = reason.ToLowerInvariant();
        return r.Contains("duplicated", StringComparison.Ordinal)
            || r.Contains("duplicate", StringComparison.Ordinal);
    }

    private static bool IsTransientFailure(string? reason)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            return false;
        }

        var r = reason.ToLowerInvariant();
        if (r.Contains("insufficient fill", StringComparison.Ordinal))
        {
            return false;
        }

        return r.Contains("timeout", StringComparison.Ordinal)
            || r.Contains("timed out", StringComparison.Ordinal)
            || r.Contains("networkerror", StringComparison.Ordinal)
            || r.Contains("network error", StringComparison.Ordinal)
            || r.Contains("connection", StringComparison.Ordinal)
            || r.Contains("socket", StringComparison.Ordinal)
            || r.Contains("host unreachable", StringComparison.Ordinal)
            || r.Contains("no such host", StringComparison.Ordinal)
            || r.Contains("ssl", StringComparison.Ordinal)
            || r.Contains("429", StringComparison.Ordinal)
            || r.Contains("503", StringComparison.Ordinal)
            || r.Contains("502", StringComparison.Ordinal)
            || r.Contains("504", StringComparison.Ordinal);
    }

    private static bool IsTransientException(Exception ex) =>
        ex is HttpRequestException or TaskCanceledException or IOException
        || IsTransientFailure(ex.Message);

    private static double ComputeFilledStakeUsd(
        double matchedShares,
        double? averagePrice,
        double? entryPriceHint,
        double requestedStakeUsd)
    {
        if (matchedShares <= 0)
        {
            return 0;
        }

        var price = averagePrice is > 0 and <= 1
            ? averagePrice.Value
            : entryPriceHint is > 0 and <= 1
                ? entryPriceHint.Value
                : 0.5;
        var filled = matchedShares * price;
        return Math.Min(requestedStakeUsd, filled);
    }

    private static string? FormatApiError(object? error)
    {
        if (error == null) return null;
        var text = error.ToString()?.Trim();
        return string.IsNullOrWhiteSpace(text) ? null : text;
    }

    public async Task<double?> GetOrderMatchedSharesAsync(string orderId, CancellationToken ct = default)
    {
        var client = await GetClientAsync(ct);
        if (client == null)
        {
            return null;
        }

        try
        {
            var order = await client.ClobApi.Trading.GetOrderAsync(orderId, ct);
            if (!order.Success || order.Data == null)
            {
                return null;
            }

            return (double)order.Data.QuantityFilled;
        }
        catch
        {
            return null;
        }
    }

    private async Task<(double MatchedShares, double? AveragePrice, OrderStatus? TerminalStatus)> WaitForFillAsync(
        PolymarketRestClient client,
        string orderId,
        CancellationToken ct)
    {
        _logger.LogDebug("Waiting for fill on order {OrderId}", orderId);
        OrderStatus? terminalStatus = null;
        for (var i = 0; i < 20; i++)
        {
            var order = await client.ClobApi.Trading.GetOrderAsync(orderId, ct);
            if (order.Success && order.Data != null)
            {
                var matched = (double)order.Data.QuantityFilled;

                var avgPrice = order.Data.Price is > 0 and <= 1
                    ? (double?)order.Data.Price
                    : null;

                if (matched >= MinMatchedShares)
                {
                    return (matched, avgPrice, null);
                }

                if (order.Data.Status is OrderStatus.Canceled or OrderStatus.Matched)
                {
                    terminalStatus = order.Data.Status;
                    return (matched, avgPrice, terminalStatus);
                }
            }

            await Task.Delay(250, ct);
        }

        var last = await client.ClobApi.Trading.GetOrderAsync(orderId, ct);
        if (last.Success && last.Data != null)
        {
            terminalStatus = last.Data.Status;
            var avgPrice = last.Data.Price is > 0 and <= 1
                ? (double?)last.Data.Price
                : null;
            return ((double)last.Data.QuantityFilled, avgPrice, terminalStatus);
        }

        return (0, null, terminalStatus);
    }

    private async Task<PolymarketRestClient?> GetClientAsync(CancellationToken ct)
    {
        if (!IsConfigured)
        {
            return null;
        }

        if (_client != null)
        {
            return _client;
        }

        await _initLock.WaitAsync(ct);
        try
        {
            if (_client != null)
            {
                return _client;
            }

            var pk = _options.PolymarketPrivateKey!.Trim();
            var signType = MapSignatureType(_options.PolymarketSignatureType);
            var funding = ResolveFundingAddress(signType, pk);
            if (funding == null)
            {
                _logger.LogWarning(
                    "Polymarket funding/deposit address required for signature type {Type}",
                    signType);
                return null;
            }

            var credentials = new PolymarketCredentials(
                new PolymarketL1Credential(signType, pk, funding));

            _client = new PolymarketRestClient(opts => opts.ApiCredentials = credentials);

            var l2 = await _client.ClobApi.Account.GetOrCreateApiCredentialsAsync(nonce: null, ct);
            if (!l2.Success || l2.Data == null)
            {
                _logger.LogError("Failed to derive CLOB L2 API credentials: {Error}", l2.Error);
                _client = null;
                return null;
            }

            _client.UpdateL2Credentials(l2.Data);
            return _client;
        }
        finally
        {
            _initLock.Release();
        }
    }

    private string? ResolveFundingAddress(SignType signType, string privateKey)
    {
        var funder = _options.PolymarketFunderAddress?.Trim();
        if (!string.IsNullOrWhiteSpace(funder))
        {
            return funder;
        }

        return signType == SignType.EOA
            ? _wallet.TryDeriveEoaAddress(privateKey)
            : null;
    }

    private static SignType MapSignatureType(int raw) =>
        raw switch
        {
            1 => SignType.Proxy,
            2 => SignType.Email,
            3 => SignType.Poly1271,
            _ => SignType.EOA,
        };
}
