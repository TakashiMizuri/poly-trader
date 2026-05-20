import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  fetchBalance,
  fetchConnectivity,
  fetchEquityBatch,
  fetchFeed,
  fetchFollowerEquity,
  fetchStatus,
  fetchSubs,
  pauseEngine,
  resumeEngine,
  useLivePoll,
  usePoll,
} from "../api/hooks";
import { useLiveConnected } from "../api/live";
import {
  Btn,
  DataTableSkeleton,
  ErrorBanner,
  PageCard,
  Skeleton,
  Stat,
  StatSkeleton,
  StatusBadge,
} from "../components/app-ui";
import type { StatusBadgeTone } from "../components/app-ui";
import { Page } from "../components/Page";
import { StatusLight, StatusLightsSkeleton } from "../components/status-lights";
import { cn } from "@/lib/utils";
import {
  TradeFeedGroupToggle,
  TradeFeedTable,
  useTradeFeedGrouped,
} from "../components/TradeFeedTable";
import { fmtTs, shortAddr } from "../lib/tradeDisplay";
import type { EngineMode, PolymarketEquityResult, Subscription } from "../types";

function modeTone(mode: EngineMode): StatusBadgeTone {
  if (mode === "live") return "live";
  if (mode === "shadow") return "shadow";
  return "neutral";
}

function sizingLabel(mode: Subscription["sizingMode"]) {
  if (mode === "fixed_usd") return "Fixed";
  if (mode === "pct_balance") return "% balance";
  if (mode === "pct_leader_notional") return "% leader";
  return "Proportional";
}

function fmtValuationTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatSizing(s: Subscription) {
  if (s.sizingMode === "fixed_usd" && s.fixedUsd != null) {
    const n = Number(s.fixedUsd);
    return Number.isFinite(n) ? `$${n.toFixed(0)}` : s.fixedUsd;
  }
  if (s.sizingMode === "pct_balance" && s.pctBalance != null) return `${s.pctBalance}%`;
  if (s.sizingMode === "pct_leader_notional" && s.pctLeaderNotional != null) return `${s.pctLeaderNotional}%`;
  if (s.sizingMode === "proportional_equity") {
    const scale = Number(s.pctBalance ?? 1);
    return Number.isFinite(scale) && scale !== 1 ? `×${scale}` : "auto";
  }
  return "—";
}

const th =
  "px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const td = "px-2 py-1.5 align-middle text-sm text-zinc-300";

function ScrollTable({ children }: { children: React.ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-auto">{children}</div>;
}

function isEquityError(v: PolymarketEquityResult | undefined): v is { error: string } {
  return v != null && "error" in v;
}

function fmtPositionsUsd(amount: number) {
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function SubsTable({
  subs,
  balances,
  equityLoading,
}: {
  subs: Subscription[];
  balances?: Record<string, PolymarketEquityResult>;
  equityLoading?: boolean;
}) {
  const sorted = [...subs].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });

  return (
    <ScrollTable>
      <table className="w-full">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border">
            <th className={th}>Leader</th>
            <th className={th}>Status</th>
            <th className={th}>Positions</th>
            <th className={th}>Sizing</th>
            <th className={th}>Last trade</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {sorted.map((s) => {
            const equity = balances?.[s.address.toLowerCase()];
            const positions = equity && !isEquityError(equity) ? equity.positionsValue : null;

            return (
            <tr key={s.id} className="transition-colors duration-150 hover:bg-muted/30">
              <td className={td}>
                <p className="font-medium text-zinc-100">{s.label || shortAddr(s.address)}</p>
                <p className="font-mono text-xs text-muted-foreground" title={s.address}>
                  {shortAddr(s.address)}
                </p>
              </td>
              <td className={td}>
                <StatusBadge tone={s.active ? "live" : "neutral"}>{s.active ? "Active" : "Paused"}</StatusBadge>
              </td>
              <td className={cn(td, "whitespace-nowrap tabular-nums")}>
                {equityLoading && equity == null ? (
                  <Skeleton className="h-4 w-20" />
                ) : positions != null ? (
                  <span className="font-medium text-emerald-300/95" title="Polymarket open positions">
                    {fmtPositionsUsd(positions)}
                  </span>
                ) : isEquityError(equity) ? (
                  <span className="text-xs text-danger" title={equity.error}>
                    —
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className={td}>
                <span className="text-muted-foreground">{sizingLabel(s.sizingMode)}</span>{" "}
                <span className="font-medium tabular-nums">{formatSizing(s)}</span>
              </td>
              <td className={cn(td, "whitespace-nowrap font-mono text-xs text-muted-foreground")}>
                {fmtTs(s.lastTradeTimestamp)}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollTable>
  );
}

function BalanceStat({
  usd,
  loading,
  error,
}: {
  usd: number | null | undefined;
  loading: boolean;
  error?: string;
}) {
  const hint =
    usd != null ? "USDC · your CLOB wallet" : error ?? "Key not set on API";

  return (
    <div className="flex h-full flex-col rounded-lg border border-primary/40 bg-gradient-to-br from-primary/15 via-card to-card px-4 py-3 ring-1 ring-primary/25">
      <p className="text-xs uppercase tracking-wider text-primary/90">Balance</p>
      {usd != null ? (
        <p className="mt-0.5 min-h-9 text-3xl font-bold leading-none tracking-tight tabular-nums text-primary">
          ${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      ) : loading ? (
        <Skeleton className="mt-1 h-9 w-32" />
      ) : (
        <p className="mt-0.5 min-h-9 text-3xl font-bold leading-none tabular-nums text-muted-foreground">—</p>
      )}
      <p
        className={cn(
          "mt-0.5 min-h-4 text-xs text-muted-foreground",
          usd == null && !loading && "text-danger/90"
        )}
      >
        {hint}
      </p>
    </div>
  );
}

function PositionsStat({
  usd,
  valuationTime,
  loading,
  error,
}: {
  usd: number | null | undefined;
  valuationTime?: string;
  loading: boolean;
  error?: string;
}) {
  const hint =
    usd != null
      ? valuationTime
        ? `Polymarket · ${fmtValuationTime(valuationTime)}`
        : "Polymarket open positions"
      : error ?? "Key not set on API";

  return (
    <div className="flex h-full flex-col rounded-lg border border-emerald-500/35 bg-gradient-to-br from-emerald-500/12 via-card to-card px-4 py-3 ring-1 ring-emerald-500/20">
      <p className="text-xs uppercase tracking-wider text-emerald-400/90">Positions</p>
      {usd != null ? (
        <p className="mt-0.5 min-h-9 text-3xl font-bold leading-none tracking-tight tabular-nums text-emerald-300">
          ${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      ) : loading ? (
        <Skeleton className="mt-1 h-9 w-32" />
      ) : (
        <p className="mt-0.5 min-h-9 text-3xl font-bold leading-none tabular-nums text-muted-foreground">—</p>
      )}
      <p
        className={cn(
          "mt-0.5 min-h-4 text-xs text-muted-foreground",
          usd == null && !loading && "text-danger/90"
        )}
      >
        {hint}
      </p>
    </div>
  );
}

export function Dashboard() {
  const [feedGrouped, setFeedGrouped] = useTradeFeedGrouped();
  const liveConnected = useLiveConnected();
  const statusPoll = useLivePoll(useCallback(() => fetchStatus(), []), ["status"], {
    cacheKey: "api/status",
  });
  const balancePoll = useLivePoll(useCallback(() => fetchBalance(), []), ["balance"], {
    cacheKey: "api/balance",
  });
  const followerEquityPoll = useLivePoll(useCallback(() => fetchFollowerEquity(), []), ["equity"], {
    cacheKey: "api/follower/equity",
  });
  const connectivityPoll = usePoll(useCallback(() => fetchConnectivity(), []), 12_000, {
    cacheKey: "api/connectivity",
  });
  const subsPoll = useLivePoll(useCallback(() => fetchSubs(), []), ["subscriptions"], {
    cacheKey: "api/subscriptions",
  });
  const addresses = useMemo(() => (subsPoll.data ?? []).map((s) => s.address), [subsPoll.data]);
  const equityCacheKey = useMemo(
    () => `api/equity:${addresses.map((a) => a.toLowerCase()).sort().join(",")}`,
    [addresses]
  );
  const equityPoll = useLivePoll(
    useCallback(() => fetchEquityBatch(addresses), [addresses]),
    ["equity", "subscriptions"],
    { cacheKey: equityCacheKey }
  );
  const feedPoll = useLivePoll(useCallback(() => fetchFeed(50), []), ["events", "intents", "executions"], {
    cacheKey: "api/feed:50",
  });

  const s = statusPoll.data;
  const eng = s?.engine;
  const statusPending = statusPoll.loading && !s;
  const balancePending = balancePoll.loading && balancePoll.data == null;
  const positionsPending = followerEquityPoll.loading && followerEquityPoll.data == null;
  const connectivityPending = connectivityPoll.loading && !connectivityPoll.data;
  const subsPending = subsPoll.loading && !subsPoll.data;
  const feedPending = feedPoll.loading && !feedPoll.data;

  async function togglePause() {
    if (!eng) return;
    if (eng.paused) await resumeEngine();
    else await pauseEngine();
    await statusPoll.refresh();
  }

  return (
    <div
      data-dashboard
      className="flex h-full min-h-0 flex-col"
    >
    <Page title="Dashboard" description="Subscriptions, trades, and engine at a glance" fill className="h-full min-h-0">
      {(statusPoll.error ||
        balancePoll.error ||
        followerEquityPoll.error ||
        equityPoll.error ||
        connectivityPoll.error ||
        subsPoll.error ||
        feedPoll.error) && (
        <ErrorBanner
          message={
            statusPoll.error ??
            balancePoll.error ??
            followerEquityPoll.error ??
            equityPoll.error ??
            connectivityPoll.error ??
            subsPoll.error ??
            feedPoll.error ??
            ""
          }
        />
      )}

      <div className="grid shrink-0 grid-cols-1 items-stretch gap-3 lg:grid-cols-12">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:col-span-8">
          {statusPending ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <Stat index={0} label="Subscriptions" value={s?.counts.subscriptions ?? "—"} />
              <Stat index={1} label="Leader events" value={s?.counts.leaderEvents ?? "—"} />
              <Stat
                index={2}
                label="Mirror intents"
                value={s?.counts.mirrorIntents ?? "—"}
                hint={s ? `${s.counts.mirrorPosted} posted` : undefined}
              />
            </>
          )}
        </div>
        <div className="grid h-full grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-1 xl:grid-cols-2">
          <BalanceStat
            usd={balancePoll.data?.usd}
            loading={balancePending}
            error={balancePoll.data?.error}
          />
          <PositionsStat
            usd={followerEquityPoll.data?.positionsValue}
            valuationTime={followerEquityPoll.data?.valuationTime}
            loading={positionsPending}
            error={followerEquityPoll.error ?? undefined}
          />
        </div>
      </div>

      <div className="grid shrink-0 gap-3 lg:grid-cols-3 lg:items-stretch">
        <PageCard
          className="h-full"
          title="Engine"
          action={
            eng ? (
              <Btn
                size="sm"
                variant={eng.paused ? "primary" : "default"}
                onClick={() => void togglePause()}
              >
                {eng.paused ? "Resume" : "Pause"}
              </Btn>
            ) : undefined
          }
        >
          {eng ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Mode</dt>
                <dd className="mt-0.5">
                  <StatusBadge tone={modeTone(eng.mode)}>{eng.mode}</StatusBadge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">State</dt>
                <dd className="mt-0.5">
                  <StatusBadge tone={eng.paused ? "warn" : "live"}>
                    {eng.paused ? "Paused" : "Running"}
                  </StatusBadge>
                </dd>
              </div>
            </dl>
          ) : (
            <Skeleton className="h-12 w-full" />
          )}
        </PageCard>

        <div className="flex h-full min-h-0 flex-col lg:col-span-2">
          <PageCard className="h-full min-h-0 flex-1" title="System status">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatusLight
                label="Live updates"
                status={liveConnected ? "ok" : "warn"}
                detail={liveConnected ? "SSE connected" : "Polling fallback"}
              />
              {connectivityPending ? (
                <StatusLightsSkeleton rows={3} />
              ) : (
                connectivityPoll.data?.checks.map((c) => (
                  <StatusLight key={c.id} label={c.label} status={c.status} detail={c.detail} />
                ))
              )}
            </div>
          </PageCard>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <PageCard
          fill
          className="min-h-0 min-w-0 flex-[1] basis-0"
          title="Subscriptions"
          action={
            <Link to="/subscriptions" className="text-xs font-medium text-primary hover:underline">
              Manage
            </Link>
          }
        >
          {subsPending && !subsPoll.data ? (
            <DataTableSkeleton columns={5} rows={3} />
          ) : subsPoll.data?.length ? (
            <SubsTable
              subs={subsPoll.data}
              balances={equityPoll.data?.balances}
              equityLoading={equityPoll.loading}
            />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No subscriptions yet.{" "}
              <Link to="/subscriptions" className="text-primary hover:underline">
                Add a leader
              </Link>
            </p>
          )}
        </PageCard>

        <PageCard
          fill
          className="min-h-0 min-w-0 flex-[2] basis-0"
          title="Live trade feed"
          action={
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TradeFeedGroupToggle grouped={feedGrouped} onGroupedChange={setFeedGrouped} />
              <span
                className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  liveConnected ? "bg-emerald-500 animate-pulse-live" : "bg-amber-500 animate-pulse-warn"
                )}
              />
              {liveConnected ? "Live" : "Polling"}
              <Link to="/activity" className="font-medium text-primary hover:underline">
                Full log
              </Link>
            </div>
          }
        >
          {feedPending && !feedPoll.data ? (
            <DataTableSkeleton columns={7} rows={5} />
          ) : feedPoll.data?.length ? (
            <TradeFeedTable items={feedPoll.data} grouped={feedGrouped} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No trades yet — they appear here as the worker ingests leader activity.
            </p>
          )}
        </PageCard>
      </div>
    </Page>
    </div>
  );
}
