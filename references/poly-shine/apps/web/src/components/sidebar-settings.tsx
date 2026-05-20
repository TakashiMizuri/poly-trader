import { useState } from "react";
import { LogOut, RotateCcw, Settings } from "lucide-react";
import { globalReset } from "@/api/hooks";
import { useAuth } from "@/api/auth";
import { clearAllPollCaches } from "@/api/poll-cache";
import { Btn, ErrorBanner } from "@/components/app-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function SidebarSettings() {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGlobalReset() {
    if (
      !window.confirm(
        "Reset everything? This deletes all subscriptions, clears activity data, snapshots, and audit history, and pauses the engine in read-only mode. This cannot be undone."
      )
    ) {
      return;
    }
    setResetting(true);
    setError(null);
    try {
      await globalReset();
      clearAllPollCaches();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-base font-medium text-muted-foreground",
          "transition-[color,background-color,transform] hover:bg-secondary hover:text-foreground active:scale-[0.98]"
        )}
      >
        <Settings className="size-4 shrink-0" aria-hidden />
        Settings
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Global settings</DialogTitle>
          <DialogDescription>
            Operator-wide actions for this console and local database.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="mt-4">
            <ErrorBanner message={error} />
          </div>
        ) : null}
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">Global reset</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Removes every subscription and wipes stored events, intents, executions, balance
              snapshots, PnL rollups, and audit history. The engine is paused in read-only mode.
            </p>
            <Btn
              variant="danger"
              className="mt-3 gap-2"
              disabled={resetting}
              onClick={() => void handleGlobalReset()}
            >
              <RotateCcw className="size-4" aria-hidden />
              {resetting ? "Resetting…" : "Reset all data"}
            </Btn>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">Sign out</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Clears the API token stored in this browser and returns to the connect screen.
            </p>
            <Btn
              variant="default"
              className="mt-3 gap-2"
              onClick={() => {
                setOpen(false);
                logout();
              }}
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </Btn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
