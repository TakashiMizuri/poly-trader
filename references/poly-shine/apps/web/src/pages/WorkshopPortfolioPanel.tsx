import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { fetchEquity } from "../api/hooks";
import {
  Btn,
  DataTableSkeleton,
  ErrorBanner,
  FormField,
  PageCard,
  Stat,
  StatSkeleton,
} from "../components/app-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { motionEnterFast } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { polymarketProfileUrl } from "../lib/polymarket";
import type { PolymarketEquity } from "../types";
import { fmtUsd, fmtValuationTime, pnlClass, shortAddr } from "./workshop-format";
import {
  type CompareRowState,
  isValidCompareAddress,
  normalizeCompareAddress,
  type WorkshopCompare,
} from "./useWorkshopCompare";

const LOOKUP_DEBOUNCE_MS = 400;

type SortKey =
  | "account"
  | "equity"
  | "cash"
  | "positions"
  | "openPnl"
  | "positionCount"
  | "pnlDay"
  | "pnlWeek"
  | "pnlMonth"
  | "pnlAll"
  | "volAll";

type SortDir = "asc" | "desc";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function sortValue(row: CompareRowState, key: SortKey): string | number {
  if (row.status !== "ready") return key === "account" ? "" : -Infinity;
  const d = row.data;
  switch (key) {
    case "account":
      return (d.displayName ?? d.address).toLowerCase();
    case "equity":
      return d.equity.equity;
    case "cash":
      return d.equity.cashBalance;
    case "positions":
      return d.equity.positionsValue;
    case "openPnl":
      return d.positions.openCashPnl;
    case "positionCount":
      return d.positions.count;
    case "pnlDay":
      return d.leaderboard.day?.pnl ?? -Infinity;
    case "pnlWeek":
      return d.leaderboard.week?.pnl ?? -Infinity;
    case "pnlMonth":
      return d.leaderboard.month?.pnl ?? -Infinity;
    case "pnlAll":
      return d.leaderboard.all?.pnl ?? -Infinity;
    case "volAll":
      return d.leaderboard.all?.vol ?? -Infinity;
  }
}

function SortableHead({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {label}
        <Icon className={cn("size-3.5", active ? "text-primary" : "opacity-40")} aria-hidden />
      </button>
    </TableHead>
  );
}

export function WorkshopPortfolioPanel({ compare }: { compare: WorkshopCompare }) {
  const {
    compareAddresses,
    rows,
    tableError,
    refreshing,
    addToComparison,
    removeFromComparison,
    refreshAll,
  } = compare;
  const [sortKey, setSortKey] = useState<SortKey>("equity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [input, setInput] = useState("");
  const debounced = useDebouncedValue(normalizeCompareAddress(input), LOOKUP_DEBOUNCE_MS);
  const valid = isValidCompareAddress(debounced);
  const alreadyInTable = valid && compareAddresses.includes(debounced);

  const [equity, setEquity] = useState<PolymarketEquity | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  useEffect(() => {
    if (!valid) {
      setEquity(null);
      setLookupError(null);
      setLookupLoading(false);
      return;
    }

    let cancelled = false;
    setLookupLoading(true);
    setLookupError(null);

    void fetchEquity(debounced)
      .then((data) => {
        if (cancelled) return;
        setEquity(data);
        setLookupError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setEquity(null);
        setLookupError(e instanceof Error ? e.message : "Lookup failed");
      })
      .finally(() => {
        if (!cancelled) setLookupLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced, valid]);

  const inputHint = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      return "Paste a Polygon wallet (0x…). Lookup runs automatically; add rows to compare.";
    }
    if (!valid) return "Enter a full 0x address with 40 hexadecimal characters.";
    if (alreadyInTable) return "This address is already in the table.";
    return null;
  }, [input, valid, alreadyInTable]);

  const showStats = valid && (lookupLoading || equity != null);
  const canAdd = valid && equity != null && !lookupLoading && !alreadyInTable;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "account" ? "asc" : "desc");
    }
  };

  const sortedAddresses = useMemo(() => {
    const list = [...compareAddresses];
    list.sort((a, b) => {
      const av = sortValue(rows[a] ?? { status: "loading" }, sortKey);
      const bv = sortValue(rows[b] ?? { status: "loading" }, sortKey);
      let cmp = 0;
      if (typeof av === "string" && typeof bv === "string") cmp = av.localeCompare(bv);
      else cmp = Number(av) - Number(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [compareAddresses, rows, sortKey, sortDir]);

  const initialTableLoading =
    compareAddresses.length > 0 &&
    compareAddresses.every((a) => rows[a]?.status === "loading");

  const headClass =
    "h-auto px-2 pb-2.5 text-left align-bottom whitespace-nowrap first:pl-0 last:pr-0";
  const cellClass = "px-2 py-3 align-middle text-sm tabular-nums first:pl-0 last:pr-0";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
    <PageCard
      title="Portfolio compare"
      fill
      className="h-full min-h-0"
      action={
        <Btn
          variant="ghost"
          size="sm"
          disabled={refreshing || compareAddresses.length === 0}
          onClick={() => void refreshAll()}
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden />
          Refresh
        </Btn>
      }
    >
      <div className={cn(motionEnterFast, "flex min-h-0 flex-1 flex-col gap-4")}>
        <div className="space-y-4 shrink-0">
          <FormField label="Wallet address">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-sm"
            />
            {inputHint ? <p className="mt-1.5 text-xs text-muted-foreground">{inputHint}</p> : null}
          </FormField>

          {lookupError ? <ErrorBanner message={lookupError} /> : null}

          {showStats ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {lookupLoading && !equity ? (
                  <>
                    <StatSkeleton />
                    <StatSkeleton />
                    <StatSkeleton />
                  </>
                ) : equity ? (
                  <>
                    <Stat label="Total equity" value={fmtUsd(equity.equity)} index={0} />
                    <Stat label="Cash balance" value={fmtUsd(equity.cashBalance)} index={1} />
                    <Stat
                      label="Positions value"
                      value={fmtUsd(equity.positionsValue)}
                      index={2}
                    />
                  </>
                ) : null}
              </div>

              {equity ? (
                <p className="text-xs text-muted-foreground">
                  Valuation as of {fmtValuationTime(equity.valuationTime)}
                  {lookupLoading ? (
                    <Loader2 className="ml-1.5 inline size-3 animate-spin align-[-2px] text-muted-foreground" />
                  ) : null}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                {canAdd ? (
                  <Btn variant="primary" size="sm" onClick={() => void addToComparison(debounced)}>
                    Add to comparison
                  </Btn>
                ) : null}
                <a
                  href={polymarketProfileUrl(debounced)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  Polymarket profile
                  <ExternalLink className="size-3" aria-hidden />
                </a>
                <a
                  href={`https://polygonscan.com/address/${debounced}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  Polygonscan
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </div>
            </div>
          ) : null}
        </div>

        {tableError ? <ErrorBanner message={tableError} /> : null}

        <div className="min-h-0 min-w-0 flex-1 overflow-x-auto">
          {initialTableLoading ? (
            <DataTableSkeleton columns={12} rows={Math.min(compareAddresses.length, 6)} />
          ) : compareAddresses.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No accounts in the table yet. Look up a wallet above and add it to compare balances
              and PnL side by side.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <SortableHead
                    label="Account"
                    sortKey="account"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className={headClass}
                  />
                  <SortableHead
                    label="Equity"
                    sortKey="equity"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className={headClass}
                  />
                  <SortableHead
                    label="Cash"
                    sortKey="cash"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className={headClass}
                  />
                  <SortableHead
                    label="Positions"
                    sortKey="positions"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className={headClass}
                  />
                  <SortableHead
                    label="Open PnL"
                    sortKey="openPnl"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className={headClass}
                  />
                  <SortableHead
                    label="#"
                    sortKey="positionCount"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className={headClass}
                  />
                  <SortableHead
                    label="1D"
                    sortKey="pnlDay"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className={headClass}
                  />
                  <SortableHead
                    label="7D"
                    sortKey="pnlWeek"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className={headClass}
                  />
                  <SortableHead
                    label="30D"
                    sortKey="pnlMonth"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className={headClass}
                  />
                  <SortableHead
                    label="All"
                    sortKey="pnlAll"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className={headClass}
                  />
                  <SortableHead
                    label="Volume"
                    sortKey="volAll"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className={headClass}
                  />
                  <TableHead className={cn(headClass, "w-px")} />
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/60">
                {sortedAddresses.map((address) => {
                  const row = rows[address] ?? { status: "loading" as const };
                  return (
                    <TableRow key={address} className="border-0 hover:bg-muted/40">
                      <TableCell className={cn(cellClass, "min-w-[10rem]")}>
                        {row.status === "ready" ? (
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">
                              {row.data.displayName ?? shortAddr(address)}
                            </p>
                            <p
                              className="truncate font-mono text-xs text-muted-foreground"
                              title={address}
                            >
                              {shortAddr(address)}
                            </p>
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {shortAddr(address)}
                          </span>
                        )}
                      </TableCell>
                      {row.status === "loading" ? (
                        <TableCell colSpan={10} className={cellClass}>
                          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" />
                            Loading portfolio…
                          </span>
                        </TableCell>
                      ) : row.status === "error" ? (
                        <TableCell colSpan={10} className={cn(cellClass, "text-danger text-xs")}>
                          {row.message}
                        </TableCell>
                      ) : (
                        <>
                          <TableCell className={cellClass}>
                            {fmtUsd(row.data.equity.equity)}
                          </TableCell>
                          <TableCell className={cellClass}>
                            {fmtUsd(row.data.equity.cashBalance)}
                          </TableCell>
                          <TableCell className={cellClass}>
                            {fmtUsd(row.data.equity.positionsValue)}
                          </TableCell>
                          <TableCell
                            className={cn(cellClass, pnlClass(row.data.positions.openCashPnl))}
                          >
                            {fmtUsd(row.data.positions.openCashPnl)}
                          </TableCell>
                          <TableCell className={cellClass}>{row.data.positions.count}</TableCell>
                          <TableCell
                            className={cn(cellClass, pnlClass(row.data.leaderboard.day?.pnl))}
                          >
                            {fmtUsd(row.data.leaderboard.day?.pnl)}
                          </TableCell>
                          <TableCell
                            className={cn(cellClass, pnlClass(row.data.leaderboard.week?.pnl))}
                          >
                            {fmtUsd(row.data.leaderboard.week?.pnl)}
                          </TableCell>
                          <TableCell
                            className={cn(cellClass, pnlClass(row.data.leaderboard.month?.pnl))}
                          >
                            {fmtUsd(row.data.leaderboard.month?.pnl)}
                          </TableCell>
                          <TableCell
                            className={cn(cellClass, pnlClass(row.data.leaderboard.all?.pnl))}
                          >
                            {fmtUsd(row.data.leaderboard.all?.pnl)}
                          </TableCell>
                          <TableCell className={cellClass}>
                            {fmtUsd(row.data.leaderboard.all?.vol)}
                          </TableCell>
                        </>
                      )}
                      <TableCell className={cn(cellClass, "text-right whitespace-nowrap")}>
                        <a
                          href={polymarketProfileUrl(address)}
                          target="_blank"
                          rel="noreferrer"
                          className="mr-2 inline-flex text-primary hover:underline"
                          title="Polymarket profile"
                          aria-label="Open Polymarket profile"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove from comparison"
                          onClick={() => removeFromComparison(address)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <p className="shrink-0 text-xs text-muted-foreground">
          Period PnL and volume come from Polymarket leaderboard stats. Comparison rows are saved in
          this browser.
        </p>
      </div>
    </PageCard>
    </div>
  );
}
