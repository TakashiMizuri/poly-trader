using System.Collections.Frozen;

namespace PolyTrader.Infrastructure.Polymarket;

public static class PolymarketActivityLedger
{
  private const double MinStakeEpsilon = 0.01;

  public static string BuildBtc5mEventSlug(string slugPrefix, long candleTimeUnix) =>
      $"{slugPrefix.Trim().TrimEnd('-')}-{candleTimeUnix}";

  public static FrozenDictionary<string, PolymarketMarketCashSummary> BuildByConditionId(
      IEnumerable<PolymarketActivityEvent> events)
  {
    var map = new Dictionary<string, PolymarketMarketCashSummary>(StringComparer.OrdinalIgnoreCase);
    foreach (var ev in events)
    {
      var key = PolymarketConditionId.Normalize(ev.ConditionId);
      if (key == null)
      {
        continue;
      }

      if (!map.TryGetValue(key, out var summary))
      {
        summary = new PolymarketMarketCashSummary();
        map[key] = summary;
      }

      ApplyEvent(summary, ev);
    }

    return map.ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);
  }

  public static FrozenDictionary<string, PolymarketMarketCashSummary> BuildByEventSlug(
      IEnumerable<PolymarketActivityEvent> events)
  {
    var map = new Dictionary<string, PolymarketMarketCashSummary>(StringComparer.OrdinalIgnoreCase);
    foreach (var ev in events)
    {
      var slug = NormalizeSlugKey(ev.EventSlug) ?? NormalizeSlugKey(ev.Slug);
      if (slug == null)
      {
        continue;
      }

      if (!map.TryGetValue(slug, out var summary))
      {
        summary = new PolymarketMarketCashSummary();
        map[slug] = summary;
      }

      ApplyEvent(summary, ev);
    }

    return map.ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);
  }

  public static PolymarketMarketCashSummary? ResolveSummary(
      FrozenDictionary<string, PolymarketMarketCashSummary> byCondition,
      FrozenDictionary<string, PolymarketMarketCashSummary> byEventSlug,
      string? conditionId,
      string? eventSlug)
  {
    var normalizedCondition = PolymarketConditionId.Normalize(conditionId);
    if (normalizedCondition != null
        && byCondition.TryGetValue(normalizedCondition, out var byCond))
    {
      return byCond;
    }

    var slugKey = NormalizeSlugKey(eventSlug);
    if (slugKey != null && byEventSlug.TryGetValue(slugKey, out var bySlug))
    {
      return bySlug;
    }

    return null;
  }

  /// <summary>
  /// Infers win/loss from on-chain USDC flows. Returns null when the market is not settled on-chain yet.
  /// </summary>
  public static bool? InferWonFromCashFlow(PolymarketMarketCashSummary? flow, double stakeUsd)
  {
    if (flow == null || flow.BuyUsdc < MinStakeEpsilon)
    {
      return null;
    }

    var stake = Math.Max(stakeUsd, MinStakeEpsilon);

    if (flow.NetUsdc > Math.Max(0.5, stake * 0.12))
    {
      return true;
    }

    if (flow.RedeemUsdc >= stake * 0.85)
    {
      return true;
    }

    if (flow.HasRedeem && flow.RedeemUsdc < stake * 0.05)
    {
      return false;
    }

    if (flow.HasRedeem && flow.NetUsdc < -Math.Max(0.5, stake * 0.12))
    {
      return false;
    }

    if (!flow.HasRedeem)
    {
      return null;
    }

    return null;
  }

  private static void ApplyEvent(PolymarketMarketCashSummary summary, PolymarketActivityEvent ev)
  {
    var type = ev.Type?.Trim().ToUpperInvariant();
    var usdc = ev.UsdcSize;
    if (usdc <= 0 && type is not "REDEEM")
    {
      return;
    }

    switch (type)
    {
      case "TRADE":
        var side = ev.Side?.Trim().ToUpperInvariant();
        if (side == "BUY")
        {
          summary.BuyUsdc += usdc;
        }
        else if (side == "SELL")
        {
          summary.SellUsdc += usdc;
        }

        break;
      case "REDEEM":
        summary.RedeemUsdc += usdc;
        summary.HasRedeem = true;
        summary.LastRedeemTimestampUnix = ev.TimestampUnix;
        break;
      case "MAKER_REBATE" or "REWARD" or "REFERRAL_REWARD":
        summary.RebateUsdc += usdc;
        break;
    }
  }

  private static string? NormalizeSlugKey(string? slug) =>
      string.IsNullOrWhiteSpace(slug) ? null : slug.Trim().ToLowerInvariant();
}
