using System.Collections.Concurrent;
using System.Net;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Polymarket.Net.Clients;
using Polymarket.Net.Enums;
using Polymarket.Net.Objects.Models;
using Polymarket.Net;
using PolyTrader.Core.Strategy;
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

    public async Task<LiveMarketBuyOutcome> PlaceMakerLimitBuyUsdAsync(
        string tokenId,
        double stakeUsd,
        double bidPriceHint,
        double? askPriceHint,
        TimeSpan firstWaveFillWait,
        TimeSpan remainderFillWait,
        Func<CancellationToken, Task<(double? Bid, double? Ask)>>? refreshQuoteAsync = null,
        LiveEntryOrderKey? entryKey = null,
        CancellationToken ct = default)
    {
        if (stakeUsd < 0.01)
        {
            var minStakeReason = $"Stake ${stakeUsd:F2} below minimum ($0.01)";
            _logger.LogWarning("{Reason}", minStakeReason);
            return LiveMarketBuyOutcome.Fail(minStakeReason);
        }

        if (!PolymarketOrderPricing.IsValidOutcomePrice(bidPriceHint))
        {
            const string priceReason = "Invalid bid hint for maker buy (must be in (0, 1])";
            _logger.LogWarning("{Reason}", priceReason);
            return LiveMarketBuyOutcome.Fail(priceReason);
        }

        var client = await GetClientAsync(ct);
        if (client == null)
        {
            const string clientReason =
                "CLOB trading client unavailable (check private key, signature type, and funder address)";
            _logger.LogWarning("Maker limit buy aborted for {TokenId}: {Reason}", tokenId, clientReason);
            return LiveMarketBuyOutcome.Fail(clientReason);
        }

        var wave1ClientOrderId = entryKey?.DeriveClientOrderId(0);
        string? lastReason = null;

        for (var attempt = 1; attempt <= TransientRetryCount; attempt++)
        {
            var outcome = await PlaceMakerLimitBuyTwoWavesAsync(
                client,
                tokenId,
                stakeUsd,
                bidPriceHint,
                askPriceHint,
                firstWaveFillWait,
                remainderFillWait,
                refreshQuoteAsync,
                entryKey,
                wave1ClientOrderId,
                ct);

            if (outcome.IsSuccess)
            {
                return outcome;
            }

            lastReason = outcome.FailureReason;

            if (entryKey != null && wave1ClientOrderId is long salt)
            {
                var recovered = await TryRecoverEntryOrderAsync(
                    client,
                    salt,
                    entryKey,
                    tokenId,
                    stakeUsd,
                    bidPriceHint,
                    ct);
                if (recovered is { IsSuccess: true })
                {
                    _logger.LogInformation(
                        "Recovered live maker entry for candle {CandleTime} token {TokenId} (attempt {Attempt})",
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
                "Maker two-wave buy attempt {Attempt}/{Max} for {TokenId} ${Stake:F2} failed ({Reason}); retrying in {DelaySeconds}s",
                attempt,
                TransientRetryCount,
                tokenId,
                stakeUsd,
                lastReason,
                TransientRetryDelay.TotalSeconds);
            await Task.Delay(TransientRetryDelay, ct);
        }

        return LiveMarketBuyOutcome.Fail(lastReason ?? "Maker limit buy failed after retries");
    }

    public async Task<LiveMarketBuyOutcome> PlaceMakerLimitBuySingleWaveAsync(
        string tokenId,
        double stakeUsd,
        double bidPriceHint,
        double? askPriceHint,
        TimeSpan fillWait,
        Func<CancellationToken, Task<(double? Bid, double? Ask)>>? refreshQuoteAsync = null,
        LiveEntryOrderKey? entryKey = null,
        CancellationToken ct = default)
    {
        if (stakeUsd < 0.01)
        {
            return LiveMarketBuyOutcome.Fail($"Stake ${stakeUsd:F2} below minimum ($0.01)");
        }

        if (!PolymarketOrderPricing.IsValidOutcomePrice(bidPriceHint))
        {
            return LiveMarketBuyOutcome.Fail("Invalid bid hint for maker buy (must be in (0, 1])");
        }

        var client = await GetClientAsync(ct);
        if (client == null)
        {
            return LiveMarketBuyOutcome.Fail(
                "CLOB trading client unavailable (check private key, signature type, and funder address)");
        }

        var tickSize = await ResolveTickSizeAsync(client, tokenId, ct);
        var (bid, ask) = await ResolveQuoteAsync(
            bidPriceHint,
            askPriceHint,
            refreshQuoteAsync,
            refreshFromApi: false,
            ct);
        var limit = ResolvePostOnlyLimit(bid, ask, tickSize, stakeUsd);
        if (limit == null)
        {
            return LiveMarketBuyOutcome.Fail(
                $"Cannot derive post-only limit on {tokenId} (bid {bid:F4}, ask {ask?.ToString("F4") ?? "n/a"}, stake ${stakeUsd:F2})");
        }

        if (!EntryPriceRules.IsAllowed(limit.Value))
        {
            return LiveMarketBuyOutcome.Fail(
                $"Maker limit {limit.Value:F4} outside allowed entry band (0, {EntryPriceRules.MaxEntryPrice:F2}] "
                + $"on {tokenId} (bid {bid:F4}, ask {ask?.ToString("F4") ?? "n/a"})");
        }

        LogLimitAdjustment(bidPriceHint, ask, limit.Value, wave: 1, tokenId);
        var wave = await ExecuteMakerLimitWaveAsync(
            client,
            tokenId,
            stakeUsd,
            bid,
            ask,
            tickSize,
            refreshQuoteAsync,
            fillWait,
            entryKey?.DeriveClientOrderId(0),
            ct);

        if (wave.PlacementFailed)
        {
            return LiveMarketBuyOutcome.Fail(wave.FailureReason ?? "Maker limit placement failed");
        }

        var waves = new List<LiveEntryWaveFill> { ToLiveEntryWaveFill(1, stakeUsd, wave) };
        var priceNumerator = wave.MatchedShares * (wave.LimitPrice ?? limit.Value);
        return BuildAggregatedMakerOutcome(
            tokenId,
            stakeUsd,
            wave.MatchedShares,
            priceNumerator,
            wave.OrderId,
            waves,
            wave.FilledStakeUsd);
    }

    private sealed record MakerLimitWaveResult(
        bool PlacementFailed,
        string? FailureReason,
        string? OrderId,
        double MatchedShares,
        double? LimitPrice,
        double FilledStakeUsd);

    private async Task<LiveMarketBuyOutcome> PlaceMakerLimitBuyTwoWavesAsync(
        PolymarketRestClient client,
        string tokenId,
        double requestedStakeUsd,
        double bidPriceHint,
        double? askPriceHint,
        TimeSpan firstWaveFillWait,
        TimeSpan remainderFillWait,
        Func<CancellationToken, Task<(double? Bid, double? Ask)>>? refreshQuoteAsync,
        LiveEntryOrderKey? entryKey,
        long? wave1ClientOrderId,
        CancellationToken ct)
    {
        var tickSize = await ResolveTickSizeAsync(client, tokenId, ct);
        var (wave1Bid, wave1Ask) = await ResolveQuoteAsync(
            bidPriceHint,
            askPriceHint,
            refreshQuoteAsync,
            refreshFromApi: false,
            ct);
        var wave1Limit = ResolvePostOnlyLimit(wave1Bid, wave1Ask, tickSize, requestedStakeUsd);
        if (wave1Limit == null)
        {
            return LiveMarketBuyOutcome.Fail(
                $"Cannot derive post-only limit for wave 1 on {tokenId} (bid {wave1Bid:F4}, ask {wave1Ask?.ToString("F4") ?? "n/a"}, stake ${requestedStakeUsd:F2})");
        }

        if (!EntryPriceRules.IsAllowed(wave1Limit.Value))
        {
            return LiveMarketBuyOutcome.Fail(
                $"Maker wave 1 limit {wave1Limit.Value:F4} outside allowed entry band (0, {EntryPriceRules.MaxEntryPrice:F2}] "
                + $"on {tokenId} (bid {wave1Bid:F4}, ask {wave1Ask?.ToString("F4") ?? "n/a"})");
        }

        LogLimitAdjustment(bidPriceHint, wave1Ask, wave1Limit.Value, wave: 1, tokenId);

        _logger.LogInformation(
            "Maker entry wave 1 for {TokenId}: ${Stake:F2} @ {Price:F4}, wait {WaitSeconds}s",
            tokenId,
            requestedStakeUsd,
            wave1Limit.Value,
            firstWaveFillWait.TotalSeconds);

        var wave1 = await ExecuteMakerLimitWaveAsync(
            client,
            tokenId,
            requestedStakeUsd,
            wave1Bid,
            wave1Ask,
            tickSize,
            refreshQuoteAsync,
            firstWaveFillWait,
            wave1ClientOrderId,
            ct);

        if (wave1.PlacementFailed)
        {
            return LiveMarketBuyOutcome.Fail(wave1.FailureReason ?? "Maker wave 1 placement failed");
        }

        var waves = new List<LiveEntryWaveFill>
        {
            ToLiveEntryWaveFill(1, requestedStakeUsd, wave1),
        };

        var totalFilledStake = wave1.FilledStakeUsd;
        var totalMatchedShares = wave1.MatchedShares;
        var primaryOrderId = wave1.OrderId;
        var priceNumerator = wave1.MatchedShares * (wave1.LimitPrice ?? wave1Limit.Value);

        if (totalFilledStake + 0.01 >= requestedStakeUsd)
        {
            return BuildAggregatedMakerOutcome(
                tokenId,
                requestedStakeUsd,
                totalMatchedShares,
                priceNumerator,
                primaryOrderId,
                waves,
                totalFilledStake);
        }

        var remainderStake = requestedStakeUsd - totalFilledStake;
        if (remainderStake < 0.01)
        {
            return BuildAggregatedMakerOutcome(
                tokenId,
                requestedStakeUsd,
                totalMatchedShares,
                priceNumerator,
                primaryOrderId,
                waves,
                totalFilledStake);
        }

        if (totalMatchedShares < MinMatchedShares)
        {
            _logger.LogInformation(
                "Maker wave 1 unfilled on {TokenId}; re-quoting wave 2 for full remainder ${Remainder:F2}",
                tokenId,
                remainderStake);
        }

        var (wave2Bid, wave2Ask) = await ResolveQuoteAsync(
            bidPriceHint,
            askPriceHint,
            refreshQuoteAsync,
            refreshFromApi: true,
            ct);
        var wave2Limit = ResolvePostOnlyLimit(wave2Bid, wave2Ask, tickSize, remainderStake);
        if (wave2Limit == null)
        {
            _logger.LogWarning(
                "Skipping maker wave 2 for {TokenId}: no post-only price for remainder ${Remainder:F2} (bid {Bid:F4}, ask {Ask})",
                tokenId,
                remainderStake,
                wave2Bid,
                wave2Ask?.ToString("F4") ?? "n/a");
            return BuildAggregatedMakerOutcome(
                tokenId,
                requestedStakeUsd,
                totalMatchedShares,
                priceNumerator,
                primaryOrderId,
                waves,
                totalFilledStake);
        }

        if (!EntryPriceRules.IsAllowed(wave2Limit.Value))
        {
            _logger.LogWarning(
                "Skipping maker wave 2 for {TokenId}: limit {Limit:F4} outside allowed entry band (0, {Max:F2}] "
                + "for remainder ${Remainder:F2} (bid {Bid:F4}, ask {Ask})",
                tokenId,
                wave2Limit.Value,
                EntryPriceRules.MaxEntryPrice,
                remainderStake,
                wave2Bid,
                wave2Ask?.ToString("F4") ?? "n/a");
            return BuildAggregatedMakerOutcome(
                tokenId,
                requestedStakeUsd,
                totalMatchedShares,
                priceNumerator,
                primaryOrderId,
                waves,
                totalFilledStake);
        }

        LogLimitAdjustment(wave2Bid, wave2Ask, wave2Limit.Value, wave: 2, tokenId);

        _logger.LogInformation(
            "Maker entry wave 2 for {TokenId}: remainder ${Remainder:F2} @ {Price:F4}, wait {WaitSeconds}s (wave1 filled ${Wave1:F2})",
            tokenId,
            remainderStake,
            wave2Limit.Value,
            remainderFillWait.TotalSeconds,
            totalFilledStake);

        var wave2ClientOrderId = entryKey?.DeriveClientOrderId(1);
        var wave2 = await ExecuteMakerLimitWaveAsync(
            client,
            tokenId,
            remainderStake,
            wave2Bid,
            wave2Ask,
            tickSize,
            refreshQuoteAsync,
            remainderFillWait,
            wave2ClientOrderId,
            ct);

        if (wave2.PlacementFailed)
        {
            _logger.LogWarning(
                "Maker wave 2 placement failed for {TokenId} ({Reason}); keeping wave 1 fill ${Filled:F2}",
                tokenId,
                wave2.FailureReason,
                totalFilledStake);
        }
        else
        {
            waves.Add(ToLiveEntryWaveFill(2, remainderStake, wave2));
            totalFilledStake += wave2.FilledStakeUsd;
            totalMatchedShares += wave2.MatchedShares;
            priceNumerator += wave2.MatchedShares * (wave2.LimitPrice ?? wave2Limit.Value);
            if (string.IsNullOrWhiteSpace(primaryOrderId))
            {
                primaryOrderId = wave2.OrderId;
            }
        }

        return BuildAggregatedMakerOutcome(
            tokenId,
            requestedStakeUsd,
            totalMatchedShares,
            priceNumerator,
            primaryOrderId,
            waves,
            totalFilledStake);
    }

    private static LiveEntryWaveFill ToLiveEntryWaveFill(
        int waveIndex,
        double requestedStakeUsd,
        MakerLimitWaveResult wave) =>
        new(
            waveIndex,
            requestedStakeUsd,
            wave.FilledStakeUsd,
            wave.LimitPrice,
            wave.OrderId);

    private LiveMarketBuyOutcome BuildAggregatedMakerOutcome(
        string tokenId,
        double requestedStakeUsd,
        double totalMatchedShares,
        double priceNumerator,
        string? primaryOrderId,
        IReadOnlyList<LiveEntryWaveFill> entryWaves,
        double totalFilledStakeUsd)
    {
        if (totalMatchedShares < MinMatchedShares)
        {
            var fillReason =
                $"Insufficient maker fill after 2 waves on {tokenId}: {totalMatchedShares:F4} shares (min {MinMatchedShares:F2})";
            _logger.LogWarning("{Reason}", fillReason);
            return LiveMarketBuyOutcome.Fail(fillReason);
        }

        var avgPrice = priceNumerator > 0 && totalMatchedShares > 0
            ? priceNumerator / totalMatchedShares
            : (double?)null;
        var filledStake = Math.Min(requestedStakeUsd, totalFilledStakeUsd);
        if (filledStake <= 0 && avgPrice is > 0 and <= 1)
        {
            filledStake = Math.Min(requestedStakeUsd, totalMatchedShares * avgPrice.Value);
        }

        var orderId = string.IsNullOrWhiteSpace(primaryOrderId)
            ? $"maker-agg-{Guid.NewGuid():N}"
            : primaryOrderId;

        var result = new LiveMarketBuyResult(
            orderId,
            totalMatchedShares,
            avgPrice,
            requestedStakeUsd,
            filledStake,
            entryWaves);

        if (result.IsPartialFill)
        {
            _logger.LogWarning(
                "Maker two-wave entry on {TokenId}: ${Filled:F2} of ${Requested:F2} ({Shares:F4} shares @ {Price:F4})",
                tokenId,
                filledStake,
                requestedStakeUsd,
                totalMatchedShares,
                avgPrice ?? 0);
        }
        else
        {
            _logger.LogInformation(
                "Maker two-wave entry filled {TokenId}: ${Filled:F2} ({Shares:F4} shares @ {Price:F4})",
                tokenId,
                filledStake,
                totalMatchedShares,
                avgPrice ?? 0);
        }

        return LiveMarketBuyOutcome.Ok(result);
    }

    private async Task<MakerLimitWaveResult> ExecuteMakerLimitWaveAsync(
        PolymarketRestClient client,
        string tokenId,
        double stakeUsd,
        double bidHint,
        double? askHint,
        decimal tickSize,
        Func<CancellationToken, Task<(double? Bid, double? Ask)>>? refreshQuoteAsync,
        TimeSpan fillWait,
        long? clientOrderId,
        CancellationToken ct)
    {
        try
        {
            var price = MakerLimitPricing.ComputePostOnlyBuyLimit(bidHint, askHint, tickSize, stakeUsd);
            if (price is not > 0)
            {
                return new MakerLimitWaveResult(
                    PlacementFailed: true,
                    FailureReason:
                        $"No valid post-only limit for ${stakeUsd:F2} (bid {bidHint:F4}, ask {askHint?.ToString("F4") ?? "n/a"})",
                    OrderId: null,
                    MatchedShares: 0,
                    LimitPrice: null,
                    FilledStakeUsd: 0);
            }

            if (!EntryPriceRules.IsAllowed((double)price.Value))
            {
                return new MakerLimitWaveResult(
                    PlacementFailed: true,
                    FailureReason:
                        $"Post-only limit {price:F4} outside allowed entry band (0, {EntryPriceRules.MaxEntryPrice:F2}] "
                        + $"(bid {bidHint:F4}, ask {askHint?.ToString("F4") ?? "n/a"})",
                    OrderId: null,
                    MatchedShares: 0,
                    LimitPrice: null,
                    FilledStakeUsd: 0);
            }

            var shares = PolymarketOrderPricing.ComputeShareQuantity(stakeUsd, price.Value);
            if (shares < PolymarketClobLimits.MinOrderShares)
            {
                return new MakerLimitWaveResult(
                    PlacementFailed: true,
                    FailureReason:
                        $"Share quantity {shares:F4} below Polymarket minimum ({PolymarketClobLimits.MinOrderShares}) "
                        + $"for ${stakeUsd:F2} at {price:F4} (need ≥ ${PolymarketClobLimits.MinStakeUsd(price.Value):F2})",
                    OrderId: null,
                    MatchedShares: 0,
                    LimitPrice: null,
                    FilledStakeUsd: 0);
            }

            const int maxPostOnlyTickRetries = 2;
            string? lastPlaceReason = null;
            var repricedFromBook = false;

            for (var tickStep = 0; tickStep <= maxPostOnlyTickRetries; tickStep++)
            {
                if (tickStep > 0)
                {
                    var stepped = PolymarketOrderPricing.RoundDownToTick(price.Value - tickSize, tickSize);
                    if (stepped <= 0 || stepped >= price.Value)
                    {
                        return new MakerLimitWaveResult(
                            PlacementFailed: true,
                            FailureReason: lastPlaceReason ?? "Could not step post-only limit price lower",
                            OrderId: null,
                            MatchedShares: 0,
                            LimitPrice: null,
                            FilledStakeUsd: 0);
                    }

                    _logger.LogInformation(
                        "Retrying maker limit one tick lower for {TokenId}: {Old:F4} -> {New:F4} (step {Step}/{Max})",
                        tokenId,
                        price,
                        stepped,
                        tickStep,
                        maxPostOnlyTickRetries);
                    price = stepped;
                    shares = PolymarketOrderPricing.ComputeShareQuantity(stakeUsd, price.Value);
                    if (shares < PolymarketClobLimits.MinOrderShares)
                    {
                        return new MakerLimitWaveResult(
                            PlacementFailed: true,
                            FailureReason:
                                $"Share quantity {shares:F4} below Polymarket minimum ({PolymarketClobLimits.MinOrderShares}) "
                                + $"after tick-down to {price:F4}",
                            OrderId: null,
                            MatchedShares: 0,
                            LimitPrice: null,
                            FilledStakeUsd: 0);
                    }
                }

                var place = await client.ClobApi.Trading.PlaceOrderAsync(
                    tokenId,
                    OrderSide.Buy,
                    OrderType.Limit,
                    quantity: shares,
                    price: price.Value,
                    timeInForce: TimeInForce.GoodTillCanceled,
                    postOnly: true,
                    clientOrderId: clientOrderId,
                    expiration: null,
                    quantityType: QuantityType.Shares,
                    ct: ct);

                string? placeReason;
                if (!place.Success || place.Data == null)
                {
                    placeReason = FormatApiError(place.Error)
                        ?? FormatApiError(place.Data?.Error)
                        ?? "Maker limit placement rejected by CLOB";
                }
                else if (place.Data.Success == false)
                {
                    placeReason = FormatApiError(place.Data.Error) ?? "Maker limit placement rejected by CLOB";
                }
                else
                {
                    placeReason = null;
                }
                if (placeReason != null)
                {
                    lastPlaceReason = placeReason;
                    if (IsPostOnlyWouldCross(placeReason)
                        && !repricedFromBook
                        && refreshQuoteAsync != null)
                    {
                        repricedFromBook = true;
                        var (freshBid, freshAsk) = await ResolveQuoteAsync(
                            bidHint,
                            askHint,
                            refreshQuoteAsync,
                            refreshFromApi: true,
                            ct);
                        var repriced = MakerLimitPricing.ComputePostOnlyBuyLimit(
                            freshBid,
                            freshAsk,
                            tickSize,
                            stakeUsd);
                        if (repriced is > 0 && repriced != price.Value)
                        {
                            if (!EntryPriceRules.IsAllowed((double)repriced.Value))
                            {
                                _logger.LogWarning(
                                    "Refusing maker limit re-price for {TokenId} above entry cap: {New:F4} "
                                    + "(allowed (0, {Max:F2}], bid {Bid:F4}, ask {Ask})",
                                    tokenId,
                                    repriced,
                                    EntryPriceRules.MaxEntryPrice,
                                    freshBid,
                                    freshAsk?.ToString("F4") ?? "n/a");
                            }
                            else
                            {
                                _logger.LogInformation(
                                    "Re-priced maker limit for {TokenId} after cross: {Old:F4} -> {New:F4} (bid {Bid:F4}, ask {Ask})",
                                    tokenId,
                                    price,
                                    repriced,
                                    freshBid,
                                    freshAsk?.ToString("F4") ?? "n/a");
                                price = repriced;
                                bidHint = freshBid;
                                askHint = freshAsk;
                                shares = PolymarketOrderPricing.ComputeShareQuantity(stakeUsd, price.Value);
                                continue;
                            }
                        }
                    }

                    if (!IsPostOnlyWouldCross(placeReason) || tickStep == maxPostOnlyTickRetries)
                    {
                        return new MakerLimitWaveResult(
                            PlacementFailed: true,
                            FailureReason: placeReason,
                            OrderId: null,
                            MatchedShares: 0,
                            LimitPrice: null,
                            FilledStakeUsd: 0);
                    }

                    continue;
                }

                var orderId = place.Data!.OrderId;
                if (string.IsNullOrWhiteSpace(orderId))
                {
                    return new MakerLimitWaveResult(
                        PlacementFailed: true,
                        FailureReason: "Maker limit placement returned no order id",
                        OrderId: null,
                        MatchedShares: 0,
                        LimitPrice: null,
                        FilledStakeUsd: 0);
                }

                if (clientOrderId is long salt)
                {
                    _orderIdByClientOrderId[salt] = orderId;
                }

                var limitPx = (double)price.Value;
                var targetShares = (double)shares;
                var (matched, avgPrice, _) = await WaitForMakerFillAsync(
                    client,
                    orderId,
                    targetShares,
                    fillWait,
                    ct);
                var filledStake = ComputeFilledStakeUsd(matched, avgPrice, limitPx, stakeUsd);

                return new MakerLimitWaveResult(
                    PlacementFailed: false,
                    FailureReason: null,
                    OrderId: orderId,
                    MatchedShares: matched,
                    LimitPrice: avgPrice ?? limitPx,
                    FilledStakeUsd: filledStake);
            }

            return new MakerLimitWaveResult(
                PlacementFailed: true,
                FailureReason: lastPlaceReason ?? "Maker limit placement rejected by CLOB",
                OrderId: null,
                MatchedShares: 0,
                LimitPrice: null,
                FilledStakeUsd: 0);
        }
        catch (Exception ex)
        {
            if (clientOrderId is long salt
                && _orderIdByClientOrderId.TryGetValue(salt, out var cachedOrderId))
            {
                var (matched, avgPrice, _) = await ReadOrderFillSnapshotAsync(client, cachedOrderId, ct);
                if (matched >= MinMatchedShares)
                {
                    var filledStake = ComputeFilledStakeUsd(matched, avgPrice, bidHint, stakeUsd);
                    return new MakerLimitWaveResult(
                        PlacementFailed: false,
                        FailureReason: null,
                        OrderId: cachedOrderId,
                        MatchedShares: matched,
                        LimitPrice: avgPrice ?? bidHint,
                        FilledStakeUsd: filledStake);
                }
            }

            if (IsTransientException(ex))
            {
                _logger.LogWarning(ex, "Transient error in maker limit wave for token {TokenId}", tokenId);
            }
            else
            {
                _logger.LogError(ex, "Maker limit wave failed for token {TokenId}", tokenId);
            }

            return new MakerLimitWaveResult(
                PlacementFailed: true,
                FailureReason: ex.Message,
                OrderId: null,
                MatchedShares: 0,
                LimitPrice: null,
                FilledStakeUsd: 0);
        }
    }

    private static async Task<(double Bid, double? Ask)> ResolveQuoteAsync(
        double bidHint,
        double? askHint,
        Func<CancellationToken, Task<(double? Bid, double? Ask)>>? refreshQuoteAsync,
        bool refreshFromApi,
        CancellationToken ct)
    {
        if (refreshFromApi && refreshQuoteAsync != null)
        {
            try
            {
                var refreshed = await refreshQuoteAsync(ct);
                if (PolymarketOrderPricing.IsValidOutcomePrice(refreshed.Bid))
                {
                    bidHint = refreshed.Bid!.Value;
                }

                if (PolymarketOrderPricing.IsValidOutcomePrice(refreshed.Ask))
                {
                    askHint = refreshed.Ask;
                }
            }
            catch
            {
                // keep hints
            }
        }

        return (bidHint, askHint);
    }

    private static double? ResolvePostOnlyLimit(
        double bid,
        double? ask,
        decimal tickSize,
        double stakeUsd)
    {
        var limit = MakerLimitPricing.ComputePostOnlyBuyLimit(bid, ask, tickSize, stakeUsd);
        return limit is > 0 ? (double)limit.Value : null;
    }

    private void LogLimitAdjustment(
        double bidHint,
        double? askHint,
        double limit,
        int wave,
        string tokenId)
    {
        if (Math.Abs(limit - bidHint) < 0.0001)
        {
            return;
        }

        _logger.LogInformation(
            "Maker wave {Wave} limit {Limit:F4} for {TokenId} (bid hint {Bid:F4}, ask {Ask})",
            wave,
            limit,
            tokenId,
            bidHint,
            askHint?.ToString("F4") ?? "n/a");
    }

    private static async Task<decimal> ResolveTickSizeAsync(
        PolymarketRestClient client,
        string tokenId,
        CancellationToken ct)
    {
        try
        {
            var tick = await client.ClobApi.ExchangeData.GetTickSizeAsync(tokenId, ct);
            if (tick.Success && tick.Data?.MinTickSize is > 0)
            {
                return tick.Data.MinTickSize;
            }
        }
        catch
        {
            // fall through to default
        }

        return 0.01m;
    }

    private static bool IsPostOnlyWouldCross(string? reason)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            return false;
        }

        var r = reason.ToLowerInvariant();
        return r.Contains("post only", StringComparison.Ordinal)
            || r.Contains("post-only", StringComparison.Ordinal)
            || r.Contains("postonly", StringComparison.Ordinal)
            || r.Contains("would cross", StringComparison.Ordinal)
            || r.Contains("crosses book", StringComparison.Ordinal);
    }

    private async Task<(double MatchedShares, double? AveragePrice, OrderStatus? TerminalStatus)> WaitForMakerFillAsync(
        PolymarketRestClient client,
        string orderId,
        double targetShares,
        TimeSpan fillWait,
        CancellationToken ct)
    {
        _logger.LogDebug(
            "Waiting for maker fill on order {OrderId} up to {Seconds}s (target {Shares:F4} shares)",
            orderId,
            fillWait.TotalSeconds,
            targetShares);
        var deadline = DateTime.UtcNow + fillWait;
        OrderStatus? terminalStatus = null;

        while (DateTime.UtcNow < deadline)
        {
            var snapshot = await ReadOrderFillSnapshotAsync(client, orderId, ct);

            if (snapshot.TerminalStatus is OrderStatus.Matched or OrderStatus.Canceled)
            {
                return snapshot;
            }

            if (targetShares > 0 && snapshot.MatchedShares >= targetShares * 0.999)
            {
                await TryCancelOpenOrderAsync(client, orderId, ct);
                return await ReadOrderFillSnapshotAsync(client, orderId, ct);
            }

            terminalStatus = snapshot.TerminalStatus;
            try
            {
                await Task.Delay(500, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        await TryCancelOpenOrderAsync(client, orderId, ct);
        var final = await ReadOrderFillSnapshotAsync(client, orderId, ct);
        return (final.MatchedShares, final.AveragePrice, final.TerminalStatus ?? terminalStatus);
    }

    private static async Task TryCancelOpenOrderAsync(
        PolymarketRestClient client,
        string orderId,
        CancellationToken ct)
    {
        try
        {
            await client.ClobApi.Trading.CancelOrderAsync(orderId, ct);
        }
        catch
        {
            // best effort
        }
    }

    private static async Task<(double MatchedShares, double? AveragePrice, OrderStatus? TerminalStatus)> ReadOrderFillSnapshotAsync(
        PolymarketRestClient client,
        string orderId,
        CancellationToken ct)
    {
        var order = await client.ClobApi.Trading.GetOrderAsync(orderId, ct);
        if (!order.Success || order.Data == null)
        {
            return (0, null, null);
        }

        var matched = (double)order.Data.QuantityFilled;
        var avgPrice = order.Data.Price is > 0 and <= 1
            ? (double?)order.Data.Price
            : null;
        var terminal = order.Data.Status is OrderStatus.Canceled or OrderStatus.Matched
            ? order.Data.Status
            : (OrderStatus?)null;

        return (matched, avgPrice, terminal);
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

            var client = new PolymarketRestClient(opts => opts.ApiCredentials = credentials);

            try
            {
                var l2 = await client.ClobApi.Account.GetOrCreateApiCredentialsAsync(nonce: null, ct);
                if (!l2.Success || l2.Data == null)
                {
                    _logger.LogError("Failed to derive CLOB L2 API credentials: {Error}", l2.Error);
                    return null;
                }

                client.UpdateL2Credentials(l2.Data);
                _client = client;
                return _client;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to initialize Polymarket CLOB client (L2 credentials)");
                return null;
            }
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
