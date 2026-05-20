namespace PolyTrader.Infrastructure.Entities;

public sealed class MarketEntity
{
    public int Id { get; set; }
    public string ConditionId { get; set; } = "";
    public string? Slug { get; set; }
    public string? Title { get; set; }
    public string YesTokenId { get; set; } = "";
    public string NoTokenId { get; set; } = "";
    public DateTime? WindowStartUtc { get; set; }
    public DateTime? WindowEndUtc { get; set; }
    public bool IsActive { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
