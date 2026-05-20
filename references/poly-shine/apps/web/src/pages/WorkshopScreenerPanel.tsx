import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Play, Plus, Square, Trash2, X } from "lucide-react";
import {
  hasActiveScreenerFilters,
  isResolvedMarketInactive,
  passesScreenerFilters,
  type ScreenerFilters,
} from "@poly-shine/shared";
import {
  refreshWorkshopMarkets,
  resolveWorkshopMarket,
  workshopScreenerTickBatch,
} from "../api/hooks";
import { Badge } from "@/components/ui/badge";
import { Btn, ErrorBanner, FormField, PageCard } from "../components/app-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { polymarketProfileUrl } from "../lib/polymarket";
import type {
  MarketParticipantDto,
  PolymarketPortfolioResult,
  PolymarketPortfolioSnapshot,
  ResolvedPolymarketMarket,
  ScreenerTickResponse,
} from "../types";
import { fmtUsd, pnlClass, shortAddr } from "./workshop-format";
import { normalizeCompareAddress, type WorkshopCompare } from "./useWorkshopCompare";

const SCAN_MS = 5000;
const MARKET_REFRESH_MS = 60_000;
const MARKET_PRUNE_MS = 15_000;
const STORAGE_FILTERS = "poly-shine-workshop-screener-filters";
const STORAGE_MARKETS = "poly-shine-workshop-screener-markets";

type FoundRow = {
  portfolio: PolymarketPortfolioSnapshot;
  marketStake: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

type BoolScreenerFilterKey = "positivePnlDay" | "positivePnlWeek" | "positivePnlMonth" | "positivePnlAll";

type NumericScreenerFilterKey = Exclude<keyof ScreenerFilters, BoolScreenerFilterKey>;

type FilterField = {
  key: NumericScreenerFilterKey;
  label: string;
  placeholder?: string;
};

type BoolFilterField = {
  key: BoolScreenerFilterKey;
  label: string;
};

const BOOL_FILTER_FIELDS: BoolFilterField[] = [
  { key: "positivePnlDay", label: "Positive 1D PnL" },
  { key: "positivePnlWeek", label: "Positive 7D PnL" },
  { key: "positivePnlMonth", label: "Positive 30D PnL" },
  { key: "positivePnlAll", label: "Positive all-time PnL" },
];

const FILTER_FIELDS: FilterField[] = [
  { key: "minEquity", label: "Min equity" },
  { key: "maxEquity", label: "Max equity" },
  { key: "minCash", label: "Min cash (USDC)" },
  { key: "maxCash", label: "Max cash (USDC)" },
  { key: "minPositionsValue", label: "Min positions $" },
  { key: "maxPositionsValue", label: "Max positions $" },
  { key: "minOpenPnl", label: "Min open PnL" },
  { key: "maxOpenPnl", label: "Max open PnL" },
  { key: "minPositionCount", label: "Min # positions" },
  { key: "maxPositionCount", label: "Max # positions" },
  { key: "minPnlDay", label: "Min 1D PnL" },
  { key: "maxPnlDay", label: "Max 1D PnL" },
  { key: "minPnlWeek", label: "Min 7D PnL" },
  { key: "maxPnlWeek", label: "Max 7D PnL" },
  { key: "minPnlMonth", label: "Min 30D PnL" },
  { key: "maxPnlMonth", label: "Max 30D PnL" },
  { key: "minPnlAll", label: "Min all-time PnL" },
  { key: "maxPnlAll", label: "Max all-time PnL" },
  { key: "minVolAll", label: "Min volume" },
  { key: "maxVolAll", label: "Max volume" },
  { key: "minMarketStake", label: "Min stake (market)" },
  { key: "maxMarketStake", label: "Max stake (market)" },
];

function emptyFilters(): ScreenerFilters {
  return {};
}

function loadFilters(): ScreenerFilters {
  try {
    const raw = localStorage.getItem(STORAGE_FILTERS);
    if (!raw) return emptyFilters();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: ScreenerFilters = {};
    for (const f of FILTER_FIELDS) {
      const v = parsed[f.key];
      if (typeof v === "number" && Number.isFinite(v)) out[f.key] = v;
    }
    for (const f of BOOL_FILTER_FIELDS) {
      if (parsed[f.key] === true) out[f.key] = true;
    }
    return out;
  } catch {
    return emptyFilters();
  }
}

function dedupeMarketsByConditionId(markets: ResolvedPolymarketMarket[]): ResolvedPolymarketMarket[] {
  const seen = new Set<string>();
  const out: ResolvedPolymarketMarket[] = [];
  for (const m of markets) {
    if (seen.has(m.conditionId)) continue;
    seen.add(m.conditionId);
    out.push(m);
  }
  return out;
}

function mergeMarketsIntoList(
  prev: ResolvedPolymarketMarket[],
  incoming: ResolvedPolymarketMarket[]
): { next: ResolvedPolymarketMarket[]; added: number; skipped: number } {
  const listed = new Set(prev.map((m) => m.conditionId));
  const next = [...prev];
  let added = 0;
  let skipped = 0;

  for (const resolved of dedupeMarketsByConditionId(incoming)) {
    if (listed.has(resolved.conditionId)) {
      skipped++;
      continue;
    }
    listed.add(resolved.conditionId);
    next.push(resolved);
    added++;
  }

  return { next, added, skipped };
}

function loadMarkets(): ResolvedPolymarketMarket[] {
  try {
    const raw = localStorage.getItem(STORAGE_MARKETS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is ResolvedPolymarketMarket =>
          m != null &&
          typeof m === "object" &&
          typeof (m as ResolvedPolymarketMarket).conditionId === "string" &&
          typeof (m as ResolvedPolymarketMarket).title === "string"
      )
      .map((m) => ({
        ...m,
        closed: m.closed ?? null,
        endAt: typeof m.endAt === "number" && Number.isFinite(m.endAt) ? m.endAt : null,
      }));
  } catch {
    return [];
  }
}

function isPortfolioError(v: PolymarketPortfolioResult): v is { error: string } {
  return "error" in v;
}

function filterInputValue(filters: ScreenerFilters, key: NumericScreenerFilterKey): string {
  const v = filters[key];
  return v != null && Number.isFinite(v) ? String(v) : "";
}

function setFilterValue(
  filters: ScreenerFilters,
  key: NumericScreenerFilterKey,
  raw: string
): ScreenerFilters {
  const next = { ...filters };
  const trimmed = raw.trim();
  if (!trimmed) {
    delete next[key];
    return next;
  }
  const n = Number(trimmed);
  if (Number.isFinite(n)) next[key] = n;
  else delete next[key];
  return next;
}

function setFilterBool(
  filters: ScreenerFilters,
  key: BoolScreenerFilterKey,
  checked: boolean
): ScreenerFilters {
  const next = { ...filters };
  if (checked) next[key] = true;
  else delete next[key];
  return next;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function mergeTickParticipants(
  into: Map<string, MarketParticipantDto>,
  participants: MarketParticipantDto[]
) {
  for (const p of participants) {
    const existing = into.get(p.address);
    if (!existing) {
      into.set(p.address, { ...p, sources: [...p.sources] });
      continue;
    }
    into.set(p.address, {
      address: p.address,
      marketStake:
        p.marketStake != null
          ? Math.max(existing.marketStake ?? 0, p.marketStake)
          : existing.marketStake,
      displayName: p.displayName ?? existing.displayName,
      sources: [...new Set([...existing.sources, ...p.sources])],
    });
  }
}

function mergeTickResponses(ticks: ScreenerTickResponse[]): {
  tickAt: string;
  participants: MarketParticipantDto[];
  portfolios: ScreenerTickResponse["portfolios"];
} {
  const byAddress = new Map<string, MarketParticipantDto>();
  const portfolios: ScreenerTickResponse["portfolios"] = {};
  let tickAt = "";

  for (const data of ticks) {
    if (!tickAt || new Date(data.tickAt).getTime() > new Date(tickAt).getTime()) {
      tickAt = data.tickAt;
    }
    mergeTickParticipants(byAddress, data.participants);
    Object.assign(portfolios, data.portfolios);
  }

  return { tickAt, participants: [...byAddress.values()], portfolios };
}

function reconcileFoundMatches(
  prev: Record<string, FoundRow>,
  participants: MarketParticipantDto[],
  tickAt: string,
  filters: ScreenerFilters,
  portfolioCache: Record<string, { portfolio: PolymarketPortfolioSnapshot; fetchedAtSec: number }>,
  participantMeta: Record<string, { marketStake: number | null; displayName: string | null }>
): Record<string, FoundRow> {
  if (!hasActiveScreenerFilters(filters)) return {};

  const next: Record<string, FoundRow> = {};

  for (const [addr, row] of Object.entries(prev)) {
    const cached = portfolioCache[addr];
    if (!cached) continue;
    const stake = participantMeta[addr]?.marketStake ?? row.marketStake;
    if (!passesScreenerFilters(cached.portfolio, filters, stake)) continue;
    next[addr] = {
      ...row,
      portfolio: cached.portfolio,
      marketStake: stake,
    };
  }

  for (const p of participants) {
    const cached = portfolioCache[p.address];
    if (!cached) continue;
    const stake = participantMeta[p.address]?.marketStake ?? p.marketStake;
    if (!passesScreenerFilters(cached.portfolio, filters, stake)) continue;

    const existing = next[p.address];
    next[p.address] = {
      portfolio: cached.portfolio,
      marketStake: stake,
      firstSeenAt: existing?.firstSeenAt ?? prev[p.address]?.firstSeenAt ?? tickAt,
      lastSeenAt: tickAt,
    };
  }

  return next;
}

export function WorkshopScreenerPanel({ compare }: { compare: WorkshopCompare }) {
  const { compareAddresses, addToComparison } = compare;
  const [marketDraft, setMarketDraft] = useState("");
  const [markets, setMarkets] = useState<ResolvedPolymarketMarket[]>(() => loadMarkets());
  const [scanning, setScanning] = useState(false);
  const [addingMarket, setAddingMarket] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState<ScreenerFilters>(() => loadFilters());
  const [found, setFound] = useState<Record<string, FoundRow>>({});
  const [seenCount, setSeenCount] = useState(0);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [addingAddr, setAddingAddr] = useState<string | null>(null);

  const portfolioCache = useRef<
    Record<string, { portfolio: PolymarketPortfolioSnapshot; fetchedAtSec: number }>
  >({});
  const participantMeta = useRef<Record<string, { marketStake: number | null; displayName: string | null }>>(
    {}
  );
  const tickInFlight = useRef(false);
  const lastMarketRefreshAt = useRef(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const marketsRef = useRef(markets);
  marketsRef.current = markets;

  useEffect(() => {
    localStorage.setItem(STORAGE_FILTERS, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    localStorage.setItem(STORAGE_MARKETS, JSON.stringify(markets));
  }, [markets]);

  useEffect(() => {
    if (markets.length === 0 && scanning) setScanning(false);
  }, [markets.length, scanning]);

  const applyMarketPrune = useCallback(
    (open: ResolvedPolymarketMarket[], removed: ResolvedPolymarketMarket[]) => {
      if (removed.length === 0) return false;
      setMarkets(open);
      setMsg(`Removed expired: ${removed.map((m) => m.title).join(", ")}`);
      if (open.length === 0) {
        setScanning(false);
        setError("All markets have ended — scan stopped");
      }
      return true;
    },
    []
  );

  const pruneExpiredMarkets = useCallback(
    async (opts?: { gamma?: boolean }) => {
      const current = marketsRef.current;
      if (current.length === 0) return;

      const now = Date.now();
      const locallyOpen = current.filter((m) => !isResolvedMarketInactive(m, now));
      const locallyRemoved = current.filter((m) => isResolvedMarketInactive(m, now));

      if (locallyRemoved.length > 0) {
        applyMarketPrune(locallyOpen, locallyRemoved);
        if (locallyOpen.length === 0) return;
      }

      if (opts?.gamma === false) return;

      try {
        const { open, removed } = await refreshWorkshopMarkets(
          locallyOpen.length > 0 ? locallyOpen : current
        );
        if (removed.length > 0) applyMarketPrune(open, removed);
      } catch {
        // Ignore Gamma errors; local endAt pruning still applies.
      }
    },
    [applyMarketPrune]
  );

  useEffect(() => {
    if (markets.length === 0) return;
    void pruneExpiredMarkets();
    const id = setInterval(() => void pruneExpiredMarkets(), MARKET_PRUNE_MS);
    return () => clearInterval(id);
  }, [markets.length, pruneExpiredMarkets]);

  useEffect(() => {
    setFound((prev) =>
      reconcileFoundMatches(
        prev,
        [],
        new Date().toISOString(),
        filters,
        portfolioCache.current,
        participantMeta.current
      )
    );
  }, [filters]);

  const runTick = useCallback(async () => {
    if (markets.length === 0 || tickInFlight.current) return;
    tickInFlight.current = true;
    setError(null);

    try {
      let activeMarkets = markets;
      const now = Date.now();
      if (now - lastMarketRefreshAt.current >= MARKET_REFRESH_MS) {
        lastMarketRefreshAt.current = now;
        const before = marketsRef.current;
        await pruneExpiredMarkets();
        activeMarkets = marketsRef.current;
        if (activeMarkets.length === 0 && before.length > 0) return;
      } else {
        const locallyOpen = markets.filter((m) => !isResolvedMarketInactive(m, Date.now()));
        if (locallyOpen.length !== markets.length) {
          applyMarketPrune(
            locallyOpen,
            markets.filter((m) => isResolvedMarketInactive(m, Date.now()))
          );
          activeMarkets = locallyOpen;
          if (locallyOpen.length === 0) return;
        }
      }

      const cacheTimes: Record<string, number> = {};
      for (const [addr, entry] of Object.entries(portfolioCache.current)) {
        cacheTimes[addr] = entry.fetchedAtSec;
      }

      const { ticks: ok, failedConditionIds } = await workshopScreenerTickBatch(
        activeMarkets.map((m) => m.conditionId),
        cacheTimes
      );
      if (ok.length === 0) {
        throw new Error("All market ticks failed");
      }
      if (failedConditionIds.length > 0) {
        const byId = new Map(activeMarkets.map((m) => [m.conditionId, m.title]));
        const failedTitles = failedConditionIds.map((id) => byId.get(id) ?? id);
        setError(`Tick failed for: ${failedTitles.join(", ")}`);
      }

      const data = mergeTickResponses(ok);
      setLastTickAt(data.tickAt);
      setSeenCount(data.participants.length);

      for (const p of data.participants) {
        const existing = participantMeta.current[p.address];
        participantMeta.current[p.address] = {
          marketStake:
            p.marketStake != null
              ? Math.max(existing?.marketStake ?? 0, p.marketStake)
              : (existing?.marketStake ?? null),
          displayName: p.displayName ?? existing?.displayName ?? null,
        };
      }

      const nowSec = Math.floor(Date.now() / 1000);
      for (const [addr, result] of Object.entries(data.portfolios)) {
        if (isPortfolioError(result)) continue;
        portfolioCache.current[addr] = { portfolio: result, fetchedAtSec: nowSec };
      }

      setFound((prev) =>
        reconcileFoundMatches(
          prev,
          data.participants,
          data.tickAt,
          filtersRef.current,
          portfolioCache.current,
          participantMeta.current
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan tick failed");
    } finally {
      tickInFlight.current = false;
    }
  }, [markets, pruneExpiredMarkets, applyMarketPrune]);

  useEffect(() => {
    if (!scanning || markets.length === 0) return;
    void runTick();
    const id = setInterval(() => void runTick(), SCAN_MS);
    return () => clearInterval(id);
  }, [scanning, markets, runTick]);

  async function addMarket() {
    const input = marketDraft.trim();
    if (!input) {
      setError("Paste a Polymarket market link");
      return;
    }
    setAddingMarket(true);
    setError(null);
    try {
      const { markets: resolvedList } = await resolveWorkshopMarket(input);
      const open = resolvedList.filter((m) => !isResolvedMarketInactive(m));
      if (open.length === 0) {
        setError("This market has already ended on Polymarket");
        return;
      }

      const { next, added, skipped } = mergeMarketsIntoList(markets, open);
      setMarkets(next);

      if (added === 0) {
        setError("Market already in the list");
        return;
      }
      if (added > 1) {
        setMsg(
          `Added ${added} outcome markets${skipped > 0 ? ` (${skipped} already listed)` : ""}`
        );
      } else if (skipped > 0) {
        setMsg("Added 1 market (other outcomes were already listed)");
      }
      setMarketDraft("");
      void pruneExpiredMarkets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve market");
    } finally {
      setAddingMarket(false);
    }
  }

  function removeMarket(conditionId: string) {
    setMarkets((prev) => prev.filter((m) => m.conditionId !== conditionId));
  }

  async function startScan() {
    if (markets.length === 0) {
      setError("Add at least one market to scan");
      return;
    }
    if (!hasActiveScreenerFilters(filters)) {
      setError("Set at least one profile filter before scanning");
      return;
    }

    setError(null);
    setMsg(null);
    setFound({});
    portfolioCache.current = {};
    participantMeta.current = {};
    lastMarketRefreshAt.current = 0;
    setScanning(true);
  }

  function resetFilters() {
    setFilters(emptyFilters());
  }

  function stopScan() {
    setScanning(false);
  }

  function clearFound() {
    setFound({});
    setMsg(null);
  }

  async function onAddToCompare(address: string, portfolio: PolymarketPortfolioSnapshot) {
    const normalized = normalizeCompareAddress(address);
    if (compareAddresses.includes(normalized)) {
      setMsg("Already in comparison table");
      return;
    }
    setAddingAddr(address);
    setMsg(null);
    try {
      await addToComparison(address, portfolio);
      setMsg("Added to comparison table");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add to comparison");
    } finally {
      setAddingAddr(null);
    }
  }

  const foundList = Object.entries(found).sort(
    (a, b) => new Date(b[1].lastSeenAt).getTime() - new Date(a[1].lastSeenAt).getTime()
  );

  const cellClass = "px-2 py-2.5 align-middle text-sm tabular-nums first:pl-0 last:pr-0";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
    <PageCard
      title="Market screener"
      fill
      className="h-full min-h-0"
      action={
        scanning ? (
          <Btn variant="ghost" size="sm" onClick={stopScan}>
            <Square className="size-3.5" aria-hidden />
            Stop
          </Btn>
        ) : (
          <Btn variant="primary" size="sm" onClick={() => void startScan()}>
            <Play className="size-3.5" aria-hidden />
            Start
          </Btn>
        )
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <FormField label="Markets">
          <div className="flex gap-2">
            <Input
              value={marketDraft}
              onChange={(e) => setMarketDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !scanning && !addingMarket) {
                  e.preventDefault();
                  void addMarket();
                }
              }}
              placeholder="https://polymarket.com/event/… (any locale) or 0x condition id"
              spellCheck={false}
              disabled={scanning || addingMarket}
              className="min-w-0 flex-1"
            />
            <Btn
              variant="default"
              size="sm"
              className="h-9 shrink-0 px-3"
              disabled={scanning || addingMarket || !marketDraft.trim()}
              onClick={() => void addMarket()}
            >
              {addingMarket ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-3.5" aria-hidden />
              )}
              Add
            </Btn>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Add one or more markets, then start. Polls holders and recent traders every 5s across
            all listed assets.
          </p>
          {markets.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {markets.map((m) => (
                <li key={m.conditionId}>
                  <Badge variant="outline" className="max-w-full gap-1 pr-1">
                    <span className="truncate" title={m.title}>
                      {m.title}
                    </span>
                    {!scanning ? (
                      <button
                        type="button"
                        className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Remove ${m.title}`}
                        onClick={() => removeMarket(m.conditionId)}
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </FormField>

        {markets.length > 0 && scanning ? (
          <p className="text-xs text-muted-foreground">
            <span className="text-foreground">
              {markets.length} market{markets.length === 1 ? "" : "s"}
            </span>
            <Loader2 className="ml-1.5 inline size-3 animate-spin align-[-2px]" />
            {lastTickAt ? (
              <span className="ml-2">
                · {seenCount} wallets seen · last tick {fmtTime(lastTickAt)}
              </span>
            ) : null}
          </p>
        ) : null}

        {error ? <ErrorBanner message={error} /> : null}
        {msg ? <p className="text-xs text-primary">{msg}</p> : null}

        <div className="shrink-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Profile filters
            </p>
            <Btn
              variant="ghost"
              size="sm"
              disabled={scanning || !hasActiveScreenerFilters(filters)}
              onClick={resetFilters}
            >
              Reset filters
            </Btn>
          </div>
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2">
            {BOOL_FILTER_FIELDS.map((f) => (
              <Label
                key={f.key}
                className="flex cursor-pointer items-center gap-2 text-xs font-normal"
              >
                <Checkbox
                  checked={filters[f.key] === true}
                  disabled={scanning}
                  onCheckedChange={(checked) =>
                    setFilters((prev) => setFilterBool(prev, f.key, checked === true))
                  }
                />
                <span className="text-muted-foreground">{f.label}</span>
              </Label>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {FILTER_FIELDS.map((f) => (
              <label key={f.key} className="block text-xs">
                <span className="mb-1 block text-muted-foreground">{f.label}</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  className="h-8 font-mono text-xs"
                  value={filterInputValue(filters, f.key)}
                  onChange={(e) => setFilters((prev) => setFilterValue(prev, f.key, e.target.value))}
                  placeholder="—"
                  disabled={scanning}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-200">
              Matches ({foundList.length})
            </p>
            <Btn variant="ghost" size="sm" disabled={foundList.length === 0} onClick={clearFound}>
              <Trash2 className="size-3.5" aria-hidden />
              Clear
            </Btn>
          </div>

          {foundList.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {scanning
                ? "Scanning… matching profiles will appear here."
                : "Start a scan to collect profiles that pass your filters."}
            </p>
          ) : (
            <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-xs">Account</TableHead>
                    <TableHead className="text-xs">Equity</TableHead>
                    <TableHead className="text-xs">Cash</TableHead>
                    <TableHead className="text-xs">Stake</TableHead>
                    <TableHead className="text-xs">1D</TableHead>
                    <TableHead className="text-xs">7D</TableHead>
                    <TableHead className="text-xs">30D</TableHead>
                    <TableHead className="text-xs">All</TableHead>
                    <TableHead className="text-xs">Last seen</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/60">
                  {foundList.map(([address, row]) => {
                    const name = row.portfolio.displayName ?? shortAddr(address);
                    const inCompare = compareAddresses.includes(normalizeCompareAddress(address));
                    return (
                      <TableRow key={address} className="border-0 hover:bg-muted/40">
                        <TableCell className={cn(cellClass, "min-w-[8rem]")}>
                          <p className="truncate font-medium">{name}</p>
                          <p className="truncate font-mono text-xs text-muted-foreground">{shortAddr(address)}</p>
                        </TableCell>
                        <TableCell className={cellClass}>{fmtUsd(row.portfolio.equity.equity)}</TableCell>
                        <TableCell className={cellClass}>{fmtUsd(row.portfolio.equity.cashBalance)}</TableCell>
                        <TableCell className={cellClass}>
                          {row.marketStake != null ? row.marketStake.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                        </TableCell>
                        <TableCell className={cn(cellClass, pnlClass(row.portfolio.leaderboard.day?.pnl))}>
                          {fmtUsd(row.portfolio.leaderboard.day?.pnl)}
                        </TableCell>
                        <TableCell className={cn(cellClass, pnlClass(row.portfolio.leaderboard.week?.pnl))}>
                          {fmtUsd(row.portfolio.leaderboard.week?.pnl)}
                        </TableCell>
                        <TableCell className={cn(cellClass, pnlClass(row.portfolio.leaderboard.month?.pnl))}>
                          {fmtUsd(row.portfolio.leaderboard.month?.pnl)}
                        </TableCell>
                        <TableCell className={cn(cellClass, pnlClass(row.portfolio.leaderboard.all?.pnl))}>
                          {fmtUsd(row.portfolio.leaderboard.all?.pnl)}
                        </TableCell>
                        <TableCell
                          className={cn(cellClass, "text-xs text-muted-foreground")}
                          title={`First seen ${fmtTime(row.firstSeenAt)}`}
                        >
                          {fmtTime(row.lastSeenAt)}
                        </TableCell>
                        <TableCell className={cn(cellClass, "text-right whitespace-nowrap")}>
                          <a
                            href={polymarketProfileUrl(address)}
                            target="_blank"
                            rel="noreferrer"
                            className="mr-2 inline-flex text-primary hover:underline"
                            title="Polymarket profile"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                          <Btn
                            variant="ghost"
                            size="sm"
                            disabled={inCompare || addingAddr === address}
                            onClick={() => void onAddToCompare(address, row.portfolio)}
                          >
                            {addingAddr === address ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : inCompare ? (
                              "Added"
                            ) : (
                              "Compare"
                            )}
                          </Btn>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </PageCard>
    </div>
  );
}
