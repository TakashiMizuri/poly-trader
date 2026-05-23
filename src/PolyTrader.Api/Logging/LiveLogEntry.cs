namespace PolyTrader.Api.Logging;

public sealed record LiveLogEntry(
    DateTime Timestamp,
    string Level,
    string Message,
    string? SourceContext = null,
    string? Exception = null);
