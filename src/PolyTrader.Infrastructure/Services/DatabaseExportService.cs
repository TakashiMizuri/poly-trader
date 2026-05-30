using System.IO.Compression;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Infrastructure.Services;

public sealed record DatabaseExportResult(Stream Stream, string FileName, IReadOnlyList<string> TempPaths);

public interface IDatabaseExportService
{
    Task<DatabaseExportResult> CreateExportAsync(CancellationToken cancellationToken = default);
}

public sealed class DatabaseExportService : IDatabaseExportService
{
    private readonly string _connectionString;
    private readonly ILogger<DatabaseExportService> _logger;

    public DatabaseExportService(IConfiguration configuration, ILogger<DatabaseExportService> logger)
    {
        _connectionString =
            configuration.GetConnectionString("DefaultConnection")
            ?? configuration[$"{PolyTraderOptions.SectionName}:ConnectionString"]
            ?? "Data Source=polytrader.db";
        _logger = logger;
    }

    public async Task<DatabaseExportResult> CreateExportAsync(CancellationToken cancellationToken = default)
    {
        var exportId = Guid.NewGuid().ToString("N");
        var tempDbPath = Path.Combine(Path.GetTempPath(), $"polytrader-export-{exportId}.db");
        var tempZipPath = Path.Combine(Path.GetTempPath(), $"polytrader-export-{exportId}.zip");
        var tempPaths = new List<string> { tempDbPath, tempZipPath };

        try
        {
            await using (var source = new SqliteConnection(_connectionString))
            {
                await source.OpenAsync(cancellationToken);
                await using var destination = new SqliteConnection($"Data Source={tempDbPath}");
                await destination.OpenAsync(cancellationToken);
                source.BackupDatabase(destination);
            }

            using (var archive = ZipFile.Open(tempZipPath, ZipArchiveMode.Create))
            {
                archive.CreateEntryFromFile(tempDbPath, "polytrader.db", CompressionLevel.Optimal);
            }

            File.Delete(tempDbPath);
            tempPaths.Remove(tempDbPath);

            var fileName = $"polytrader-db-{DateTime.UtcNow:yyyyMMdd-HHmmss}.zip";
            var stream = new FileStream(
                tempZipPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 4096,
                FileOptions.DeleteOnClose | FileOptions.Asynchronous);

            _logger.LogInformation("Prepared SQLite database export {FileName}", fileName);
            return new DatabaseExportResult(stream, fileName, tempPaths);
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
