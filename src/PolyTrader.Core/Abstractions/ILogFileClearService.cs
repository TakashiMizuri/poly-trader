namespace PolyTrader.Core.Abstractions;

public interface ILogFileClearService
{
    /// <summary>Flushes Serilog, deletes rolling log files, and reopens the file sink.</summary>
    int ClearLogFiles();
}
