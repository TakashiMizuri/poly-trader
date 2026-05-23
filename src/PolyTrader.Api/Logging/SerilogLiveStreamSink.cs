using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting.Display;

namespace PolyTrader.Api.Logging;

public sealed class SerilogLiveStreamSink : ILogEventSink
{
    private static readonly MessageTemplateTextFormatter MessageFormatter =
        new("{Message:lj}", null);

    private readonly ILiveLogBroadcaster _broadcaster;
    private readonly LogEventLevel _minimumLevel;

    public SerilogLiveStreamSink(ILiveLogBroadcaster broadcaster, LogEventLevel minimumLevel)
    {
        _broadcaster = broadcaster;
        _minimumLevel = minimumLevel;
    }

    public void Emit(LogEvent logEvent)
    {
        if ((int)logEvent.Level < (int)_minimumLevel)
        {
            return;
        }

        using var writer = new StringWriter();
        MessageFormatter.Format(logEvent, writer);
        var message = writer.ToString();

        string? sourceContext = null;
        if (logEvent.Properties.TryGetValue("SourceContext", out var sourceValue))
        {
            sourceContext = sourceValue.ToString().Trim('"');
            if (string.IsNullOrWhiteSpace(sourceContext))
            {
                sourceContext = null;
            }
        }

        _broadcaster.Publish(
            new LiveLogEntry(
                logEvent.Timestamp.UtcDateTime,
                logEvent.Level.ToString(),
                message,
                sourceContext,
                logEvent.Exception?.ToString()));
    }
}
