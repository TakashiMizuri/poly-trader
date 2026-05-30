using System.IO.Compression;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using PolyTrader.Infrastructure.Logging;

namespace PolyTrader.Infrastructure.Services;

public sealed record LogExportResult(Stream Stream, string FileName, IReadOnlyList<string> TempPaths);

public interface ILogExportService
{
    Task<LogExportResult> CreateExportAsync(CancellationToken cancellationToken = default);
}

public sealed class LogExportService : ILogExportService
{
    private readonly string _logDirectory;
    private readonly ILogger<LogExportService> _logger;

    public LogExportService(IConfiguration configuration, ILogger<LogExportService> logger)
    {
        _logDirectory = ApplicationLogPaths.ResolveLogDirectory(configuration);
        _logger = logger;
    }

    public Task<LogExportResult> CreateExportAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var logFiles = EnumerateLogFiles().OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToList();
        if (logFiles.Count == 0)
        {
            throw new InvalidOperationException("No log files found to export.");
        }

        var exportId = Guid.NewGuid().ToString("N");
        var tempZipPath = Path.Combine(Path.GetTempPath(), $"polytrader-logs-export-{exportId}.zip");
        var tempPaths = new List<string> { tempZipPath };

        try
        {
            using (var archive = ZipFile.Open(tempZipPath, ZipArchiveMode.Create))
            {
                foreach (var path in logFiles)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var entryName = Path.GetFileName(path);
                    archive.CreateEntryFromFile(path, entryName, CompressionLevel.Optimal);
                }
            }

            var fileName = $"polytrader-logs-{DateTime.UtcNow:yyyyMMdd-HHmmss}.zip";
            var stream = new FileStream(
                tempZipPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 4096,
                FileOptions.DeleteOnClose | FileOptions.Asynchronous);

            _logger.LogInformation(
                "Prepared log export {FileName} with {FileCount} file(s) from {LogDirectory}",
                fileName,
                logFiles.Count,
                _logDirectory);
            return Task.FromResult(new LogExportResult(stream, fileName, tempPaths));
        }
        catch
        {
            foreach (var path in tempPaths)
            {
                TryDelete(path);
            }

            throw;
        }
    }

    private IEnumerable<string> EnumerateLogFiles()
    {
        if (!Directory.Exists(_logDirectory))
        {
            yield break;
        }

        foreach (var path in Directory.EnumerateFiles(_logDirectory, "polytrader-*.log")
            .Concat(Directory.EnumerateFiles(_logDirectory, "trade-execution-*.log")))
        {
            yield return path;
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // Best-effort cleanup for temp export files.
        }
    }
}
