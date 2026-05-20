import type { ReactNode } from "react";
import { motionEnterFast } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function Page({
  title,
  description,
  children,
  className,
  fill,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Fill main content area; children should use flex-1 for scrollable panels. */
  fill?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col",
        fill ? "h-full min-h-0 flex-1 gap-4" : "space-y-6",
        className
      )}
    >
      <header className={cn("shrink-0", motionEnterFast)}>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 animate-in fade-in duration-300 fill-mode-both text-sm text-muted-foreground [--tw-animation-delay:60ms]">
            {description}
          </p>
        ) : null}
      </header>
      {fill ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
