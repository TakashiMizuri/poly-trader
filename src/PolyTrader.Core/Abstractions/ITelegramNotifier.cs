namespace PolyTrader.Core.Abstractions;

public interface ITelegramNotifier
{
    bool IsEnabled { get; }
    IReadOnlyList<long> AdminChatIds { get; }
    bool IsAdmin(long chatId);
    Task NotifyAdminsAsync(string text, CancellationToken ct = default);
    Task SendPhotoToChatAsync(long chatId, byte[] png, string? caption = null, CancellationToken ct = default);
    Task SendMessageToChatAsync(long chatId, string text, CancellationToken ct = default);
}
