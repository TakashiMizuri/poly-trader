import type { ChartDisplayPrefs } from '@/lib/chartDisplayPrefs'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface ChartSettingsDialogProps {
  open: boolean
  prefs: ChartDisplayPrefs
  onPrefsChange: (prefs: ChartDisplayPrefs) => void
  onClose: () => void
}

export function ChartSettingsDialog({
  open,
  prefs,
  onPrefsChange,
  onClose,
}: ChartSettingsDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-sm gap-0 p-0" showClose={false}>
        <DialogHeader>
          <div className="min-w-0 pr-10">
            <DialogTitle>Chart settings</DialogTitle>
            <DialogDescription>
              Choose which overlays appear on the candlestick chart.
            </DialogDescription>
          </div>
          <DialogClose>Close</DialogClose>
        </DialogHeader>

        <DialogBody>
          <div className="flex flex-col gap-2">
            <Label
              className={cn(
                'cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:border-muted-foreground/40',
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={prefs.showBetMarkers}
                onCheckedChange={(checked) =>
                  onPrefsChange({
                    ...prefs,
                    showBetMarkers: checked === true,
                  })
                }
              />
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Backtest (+/−)
                </span>
                <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                  Plus and minus markers above candles from the unified strategy simulation.
                </span>
              </span>
            </Label>

            <Label
              className={cn(
                'cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:border-muted-foreground/40',
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={prefs.showTrends}
                onCheckedChange={(checked) =>
                  onPrefsChange({
                    ...prefs,
                    showTrends: checked === true,
                  })
                }
              />
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Trends
                </span>
                <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                  Highlight long / short segments on the chart.
                </span>
              </span>
            </Label>

            <Label
              className={cn(
                'cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:border-muted-foreground/40',
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={prefs.showBosOverlay}
                onCheckedChange={(checked) =>
                  onPrefsChange({
                    ...prefs,
                    showBosOverlay: checked === true,
                  })
                }
              />
              <span>
                <span className="block text-sm font-medium text-foreground">
                  BoS levels
                </span>
                <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                  Bullish / bearish break-of-structure lines.
                </span>
              </span>
            </Label>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
