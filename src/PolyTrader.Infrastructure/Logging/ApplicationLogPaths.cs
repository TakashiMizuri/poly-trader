using Microsoft.Extensions.Configuration;

namespace PolyTrader.Infrastructure.Logging;

public static class ApplicationLogPaths
{
    public static string ResolveLogDirectory(IConfiguration configuration) =>
        configuration["Serilog:LogDirectory"]
        ?? Environment.GetEnvironmentVariable("POLYTRADER_LOG_DIR")
        ?? "logs";
}
