import { cn } from "@/lib/utils";

export function MarketCell({
  title,
  icon,
  outcome,
  className,
}: {
  title: string | null;
  icon: string | null;
  outcome: string | null;
  className?: string;
}) {
  const displayTitle = title?.trim() || "Unknown market";

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {icon ? (
        <img
          src={icon}
          alt=""
          className="h-8 w-8 shrink-0 rounded-md border border-border/60 bg-muted object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div
          className="h-8 w-8 shrink-0 rounded-md border border-border/60 bg-muted"
          aria-hidden
        />
      )}
      <div className="min-w-0">
        <p className="truncate font-medium text-zinc-100" title={displayTitle}>
          {displayTitle}
        </p>
        {outcome ? (
          <p className="truncate text-xs text-muted-foreground" title={outcome}>
            {outcome}
          </p>
        ) : null}
      </div>
    </div>
  );
}
