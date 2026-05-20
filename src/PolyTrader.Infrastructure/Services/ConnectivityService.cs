using PolyTrader.Infrastructure.Binance;
using PolyTrader.Infrastructure.Polymarket;

namespace PolyTrader.Infrastructure.Services;

public sealed record ConnectivityStatusDto(
    string Binance,
    string PolymarketMarketWs,
    string PolymarketClob,
    bool EngineConfigured);

public interface IConnectivityService
{
    ConnectivityStatusDto GetStatus();
}

public sealed class ConnectivityService : IConnectivityService
{
    private readonly IBinanceMarketService _binance;
    private readonly IPolymarketMarketWebSocket _marketWs;
    private readonly IPolymarketClobService _clob;

    public ConnectivityService(
        IBinanceMarketService binance,
        IPolymarketMarketWebSocket marketWs,
        IPolymarketClobService clob)
    {
        _binance = binance;
        _marketWs = marketWs;
        _clob = clob;
    }

    public ConnectivityStatusDto GetStatus() => new(
        _binance.Status.ToString(),
        _marketWs.IsConnected ? "connected" : "disconnected",
        _clob.IsConfigured ? "configured" : "not_configured",
        _clob.IsConfigured);
}
