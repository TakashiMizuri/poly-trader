using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PolyTrader.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class EngineAutoRedeemEnabled : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AutoRedeemEnabled",
                table: "EngineSettings",
                type: "INTEGER",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AutoRedeemEnabled",
                table: "EngineSettings");
        }
    }
}
