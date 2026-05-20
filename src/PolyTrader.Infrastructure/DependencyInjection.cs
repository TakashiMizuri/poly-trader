using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using PolyTrader.Infrastructure.Binance;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Options;
using PolyTrader.Infrastructure.Polymarket;
using PolyTrader.Infrastructure.Services;

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
        services.AddSingleton<IPolymarketMarketWebSocket, PolymarketMarketWebSocket>();
        services.AddSingleton<IPolymarketClobService, PolymarketClobService>();
        services.AddSingleton<IConnectivityService, ConnectivityService>();
        services.AddHostedService<TradingEngineHostedService>();

        return services;
    }

    public static async Task InitializeDatabaseAsync(this IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PolyTraderDbContext>();
        var logger = scope.ServiceProvider.GetService<ILogger<PolyTraderDbContext>>();

        await db.Database.MigrateAsync();

        if (!await SchemaTableExistsAsync(db, "EngineSettings"))
        {
            logger?.LogWarning(
                "Database schema is missing after migration (corrupt or stale history). Recreating database.");
            await db.Database.EnsureDeletedAsync();
            await db.Database.MigrateAsync();
        }

        if (!await db.EngineSettings.AnyAsync())
        {
            db.EngineSettings.Add(new Entities.EngineSettingsEntity());
            await db.SaveChangesAsync();
        }

        if (!await db.PaperAccounts.AnyAsync())
        {
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
