namespace PolyTrader.Infrastructure.Logging;

internal static class TradeExecutionLogProperties
{
    public const string IsTradeExecution = "TradeExecution";

    public static readonly string[] ExcludedSourceContexts =
    [
        "PolyTrader.TradeExecution",
        "PolyTrader.Infrastructure.Polymarket.PolymarketRestTradingClient",
        "PolyTrader.Infrastructure.Polymarket.PolymarketClobService",
        "PolyTrader.Infrastructure.Services.EntryPatienceExecutor",
    ];
}
