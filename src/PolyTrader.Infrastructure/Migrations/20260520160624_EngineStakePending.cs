using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PolyTrader.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class EngineStakePending : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PendingBetStakeMode",
                table: "EngineSettings",
                type: "TEXT",
                nullable: false,
                defaultValue: "Percent");

            migrationBuilder.AddColumn<double>(
                name: "PendingBetStakePercent",
                table: "EngineSettings",
                type: "REAL",
                nullable: false,
                defaultValue: 3.0);

            migrationBuilder.AddColumn<double>(
                name: "PendingBetStakeUsd",
                table: "EngineSettings",
                type: "REAL",
                nullable: false,
                defaultValue: 1.0);

            migrationBuilder.AddColumn<double>(
                name: "PendingMaxBetStakeUsd",
                table: "EngineSettings",
                type: "REAL",
                nullable: true,
                defaultValue: 500.0);

            migrationBuilder.Sql(
                """
                UPDATE "EngineSettings"
                SET
                    "PendingBetStakeMode" = "BetStakeMode",
                    "PendingBetStakeUsd" = "BetStakeUsd",
                    "PendingBetStakePercent" = "BetStakePercent",
                    "PendingMaxBetStakeUsd" = "MaxBetStakeUsd";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PendingBetStakeMode",
                table: "EngineSettings");

            migrationBuilder.DropColumn(
                name: "PendingBetStakePercent",
                table: "EngineSettings");

            migrationBuilder.DropColumn(
                name: "PendingBetStakeUsd",
                table: "EngineSettings");

            migrationBuilder.DropColumn(
                name: "PendingMaxBetStakeUsd",
                table: "EngineSettings");
        }
    }
}
