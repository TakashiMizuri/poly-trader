using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PolyTrader.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class BalanceSnapshotCandleTime : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "CandleTime",
                table: "BalanceSnapshots",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_BalanceSnapshots_PaperAccountId_CandleTime",
                table: "BalanceSnapshots",
                columns: new[] { "PaperAccountId", "CandleTime" });

            migrationBuilder.Sql(
                """
                UPDATE "EngineSettings"
                SET "CommissionPercent" = 3.5
                WHERE "CommissionPercent" = 1.8;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_BalanceSnapshots_PaperAccountId_CandleTime",
                table: "BalanceSnapshots");

            migrationBuilder.DropColumn(
                name: "CandleTime",
                table: "BalanceSnapshots");
        }
    }
}
