namespace PolyTrader.Infrastructure.Telegram;

public static class TelegramAdminIds
{
    public static IReadOnlyList<long> Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        var ids = new List<long>();
        foreach (var part in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (long.TryParse(part, out var id))
            {
                ids.Add(id);
            }
        }

        return ids;
    }
}
