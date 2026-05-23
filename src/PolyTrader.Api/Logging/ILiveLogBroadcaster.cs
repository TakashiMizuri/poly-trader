namespace PolyTrader.Api.Logging;

public interface ILiveLogBroadcaster
{
    void Publish(LiveLogEntry entry);
}
