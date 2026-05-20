using Microsoft.AspNetCore.SignalR;

namespace PolyTrader.Api.Hubs;

public sealed class TradingHub : Hub
{
    public const string HubPath = "/hubs/trading";
}
