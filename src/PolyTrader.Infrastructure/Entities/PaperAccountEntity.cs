namespace PolyTrader.Infrastructure.Entities;

public sealed class PaperAccountEntity
{
    public int Id { get; set; }
    public string Name { get; set; } = "Paper account";
    public double InitialBalance { get; set; } = 100;
    public double Balance { get; set; } = 100;
    public bool IsArchived { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
