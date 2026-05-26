using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Binance;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Options;
using PolyTrader.Infrastructure.Polymarket;
using PolyTrader.Infrastructure.Services;
using PolyTrader.Infrastructure.Telegram;

namespace PolyTrader.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddPolyTraderInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var section = configuration.GetSection(PolyTraderOptions.SectionName);
        services.Configure<PolyTraderOptions>(opts =>
        {
            section.Bind(opts);
            opts.PolymarketPrivateKey ??= configuration["POLYMARKET_PRIVATE_KEY"];
            opts.PolymarketFunderAddress ??= configuration["POLYMARKET_FUNDER_ADDRESS"];
            if (int.TryParse(configuration["POLYMARKET_SIGNATURE_TYPE"], out var sig))
            {
                opts.PolymarketSignatureType = sig;
            }

            opts.WebApiToken ??= configuration["WEB_API_TOKEN"];
            opts.PolymarketPolygonRpc ??= configuration["POLYMARKET_POLYGON_RPC"];
            opts.CorsOrigins ??= configuration["CORS_ORIGINS"];
            opts.TelegramBotToken ??= configuration["TELEGRAM_BOT_TOKEN"];
            opts.TelegramAdminChatIds ??= configuration["TELEGRAM_ADMIN_CHAT_IDS"];

            if (int.TryParse(configuration["POLYTRADER_LIVE_MAKER_FILL_WAIT_SECONDS"], out var makerWait)
                && makerWait >= 1)
            {
                opts.LiveMakerFillWaitSeconds = makerWait;
            }

            if (int.TryParse(configuration["POLYTRADER_LIVE_MAKER_REMAINDER_FILL_WAIT_SECONDS"], out var remainderWait)
                && remainderWait >= 1)
            {
                opts.LiveMakerRemainderFillWaitSeconds = remainderWait;
            }
        });

        services.AddHttpClient();
        services.AddDbContext<PolyTraderDbContext>(db =>
            db.UseSqlite(
                configuration.GetConnectionString("DefaultConnection")
                ?? configuration[$"{PolyTraderOptions.SectionName}:ConnectionString"]
                ?? "Data Source=polytrader.db",
                o => o.MigrationsAssembly(typeof(PolyTraderDbContext).Assembly.FullName)));

        services.AddSingleton<IBinanceMarketService, BinanceMarketService>();
        services.AddSingleton<IPolymarketGammaService, PolymarketGammaService>();
        services.AddSingleton<IPolymarketDataApiService, PolymarketDataApiService>();
        services.AddSingleton<IPolymarketMarketWebSocket, PolymarketMarketWebSocket>();
        services.AddSingleton<IPolymarketWalletResolver, PolymarketWalletResolver>();
        services.AddSingleton<IPolymarketRestTradingClient, PolymarketRestTradingClient>();
        services.AddSingleton<IPolymarketClobService, PolymarketClobService>();
        services.AddSingleton<LiveTradeOutcomeResolver>();
        services.AddSingleton<ILiveTradeSettlementService, LiveTradeSettlementService>();
        services.AddSingleton<LiveTradeReconciliationService>();
        services.AddSingleton<IPolymarketCtfRedeemService, PolymarketCtfRedeemService>();
        services.AddSingleton<IPolymarketRedeemService, PolymarketRedeemService>();
        services.AddSingleton<IConnectivityService, ConnectivityService>();
        services.AddSingleton<IEntryWaitTracker, EntryWaitTracker>();
        services.AddSingleton<IEntryPatienceExecutor, EntryPatienceExecutor>();
        services.AddScoped<GlobalResetService>();
        services.AddScoped<InProgressWindowSkipService>();
        services.AddScoped<BalanceHistoryService>();
        services.AddScoped<IEngineSettingsService, EngineSettingsService>();
        services.AddScoped<LimitEntryPreviewService>();
        services.AddSingleton<ITelegramNotifier, TelegramNotifier>();
        services.AddSingleton<BalanceChartImageBuilder>();
        services.AddHostedService<TradingEngineHostedService>();
        services.AddHostedService<PolymarketRedeemHostedService>();
        services.AddHostedService<LiveTradeReconciliationHostedService>();

        return services;
    }

    public static async Task InitializeDatabaseAsync(this IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var logger = scope.ServiceProvider.GetService<ILogger<PolyTraderDbContext>>();

        logger?.LogInformation("Applying database migrations");
        await db.Database.MigrateAsync();
        logger?.LogInformation("Database migrations complete");
        await EnsureEngineStakeSizingColumnsAsync(db, logger);
        await EnsureEngineStakePendingColumnsAsync(db, logger);
        await EnsureTradeRequestedStakeUsdColumnAsync(db, logger);
        await EnsureTradeStakeSnapshotColumnsAsync(db, logger);
        await EnsureTradeEntryWavesJsonColumnAsync(db, logger);
        await EnsureEngineAutoRedeemEnabledColumnAsync(db, logger);
        var importedEntryModeFromEnv = await EnsureEngineLiveEntryOrderModeColumnAsync(
            db,
            configuration,
            logger);

        if (!await SchemaTableExistsAsync(db, "EngineSettings"))
        {
            logger?.LogWarning(
                "Database schema is missing after migration (corrupt or stale history). Recreating database.");
            await db.Database.EnsureDeletedAsync();
            await db.Database.MigrateAsync();
        }

        if (!await db.EngineSettings.AnyAsync())
        {
            logger?.LogInformation("Seeding default engine settings");
            var seed = new Entities.EngineSettingsEntity();
            if (importedEntryModeFromEnv is not null)
            {
                seed.LiveEntryOrderMode = importedEntryModeFromEnv;
            }

            db.EngineSettings.Add(seed);
            await db.SaveChangesAsync();
        }
        else if (importedEntryModeFromEnv is not null)
        {
            var settings = await db.EngineSettings.FirstAsync();
            settings.LiveEntryOrderMode = importedEntryModeFromEnv;
            settings.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            logger?.LogInformation(
                "Imported live entry order mode from POLYTRADER_LIVE_ENTRY_ORDER_MODE: {Mode}",
                importedEntryModeFromEnv);
        }

        if (!await db.PaperAccounts.AnyAsync())
        {
            logger?.LogInformation("Seeding default paper account");
            var defaultAccount = new Entities.PaperAccountEntity
            {
                Name = "Default paper",
                InitialBalance = 100,
                Balance = 100
            };
            db.PaperAccounts.Add(defaultAccount);
            await db.SaveChangesAsync();

            var settings = await db.EngineSettings.FirstAsync();
            settings.ActivePaperAccountId = defaultAccount.Id;
            settings.TradingMode = Core.Models.TradingMode.Paper;
            settings.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        else
        {
            var settings = await db.EngineSettings.FirstAsync();
            if (settings.ActivePaperAccountId == null)
            {
                var first = await db.PaperAccounts
                    .Where(a => !a.IsArchived)
                    .OrderBy(a => a.Id)
                    .FirstOrDefaultAsync();
                if (first != null)
                {
                    settings.ActivePaperAccountId = first.Id;
                    settings.UpdatedAt = DateTime.UtcNow;
                    await db.SaveChangesAsync();
                }
            }
        }
    }

    /// <summary>
    /// Repairs DBs where <c>EngineStakeSizing</c> was recorded in history but <c>Up()</c> was empty
    /// (snapshot was updated before <c>dotnet ef migrations add</c>).
    /// </summary>
    private static async Task EnsureEngineStakeSizingColumnsAsync(
        PolyTraderDbContext db,
        ILogger<PolyTraderDbContext>? logger)
    {
        if (!await SchemaTableExistsAsync(db, "EngineSettings"))
        {
            return;
        }

        if (await ColumnExistsAsync(db, "EngineSettings", "BetStakeMode"))
        {
            return;
        }

        logger?.LogWarning(
            "EngineSettings is missing stake sizing columns; applying schema repair.");

        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "EngineSettings" ADD COLUMN "BetStakeMode" TEXT NOT NULL DEFAULT 'Percent';
            """);
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "EngineSettings" ADD COLUMN "BetStakePercent" REAL NOT NULL DEFAULT 3;
            """);
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "EngineSettings" ADD COLUMN "MaxBetStakeUsd" REAL NULL DEFAULT 500;
            """);

        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT OR IGNORE INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
            VALUES ('20260520154029_EngineStakeSizing', '10.0.8');
            """);
    }

    private static async Task EnsureEngineStakePendingColumnsAsync(
        PolyTraderDbContext db,
        ILogger<PolyTraderDbContext>? logger)
    {
        if (!await SchemaTableExistsAsync(db, "EngineSettings"))
        {
            return;
        }

        if (await ColumnExistsAsync(db, "EngineSettings", "PendingBetStakeMode"))
        {
            return;
        }

        logger?.LogWarning(
            "EngineSettings is missing pending stake columns; applying schema repair.");

        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "EngineSettings" ADD COLUMN "PendingBetStakeMode" TEXT NOT NULL DEFAULT 'Percent';
            """);
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "EngineSettings" ADD COLUMN "PendingBetStakeUsd" REAL NOT NULL DEFAULT 1;
            """);
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "EngineSettings" ADD COLUMN "PendingBetStakePercent" REAL NOT NULL DEFAULT 3;
            """);
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "EngineSettings" ADD COLUMN "PendingMaxBetStakeUsd" REAL NULL DEFAULT 500;
            """);
        await db.Database.ExecuteSqlRawAsync(
            """
            UPDATE "EngineSettings"
            SET
                "PendingBetStakeMode" = "BetStakeMode",
                "PendingBetStakeUsd" = "BetStakeUsd",
                "PendingBetStakePercent" = "BetStakePercent",
                "PendingMaxBetStakeUsd" = "MaxBetStakeUsd";
            """);

        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT OR IGNORE INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
            VALUES ('20260520160624_EngineStakePending', '10.0.8');
            """);
    }

    private static async Task EnsureTradeStakeSnapshotColumnsAsync(
        PolyTraderDbContext db,
        ILogger<PolyTraderDbContext>? logger)
    {
        if (!await SchemaTableExistsAsync(db, "Trades"))
        {
            return;
        }

        if (await ColumnExistsAsync(db, "Trades", "StakeBalanceUsd"))
        {
            return;
        }

        logger?.LogWarning(
            "Trades is missing stake snapshot / payout ratio columns; applying schema repair.");

        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "Trades" ADD COLUMN "StakeBalanceUsd" REAL NULL;
            """);
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "Trades" ADD COLUMN "BetStakeMode" TEXT NULL;
            """);
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "Trades" ADD COLUMN "BetStakePercent" REAL NULL;
            """);
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "Trades" ADD COLUMN "BetStakeFixedUsd" REAL NULL;
            """);
        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "Trades" ADD COLUMN "WinPayoutRatio" REAL NULL;
            """);

        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT OR IGNORE INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
            VALUES ('20260526120000_TradeStakeSnapshot', '10.0.8');
            """);
    }

    private static async Task EnsureTradeEntryWavesJsonColumnAsync(
        PolyTraderDbContext db,
        ILogger<PolyTraderDbContext>? logger)
    {
        if (!await SchemaTableExistsAsync(db, "Trades"))
        {
            return;
        }

        if (await ColumnExistsAsync(db, "Trades", "EntryWavesJson"))
        {
            return;
        }

        logger?.LogWarning("Trades is missing EntryWavesJson column; applying schema repair.");

        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "Trades" ADD COLUMN "EntryWavesJson" TEXT NULL;
            """);

        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT OR IGNORE INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
            VALUES ('20260522180000_TradeEntryWavesJson', '10.0.8');
            """);
    }

    private static async Task EnsureEngineAutoRedeemEnabledColumnAsync(
        PolyTraderDbContext db,
        ILogger<PolyTraderDbContext>? logger)
    {
        if (!await SchemaTableExistsAsync(db, "EngineSettings"))
        {
            return;
        }

        if (await ColumnExistsAsync(db, "EngineSettings", "AutoRedeemEnabled"))
        {
            return;
        }

        logger?.LogWarning(
            "EngineSettings is missing AutoRedeemEnabled column; applying schema repair.");

        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "EngineSettings" ADD COLUMN "AutoRedeemEnabled" INTEGER NOT NULL DEFAULT 1;
            """);

        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT OR IGNORE INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
            VALUES ('20260522120000_EngineAutoRedeemEnabled', '10.0.8');
            """);
    }

    /// <summary>
    /// Returns a normalized mode from legacy <c>POLYTRADER_LIVE_ENTRY_ORDER_MODE</c> when the column was just added.
    /// </summary>
    private static async Task<string?> EnsureEngineLiveEntryOrderModeColumnAsync(
        PolyTraderDbContext db,
        IConfiguration configuration,
        ILogger<PolyTraderDbContext>? logger)
    {
        if (!await SchemaTableExistsAsync(db, "EngineSettings"))
        {
            return null;
        }

        var columnExisted = await ColumnExistsAsync(db, "EngineSettings", "LiveEntryOrderMode");
        if (columnExisted)
        {
            return null;
        }

        logger?.LogWarning(
            "EngineSettings is missing LiveEntryOrderMode column; applying schema repair.");

        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "EngineSettings" ADD COLUMN "LiveEntryOrderMode" TEXT NOT NULL DEFAULT 'Limit';
            """);

        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT OR IGNORE INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
            VALUES ('20260523120000_EngineLiveEntryOrderMode', '10.0.8');
            """);

        var envMode = configuration["POLYTRADER_LIVE_ENTRY_ORDER_MODE"];
        return string.IsNullOrWhiteSpace(envMode)
            ? null
            : LiveEntryOrderModes.Normalize(envMode);
    }

    private static async Task EnsureTradeRequestedStakeUsdColumnAsync(
        PolyTraderDbContext db,
        ILogger<PolyTraderDbContext>? logger)
    {
        if (!await SchemaTableExistsAsync(db, "Trades"))
        {
            return;
        }

        if (await ColumnExistsAsync(db, "Trades", "RequestedStakeUsd"))
        {
            return;
        }

        logger?.LogWarning(
            "Trades is missing RequestedStakeUsd column; applying schema repair.");

        await db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "Trades" ADD COLUMN "RequestedStakeUsd" REAL NULL;
            """);

        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT OR IGNORE INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
            VALUES ('20260521152022_TradeRequestedStakeUsd', '10.0.8');
            """);
    }

    private static async Task<bool> ColumnExistsAsync(
        PolyTraderDbContext db,
        string tableName,
        string columnName)
    {
        var connection = db.Database.GetDbConnection();
        await connection.OpenAsync();
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = $"PRAGMA table_info(\"{tableName}\")";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var name = reader.GetString(1);
                if (string.Equals(name, columnName, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }
        finally
        {
            await connection.CloseAsync();
        }
    }

    private static async Task<bool> SchemaTableExistsAsync(PolyTraderDbContext db, string tableName)
    {
        var connection = db.Database.GetDbConnection();
        await connection.OpenAsync();
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText =
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $name";
            var param = command.CreateParameter();
            param.ParameterName = "$name";
            param.Value = tableName;
            command.Parameters.Add(param);
            var count = Convert.ToInt32(await command.ExecuteScalarAsync());
            return count > 0;
        }
        finally
        {
            await connection.CloseAsync();
        }
    }
}
