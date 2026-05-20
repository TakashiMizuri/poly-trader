import { GAMMA_API_BASE } from "./constants.js";

export type TradeMarketDisplay = {
  title: string | null;
  icon: string | null;
  outcome: string | null;
  /** Gamma market slug for polymarket.com/market/… links. */
  slug: string | null;
  /** Polymarket market no longer open for trading (Gamma `closed`). */
  closed: boolean | null;
  /** Market / event window start (epoch ms). */
  startAt: number | null;
  /** Market / event window end (epoch ms). */
  endAt: number | null;
};

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

/** Parse ISO date-time or unix seconds/ms from Polymarket payloads. */
export function parseMarketTimestamp(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === "string" && v.trim()) {
    const n = Date.parse(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Ignore lifecycle dates (creation → resolution) when the span is too wide for a slot progress bar. */
const MAX_EVENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isPlausibleEventWindow(startAt: number, endAt: number): boolean {
  const span = endAt - startAt;
  return span > 0 && span <= MAX_EVENT_WINDOW_MS;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

/** e.g. "Bitcoin Up or Down - May 17, 3:55AM-4:00AM ET" */
const UP_DOWN_TITLE_SLOT_RE =
  /(\w+)\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*ET/i;

function etWallClockToMs(
  year: number,
  monthIndex: number,
  day: number,
  hour12: number,
  minute: number,
  ampm: string
): number {
  let hour = hour12 % 12;
  if (ampm.toUpperCase() === "PM") hour += 12;
  const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-04:00`;
  return Date.parse(iso);
}

/** Parse short ET windows from Up/Down market titles when Gamma omits `eventStartTime`. */
function parseUpDownTitleWindow(
  title: string | null,
  endAtMs: number | null
): { startAt: number; endAt: number } | null {
  if (!title || !title.toLowerCase().includes("up or down")) return null;
  const m = UP_DOWN_TITLE_SLOT_RE.exec(title);
  if (!m) return null;

  const monthIndex = MONTH_INDEX[m[1]!.toLowerCase()];
  if (monthIndex == null) return null;

  const day = Number(m[2]);
  const startHour = Number(m[3]);
  const startMin = Number(m[4]);
  const startAmpm = m[5]!;
  const endHour = Number(m[6]);
  const endMin = Number(m[7]);
  const endAmpm = m[8]!;

  const year =
    endAtMs != null
      ? new Date(endAtMs).getUTCFullYear()
      : new Date().getUTCFullYear();

  const startAt = etWallClockToMs(year, monthIndex, day, startHour, startMin, startAmpm);
  const endAt = etWallClockToMs(year, monthIndex, day, endHour, endMin, endAmpm);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return null;
  if (!isPlausibleEventWindow(startAt, endAt)) return null;
  return { startAt, endAt };
}

export function marketWindowFromRecord(raw: Record<string, unknown>): {
  startAt: number | null;
  endAt: number | null;
} {
  const endAt =
    parseMarketTimestamp(raw.endDate) ?? parseMarketTimestamp(raw.endDateIso);

  const eventStart = parseMarketTimestamp(raw.eventStartTime);
  if (eventStart != null && endAt != null && isPlausibleEventWindow(eventStart, endAt)) {
    return { startAt: eventStart, endAt };
  }

  const gameStart = parseMarketTimestamp(raw.gameStartTime);
  if (gameStart != null && endAt != null && isPlausibleEventWindow(gameStart, endAt)) {
    return { startAt: gameStart, endAt };
  }

  const title =
    asString(raw.question) ?? asString(raw.title) ?? asString(raw.groupItemTitle);
  const fromTitle = parseUpDownTitleWindow(title, endAt);
  if (fromTitle) return fromTitle;

  const startDate =
    parseMarketTimestamp(raw.startDate) ?? parseMarketTimestamp(raw.startDateIso);
  if (startDate != null && endAt != null && isPlausibleEventWindow(startDate, endAt)) {
    return { startAt: startDate, endAt };
  }

  return { startAt: null, endAt: null };
}

export function tradeMarketFromRaw(
  raw: Record<string, unknown> | null | undefined
): TradeMarketDisplay {
  if (!raw) {
    return {
      title: null,
      icon: null,
      outcome: null,
      slug: null,
      closed: null,
      startAt: null,
      endAt: null,
    };
  }
  const closed =
    typeof raw.closed === "boolean"
      ? raw.closed
      : raw.closed === "true"
        ? true
        : raw.closed === "false"
          ? false
          : null;
  const { startAt, endAt } = marketWindowFromRecord(raw);
  return {
    title: asString(raw.title) ?? asString(raw.question),
    icon: asString(raw.icon) ?? asString(raw.image),
    outcome: asString(raw.outcome),
    slug: asString(raw.slug) ?? asString(raw.marketSlug),
    closed,
    startAt,
    endAt,
  };
}

type GammaMarket = {
  question?: string;
  slug?: string;
  icon?: string;
  image?: string;
  outcomes?: string;
  clobTokenIds?: string;
  groupItemTitle?: string;
  closed?: boolean;
  startDate?: string;
  endDate?: string;
  startDateIso?: string;
  endDateIso?: string;
  gameStartTime?: string;
  eventStartTime?: string;
};

function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

export async function fetchTradeMarketsByAssets(
  assets: string[]
): Promise<Map<string, TradeMarketDisplay>> {
  const unique = [...new Set(assets.filter(Boolean))].slice(0, 40);
  if (unique.length === 0) return new Map();

  const url = new URL(`${GAMMA_API_BASE}/markets`);
  for (const id of unique) url.searchParams.append("clob_token_ids", id);
  url.searchParams.set("limit", String(Math.min(unique.length, 100)));

  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return new Map();

  const markets = (await res.json()) as GammaMarket[];
  const out = new Map<string, TradeMarketDisplay>();

  for (const m of markets) {
    const tokenIds = parseJsonArray(m.clobTokenIds);
    const outcomes = parseJsonArray(m.outcomes);
    const title = asString(m.groupItemTitle) ?? asString(m.question);
    const icon = asString(m.icon) ?? asString(m.image);
    const slug = asString(m.slug);
    const { startAt, endAt } = marketWindowFromRecord(m as Record<string, unknown>);

    for (let i = 0; i < tokenIds.length; i++) {
      const tid = tokenIds[i]!;
      if (out.has(tid)) continue;
      out.set(tid, {
        title,
        icon,
        outcome: outcomes[i] ?? null,
        slug,
        closed: m.closed === true ? true : m.closed === false ? false : null,
        startAt,
        endAt,
      });
    }
  }

  return out;
}

export function mergeTradeMarket(
  asset: string,
  fromRaw: TradeMarketDisplay,
  gamma: Map<string, TradeMarketDisplay>
): TradeMarketDisplay {
  const g = gamma.get(asset);
  if (fromRaw.title) {
    return {
      title: fromRaw.title,
      icon: fromRaw.icon ?? g?.icon ?? null,
      outcome: fromRaw.outcome ?? g?.outcome ?? null,
      slug: g?.slug ?? fromRaw.slug ?? null,
      closed: g?.closed ?? fromRaw.closed ?? null,
      startAt: g?.startAt ?? fromRaw.startAt ?? null,
      endAt: g?.endAt ?? fromRaw.endAt ?? null,
    };
  }
  return g ?? fromRaw;
}
