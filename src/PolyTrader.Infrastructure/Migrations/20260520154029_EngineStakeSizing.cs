using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PolyTrader.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class EngineStakeSizing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BetStakeMode",
                table: "EngineSettings",
                type: "TEXT",
                nullable: false,
                defaultValue: "Percent");

            migrationBuilder.AddColumn<double>(
                name: "BetStakePercent",
                table: "EngineSettings",
                type: "REAL",
                nullable: false,
                defaultValue: 3.0);

            migrationBuilder.AddColumn<double>(
                name: "MaxBetStakeUsd",
                table: "EngineSettings",
                type: "REAL",
                nullable: true,
                defaultValue: 500.0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BetStakeMode",
                table: "EngineSettings");

            migrationBuilder.DropColumn(
                name: "BetStakePercent",
                table: "EngineSettings");

            migrationBuilder.DropColumn(
                name: "MaxBetStakeUsd",
                table: "EngineSettings");
        }
    }
}
