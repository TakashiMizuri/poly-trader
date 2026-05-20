import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Settings } from "lucide-react";
import {
  addSubscription,
  deleteSub,
  fetchBalance,
  fetchEquityBatch,
  fetchSubs,
  toggleSub,
  updateSubSizing,
  useLivePoll,
} from "../api/hooks";
import type { AddSubBody, UpdateSubSizingBody } from "../api/hooks";
import { Btn, ErrorBanner, FormField, PageCard, StatusBadge } from "../components/app-ui";
import { Page } from "../components/Page";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { motionEnterFast, motionStagger } from "@/lib/motion";
import { polymarketProfileUrl } from "@/lib/polymarket";
import { cn } from "@/lib/utils";
import type { PolymarketEquityResult, Subscription } from "../types";

function fmtTs(ts: number | string | null | undefined) {
  if (ts == null) return "—";
  const n = typeof ts === "number" ? ts : Date.parse(ts);
  if (Number.isNaN(n)) return "—";
  return new Date(n < 1e12 ? n * 1000 : n).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortAddr(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtUsd(amount: number) {
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sizingModeLabel(mode: Subscription["sizingMode"]) {
  if (mode === "fixed_usd") return "Fixed USD";
  if (mode === "pct_balance") return "% balance";
  if (mode === "pct_leader_notional") return "% leader";
  return "Proportional";
}

function proportionalScaleFromSub(sub: Subscription): number {
  const n = Number(sub.pctBalance ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function formatSizingValue(s: Subscription) {
  if (s.sizingMode === "fixed_usd" && s.fixedUsd != null) {
    const n = Number(s.fixedUsd);
    return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : s.fixedUsd;
  }
  if (s.sizingMode === "pct_balance" && s.pctBalance != null) return `${s.pctBalance}%`;
  if (s.sizingMode === "pct_leader_notional" && s.pctLeaderNotional != null) return `${s.pctLeaderNotional}%`;
  if (s.sizingMode === "proportional_equity") {
    const scale = proportionalScaleFromSub(s);
    return scale === 1 ? "auto" : `×${scale}`;
  }
  return "—";
}

function sizingValueFromSub(sub: Subscription): string {
  if (sub.sizingMode === "fixed_usd") return sub.fixedUsd ?? "";
  if (sub.sizingMode === "pct_balance") return sub.pctBalance ?? "";
  if (sub.sizingMode === "proportional_equity") return String(proportionalScaleFromSub(sub));
  return sub.pctLeaderNotional ?? "";
}

function onSizingModeChange(
  mode: Subscription["sizingMode"],
  setSizing: (m: Subscription["sizingMode"]) => void,
  setValue: (v: string) => void,
) {
  setSizing(mode);
  if (mode === "proportional_equity") setValue("1");
}

function formatRatioPct(ratio: number) {
  return `${(ratio * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function ProportionalRatioPreview({
  sub,
  equity,
  followerUsd,
}: {
  sub: Subscription;
  equity: PolymarketEquityResult | undefined;
  followerUsd: number | null | undefined;
}) {
  if (sub.sizingMode !== "proportional_equity") return null;
  if (equity == null || "error" in equity) {
    return <p className="text-xs text-muted-foreground">Ratio preview unavailable</p>;
  }
  if (followerUsd == null || !Number.isFinite(followerUsd)) {
    return <p className="text-xs text-muted-foreground">Connect follower wallet for ratio preview</p>;
  }
  const leaderCash = equity.cashBalance;
  if (!Number.isFinite(leaderCash) || leaderCash <= 0) {
    return <p className="text-xs text-muted-foreground">Leader cash unavailable</p>;
  }
  const scale = proportionalScaleFromSub(sub);
  const ratio = (followerUsd * scale) / leaderCash;
  return (
    <p className="text-xs text-muted-foreground">
      Your ratio ≈{" "}
      <span className="font-medium tabular-nums text-primary">{formatRatioPct(ratio)}</span>
      <span className="text-border"> · </span>
      <span className="tabular-nums">
        {fmtUsd(followerUsd)} / {fmtUsd(leaderCash)} cash
      </span>
      {scale !== 1 ? <span className="text-border"> · scale {scale}</span> : null}
    </p>
  );
}

function SubscriptionSizingDialog({
  sub,
  open,
  onOpenChange,
  disabled,
  onSaved,
}: {
  sub: Subscription;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [sizing, setSizing] = useState<Subscription["sizingMode"]>(sub.sizingMode);
  const [value, setValue] = useState(sizingValueFromSub(sub));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSizing(sub.sizingMode);
    setValue(sizingValueFromSub(sub));
    setError(null);
  }, [open, sub]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    let body: UpdateSubSizingBody;
    if (sizing === "proportional_equity") {
      const num = value.trim() === "" ? 1 : Number(value);
      if (!Number.isFinite(num) || num < 0.01 || num > 10) {
        setError("Scale must be between 0.01 and 10");
        return;
      }
      body = { sizingMode: "proportional_equity", proportionalScale: num };
    } else {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) {
        setError("Enter a valid positive number");
        return;
      }
      if (sizing === "fixed_usd") body = { sizingMode: "fixed_usd", fixedUsd: num };
      else if (sizing === "pct_balance") body = { sizingMode: "pct_balance", pctBalance: num };
      else body = { sizingMode: "pct_leader_notional", pctLeaderNotional: num };
    }

    setBusy(true);
    setError(null);
    try {
      await updateSubSizing(sub.id, body);
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  const valueLabel =
    sizing === "fixed_usd"
      ? "Amount (USD)"
      : sizing === "pct_balance"
        ? "Share of balance"
        : sizing === "proportional_equity"
          ? "Scale (optional, default 1)"
          : "% of leader trade";
  const isProportional = sizing === "proportional_equity";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => void onSave(e)}>
          <DialogHeader>
            <DialogTitle>Follow sizing</DialogTitle>
            <DialogDescription>
              How much to mirror per trade for {sub.label || shortAddr(sub.address)}.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            <FormField label="Sizing mode">
              <Select
                value={sizing}
                onValueChange={(v) => onSizingModeChange(v as typeof sizing, setSizing, setValue)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="fixed_usd">Fixed USD</SelectItem>
                  <SelectItem value="pct_balance">% of balance</SelectItem>
                  <SelectItem value="pct_leader_notional">% of leader</SelectItem>
                  <SelectItem value="proportional_equity">Proportional (cash ratio)</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {isProportional ? (
              <p className="text-xs text-muted-foreground">
                Mirror size is your cash ÷ leader cash per trade (both from Polymarket cash balances).
              </p>
            ) : null}
            <FormField label={valueLabel}>
              <NumberInput
                value={value}
                onChange={(e) => setValue(e.target.value)}
                step="any"
                required={!isProportional}
                disabled={busy || disabled}
                placeholder={isProportional ? "1" : undefined}
              />
            </FormField>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
          </div>

          <DialogFooter>
            <Btn type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Btn>
            <Btn type="submit" variant="primary" disabled={busy || disabled}>
              Save
            </Btn>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatLimits(s: Subscription) {
  const parts: string[] = [];
  if (s.maxNotionalPerTrade != null) {
    const n = Number(s.maxNotionalPerTrade);
    parts.push(Number.isFinite(n) ? `$${n.toLocaleString()} cap` : `$${s.maxNotionalPerTrade} cap`);
  }
  if (s.maxOrdersPerSecond != null) parts.push(`${s.maxOrdersPerSecond}/s`);
  if (s.maxSlippageBps != null) parts.push(`${s.maxSlippageBps} bps`);
  return parts.length ? parts.join(" · ") : null;
}

function sortSubs(list: Subscription[]) {
  return [...list].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

function isEquityError(v: PolymarketEquityResult | undefined): v is { error: string } {
  return v != null && "error" in v;
}

function LeaderBalance({
  equity,
  loading,
}: {
  equity: PolymarketEquityResult | undefined;
  loading: boolean;
}) {
  if (loading && !equity) {
    return (
      <div className="rounded-lg bg-muted/25 px-3 py-2.5">
        <p className="text-xs text-muted-foreground">Loading balance…</p>
      </div>
    );
  }
  if (!equity) {
    return (
      <div className="rounded-lg bg-muted/25 px-3 py-2.5">
        <p className="text-xs text-muted-foreground">Balance unavailable</p>
      </div>
    );
  }
  if (isEquityError(equity)) {
    return (
      <div className="rounded-lg bg-muted/25 px-3 py-2.5">
        <p className="text-xs text-danger">{equity.error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-muted/25 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">Equity</span>
        <span className="text-lg font-semibold tabular-nums text-primary">{fmtUsd(equity.equity)}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{fmtUsd(equity.cashBalance)} cash</span>
        <span className="mx-1.5 text-border">·</span>
        <span className="tabular-nums">{fmtUsd(equity.positionsValue)} positions</span>
      </p>
    </div>
  );
}

function SubscriptionCard({
  sub,
  equity,
  equityLoading,
  followerUsd,
  rowBusy,
  index,
  onToggle,
  onDelete,
  onRefresh,
}: {
  sub: Subscription;
  equity: PolymarketEquityResult | undefined;
  equityLoading: boolean;
  followerUsd: number | null | undefined;
  rowBusy: boolean;
  index: number;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void | Promise<void>;
}) {
  const limits = formatLimits(sub);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <Card
      size="sm"
      className={cn(
        "gap-0 border border-border bg-card py-0 shadow-none ring-0",
        "transition-[background-color,border-color,opacity] duration-200",
        "hover:bg-muted/20",
        motionEnterFast,
        motionStagger(index),
        sub.active && "border-primary/30 hover:border-primary/50",
        !sub.active && "opacity-90 hover:opacity-100 hover:border-zinc-600"
      )}
    >
      <CardHeader className="border-b border-border/50 px-4 py-3 [.border-b]:pb-3">
        <CardTitle className="truncate text-base font-semibold text-foreground">
          {sub.label || shortAddr(sub.address)}
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs" title={sub.address}>
          {shortAddr(sub.address)}
        </CardDescription>
        <CardAction className="flex items-center gap-1">
          <a
            href={polymarketProfileUrl(sub.address)}
            target="_blank"
            rel="noreferrer"
            aria-label="Open Polymarket profile"
            title="View on Polymarket"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ExternalLink className="size-4" />
          </a>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={rowBusy}
            aria-label="Sizing settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="size-4" />
          </Button>
          <StatusBadge tone={sub.active ? "live" : "neutral"}>
            {sub.active ? "Active" : "Paused"}
          </StatusBadge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3 px-4 py-3">
        <LeaderBalance equity={equity} loading={equityLoading} />

        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">{sizingModeLabel(sub.sizingMode)}</span>
          <span className="font-medium tabular-nums text-foreground">{formatSizingValue(sub)}</span>
        </div>

        <ProportionalRatioPreview sub={sub} equity={equity} followerUsd={followerUsd} />

        <dl className="space-y-1 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Last trade</dt>
            <dd className="tabular-nums text-foreground/80">{fmtTs(sub.lastTradeTimestamp)}</dd>
          </div>
          {limits ? (
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">Limits</dt>
              <dd className="text-right text-foreground/80">{limits}</dd>
            </div>
          ) : null}
        </dl>
      </CardContent>

      <CardFooter className="gap-2 border-t border-border/50 bg-transparent px-4 py-2.5">
        <Btn size="sm" variant="ghost" disabled={rowBusy} className="flex-1" onClick={() => onToggle(sub.id)}>
          {sub.active ? "Pause" : "Resume"}
        </Btn>
        <Btn size="sm" variant="danger" disabled={rowBusy} className="flex-1" onClick={() => onDelete(sub.id)}>
          Delete
        </Btn>
      </CardFooter>

      <SubscriptionSizingDialog
        sub={sub}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        disabled={rowBusy}
        onSaved={onRefresh}
      />
    </Card>
  );
}

function SubscriptionsGrid({
  items,
  balances,
  equityLoading,
  followerUsd,
  actingId,
  formBusy,
  onToggle,
  onDelete,
  onRefresh,
}: {
  items: Subscription[];
  balances: Record<string, PolymarketEquityResult> | undefined;
  equityLoading: boolean;
  followerUsd: number | null | undefined;
  actingId: string | null;
  formBusy: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void | Promise<void>;
}) {
  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No subscriptions yet — add a leader above.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((s, i) => (
        <SubscriptionCard
          key={s.id}
          index={i}
          sub={s}
          equity={balances?.[s.address.toLowerCase()]}
          equityLoading={equityLoading}
          followerUsd={followerUsd}
          rowBusy={formBusy || actingId === s.id}
          onToggle={onToggle}
          onDelete={onDelete}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

export function SubscriptionsPage() {
  const subs = useLivePoll(useCallback(() => fetchSubs(), []), ["subscriptions"], {
    cacheKey: "api/subscriptions",
  });
  const addresses = useMemo(
    () => (subs.data ?? []).map((s) => s.address),
    [subs.data]
  );
  const equityCacheKey = useMemo(
    () => `api/equity:${addresses.map((a) => a.toLowerCase()).sort().join(",")}`,
    [addresses]
  );
  const equityPoll = useLivePoll(
    useCallback(() => fetchEquityBatch(addresses), [addresses]),
    ["equity", "subscriptions"],
    { cacheKey: equityCacheKey }
  );
  const balancePoll = useLivePoll(useCallback(() => fetchBalance(), []), ["balance"], {
    cacheKey: "api/balance",
  });

  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [sizing, setSizing] = useState<Subscription["sizingMode"]>("fixed_usd");
  const [value, setValue] = useState("25");
  const [busy, setBusy] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const addr = address.trim();
    if (!addr) return;
    setBusy(true);
    setMsg(null);
    try {
      let body: AddSubBody;
      const base = { address: addr, label: label.trim() || undefined };
      if (sizing === "proportional_equity") {
        const scale = value.trim() === "" ? 1 : Number(value);
        if (!Number.isFinite(scale) || scale < 0.01 || scale > 10) {
          setMsg("Scale must be between 0.01 and 10");
          setBusy(false);
          return;
        }
        body = { ...base, sizingMode: "proportional_equity", proportionalScale: scale };
      } else {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          setBusy(false);
          return;
        }
        if (sizing === "fixed_usd") body = { ...base, sizingMode: "fixed_usd", fixedUsd: num };
        else if (sizing === "pct_balance") body = { ...base, sizingMode: "pct_balance", pctBalance: num };
        else body = { ...base, sizingMode: "pct_leader_notional", pctLeaderNotional: num };
      }
      const row = await addSubscription(body);
      setMsg(`Created ${row.id.slice(0, 8)}…`);
      setAddress("");
      setLabel("");
      await subs.refresh();
      await equityPoll.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(id: string) {
    setActingId(id);
    setMsg(null);
    try {
      await toggleSub(id);
      await subs.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not update subscription");
    } finally {
      setActingId(null);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Remove this subscription? Mirroring stops immediately for this leader.")) return;
    setActingId(id);
    setMsg(null);
    try {
      await deleteSub(id);
      await subs.refresh();
      await equityPoll.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not delete subscription");
    } finally {
      setActingId(null);
    }
  }

  const sorted = sortSubs(subs.data ?? []);

  return (
    <Page title="Subscriptions" description="Follow leaders and monitor their Polymarket equity">
      {(subs.error || equityPoll.error) && (
        <ErrorBanner message={subs.error ?? equityPoll.error ?? ""} />
      )}
      {msg && (
        <p className="animate-in fade-in slide-in-from-top-1 duration-300 fill-mode-both text-sm text-primary">
          {msg}
        </p>
      )}

      <PageCard title="Add subscription">
        <form
          onSubmit={(e) => void onAdd(e)}
          className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6"
        >
          <FormField label="Leader address" className="sm:col-span-2 2xl:col-span-2">
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x…"
              className="font-mono"
              required
            />
          </FormField>
          <FormField label="Label (optional)">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Trader name" />
          </FormField>
          <FormField label="Sizing mode">
            <Select
              value={sizing}
              onValueChange={(v) => onSizingModeChange(v as typeof sizing, setSizing, setValue)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="fixed_usd">Fixed USD</SelectItem>
                <SelectItem value="pct_balance">% of balance</SelectItem>
                <SelectItem value="pct_leader_notional">% of leader</SelectItem>
                <SelectItem value="proportional_equity">Proportional (cash ratio)</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={sizing === "proportional_equity" ? "Scale (optional)" : "Value"}>
            <NumberInput
              value={value}
              onChange={(e) => setValue(e.target.value)}
              step="any"
              required={sizing !== "proportional_equity"}
              placeholder={sizing === "proportional_equity" ? "1" : undefined}
            />
          </FormField>
          <div className="flex items-end justify-end sm:col-span-2 lg:col-span-3 2xl:col-span-1">
            <Btn type="submit" variant="primary" disabled={busy || !address.trim()} className="w-full sm:w-auto">
              Create
            </Btn>
          </div>
        </form>
      </PageCard>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-200">
            Subscriptions ({subs.data?.length ?? 0})
          </h2>
          {equityPoll.loading && subs.data?.length ? (
            <span className="text-xs text-muted-foreground">Refreshing balances…</span>
          ) : null}
        </div>

        {subs.loading && !subs.data ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading subscriptions…</p>
        ) : (
          <SubscriptionsGrid
            items={sorted}
            balances={equityPoll.data?.balances}
            equityLoading={equityPoll.loading}
            followerUsd={balancePoll.data?.usd ?? null}
            actingId={actingId}
            formBusy={busy}
            onToggle={(id) => void onToggle(id)}
            onDelete={(id) => void onDelete(id)}
            onRefresh={() => subs.refresh()}
          />
        )}
      </section>
    </Page>
  );
}
