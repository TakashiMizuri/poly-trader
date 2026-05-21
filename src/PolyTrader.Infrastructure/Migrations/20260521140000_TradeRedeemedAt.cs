using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PolyTrader.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TradeRedeemedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "RedeemedAt",
                table: "Trades",
                type: "TEXT",
                nullable: true);

            migrationBuilder.Sql(
                """
                UPDATE "Trades"
                SET "RedeemedAt" = "CreatedAt"
                WHERE "Mode" = 'Live' AND "Won" = 1 AND "RedeemedAt" IS NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RedeemedAt",
                table: "Trades");
        }
    }
}
