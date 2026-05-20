import { GAMMA_API_BASE } from "./constants.js";
import { marketWindowFromRecord } from "./trade-market.js";

const CONDITION_ID_RE = /^0x[a-fA-F0-9]{64}$/;
/** Grace after window end before pruning (resolution lag). */
export const RESOLVED_MARKET_EXPIRED_GRACE_MS = 15_000;

export type ResolvedPolymarketMarket = {
  conditionId: string;
  title: string;
  slug: string | null;
  closed: boolean | null;
  /** Epoch ms when the tradable window ends, when known. */
  endAt: number | null;
};

type GammaMarket = {
  conditionId?: string;
  question?: string;
  slug?: string;
  closed?: boolean;
  endDate?: string;
  endDateIso?: string;
  startDate?: string;
  startDateIso?: string;
  gameStartTime?: string;
  eventStartTime?: string;
  groupItemTitle?: string;
  title?: string;
};

type GammaEvent = {
  title?: string;
  slug?: string;
  markets?: GammaMarket[];
};

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function normalizeConditionId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!CONDITION_ID_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function normalizeMarketLinkInput(input: string): string {
  const trimmed = input.trim();
  if (/^polymarket\.com\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/** Supports /event/…, /ru/event/…, /market/…, and nested outcome slugs. */
function parseUrlPath(input: string): { eventSlug: string | null; marketSlug: string | null } | null {
  try {
    const url = new URL(normalizeMarketLinkInput(input));
    const parts = url.pathname.split("/").filter(Boolean);

    const marketIdx = parts.indexOf("market");
    if (marketIdx >= 0 && parts[marketIdx + 1]) {
      return { eventSlug: null, marketSlug: parts[marketIdx + 1]! };
    }

    const eventIdx = parts.indexOf("event");
    if (eventIdx >= 0 && parts[eventIdx + 1]) {
      return {
        eventSlug: parts[eventIdx + 1]!,
        marketSlug: parts[eventIdx + 2] ?? null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchGammaMarketBySlug(slug: string): Promise<GammaMarket | null> {
  const url = new URL(`${GAMMA_API_BASE}/markets`);
  url.searchParams.set("slug", slug);
  url.searchParams.set("limit", "5");
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const rows = (await res.json()) as GammaMarket[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.find((m) => asString(m.slug) === slug) ?? rows[0] ?? null;
}

async function fetchGammaEventBySlugOnce(slug: string): Promise<GammaEvent | null> {
  const url = new URL(`${GAMMA_API_BASE}/events`);
  url.searchParams.set("slug", slug);
  url.searchParams.set("limit", "3");
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const rows = (await res.json()) as GammaEvent[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.find((e) => asString(e.slug) === slug) ?? rows[0] ?? null;
}

async function fetchGammaEventBySlug(slug: string): Promise<GammaEvent | null> {
  const direct = await fetchGammaEventBySlugOnce(slug);
  if (direct) return direct;

  const stripped = slug.replace(/-\d{9,}$/, "");
  if (stripped !== slug) return fetchGammaEventBySlugOnce(stripped);

  return null;
}

function endAtFromShortSlotSlug(slug: string | null): number | null {
  if (!slug) return null;
  const m = slug.match(/-(\d{9,})$/);
  if (!m) return null;
  const startSec = Number(m[1]);
  if (!Number.isFinite(startSec)) return null;
  const durMin = /\b5m\b/i.test(slug) ? 5 : /\b15m\b/i.test(slug) ? 15 : null;
  if (durMin == null) return null;
  return (startSec + durMin * 60) * 1000;
}

function resolveEndAt(m: GammaMarket): number | null {
  const { endAt } = marketWindowFromRecord(m as Record<string, unknown>);
  if (endAt != null) return endAt;
  return endAtFromShortSlotSlug(asString(m.slug));
}

export function isResolvedMarketInactive(
  market: ResolvedPolymarketMarket,
  nowMs = Date.now()
): boolean {
  if (market.closed === true) return true;
  if (market.endAt != null && nowMs >= market.endAt + RESOLVED_MARKET_EXPIRED_GRACE_MS) {
    return true;
  }
  return false;
}

function marketFromGamma(m: GammaMarket): ResolvedPolymarketMarket | null {
  const conditionId = normalizeConditionId(asString(m.conditionId) ?? "");
  if (!conditionId) return null;
  const title = asString(m.question) ?? conditionId;
  return {
    conditionId,
    title,
    slug: asString(m.slug),
    closed: m.closed === true ? true : m.closed === false ? false : null,
    endAt: resolveEndAt(m),
  };
}

/** Load current Gamma metadata for condition ids (batch). */
export async function fetchPolymarketMarketsByConditionIds(
  conditionIds: string[]
): Promise<ResolvedPolymarketMarket[]> {
  const normalized = [
    ...new Set(
      conditionIds
        .map((id) => normalizeConditionId(id))
        .filter((id): id is string => id != null)
    ),
  ];
  if (normalized.length === 0) return [];

  const url = new URL(`${GAMMA_API_BASE}/markets`);
  for (const id of normalized) url.searchParams.append("condition_ids", id);
  url.searchParams.set("limit", String(Math.min(normalized.length, 50)));

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];

  const rows = (await res.json()) as GammaMarket[];
  if (!Array.isArray(rows)) return [];

  const byConditionId = new Map<string, ResolvedPolymarketMarket>();
  for (const row of rows) {
    const resolved = marketFromGamma(row);
    if (resolved) byConditionId.set(resolved.conditionId, resolved);
  }
  return normalized
    .map((id) => byConditionId.get(id))
    .filter((m): m is ResolvedPolymarketMarket => m != null);
}

export type RefreshPolymarketMarketsResult = {
  open: ResolvedPolymarketMarket[];
  removed: ResolvedPolymarketMarket[];
};

/** Refresh metadata from Gamma; drop closed or expired markets. */
export async function refreshPolymarketMarketList(
  markets: ResolvedPolymarketMarket[]
): Promise<RefreshPolymarketMarketsResult> {
  if (markets.length === 0) return { open: [], removed: [] };

  const nowMs = Date.now();
  const fresh = await fetchPolymarketMarketsByConditionIds(markets.map((m) => m.conditionId));
  const byId = new Map(fresh.map((m) => [m.conditionId, m]));

  const open: ResolvedPolymarketMarket[] = [];
  const removed: ResolvedPolymarketMarket[] = [];

  for (const m of markets) {
    const updated = byId.get(m.conditionId);
    const merged: ResolvedPolymarketMarket = updated
      ? {
          conditionId: m.conditionId,
          title: updated.title,
          slug: updated.slug ?? m.slug,
          closed: updated.closed,
          endAt: updated.endAt ?? m.endAt,
        }
      : m;
    if (isResolvedMarketInactive(merged, nowMs)) removed.push(merged);
    else open.push(merged);
  }

  return { open, removed };
}

function eventMarketTitle(eventTitle: string | null, market: ResolvedPolymarketMarket): string {
  if (!eventTitle) return market.title;
  if (market.title === eventTitle) return market.title;
  return `${eventTitle} — ${market.title}`;
}

/** Resolve a Polymarket link, slug, or condition id to one or more markets. */
export async function resolvePolymarketMarketsFromInput(
  input: string
): Promise<ResolvedPolymarketMarket[]> {
  const trimmed = normalizeMarketLinkInput(input.trim());
  if (!trimmed) throw new Error("Enter a Polymarket market link or condition id");

  const direct = normalizeConditionId(trimmed);
  if (direct) {
    const fromGamma = await fetchPolymarketMarketsByConditionIds([direct]);
    const resolved = fromGamma[0];
    if (resolved) return [resolved];
    return [{ conditionId: direct, title: direct, slug: null, closed: null, endAt: null }];
  }

  const path = parseUrlPath(trimmed);
  const slugOnly = !trimmed.includes("/") && /^[a-z0-9-]+$/i.test(trimmed) ? trimmed : null;

  if (path?.marketSlug && !path.eventSlug) {
    const market = await fetchGammaMarketBySlug(path.marketSlug);
    const resolved = market ? marketFromGamma(market) : null;
    if (resolved) return [resolved];
    throw new Error(`Market not found for slug “${path.marketSlug}”`);
  }

  if (path?.eventSlug) {
    if (path.marketSlug) {
      const market = await fetchGammaMarketBySlug(path.marketSlug);
      const resolved = market ? marketFromGamma(market) : null;
      if (resolved) return [resolved];
      throw new Error(`Market not found for slug “${path.marketSlug}”`);
    }

    const event = await fetchGammaEventBySlug(path.eventSlug);
    const gammaMarkets = event?.markets ?? [];
    if (gammaMarkets.length === 0) throw new Error(`Event not found: “${path.eventSlug}”`);

    const eventTitle = asString(event?.title);
    const resolved = gammaMarkets
      .map((m) => marketFromGamma(m))
      .filter((m): m is ResolvedPolymarketMarket => m != null)
      .map((m) => ({ ...m, title: eventMarketTitle(eventTitle, m) }));

    if (resolved.length === 0) throw new Error("Could not read condition ids from event markets");
    return resolved;
  }

  if (slugOnly) {
    const market = await fetchGammaMarketBySlug(slugOnly);
    const resolved = market ? marketFromGamma(market) : null;
    if (resolved) return [resolved];
    throw new Error(`Market not found for slug “${slugOnly}”`);
  }

  throw new Error("Paste a polymarket.com link (any locale) or a 0x… condition id (64 hex chars)");
}

/** Resolve to a single market; use {@link resolvePolymarketMarketsFromInput} when multiple outcomes are possible. */
export async function resolvePolymarketMarketInput(
  input: string
): Promise<ResolvedPolymarketMarket> {
  const markets = await resolvePolymarketMarketsFromInput(input);
  return markets[0]!;
}
