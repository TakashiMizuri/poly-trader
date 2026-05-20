using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using PolyTrader.Infrastructure.Binance;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Options;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

public enum CheckStatus
{
    Ok,
    Warn,
    Error,
    Idle
}

public sealed record ConnectivityCheckDto(
    string Id,
    string Label,
    CheckStatus Status,
    string? Detail);

public sealed record ConnectivityResponseDto(
    IReadOnlyList<ConnectivityCheckDto> Checks,
    DateTime CheckedAt);

public interface IConnectivityService
{
    Task<ConnectivityResponseDto> RunChecksAsync(CancellationToken cancellationToken = default);
}

public sealed class ConnectivityService : IConnectivityService
{
    private const string ClobHost = "https://clob.polymarket.com";
    private const int EngineStaleMs = 90_000;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IBinanceMarketService _binance;
    private readonly IPolymarketMarketWebSocket _marketWs;
    private readonly IPolymarketClobService _clob;
    private readonly PolyTraderOptions _options;

    public ConnectivityService(
        IServiceScopeFactory scopeFactory,
        IBinanceMarketService binance,
        IPolymarketMarketWebSocket marketWs,
        IPolymarketClobService clob,
        IOptions<PolyTraderOptions> options)
    {
        _scopeFactory = scopeFactory;
        _binance = binance;
        _marketWs = marketWs;
        _clob = clob;
        _options = options.Value;
    }

    public async Task<ConnectivityResponseDto> RunChecksAsync(CancellationToken cancellationToken = default)
    {
        var checks = await Task.WhenAll(
            CheckDatabaseAsync(cancellationToken),
            Task.FromResult(CheckBinance()),
            Task.FromResult(CheckPolymarketMarketWs()),
            CheckClobAsync(cancellationToken),
            CheckTradingEngineAsync(cancellationToken));

        return new ConnectivityResponseDto(checks, DateTime.UtcNow);
    }

    private async Task<ConnectivityCheckDto> CheckDatabaseAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
            _ = await db.EngineSettings.AsNoTracking().Select(s => s.Id).FirstOrDefaultAsync(ct);
            var path = ResolveDatabasePath();
            return new ConnectivityCheckDto(
                "database",
                "Database",
                CheckStatus.Ok,
                $"{Path.GetFileName(path)} — {path}");
        }
        catch (Exception ex)
        {
            return new ConnectivityCheckDto(
                "database",
                "Database",
                CheckStatus.Error,
                ex.Message);
        }
    }

    private string ResolveDatabasePath()
    {
        var cs = _options.ConnectionString;
        const string prefix = "Data Source=";
        if (cs.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            var relative = cs[prefix.Length..].Trim();
            return Path.GetFullPath(relative);
        }

        return cs;
    }

    private ConnectivityCheckDto CheckBinance()
    {
        return _binance.Status switch
        {
            BinanceConnectionStatus.Connected => new(
                "binance",
                "Binance BTCUSDT",
                CheckStatus.Ok,
                "WebSocket connected · 5m klines"),
            BinanceConnectionStatus.Loading => new(
                "binance",
                "Binance BTCUSDT",
                CheckStatus.Warn,
                "Connecting…"),
            BinanceConnectionStatus.Reconnecting => new(
                "binance",
                "Binance BTCUSDT",
                CheckStatus.Warn,
                "Reconnecting…"),
            BinanceConnectionStatus.Idle => new(
                "binance",
                "Binance BTCUSDT",
                CheckStatus.Idle,
                "Not started"),
            BinanceConnectionStatus.Disconnected => new(
                "binance",
                "Binance BTCUSDT",
                CheckStatus.Error,
                "Disconnected"),
            BinanceConnectionStatus.Error => new(
                "binance",
                "Binance BTCUSDT",
                CheckStatus.Error,
                "Connection error"),
            _ => new(
                "binance",
                "Binance BTCUSDT",
                CheckStatus.Warn,
                _binance.Status.ToString()),
        };
    }

    private ConnectivityCheckDto CheckPolymarketMarketWs()
    {
        if (_marketWs.IsConnected)
        {
            return new ConnectivityCheckDto(
                "polymarket_ws",
                "Polymarket market WS",
                CheckStatus.Ok,
                "Subscribed · live outcome prices");
        }

        return new ConnectivityCheckDto(
            "polymarket_ws",
            "Polymarket market WS",
            CheckStatus.Warn,
            "Disconnected");
    }

    private async Task<ConnectivityCheckDto> CheckClobAsync(CancellationToken ct)
    {
        if (!_clob.IsConfigured)
        {
            return new ConnectivityCheckDto(
                "clob",
                "Polymarket CLOB",
                CheckStatus.Warn,
                "POLYMARKET_PRIVATE_KEY not configured");
        }

        try
        {
            var usd = await _clob.GetCollateralBalanceAsync(ct);
            if (usd == null)
            {
                return new ConnectivityCheckDto(
                    "clob",
                    "Polymarket CLOB",
                    CheckStatus.Warn,
                    $"{ClobHost} — reachable, balance unavailable");
            }

            return new ConnectivityCheckDto(
                "clob",
                "Polymarket CLOB",
                CheckStatus.Ok,
                $"{ClobHost} — USDC {usd.Value:F2}");
        }
        catch (Exception ex)
        {
            return new ConnectivityCheckDto(
                "clob",
                "Polymarket CLOB",
                CheckStatus.Error,
                ex.Message);
        }
    }

    private async Task<ConnectivityCheckDto> CheckTradingEngineAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
            var settings = await db.EngineSettings.AsNoTracking().FirstOrDefaultAsync(ct);
            if (settings == null)
            {
                return new ConnectivityCheckDto(
                    "engine",
                    "Trading engine",
                    CheckStatus.Warn,
                    "Engine settings missing");
            }

            if (!settings.IsRunning)
            {
                return new ConnectivityCheckDto(
                    "engine",
                    "Trading engine",
                    CheckStatus.Idle,
                    $"Stopped · {settings.TradingMode} mode");
            }

            if (_binance.Status != BinanceConnectionStatus.Connected)
            {
                return new ConnectivityCheckDto(
                    "engine",
                    "Trading engine",
                    CheckStatus.Warn,
                    $"Running · {settings.TradingMode} — Binance not connected");
            }

            var lastTradeAt = await db.Trades.AsNoTracking()
                .MaxAsync(t => (DateTime?)t.CreatedAt, ct);
            var lastSkipAt = await db.SkippedBets.AsNoTracking()
                .MaxAsync(s => (DateTime?)s.CreatedAt, ct);
            var latest = new[] { lastTradeAt, lastSkipAt, settings.UpdatedAt }
                .Where(t => t.HasValue)
                .Select(t => t!.Value)
                .DefaultIfEmpty()
                .Max();

            if (latest == default)
            {
                return new ConnectivityCheckDto(
                    "engine",
                    "Trading engine",
                    CheckStatus.Warn,
                    $"Running · {settings.TradingMode} — no activity yet");
            }

            var ageMs = (DateTime.UtcNow - latest).TotalMilliseconds;
            if (ageMs > EngineStaleMs)
            {
                return new ConnectivityCheckDto(
                    "engine",
                    "Trading engine",
                    CheckStatus.Warn,
                    $"Running · no recent activity ({Math.Round(ageMs / 1000)}s ago)");
            }

            return new ConnectivityCheckDto(
                "engine",
                "Trading engine",
                CheckStatus.Ok,
                $"Running · {settings.TradingMode} — last activity {Math.Round(ageMs / 1000)}s ago");
        }
        catch (Exception ex)
        {
            return new ConnectivityCheckDto(
                "engine",
                "Trading engine",
                CheckStatus.Error,
                ex.Message);
        }
    }
}
