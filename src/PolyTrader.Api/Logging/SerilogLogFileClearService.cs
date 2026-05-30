using PolyTrader.Core.Abstractions;
using PolyTrader.Infrastructure.Logging;
using Serilog;

namespace PolyTrader.Api.Logging;

public sealed class SerilogLogFileClearService(IConfiguration configuration) : ILogFileClearService
{
    public int ClearLogFiles()
    {
        Log.CloseAndFlush();

        var directory = ApplicationLogPaths.ResolveLogDirectory(configuration);
        var deleted = 0;
        var failed = new List<string>();

        if (Directory.Exists(directory))
        {
            foreach (var path in Directory.EnumerateFiles(directory, "polytrader-*.log")
                .Concat(Directory.EnumerateFiles(directory, "trade-execution-*.log")))
            {
                try
                {
                    File.Delete(path);
                    deleted++;
                }
                catch (IOException)
                {
                    failed.Add(path);
                }
                catch (UnauthorizedAccessException)
                {
                    failed.Add(path);
                }
            }
        }

        SerilogBootstrap.ConfigureLogger(configuration);

        if (failed.Count > 0)
        {
            Log.Warning(
                "Global reset: deleted {DeletedCount} log file(s); could not delete {FailedCount} (another process may be tailing them): {Paths}",
                deleted,
                failed.Count,
                string.Join(", ", failed));
        }

        return deleted;
    }
}
