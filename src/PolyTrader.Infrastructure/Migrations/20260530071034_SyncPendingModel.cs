using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PolyTrader.Infrastructure.Migrations;

/// <summary>
/// Aligns EF model snapshot with runtime entities. Column DDL is applied idempotently at startup
/// (see <see cref="DependencyInjection.InitializeDatabaseAsync"/>) so existing VPS databases
/// that already received schema repair do not fail on duplicate ALTER TABLE.
/// </summary>
public partial class SyncPendingModel : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
    }
}
