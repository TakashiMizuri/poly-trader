using Serilog;
using Serilog.Events;

namespace PolyTrader.Infrastructure.Logging;

/// <summary>
/// Critical entry/skip lines duplicated into the main polytrader log (not filtered as trade-only).
/// Detailed execution remains in <c>trade-execution-*.log</c> via <see cref="ITradeExecutionLogger"/>.
/// </summary>
public static class EntryAuditLog
{
    private static ILogger Logger =>
        Log.ForContext("SourceContext", "PolyTrader.EntryAudit");

    public static void Skip(
        long candleTime,
        string mode,
        string skipReason,
        string? detail,
        string? side = null,
        string? trend = null)
    {
        Logger.Write(
            LogEventLevel.Warning,
            "Entry skip candle={CandleTime} mode={Mode} reason={Reason} detail={Detail} side={Side} trend={Trend}",
            candleTime,
            mode,
            skipReason,
            detail ?? "(none)",
            side ?? "(none)",
            trend ?? "(none)");
    }

    public static void TradeChannel(
        LogEventLevel level,
        string messageTemplate,
        params object?[] propertyValues) =>
        Logger.Write(level, messageTemplate, propertyValues);
}
