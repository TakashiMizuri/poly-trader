using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PolyTrader.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class EngineLiveEntryOrderMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LiveEntryOrderMode",
                table: "EngineSettings",
                type: "TEXT",
                nullable: false,
                defaultValue: "Limit");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LiveEntryOrderMode",
                table: "EngineSettings");
        }
    }
}
