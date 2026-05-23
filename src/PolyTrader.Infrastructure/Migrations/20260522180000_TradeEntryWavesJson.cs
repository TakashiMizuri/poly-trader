using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PolyTrader.Infrastructure.Migrations;

/// <inheritdoc />
public partial class TradeEntryWavesJson : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "EntryWavesJson",
            table: "Trades",
            type: "TEXT",
            nullable: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "EntryWavesJson",
            table: "Trades");
    }
}
