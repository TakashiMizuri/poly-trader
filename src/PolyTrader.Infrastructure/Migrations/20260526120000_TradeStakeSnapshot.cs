using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PolyTrader.Infrastructure.Migrations;

/// <inheritdoc />
public partial class TradeStakeSnapshot : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<double>(
            name: "BetStakeFixedUsd",
            table: "Trades",
            type: "REAL",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "BetStakeMode",
            table: "Trades",
            type: "TEXT",
            nullable: true);

        migrationBuilder.AddColumn<double>(
            name: "BetStakePercent",
            table: "Trades",
            type: "REAL",
            nullable: true);

        migrationBuilder.AddColumn<double>(
            name: "StakeBalanceUsd",
            table: "Trades",
            type: "REAL",
            nullable: true);

        migrationBuilder.AddColumn<double>(
            name: "WinPayoutRatio",
            table: "Trades",
            type: "REAL",
            nullable: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "BetStakeFixedUsd",
            table: "Trades");

        migrationBuilder.DropColumn(
            name: "BetStakeMode",
            table: "Trades");

        migrationBuilder.DropColumn(
            name: "BetStakePercent",
            table: "Trades");

        migrationBuilder.DropColumn(
            name: "StakeBalanceUsd",
            table: "Trades");

        migrationBuilder.DropColumn(
            name: "WinPayoutRatio",
            table: "Trades");
    }
}
