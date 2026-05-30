using PolyTrader.Core.Strategy;

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

    /// <summary>Seconds to wait on the first maker limit (full requested stake).</summary>
    public int LiveMakerFillWaitSeconds { get; set; } = 45;

    /// <summary>Seconds to wait on the second maker limit (remainder only, after wave 1 partial).</summary>
    public int LiveMakerRemainderFillWaitSeconds { get; set; } = 20;

    /// <summary>Max seconds to wait for patience entry after expensive quote at bar open (1–180).</summary>
    public int EntryMaxWaitSeconds { get; set; } = EntryExecutionSettings.DefaultMaxWaitSeconds;

    /// <summary>Override patience max entry price; 0 = use <see cref="EntryPriceRules.MaxEntryPrice"/>.</summary>
    public double PatienceMaxEntryPrice { get; set; }

    /// <summary>Post-only buy: ticks below best ask (1 = ask−1 tick, 2 = more conservative).</summary>
    public int PostOnlyAskTickMargin { get; set; } = 1;

    /// <summary>Retries stepping limit down when CLOB reports post-only cross.</summary>
    public int PostOnlyCrossTickRetries { get; set; } = 5;

    /// <summary>Delay after 5m window open before first live entry (ms); 0 = disabled.</summary>
    public int EntryOpenDelayMs { get; set; } = 300;

    /// <summary>Use WS best_bid_ask when younger than this (ms); REST still used before PlaceOrder.</summary>
    public int WebSocketQuoteMaxAgeMs { get; set; } = 500;

    /// <summary>REST order poll interval when user WS is connected (ms).</summary>
    public int MakerFillPollIntervalMs { get; set; } = 250;
}
