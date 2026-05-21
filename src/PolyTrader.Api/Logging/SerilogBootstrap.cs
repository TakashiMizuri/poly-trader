using Microsoft.Extensions.Configuration;
using PolyTrader.Infrastructure.Logging;
using Serilog;
using Serilog.Events;

namespace PolyTrader.Api.Logging;

public static class SerilogBootstrap
{
    private const string OutputTemplate =
        "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] [{SourceContext}] {Message:lj}{NewLine}{Exception}";

    public static void Configure(WebApplicationBuilder builder)
    {
        ConfigureLogger(builder.Configuration);
        builder.Host.UseSerilog();
    }

    public static void ConfigureLogger(IConfiguration configuration)
    {
        var logDirectory = ApplicationLogPaths.ResolveLogDirectory(configuration);
        Directory.CreateDirectory(logDirectory);

        var retained = configuration.GetValue("Serilog:RetainedFileCountLimit", 90);
        var minLevel = ParseLevel(
            configuration["Serilog:MinimumLevel"]
            ?? Environment.GetEnvironmentVariable("POLYTRADER_LOG_LEVEL"),
            LogEventLevel.Information);

        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Is(minLevel)
            .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
            .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
            .MinimumLevel.Override("Microsoft.EntityFrameworkCore", LogEventLevel.Warning)
            .MinimumLevel.Override("System.Net.Http.HttpClient", LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .Enrich.WithProperty("Application", "PolyTrader")
            .Enrich.WithProperty("MachineName", Environment.MachineName)
            .WriteTo.Console(outputTemplate: OutputTemplate)
            .WriteTo.File(
                Path.Combine(logDirectory, "polytrader-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: retained,
                shared: true,
                outputTemplate: OutputTemplate)
            .CreateLogger();
    }

    private static LogEventLevel ParseLevel(string? value, LogEventLevel fallback) =>
        Enum.TryParse<LogEventLevel>(value, ignoreCase: true, out var level) ? level : fallback;
}
