import { useCallback } from "react";
import { User } from "lucide-react";
import { fetchMe, usePoll } from "@/api/hooks";
import { cn } from "@/lib/utils";

function shortAddr(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function SidebarPolymarketUser() {
  const me = usePoll(useCallback(() => fetchMe(), []), 300_000, { cacheKey: "api/me" });

  const displayName = me.data?.displayName?.trim();
  const address = me.data?.address;
  const profileImage = me.data?.profileImage;

  if (me.loading && !me.data) {
    return (
      <div
        className="px-4 py-2 text-sm text-muted-foreground"
        aria-busy="true"
        aria-label="Loading Polymarket profile"
      >
        <span className="inline-block h-4 w-24 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!address && !displayName) {
    if (me.error) {
      return (
        <p className="px-4 py-2 text-xs text-muted-foreground" title={me.error}>
          Polymarket account unavailable
        </p>
      );
    }
    return null;
  }

  const label = displayName ?? (address ? shortAddr(address) : "Polymarket");

  return (
    <div className="flex items-center gap-2.5 px-4 py-2" title={address ?? undefined}>
      {profileImage ? (
        <img
          src={profileImage}
          alt=""
          className="size-7 shrink-0 rounded-full border border-border object-cover"
        />
      ) : (
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground"
          )}
          aria-hidden
        >
          <User className="size-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        {displayName && address ? (
          <p className="truncate font-mono text-xs text-muted-foreground">{shortAddr(address)}</p>
        ) : null}
      </div>
    </div>
  );
}
