import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { StatusBadge } from "./app-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { polymarketMarketUrl } from "@/lib/polymarket";
import { cn } from "@/lib/utils";
import {
  fmtTs,
  eventProgressPercent,
  formatGroupSides,
  formatGroupTimeRange,
  formatGroupUsd,
  formatMirrorVol,
  formatRatio,
  formatShareAmount,
  formatTradeFeedGroupForCopy,
  fmtVol,
  compareTradeFeedItemsNewestFirst,
  groupTradeFeedItems,
  summarizeTradeFeedGroup,
  intentTone,
  isTradeFeedItemCompleted,
  mirrorResult,
  mirrorResultTitle,
  skipLabel,
  followLineAbandonHint,
  shortAddr,
  tradeFeedEventWindow,
} from "../lib/tradeDisplay";
import { MarketCell } from "./MarketCell";
import type { TradeFeedItem } from "../types";

const GROUPED_STORAGE_KEY = "poly-shine-trade-feed-grouped";

/** Grouped fills: time · side · leader vol · mirror · ratio · result */
const fillRowGrid =
  "grid grid-cols-[7rem_3.25rem_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,0.75fr)_minmax(0,5.5rem)] items-center gap-x-2";

/** Flat list: time · market · leader · side · leader vol · mirror · ratio · result */
const flatRowGrid =
  "grid grid-cols-[7rem_minmax(7rem,1.15fr)_minmax(4.5rem,0.65fr)_3.25rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,5.5rem)] items-center gap-x-2";

const headCell =
  "px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const cell = "px-2 py-1.5 text-sm text-zinc-300 min-w-0";

/** Ended / resolved predictions — muted gray, semi-dim. */
const completedFeedClass =
  "opacity-50 grayscale saturate-[0.35] contrast-[0.95]";

const completedGroupClass = cn(
  completedFeedClass,
  "border-border/40 bg-muted/25 ring-border/20",
);

export function useTradeFeedGrouped() {
  const [grouped, setGroupedState] = useState(() => {
    try {
      const stored = localStorage.getItem(GROUPED_STORAGE_KEY);
      if (stored === "0") return false;
      if (stored === "1") return true;
    } catch {
      /* ignore */
    }
    return true;
  });

  const setGrouped = useCallback((value: boolean) => {
    setGroupedState(value);
    try {
      localStorage.setItem(GROUPED_STORAGE_KEY, value ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  return [grouped, setGrouped] as const;
}

export function TradeFeedGroupToggle({
  grouped,
  onGroupedChange,
  className,
}: {
  grouped: boolean;
  onGroupedChange: (grouped: boolean) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Trade feed view"
      className={cn("inline-flex rounded-lg border border-border bg-muted/30 p-0.5", className)}
    >
      <Button
        type="button"
        size="xs"
        variant={!grouped ? "secondary" : "ghost"}
        className={cn("h-6 px-2.5 shadow-none", !grouped && "bg-card")}
        onClick={() => onGroupedChange(false)}
      >
        List
      </Button>
      <Button
        type="button"
        size="xs"
        variant={grouped ? "secondary" : "ghost"}
        className={cn("h-6 px-2.5 shadow-none", grouped && "bg-card")}
        onClick={() => onGroupedChange(true)}
      >
        Grouped
      </Button>
    </div>
  );
}

function FillColumnsHeader({ className }: { className?: string }) {
  return (
    <div className={cn(fillRowGrid, "border-b border-border bg-card", className)}>
      <span className={headCell}>Time</span>
      <span className={headCell}>Side</span>
      <span className={headCell}>Leader vol.</span>
      <span className={headCell}>Mirror vol.</span>
      <span className={headCell}>Ratio</span>
      <span className={cn(headCell, "text-right")}>Result</span>
    </div>
  );
}

function FlatColumnsHeader({ className }: { className?: string }) {
  return (
    <div className={cn(flatRowGrid, "border-b border-border bg-card", className)}>
      <span className={headCell}>Time</span>
      <span className={headCell}>Market</span>
      <span className={headCell}>Leader</span>
      <span className={headCell}>Side</span>
      <span className={headCell}>Leader vol.</span>
      <span className={headCell}>Mirror vol.</span>
      <span className={headCell}>Ratio</span>
      <span className={cn(headCell, "text-right")}>Result</span>
    </div>
  );
}

function TradeFeedFillRow({
  item,
  inCompletedGroup = false,
}: {
  item: TradeFeedItem;
  inCompletedGroup?: boolean;
}) {
  const completed = inCompletedGroup || isTradeFeedItemCompleted(item);
  const leaderShares = Number(item.leaderSize);
  const leaderPrice = Number(item.leaderPrice);
  const planned = item.planned;
  const ratioTitle =
    planned?.followerCash != null && planned?.leaderCash != null
      ? `$${planned.followerCash.toLocaleString()} / $${planned.leaderCash.toLocaleString()} cash`
      : undefined;
  const sideTone =
    item.side === "BUY"
      ? "live"
      : item.side === "SELL"
        ? "danger"
        : item.side === "MERGE" || item.side === "REDEEM"
          ? "warn"
          : item.side === "SPLIT"
            ? "accent"
            : "neutral";

  return (
    <div
      className={cn(
        fillRowGrid,
        "border-t border-border/40 transition-colors duration-150",
        !completed && "hover:bg-muted/25",
        completed && !inCompletedGroup && completedFeedClass,
      )}
      title={completed ? "Market closed" : undefined}
    >
      <span className={cn(cell, "whitespace-nowrap font-mono text-xs text-muted-foreground")}>
        {fmtTs(item.tradeTimestamp)}
      </span>
      <span className={cell}>
        <StatusBadge tone={sideTone}>{item.side}</StatusBadge>
      </span>
      <span className={cn(cell, "truncate font-mono text-xs tabular-nums")} title={fmtVol(leaderShares, leaderPrice)}>
        {fmtVol(leaderShares, leaderPrice)}
      </span>
      <span
        className={cn(cell, "truncate font-mono text-xs tabular-nums")}
        title={formatMirrorVol(leaderShares, leaderPrice, planned)}
      >
        {formatMirrorVol(leaderShares, leaderPrice, planned)}
      </span>
      <span className={cn(cell, "font-mono text-xs tabular-nums")} title={ratioTitle}>
        {formatRatio(planned)}
      </span>
      <span className={cn(cell, "flex justify-end")}>
        <StatusBadge tone={intentTone(item.intentStatus)} title={mirrorResultTitle(item)}>
          {mirrorResult(item)}
        </StatusBadge>
      </span>
    </div>
  );
}

function TradeFeedFlatRow({ item }: { item: TradeFeedItem }) {
  const completed = isTradeFeedItemCompleted(item);
  const leaderShares = Number(item.leaderSize);
  const leaderPrice = Number(item.leaderPrice);
  const planned = item.planned;
  const ratioTitle =
    planned?.followerCash != null && planned?.leaderCash != null
      ? `$${planned.followerCash.toLocaleString()} / $${planned.leaderCash.toLocaleString()} cash`
      : undefined;
  const name = item.subscriptionLabel || shortAddr(item.subscriptionAddress);
  const sideTone =
    item.side === "BUY"
      ? "live"
      : item.side === "SELL"
        ? "danger"
        : item.side === "MERGE" || item.side === "REDEEM"
          ? "warn"
          : item.side === "SPLIT"
            ? "accent"
            : "neutral";

  return (
    <div
      className={cn(
        flatRowGrid,
        "border-b border-border/40 transition-colors duration-150",
        !completed && "hover:bg-muted/25",
        completed && completedFeedClass,
      )}
      title={completed ? "Market closed" : undefined}
    >
      <span className={cn(cell, "whitespace-nowrap font-mono text-xs text-muted-foreground")}>
        {fmtTs(item.tradeTimestamp)}
      </span>
      <span className={cell}>
        <MarketCell title={item.marketTitle} icon={item.marketIcon} outcome={item.marketOutcome} />
      </span>
      <span className={cn(cell, "truncate font-medium text-zinc-100")} title={name}>
        {name}
      </span>
      <span className={cell}>
        <StatusBadge tone={sideTone}>{item.side}</StatusBadge>
      </span>
      <span className={cn(cell, "truncate font-mono text-xs tabular-nums")} title={fmtVol(leaderShares, leaderPrice)}>
        {fmtVol(leaderShares, leaderPrice)}
      </span>
      <span
        className={cn(cell, "truncate font-mono text-xs tabular-nums")}
        title={formatMirrorVol(leaderShares, leaderPrice, planned)}
      >
        {formatMirrorVol(leaderShares, leaderPrice, planned)}
      </span>
      <span className={cn(cell, "font-mono text-xs tabular-nums")} title={ratioTitle}>
        {formatRatio(planned)}
      </span>
      <span className={cn(cell, "flex justify-end")}>
        <StatusBadge tone={intentTone(item.intentStatus)} title={mirrorResultTitle(item)}>
          {mirrorResult(item)}
        </StatusBadge>
      </span>
    </div>
  );
}

function TradeFeedGroupSummaryBar({ items }: { items: TradeFeedItem[] }) {
  const head = items[0];
  const summary = summarizeTradeFeedGroup(items);
  const stats: { label: string; value: string; title: string }[] = [];

  if (head?.followLineState === "abandoned") {
    const root = head.followLineAbandonedReason ? skipLabel(head.followLineAbandonedReason) : null;
    stats.push({
      label: "Follow line",
      value: root ?? "abandoned",
      title:
        followLineAbandonHint(head.followLineAbandonedReason) ??
        "Proportional line abandoned until leader is flat and opens a new BUY.",
    });
  }

  if (summary.leaderNetShares != null) {
    stats.push({
      label: "Leader net",
      value: `${formatShareAmount(summary.leaderNetShares)} sh`,
      title: "Net leader shares in this position (buy fills − sell fills)",
    });
  }
  if (summary.leaderTradedUsd != null && summary.leaderTradedUsd > 0) {
    stats.push({
      label: "Leader volume",
      value: formatGroupUsd(summary.leaderTradedUsd),
      title: "Sum of leader fill notionals (|shares × price|)",
    });
  }
  if (summary.mirrorNetShares != null) {
    stats.push({
      label: "Mirror net",
      value: `${formatShareAmount(summary.mirrorNetShares)} sh`,
      title: "Net planned mirror shares across fills",
    });
  }
  if (summary.mirrorTradedUsd != null && summary.mirrorTradedUsd > 0) {
    stats.push({
      label: "Mirror volume",
      value: formatGroupUsd(summary.mirrorTradedUsd),
      title: "Sum of planned mirror notionals",
    });
  }
  if (summary.followerPosition != null) {
    stats.push({
      label: "Your position",
      value: `${formatShareAmount(summary.followerPosition)} sh`,
      title: "Follower token balance from the latest planned fill in this group",
    });
  }
  if (summary.leaderPositionBefore != null) {
    stats.push({
      label: "Leader held",
      value: `${formatShareAmount(summary.leaderPositionBefore)} sh`,
      title: "Leader position before their latest fill in this group",
    });
  }

  if (stats.length === 0) return null;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 sm:grid-cols-3">
      {stats.map((s) => (
        <div key={s.label} className="min-w-0" title={s.title}>
          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {s.label}
          </dt>
          <dd className="truncate font-mono text-xs font-semibold tabular-nums text-zinc-200">
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TradeFeedGroupOpenButton({
  marketSlug,
  marketTitle,
  className,
}: {
  marketSlug: string | null;
  marketTitle: string | null;
  className?: string;
}) {
  const href = polymarketMarketUrl(marketSlug);
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Open market on Polymarket"
      title={marketTitle ? `View on Polymarket: ${marketTitle}` : "View on Polymarket"}
      className={cn(
        buttonVariants({ variant: "ghost", size: "xs" }),
        "h-7 shrink-0 gap-1 px-2 text-muted-foreground shadow-none",
        className,
      )}
    >
      <ExternalLink className="h-3.5 w-3.5" />
      <span className="text-xs">Open</span>
    </a>
  );
}

function TradeFeedGroupCopyButton({
  items,
  nowMs,
  className,
}: {
  items: TradeFeedItem[];
  nowMs: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    const text = formatTradeFeedGroupForCopy(items, nowMs);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [items, nowMs]);

  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      className={cn("h-7 shrink-0 gap-1 px-2 text-muted-foreground shadow-none", className)}
      onClick={() => void copy()}
      title="Copy group summary for chat"
      aria-label={copied ? "Copied" : "Copy group summary"}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="text-xs">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

/** Tick interval matches the progress fill transition for smooth motion. */
const EVENT_PROGRESS_TICK_MS = 1_000;

function useEventProgressTick(eventWindow: { startMs: number; endMs: number } | null): {
  progress: number | null;
  now: number;
} {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!eventWindow) return;
    setNow(Date.now());
    const id = globalThis.setInterval(() => setNow(Date.now()), EVENT_PROGRESS_TICK_MS);
    return () => globalThis.clearInterval(id);
  }, [eventWindow?.startMs, eventWindow?.endMs]);

  const progress = eventWindow
    ? eventProgressPercent(eventWindow.startMs, eventWindow.endMs, now)
    : null;
  return { progress, now };
}

function TradePositionBlock({ items }: { items: TradeFeedItem[] }) {
  const head = items[0];
  const name = head.subscriptionLabel || shortAddr(head.subscriptionAddress);
  const multi = items.length > 1;
  const eventWindow = tradeFeedEventWindow(items);
  const { progress, now } = useEventProgressTick(eventWindow);
  const completed = isTradeFeedItemCompleted(head, eventWindow, now);
  const progressPct = completed ? 1 : progress;
  const progressTitle = completed
    ? `Ended · ${eventWindow ? `${fmtTs(eventWindow.startMs)} – ${fmtTs(eventWindow.endMs)}` : "Market closed"}`
    : progressPct != null && eventWindow
      ? `${Math.round(progressPct * 100)}% · ${fmtTs(eventWindow.startMs)} – ${fmtTs(eventWindow.endMs)}`
      : undefined;

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-lg border border-border/70 bg-card/40",
        "ring-1 ring-inset ring-border/30",
        completed && completedGroupClass,
      )}
      title={progressTitle}
      role={progressPct != null && !completed ? "progressbar" : undefined}
      aria-valuemin={progressPct != null && !completed ? 0 : undefined}
      aria-valuemax={progressPct != null && !completed ? 100 : undefined}
      aria-valuenow={
        progressPct != null && !completed ? Math.round(progressPct * 100) : undefined
      }
    >
      {completed ? (
        <div className="pointer-events-none absolute inset-0 z-0 bg-muted/15" aria-hidden />
      ) : progressPct != null ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-0 bg-primary/10 transition-[width] ease-linear"
          style={{
            width: `${progressPct * 100}%`,
            transitionDuration: `${EVENT_PROGRESS_TICK_MS}ms`,
          }}
          aria-hidden
        />
      ) : null}
      <div className="relative z-[1]">
      <header className="flex gap-3 border-b border-border/60 py-2 pl-3 pr-2">
        <div
          className={cn(
            "w-1 shrink-0 self-stretch rounded-full",
            completed ? "bg-muted-foreground/30" : "bg-primary/70",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <MarketCell
              title={head.marketTitle}
              icon={head.marketIcon}
              outcome={head.marketOutcome}
              className={cn(
                "min-w-0 flex-1",
                completed && "[&_p]:text-muted-foreground [&_img]:opacity-70",
              )}
            />
            <div className="flex shrink-0 items-center gap-1.5">
              {multi ? (
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                  {items.length} fills
                </span>
              ) : null}
              <TradeFeedGroupOpenButton
                marketSlug={head.marketSlug}
                marketTitle={head.marketTitle}
              />
              <TradeFeedGroupCopyButton items={items} nowMs={now} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span
              className={cn("font-medium", completed ? "text-muted-foreground" : "text-zinc-300")}
              title={name}
            >
              {name}
            </span>
            <span className="text-border/80">·</span>
            <span>{formatGroupSides(items)}</span>
            <span className="text-border/80">·</span>
            <span className="font-mono tabular-nums">{formatGroupTimeRange(items)}</span>
          </div>
          <TradeFeedGroupSummaryBar items={items} />
        </div>
      </header>

      <div>
        {items.map((item) => (
          <TradeFeedFillRow key={item.eventId} item={item} inCompletedGroup={completed} />
        ))}
      </div>
      </div>
    </article>
  );
}

function TradeFeedGroupedView({ items }: { items: TradeFeedItem[] }) {
  const groups = groupTradeFeedItems(items);

  return (
    <>
      <FillColumnsHeader className="sticky top-0 z-10" />
      <div className="space-y-2.5 py-2">
        {groups.map((group) => (
          <TradePositionBlock key={group.key} items={group.items} />
        ))}
      </div>
    </>
  );
}

function TradeFeedFlatView({ items }: { items: TradeFeedItem[] }) {
  const sorted = [...items].sort(compareTradeFeedItemsNewestFirst);
  return (
    <>
      <FlatColumnsHeader className="sticky top-0 z-10" />
      <div className="py-1">
        {sorted.map((item) => (
          <TradeFeedFlatRow key={item.eventId} item={item} />
        ))}
      </div>
    </>
  );
}

export function TradeFeedTable({
  items,
  grouped = true,
}: {
  items: TradeFeedItem[];
  grouped?: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {grouped ? <TradeFeedGroupedView items={items} /> : <TradeFeedFlatView items={items} />}
    </div>
  );
}
