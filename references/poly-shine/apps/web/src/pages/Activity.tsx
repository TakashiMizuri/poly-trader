import { useCallback, useState, type ReactNode } from "react";
import { fetchExecs, fetchFeed, fetchIntents, useLivePoll } from "../api/hooks";
import { DataTable, DataTableSkeleton, ErrorBanner, PageCard } from "../components/app-ui";
import { MarketCell } from "../components/MarketCell";
import {
  TradeFeedGroupToggle,
  TradeFeedTable,
  useTradeFeedGrouped,
} from "../components/TradeFeedTable";
import { Page } from "../components/Page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatRatio, fmtTs, mirrorResult } from "../lib/tradeDisplay";
import type { MirrorIntent } from "../types";

const tabPanelClass =
  "col-start-1 row-start-1 mt-0 flex min-h-0 flex-col outline-none data-ending-style:hidden data-hidden:hidden";

function ActivityTable({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-auto">{children}</div>;
}

type Tab = "events" | "intents" | "executions";

const TABS: Tab[] = ["events", "intents", "executions"];

const FEED_LIMIT = 50;

function formatIntentMirror(m: MirrorIntent) {
  const size = m.planned?.size;
  if (size == null || !Number.isFinite(Number(size))) return "—";
  return Number(size).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function ActivityPage() {
  const [feedGrouped, setFeedGrouped] = useTradeFeedGrouped();
  const [tab, setTab] = useState<Tab>("events");

  const feed = useLivePoll(useCallback(() => fetchFeed(FEED_LIMIT), []), ["events", "intents", "executions"], {
    cacheKey: `api/feed:${FEED_LIMIT}`,
  });
  const intents = useLivePoll(useCallback(() => fetchIntents(FEED_LIMIT), []), ["intents"], {
    cacheKey: `api/intents:${FEED_LIMIT}`,
  });
  const execs = useLivePoll(useCallback(() => fetchExecs(FEED_LIMIT), []), ["executions"], {
    cacheKey: `api/executions:${FEED_LIMIT}`,
  });

  const active = tab === "events" ? feed : tab === "intents" ? intents : execs;

  const intentRows =
    intents.data?.map((m) => [
      <MarketCell
        key={`${m.id}-market`}
        title={m.marketTitle}
        icon={m.marketIcon}
        outcome={m.marketOutcome}
      />,
      mirrorResult({
        eventId: m.leaderEventId,
        tradeTimestamp: 0,
        eventCreatedAt: m.createdAt,
        side: m.planned?.side ?? "—",
        leaderSize: String(m.planned?.leaderShares ?? "—"),
        leaderPrice: String(m.planned?.leaderPrice ?? "—"),
        asset: "",
        subscriptionId: m.subscriptionId,
        subscriptionLabel: null,
        subscriptionAddress: "",
        subscriptionActive: true,
        intentId: m.id,
        intentStatus: m.status,
        skipReason: m.skipReason,
        planned: m.planned ?? null,
        executed: null,
        marketTitle: m.marketTitle,
        marketIcon: m.marketIcon,
        marketOutcome: m.marketOutcome,
        marketSlug: null,
        marketClosed: false,
        marketStartAt: null,
        marketEndAt: null,
        followLineState: null,
        followLineAbandonedReason: null,
      }),
      formatRatio(m.planned),
      formatIntentMirror(m),
      m.skipReason ?? "—",
      fmtTs(m.createdAt),
    ]) ?? [];

  const execRows =
    execs.data?.map((x) => [
      x.success ? "✓" : "✗",
      x.mirrorIntentId,
      fmtTs(x.createdAt),
    ]) ?? [];

  return (
    <div data-activity className="flex h-full min-h-0 flex-col">
      <Page
        title="Activity"
        description="Leader events with mirror sizing (same feed as Dashboard)"
        fill
        className="h-full min-h-0"
      >
        {active.error && <ErrorBanner message={active.error} />}

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <TabsList
            variant="line"
            className="h-auto w-full shrink-0 justify-start gap-2 rounded-none border-b border-border bg-transparent p-0"
          >
            {TABS.map((t) => (
              <TabsTrigger
                key={t}
                value={t}
                className={cn(
                  "h-auto flex-none rounded-lg px-3 py-1.5 capitalize shadow-none after:hidden",
                  "transition-[color,background-color,transform] duration-200 active:scale-[0.98]",
                  "text-muted-foreground hover:text-foreground",
                  "data-active:bg-primary/15 data-active:text-primary",
                  "dark:data-active:border-transparent dark:data-active:bg-primary/15 dark:data-active:text-primary"
                )}
              >
                {t}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1">
            <TabsContent value="events" className={tabPanelClass}>
              <PageCard
                fill
                className="h-full min-h-0"
                title="Leader events & mirror plan"
                action={
                  <TradeFeedGroupToggle grouped={feedGrouped} onGroupedChange={setFeedGrouped} />
                }
              >
                {feed.loading && !feed.data ? (
                  <DataTableSkeleton columns={8} rows={8} />
                ) : feed.data?.length ? (
                  <TradeFeedTable items={feed.data} grouped={feedGrouped} />
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No events yet. Use shadow or live mode (not read-only) for mirror sizing.
                  </p>
                )}
              </PageCard>
            </TabsContent>
            <TabsContent value="intents" className={tabPanelClass}>
              <PageCard fill className="h-full min-h-0" title="Mirror intents">
                <ActivityTable>
                  {intents.loading && !intents.data ? (
                    <DataTableSkeleton columns={6} />
                  ) : (
                    <DataTable
                      mono
                      headers={["Market", "Result", "Ratio", "Mirror sh.", "Skip", "Created"]}
                      rows={intentRows}
                    />
                  )}
                </ActivityTable>
              </PageCard>
            </TabsContent>
            <TabsContent value="executions" className={tabPanelClass}>
              <PageCard fill className="h-full min-h-0" title="Executions">
                <ActivityTable>
                  {execs.loading && !execs.data ? (
                    <DataTableSkeleton columns={3} />
                  ) : (
                    <DataTable mono headers={["OK", "Intent", "Created"]} rows={execRows} />
                  )}
                </ActivityTable>
              </PageCard>
            </TabsContent>
          </div>
        </Tabs>
      </Page>
    </div>
  );
}
