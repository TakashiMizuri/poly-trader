using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Strategy;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Infrastructure.Data;

public sealed class PolyTraderDbContext(DbContextOptions<PolyTraderDbContext> options) : DbContext(options)
{
    public DbSet<EngineSettingsEntity> EngineSettings => Set<EngineSettingsEntity>();
    public DbSet<PaperAccountEntity> PaperAccounts => Set<PaperAccountEntity>();
    public DbSet<MarketEntity> Markets => Set<MarketEntity>();
    public DbSet<TradeEntity> Trades => Set<TradeEntity>();
    public DbSet<PositionEntity> Positions => Set<PositionEntity>();
    public DbSet<BalanceSnapshotEntity> BalanceSnapshots => Set<BalanceSnapshotEntity>();
    public DbSet<CandleSnapshotEntity> CandleSnapshots => Set<CandleSnapshotEntity>();
    public DbSet<SkippedBetEntity> SkippedBets => Set<SkippedBetEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<EngineSettingsEntity>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.TradingMode).HasConversion<string>();
            e.Property(x => x.BetStakeMode).HasConversion<string>();
            e.Property(x => x.PendingBetStakeMode).HasConversion<string>();
            e.HasOne(x => x.ActivePaperAccount)
                .WithMany()
                .HasForeignKey(x => x.ActivePaperAccountId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<PaperAccountEntity>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(100);
        });

        modelBuilder.Entity<MarketEntity>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.ConditionId);
        });

        modelBuilder.Entity<TradeEntity>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.CandleTime);
            e.HasIndex(x => new { x.CandleTime, x.Mode, x.PaperAccountId }).IsUnique();
            e.Property(x => x.Side).HasConversion<string>();
            e.Property(x => x.Trend).HasConversion<string>();
            e.Property(x => x.Mode).HasConversion<string>();
        });

        modelBuilder.Entity<PositionEntity>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Side).HasConversion<string>();
            e.Property(x => x.Mode).HasConversion<string>();
        });

        modelBuilder.Entity<CandleSnapshotEntity>(e =>
        {
            e.HasKey(x => x.Time);
        });

        modelBuilder.Entity<SkippedBetEntity>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.CandleTime, x.Mode, x.PaperAccountId, x.MarketId }).IsUnique();
            e.Property(x => x.Mode).HasConversion<string>();
            e.Property(x => x.SkipReason).HasMaxLength(64);
            e.HasOne(x => x.Market)
                .WithMany()
                .HasForeignKey(x => x.MarketId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
