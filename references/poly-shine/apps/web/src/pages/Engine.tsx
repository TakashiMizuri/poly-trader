import { useCallback, useState } from "react";
import {
  fetchEngine,
  patchEngine,
  pauseEngine,
  resumeEngine,
  useLivePoll,
} from "../api/hooks";
import {
  Btn,
  ErrorBanner,
  PageCard,
  Skeleton,
  Stat,
  StatSkeleton,
  StatusBadge,
} from "../components/app-ui";
import type { StatusBadgeTone } from "../components/app-ui";
import { Page } from "../components/Page";
import { motionEnterFast, motionStagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { EngineMode, EngineState } from "../types";

const MODES: EngineMode[] = ["read_only", "shadow", "live"];

const MODE_INFO: Record<EngineMode, { title: string; description: string }> = {
  read_only: {
    title: "Read only",
    description: "Ingest leader activity only — no mirror intents or orders.",
  },
  shadow: {
    title: "Shadow",
    description: "Plan mirror trades without posting orders to the exchange.",
  },
  live: {
    title: "Live",
    description: "Post mirror orders when leader trades match your sizing.",
  },
};

function modeTone(mode: EngineMode): StatusBadgeTone {
  if (mode === "live") return "live";
  if (mode === "shadow") return "shadow";
  return "neutral";
}

function fmtTs(ts: string | null | undefined) {
  if (!ts) return "—";
  const n = Date.parse(ts);
  if (Number.isNaN(n)) return "—";
  return new Date(n).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function EngineStatusStrip({ data, pending }: { data: EngineState | null | undefined; pending: boolean }) {
  if (pending) {
    return (
      <div className={cn(motionEnterFast, "grid grid-cols-1 gap-3 sm:grid-cols-3")}>
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={cn(motionEnterFast, "grid grid-cols-1 gap-3 sm:grid-cols-3")}>
      <Stat
        index={0}
        label="Mode"
        value={<StatusBadge tone={modeTone(data.mode)}>{data.mode}</StatusBadge>}
        hint={MODE_INFO[data.mode].title}
      />
      <Stat
        index={1}
        label="Runtime"
        value={
          <StatusBadge tone={data.paused ? "warn" : "live"}>
            {data.paused ? "Paused" : "Running"}
          </StatusBadge>
        }
        hint={data.paused ? "Mirroring is stopped" : "Actively processing leaders"}
      />
      <Stat
        index={2}
        label="Cancel on pause"
        value={
          <StatusBadge tone={data.cancelAllOnKill ? "accent" : "neutral"}>
            {data.cancelAllOnKill ? "On" : "Off"}
          </StatusBadge>
        }
        hint={data.cancelAllOnKill ? "Open orders cancelled when paused" : "Orders kept when paused"}
      />
    </div>
  );
}

function ModeSelector({
  current,
  disabled,
  onSelect,
  className,
}: {
  current: EngineMode | undefined;
  disabled: boolean;
  onSelect: (mode: EngineMode) => void;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-3 sm:items-stretch", className)}>
      {MODES.map((m, i) => {
        const info = MODE_INFO[m];
        const selected = current === m;
        return (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(m)}
            className={cn(
              "flex h-full min-h-[7.5rem] flex-col rounded-lg border px-3 py-3 text-left",
              "transition-[background-color,border-color] duration-200",
              "disabled:pointer-events-none disabled:opacity-50",
              motionStagger(i),
              selected
                ? "border-primary/50 bg-primary/10"
                : "border-border bg-muted/15 hover:bg-muted/25 hover:border-zinc-600"
            )}
          >
            <span className="block text-sm font-medium text-foreground">{info.title}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {info.description}
            </span>
            <span className="mt-auto block pt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
              {m}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TogglePair({
  value,
  disabled,
  onOn,
  onOff,
  labels = { on: "On", off: "Off" },
}: {
  value: boolean | undefined;
  disabled: boolean;
  onOn: () => void;
  onOff: () => void;
  labels?: { on: string; off: string };
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Btn
        variant={value ? "primary" : "default"}
        disabled={disabled}
        className="w-full"
        onClick={onOn}
      >
        {labels.on}
      </Btn>
      <Btn
        variant={value === false ? "primary" : "default"}
        disabled={disabled}
        className="w-full"
        onClick={onOff}
      >
        {labels.off}
      </Btn>
    </div>
  );
}

export function EnginePage() {
  const { data, error, loading, refresh } = useLivePoll(
    useCallback(() => fetchEngine(), []),
    ["engine"],
    { cacheKey: "api/engine" }
  );
  const pending = loading && !data;
  const [busy, setBusy] = useState(false);

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }

  async function setMode(mode: EngineMode) {
    await run(async () => {
      await patchEngine({ mode });
      await refresh();
    });
  }

  async function setCancelAll(on: boolean) {
    await run(async () => {
      await patchEngine({ cancelAllOnKill: on });
      await refresh();
    });
  }

  async function togglePause() {
    if (!data) return;
    await run(async () => {
      if (data.paused) await resumeEngine();
      else await pauseEngine();
      await refresh();
    });
  }

  const controlsDisabled = busy || pending;

  return (
    <Page title="Engine" description="Mode, pause behavior, and rollout controls">
      {error && <ErrorBanner message={error} />}

      <EngineStatusStrip data={data} pending={pending} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-200">Controls</h2>

        <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
          <PageCard
            title="Operating mode"
            className="flex h-full flex-col lg:col-span-2"
            contentClassName="flex min-h-0 flex-1 flex-col"
          >
            <p className="mb-4 shrink-0 text-sm text-muted-foreground">
              Choose how the worker handles leader trades. Changes apply on the next processed event.
            </p>
            <ModeSelector
              className="min-h-0 flex-1 lg:min-h-[11rem]"
              current={data?.mode}
              disabled={controlsDisabled}
              onSelect={(m) => void setMode(m)}
            />
          </PageCard>

          <PageCard
            title="Runtime"
            className="flex h-full flex-col"
            contentClassName="flex min-h-0 flex-1 flex-col"
            action={
              data ? (
                <Btn
                  size="sm"
                  variant={data.paused ? "primary" : "default"}
                  disabled={controlsDisabled}
                  onClick={() => void togglePause()}
                >
                  {data.paused ? "Resume" : "Pause"}
                </Btn>
              ) : pending ? (
                <Skeleton className="h-8 w-16 rounded-md" />
              ) : null
            }
          >
            <p className="text-sm text-muted-foreground">
              Pause stops mirroring immediately. Resume continues from the current mode and subscriptions.
            </p>
            {data ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Updated{" "}
                <span className="tabular-nums text-foreground/80">{fmtTs(data.updatedAt)}</span>
              </p>
            ) : pending ? (
              <Skeleton className="mt-2 h-4 w-36" />
            ) : null}

            <div className="mt-auto border-t border-border/50 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cancel on pause
              </p>
              <p className="mt-1.5 mb-3 text-sm text-muted-foreground">
                Cancel open follower orders when paused (
                <code className="font-mono text-xs">/cancelall on</code>).
              </p>
              <TogglePair
                value={data?.cancelAllOnKill}
                disabled={controlsDisabled}
                onOn={() => void setCancelAll(true)}
                onOff={() => void setCancelAll(false)}
              />
            </div>
          </PageCard>
        </div>
      </section>

      <PageCard title="Raw state" contentClassName="p-0">
        {data ? (
          <pre className="max-h-72 overflow-auto p-4 font-mono text-xs leading-relaxed text-zinc-400">
            {JSON.stringify(data, null, 2)}
          </pre>
        ) : pending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
            <Skeleton className="h-3 w-full" />
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No engine state available.</p>
        )}
      </PageCard>
    </Page>
  );
}
