using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using PolyTrader.Api.Hubs;

namespace PolyTrader.Api.Logging;

public sealed class LiveLogBroadcaster : ILiveLogBroadcaster, IAsyncDisposable
{
    private readonly Channel<LiveLogEntry> _channel = Channel.CreateBounded<LiveLogEntry>(
        new BoundedChannelOptions(500)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest,
        });

    private IHubContext<TradingHub>? _hub;
    private Task? _pumpTask;
    private CancellationTokenSource? _cts;

    public void Attach(IHubContext<TradingHub> hub, CancellationToken applicationStopping)
    {
        _hub = hub;
        _cts = CancellationTokenSource.CreateLinkedTokenSource(applicationStopping);
        _pumpTask ??= PumpAsync(_cts.Token);
    }

    public void Publish(LiveLogEntry entry) => _channel.Writer.TryWrite(entry);

    private async Task PumpAsync(CancellationToken ct)
    {
        await foreach (var entry in _channel.Reader.ReadAllAsync(ct))
        {
            if (_hub is null)
            {
                continue;
            }

            try
            {
                await _hub.Clients.All.SendAsync(
                    "LogEntry",
                    new
                    {
                        timestamp = entry.Timestamp,
                        level = entry.Level,
                        sourceContext = entry.SourceContext,
                        message = entry.Message,
                        exception = entry.Exception,
                    },
                    ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch
            {
                /* hub may be unavailable during shutdown */
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_cts is not null)
        {
            await _cts.CancelAsync();
        }

        if (_pumpTask is not null)
        {
            try
            {
                await _pumpTask;
            }
            catch (OperationCanceledException)
            {
                /* expected on shutdown */
            }
        }

        _cts?.Dispose();
    }
}
