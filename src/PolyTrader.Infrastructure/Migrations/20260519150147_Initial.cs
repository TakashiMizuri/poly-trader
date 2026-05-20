using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PolyTrader.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BalanceSnapshots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Timestamp = table.Column<DateTime>(type: "TEXT", nullable: false),
                    CashBalance = table.Column<double>(type: "REAL", nullable: false),
                    Equity = table.Column<double>(type: "REAL", nullable: true),
                    Source = table.Column<string>(type: "TEXT", nullable: false),
                    PaperAccountId = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BalanceSnapshots", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CandleSnapshots",
                columns: table => new
                {
                    Time = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Open = table.Column<double>(type: "REAL", nullable: false),
                    High = table.Column<double>(type: "REAL", nullable: false),
                    Low = table.Column<double>(type: "REAL", nullable: false),
                    Close = table.Column<double>(type: "REAL", nullable: false),
                    RecordedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CandleSnapshots", x => x.Time);
                });

            migrationBuilder.CreateTable(
                name: "Markets",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ConditionId = table.Column<string>(type: "TEXT", nullable: false),
                    Slug = table.Column<string>(type: "TEXT", nullable: true),
                    Title = table.Column<string>(type: "TEXT", nullable: true),
                    YesTokenId = table.Column<string>(type: "TEXT", nullable: false),
                    NoTokenId = table.Column<string>(type: "TEXT", nullable: false),
                    WindowStartUtc = table.Column<DateTime>(type: "TEXT", nullable: true),
                    WindowEndUtc = table.Column<DateTime>(type: "TEXT", nullable: true),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Markets", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PaperAccounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    InitialBalance = table.Column<double>(type: "REAL", nullable: false),
                    Balance = table.Column<double>(type: "REAL", nullable: false),
                    IsArchived = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaperAccounts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Positions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    MarketId = table.Column<int>(type: "INTEGER", nullable: false),
                    Side = table.Column<string>(type: "TEXT", nullable: false),
                    SizeUsd = table.Column<double>(type: "REAL", nullable: false),
                    AvgPrice = table.Column<double>(type: "REAL", nullable: false),
                    Mode = table.Column<string>(type: "TEXT", nullable: false),
                    IsOpen = table.Column<bool>(type: "INTEGER", nullable: false),
                    OpenedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ClosedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Positions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Positions_Markets_MarketId",
                        column: x => x.MarketId,
                        principalTable: "Markets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Trades",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    CandleTime = table.Column<long>(type: "INTEGER", nullable: false),
                    Side = table.Column<string>(type: "TEXT", nullable: false),
                    Trend = table.Column<string>(type: "TEXT", nullable: false),
                    Mode = table.Column<string>(type: "TEXT", nullable: false),
                    PaperAccountId = table.Column<int>(type: "INTEGER", nullable: false),
                    StakeUsd = table.Column<double>(type: "REAL", nullable: false),
                    EntryPrice = table.Column<double>(type: "REAL", nullable: false),
                    Won = table.Column<bool>(type: "INTEGER", nullable: true),
                    PnlUsd = table.Column<double>(type: "REAL", nullable: true),
                    PolymarketOrderId = table.Column<string>(type: "TEXT", nullable: true),
                    MarketId = table.Column<int>(type: "INTEGER", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Trades", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Trades_Markets_MarketId",
                        column: x => x.MarketId,
                        principalTable: "Markets",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "EngineSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TradingMode = table.Column<string>(type: "TEXT", nullable: false),
                    ActivePaperAccountId = table.Column<int>(type: "INTEGER", nullable: true),
                    IsRunning = table.Column<bool>(type: "INTEGER", nullable: false),
                    BetStakeUsd = table.Column<double>(type: "REAL", nullable: false),
                    CommissionPercent = table.Column<double>(type: "REAL", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EngineSettings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EngineSettings_PaperAccounts_ActivePaperAccountId",
                        column: x => x.ActivePaperAccountId,
                        principalTable: "PaperAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EngineSettings_ActivePaperAccountId",
                table: "EngineSettings",
                column: "ActivePaperAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_Markets_ConditionId",
                table: "Markets",
                column: "ConditionId");

            migrationBuilder.CreateIndex(
                name: "IX_Positions_MarketId",
                table: "Positions",
                column: "MarketId");

            migrationBuilder.CreateIndex(
                name: "IX_Trades_CandleTime",
                table: "Trades",
                column: "CandleTime");

            migrationBuilder.CreateIndex(
                name: "IX_Trades_CandleTime_Mode_PaperAccountId",
                table: "Trades",
                columns: new[] { "CandleTime", "Mode", "PaperAccountId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Trades_MarketId",
                table: "Trades",
                column: "MarketId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BalanceSnapshots");

            migrationBuilder.DropTable(
                name: "CandleSnapshots");

            migrationBuilder.DropTable(
                name: "EngineSettings");

            migrationBuilder.DropTable(
                name: "Positions");

            migrationBuilder.DropTable(
                name: "Trades");

            migrationBuilder.DropTable(
                name: "PaperAccounts");

            migrationBuilder.DropTable(
                name: "Markets");
        }
    }
}
