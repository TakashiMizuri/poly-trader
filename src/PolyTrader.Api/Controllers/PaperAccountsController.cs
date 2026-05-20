using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PolyTrader.Core.Abstractions;
using PolyTrader.Core.Models;
using PolyTrader.Infrastructure.Data;
using PolyTrader.Infrastructure.Entities;

namespace PolyTrader.Api.Controllers;

[ApiController]
[Route("api/paper-accounts")]
public sealed class PaperAccountsController : ControllerBase
{
    private readonly PolyTraderDbContext _db;
    private readonly ITradingEventPublisher _publisher;

    public PaperAccountsController(PolyTraderDbContext db, ITradingEventPublisher publisher)
    {
        _db = db;
        _publisher = publisher;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<PaperAccountDto>>> List(
        [FromQuery] bool includeArchived = false,
        CancellationToken ct = default)
    {
        var query = _db.PaperAccounts.AsNoTracking();
        if (!includeArchived)
        {
            query = query.Where(a => !a.IsArchived);
        }

        var accounts = await query.OrderByDescending(a => a.UpdatedAt).ToListAsync(ct);
        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        return Ok(accounts.Select(a => Map(a, settings.ActivePaperAccountId)));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<PaperAccountDto>> Get(int id, CancellationToken ct)
    {
        var account = await _db.PaperAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct);
        if (account == null) return NotFound();

        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        return Ok(Map(account, settings.ActivePaperAccountId));
    }

    [HttpPost]
    public async Task<ActionResult<PaperAccountDto>> Create(
        [FromBody] CreatePaperAccountRequest req,
        CancellationToken ct)
    {
        var name = string.IsNullOrWhiteSpace(req.Name) ? "Paper account" : req.Name.Trim();
        var initial = req.InitialBalance is > 0 ? req.InitialBalance.Value : 100;

        var account = new PaperAccountEntity
        {
            Name = name,
            InitialBalance = initial,
            Balance = initial
        };

        _db.PaperAccounts.Add(account);
        await _db.SaveChangesAsync(ct);

        var settings = await _db.EngineSettings.FirstAsync(ct);
        if (settings.ActivePaperAccountId == null)
        {
            settings.ActivePaperAccountId = account.Id;
            settings.TradingMode = TradingMode.Paper;
            settings.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        if (settings.ActivePaperAccountId == account.Id)
        {
            await _publisher.PublishBalanceUpdatedAsync(account.Balance, account.Id, ct);
        }

        return CreatedAtAction(nameof(Get), new { id = account.Id }, Map(account, settings.ActivePaperAccountId));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<PaperAccountDto>> Update(
        int id,
        [FromBody] UpdatePaperAccountRequest req,
        CancellationToken ct)
    {
        var account = await _db.PaperAccounts.FirstOrDefaultAsync(a => a.Id == id, ct);
        if (account == null) return NotFound();

        if (!string.IsNullOrWhiteSpace(req.Name))
        {
            account.Name = req.Name.Trim();
        }

        if (req.IsArchived.HasValue)
        {
            account.IsArchived = req.IsArchived.Value;
        }

        account.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        return Ok(Map(account, settings.ActivePaperAccountId));
    }

    [HttpPost("{id:int}/reset")]
    public async Task<ActionResult<PaperAccountDto>> Reset(
        int id,
        [FromBody] ResetPaperAccountRequest? req,
        CancellationToken ct)
    {
        var account = await _db.PaperAccounts.FirstOrDefaultAsync(a => a.Id == id, ct);
        if (account == null) return NotFound();

        var resetBalance = req?.InitialBalance is > 0 ? req.InitialBalance.Value : account.InitialBalance;
        account.InitialBalance = resetBalance;
        account.Balance = resetBalance;
        account.UpdatedAt = DateTime.UtcNow;

        _db.BalanceSnapshots.Add(new BalanceSnapshotEntity
        {
            CashBalance = account.Balance,
            Equity = account.Balance,
            Source = "PaperReset",
            PaperAccountId = account.Id
        });

        await _db.SaveChangesAsync(ct);

        var settings = await _db.EngineSettings.AsNoTracking().FirstAsync(ct);
        if (settings.ActivePaperAccountId == id)
        {
            await _publisher.PublishBalanceUpdatedAsync(account.Balance, id, ct);
        }

        return Ok(Map(account, settings.ActivePaperAccountId));
    }

    private static PaperAccountDto Map(PaperAccountEntity a, int? activeId) => new(
        a.Id,
        a.Name,
        a.InitialBalance,
        a.Balance,
        a.IsArchived,
        a.CreatedAt,
        a.UpdatedAt,
        activeId == a.Id);

    public sealed record PaperAccountDto(
        int Id,
        string Name,
        double InitialBalance,
        double Balance,
        bool IsArchived,
        DateTime CreatedAt,
        DateTime UpdatedAt,
        bool IsActive);

    public sealed record CreatePaperAccountRequest(string? Name, double? InitialBalance);

    public sealed record UpdatePaperAccountRequest(string? Name, bool? IsArchived);

    public sealed record ResetPaperAccountRequest(double? InitialBalance);
}
