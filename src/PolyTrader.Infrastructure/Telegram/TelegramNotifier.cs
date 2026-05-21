using System.Net.Http.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PolyTrader.Core.Abstractions;
using PolyTrader.Infrastructure.Options;

namespace PolyTrader.Infrastructure.Telegram;

public sealed class TelegramNotifier : ITelegramNotifier
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly PolyTraderOptions _options;
    private readonly ILogger<TelegramNotifier> _logger;
    private readonly IReadOnlyList<long> _adminChatIds;

    public TelegramNotifier(
        IHttpClientFactory httpClientFactory,
        IOptions<PolyTraderOptions> options,
        ILogger<TelegramNotifier> logger)
    {
        _httpClientFactory = httpClientFactory;
        _options = options.Value;
        _logger = logger;
        _adminChatIds = TelegramAdminIds.Parse(_options.TelegramAdminChatIds);
    }

    public bool IsEnabled =>
        !string.IsNullOrWhiteSpace(_options.TelegramBotToken) && _adminChatIds.Count > 0;

    public IReadOnlyList<long> AdminChatIds => _adminChatIds;

    public bool IsAdmin(long chatId) => _adminChatIds.Contains(chatId);

    public Task NotifyAdminsAsync(string text, CancellationToken ct = default)
    {
        if (!IsEnabled)
        {
            return Task.CompletedTask;
        }

        return Task.WhenAll(_adminChatIds.Select(id => SendMessageToChatAsync(id, text, ct)));
    }

    public async Task SendMessageToChatAsync(long chatId, string text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.TelegramBotToken))
        {
            return;
        }

        var client = _httpClientFactory.CreateClient(nameof(TelegramNotifier));
        var url = $"https://api.telegram.org/bot{_options.TelegramBotToken}/sendMessage";
        using var response = await client.PostAsJsonAsync(
            url,
            new
            {
                chat_id = chatId,
                text,
                disable_web_page_preview = true,
            },
            ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            _logger.LogWarning(
                "Telegram sendMessage failed chat={ChatId} status={Status} body={Body}",
                chatId,
                (int)response.StatusCode,
                body);
        }
    }

    public async Task SendPhotoToChatAsync(
        long chatId,
        byte[] png,
        string? caption = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.TelegramBotToken))
        {
            return;
        }

        var client = _httpClientFactory.CreateClient(nameof(TelegramNotifier));
        var url = $"https://api.telegram.org/bot{_options.TelegramBotToken}/sendPhoto";
        using var content = new MultipartFormDataContent();
        content.Add(new StringContent(chatId.ToString()), "chat_id");
        if (!string.IsNullOrWhiteSpace(caption))
        {
            content.Add(new StringContent(caption), "caption");
        }

        var image = new ByteArrayContent(png);
        image.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        content.Add(image, "photo", "balance-chart.png");

        using var response = await client.PostAsync(url, content, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            _logger.LogWarning(
                "Telegram sendPhoto failed chat={ChatId} status={Status} body={Body}",
                chatId,
                (int)response.StatusCode,
                body);
        }
    }
}
