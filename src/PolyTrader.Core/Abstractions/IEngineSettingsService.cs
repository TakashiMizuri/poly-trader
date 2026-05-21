using PolyTrader.Core.Models;

namespace PolyTrader.Core.Abstractions;

public interface IEngineSettingsService
{
    Task<EngineSettingsSnapshot> GetAsync(CancellationToken ct = default);
    Task<EngineSettingsUpdateResult> UpdateAsync(UpdateEngineSettingsCommand command, CancellationToken ct = default);
}
