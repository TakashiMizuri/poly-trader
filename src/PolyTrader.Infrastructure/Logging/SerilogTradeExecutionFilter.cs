using Serilog.Core;
using Serilog.Events;

namespace PolyTrader.Infrastructure.Logging;

public sealed class SerilogTradeExecutionFilter : ILogEventFilter
{
    public static SerilogTradeExecutionFilter ExcludeTradeExecution { get; } = new(exclude: true);
    public static SerilogTradeExecutionFilter IncludeTradeExecutionOnly { get; } = new(exclude: false);

    private readonly bool _exclude;

    private SerilogTradeExecutionFilter(bool exclude) => _exclude = exclude;

    public bool IsEnabled(LogEvent logEvent)
    {
        var isTrade = IsTradeExecutionEvent(logEvent);
        return _exclude ? !isTrade : isTrade;
    }

    internal static bool IsTradeExecutionEvent(LogEvent logEvent)
    {
        if (logEvent.Properties.TryGetValue(TradeExecutionLogProperties.IsTradeExecution, out var flag)
            && flag is ScalarValue { Value: true })
        {
            return true;
        }

        if (!logEvent.Properties.TryGetValue(Constants.SourceContextPropertyName, out var source)
            || source is not ScalarValue { Value: string ctx })
        {
            return false;
        }

        foreach (var excluded in TradeExecutionLogProperties.ExcludedSourceContexts)
        {
            if (string.Equals(ctx, excluded, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return IsTradingEngineTradeMessage(ctx, logEvent);
    }

    private static bool IsTradingEngineTradeMessage(string sourceContext, LogEvent logEvent)
    {
        if (!sourceContext.Contains("TradingEngineHostedService", StringComparison.Ordinal))
        {
            return false;
        }

        var msg = logEvent.RenderMessage();
        return msg.Contains("entry", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("trade", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("skip", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("patience", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("maker", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("stake", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("Placing live", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("Opened ", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("Closed ", StringComparison.OrdinalIgnoreCase);
    }
}
