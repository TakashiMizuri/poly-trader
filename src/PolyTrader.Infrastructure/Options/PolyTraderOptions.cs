namespace PolyTrader.Infrastructure.Options;

public sealed class PolyTraderOptions
{
    public const string SectionName = "PolyTrader";

    public string ConnectionString { get; set; } = "Data Source=polytrader.db";
    public string? WebApiToken { get; set; }
    public string BinanceSymbol { get; set; } = "BTCUSDT";
    public string BinanceInterval { get; set; } = "5m";
    public int CandleHistoryLimit { get; set; } = 5000;
    public string? PolymarketPrivateKey { get; set; }
    public string? PolymarketFunderAddress { get; set; }
    public int PolymarketSignatureType { get; set; }
    public string? PolymarketPolygonRpc { get; set; }
    /// <summary>Comma-separated CORS origins for production (e.g. https://trader.example.com).</summary>
    public string? CorsOrigins { get; set; }
    public string GammaSearchQuery { get; set; } = "btc";
    public string BtcMarketSlugPrefix { get; set; } = "btc-updown-5m";

    /// <summary>Telegram bot token from @BotFather. When empty, the bot and alerts are disabled.</summary>
    public string? TelegramBotToken { get; set; }

    /// <summary>Comma-separated numeric Telegram user/chat IDs allowed to control the bot and receive alerts.</summary>
    public string? TelegramAdminChatIds { get; set; }

    /// <summary>
    /// Live entry: <c>Maker</c> = post-only limit at best bid (0% fee); <c>Market</c> = IOC taker (legacy).
    /// </summary>
    public string LiveEntryOrderMode { get; set; } = "Maker";

    /// <summary>Seconds to wait on the first maker limit (full requested stake).</summary>
    public int LiveMakerFillWaitSeconds { get; set; } = 45;

    /// <summary>Seconds to wait on the second maker limit (remainder only, after wave 1 partial).</summary>
    public int LiveMakerRemainderFillWaitSeconds { get; set; } = 20;
}
