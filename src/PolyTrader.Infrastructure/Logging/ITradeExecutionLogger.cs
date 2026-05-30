namespace PolyTrader.Infrastructure.Logging;

/// <summary>Structured execution log (separate rolling file, excluded from main app log).</summary>
public interface ITradeExecutionLogger
{
    void Debug(string messageTemplate, params object?[] propertyValues);
    void Information(string messageTemplate, params object?[] propertyValues);
    void Warning(string messageTemplate, params object?[] propertyValues);
    void Error(Exception? exception, string messageTemplate, params object?[] propertyValues);
}
