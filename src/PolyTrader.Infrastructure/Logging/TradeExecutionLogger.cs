using Microsoft.Extensions.Configuration;
using Serilog;
using Serilog.Events;

namespace PolyTrader.Infrastructure.Logging;

public sealed class TradeExecutionLogger : ITradeExecutionLogger
{
    private readonly ILogger _logger;

    public TradeExecutionLogger()
    {
        _logger = TradeExecutionLog.RequireLogger();
    }

    public void Debug(string messageTemplate, params object?[] propertyValues) =>
        Write(LogEventLevel.Debug, null, messageTemplate, propertyValues);

    public void Information(string messageTemplate, params object?[] propertyValues) =>
        Write(LogEventLevel.Information, null, messageTemplate, propertyValues);

    public void Warning(string messageTemplate, params object?[] propertyValues) =>
        Write(LogEventLevel.Warning, null, messageTemplate, propertyValues);

    public void Error(Exception? exception, string messageTemplate, params object?[] propertyValues) =>
        Write(LogEventLevel.Error, exception, messageTemplate, propertyValues);

    private void Write(
        LogEventLevel level,
        Exception? exception,
        string messageTemplate,
        object?[] propertyValues)
    {
        if (!_logger.IsEnabled(level))
        {
            return;
        }

        _logger.Write(level, exception, messageTemplate, propertyValues);
    }
}

public static class TradeExecutionLog
{
    private static ILogger? _logger;

    public static ILogger CreateLogger() =>
        _logger ??= BuildLogger();

    public static ILogger RequireLogger()
    {
        if (_logger == null)
        {
            throw new InvalidOperationException(
                "Trade execution log is not initialized. Ensure SerilogBootstrap.Configure runs before resolving ITradeExecutionLogger.");
        }

        return _logger;
    }

    public static void Initialize(IConfiguration configuration, string logDirectory)
    {
        Directory.CreateDirectory(logDirectory);
        _logger = BuildLogger(configuration, logDirectory);
        var filePrefix = Path.Combine(logDirectory, "trade-execution");
        _logger.Information(
            "Trade execution log started directory={LogDirectory} filePrefix={FilePrefix}-YYYYMMDD.log",
            logDirectory,
            filePrefix);
        EntryAuditLog.TradeChannel(
            LogEventLevel.Information,
            "Trade execution log active at {LogDirectory} (files: trade-execution-YYYYMMDD.log)",
            logDirectory);
    }

    private static ILogger BuildLogger(
        IConfiguration? configuration = null,
        string? logDirectory = null)
    {
        configuration ??= new ConfigurationBuilder().Build();
        logDirectory ??= ApplicationLogPaths.ResolveLogDirectory(configuration);
        var retained = configuration.GetValue("Serilog:TradeExecution:RetainedFileCountLimit", 180);

        return new LoggerConfiguration()
            .MinimumLevel.Is(LogEventLevel.Debug)
            .Enrich.FromLogContext()
            .Enrich.WithProperty(TradeExecutionLogProperties.IsTradeExecution, true)
            .Enrich.WithProperty("Application", "PolyTrader")
            .Enrich.WithProperty("LogChannel", "TradeExecution")
            .WriteTo.File(
                Path.Combine(logDirectory, "trade-execution-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: retained,
                shared: true,
                outputTemplate:
                    "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
            .CreateLogger();
    }
}
