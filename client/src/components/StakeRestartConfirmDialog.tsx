import type { StakeSettingChange } from '@/lib/engineStakeSettings'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  changes: StakeSettingChange[]
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function StakeRestartConfirmDialog({
  open,
  changes,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Apply stake changes?</DialogTitle>
          <DialogDescription>
            Stake settings were changed while the engine was running. They take
            effect only after restart.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <ul className="space-y-2.5 text-sm">
            {changes.map((change) => (
              <li
                key={change.label}
                className="rounded-lg border border-border bg-background px-3 py-2"
              >
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {change.label}
                </p>
                <p className="mt-1 font-mono tabular-nums text-foreground">
                  <span className="text-muted-foreground">{change.from}</span>
                  <span className="mx-2 text-muted-foreground/70">→</span>
                  <span>{change.to}</span>
                </p>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Do you really want to continue and start the engine with the new
            stake settings?
          </p>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="success"
            size="sm"
            disabled={busy}
            onClick={onConfirm}
          >
            Start engine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
