using Serilog;
using Serilog.Configuration;
using Serilog.Events;

namespace PolyTrader.Api.Logging;

public static class SerilogLiveStreamExtensions
{
    public static LoggerConfiguration LiveStream(
        this LoggerSinkConfiguration sinkConfiguration,
        ILiveLogBroadcaster broadcaster,
        LogEventLevel minimumLevel = LogEventLevel.Information) =>
        sinkConfiguration.Sink(new SerilogLiveStreamSink(broadcaster, minimumLevel));
}
