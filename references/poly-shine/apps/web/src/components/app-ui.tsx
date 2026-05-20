import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { motionEnterFast, motionFade, motionStagger } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function PageCard({
  title,
  children,
  action,
  className,
  contentClassName,
  fill,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  contentClassName?: string;
  /** Stretch card to parent height; content scrolls when overflow. */
  fill?: boolean;
}) {
  return (
    <Card
      className={cn(
        "w-full gap-0 overflow-hidden rounded-xl border border-border bg-card py-0 shadow-none ring-0",
        motionEnterFast,
        fill && "flex min-h-0 flex-col",
        className
      )}
    >
      <div
        data-slot="card-header"
        className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4"
      >
        <CardTitle className="min-w-0 truncate text-sm font-semibold leading-none tracking-wide text-zinc-200">
          {title}
        </CardTitle>
        {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
      </div>
      <CardContent
        className={cn(
          "px-4 py-3",
          fill && "flex min-h-0 flex-1 flex-col overflow-hidden",
          contentClassName
        )}
      >
        {children}
      </CardContent>
    </Card>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-muted", className)} aria-hidden>
      <div className="absolute inset-0 animate-shimmer opacity-60" />
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  index = 0,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  index?: number;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3",
        motionEnterFast,
        motionStagger(index),
      )}
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 min-h-7 text-xl font-semibold tabular-nums text-foreground transition-opacity duration-300">
        {value}
      </p>
      <p className={cn("mt-0.5 min-h-4 text-xs text-muted-foreground", !hint && "invisible")}>
        {hint ?? "\u00a0"}
      </p>
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2 h-7 w-16" />
      <Skeleton className="mt-1 h-4 w-24" />
    </div>
  );
}

export function EngineDetailsSkeleton() {
  return (
    <dl className="space-y-3 text-sm">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-4 w-28 shrink-0" />
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </dl>
  );
}

export function DataTableSkeleton({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <div className="min-w-0 space-y-0">
      <div className="flex gap-4 border-b border-border pb-2.5">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-14 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4 py-3">
            {Array.from({ length: columns }).map((_, j) => (
              <Skeleton key={j} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export type StatusBadgeTone = "neutral" | "live" | "shadow" | "warn" | "danger" | "accent";

export function StatusBadge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: StatusBadgeTone;
  title?: string;
}) {
  return (
    <Badge variant={tone} title={title}>
      {children}
    </Badge>
  );
}

const btnVariantMap = {
  default: "secondary",
  primary: "default",
  danger: "destructive",
  ghost: "ghost",
} as const;

export function Btn({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: keyof typeof btnVariantMap;
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <Button
      type={type}
      disabled={disabled}
      onClick={onClick}
      variant={btnVariantMap[variant]}
      size={size === "sm" ? "sm" : "default"}
      className={className}
    >
      {children}
    </Button>
  );
}

const tableHeadClass =
  "h-auto px-0 pb-2.5 pr-4 text-xs font-medium uppercase tracking-wider text-muted-foreground";
const tableCellClass = "px-0 py-3 pr-4 align-middle text-sm text-zinc-300";

export function DataTable({
  headers,
  rows,
  emptyMessage = "No rows",
  mono = false,
}: {
  headers: string[];
  rows: ReactNode[][];
  emptyMessage?: string;
  mono?: boolean;
}) {
  const cellClass = cn(tableCellClass, mono && "font-mono text-xs tabular-nums");

  return (
    <div className="min-w-0 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            {headers.map((h, i) => (
              <TableHead
                key={`${h}-${i}`}
                className={cn(tableHeadClass, i === headers.length - 1 && h === "" && "w-px text-right")}
              >
                {h || null}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-border/60">
          {rows.map((cells, i) => (
            <TableRow
              key={i}
              className={cn(
                "border-0 transition-colors duration-150 hover:bg-muted/40",
                motionEnterFast,
                motionStagger(Math.min(i, 8))
              )}
            >
              {cells.map((cell, j) => (
                <TableCell
                  key={j}
                  className={cn(
                    cellClass,
                    j === cells.length - 1 && "text-right whitespace-nowrap"
                  )}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 ? (
        <p className={cn("py-8 text-center text-sm text-muted-foreground", motionFade)}>{emptyMessage}</p>
      ) : null}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <Alert
      variant="destructive"
      className={cn(
        "border-red-800/50 bg-red-950/40 text-danger",
        "animate-in fade-in slide-in-from-top-1 duration-300 fill-mode-both"
      )}
    >
      <AlertDescription className="text-danger">{message}</AlertDescription>
    </Alert>
  );
}
