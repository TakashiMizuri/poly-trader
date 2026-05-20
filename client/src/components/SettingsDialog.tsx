import { useState } from 'react'
import { api } from '@/api/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTheme } from '@/context/ThemeContext'
import { useTimeFormat } from '@/context/TimeFormatContext'
import { formatDisplayDateTime } from '@/lib/displayLocale'
import type { TimeFormat } from '@/lib/timeFormat'
import { clearClientTradingState, notifyGlobalReset } from '@/lib/appReset'
import type { Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const THEME_OPTIONS: { value: Theme; label: string; description: string }[] = [
  { value: 'dark', label: 'Dark', description: 'Default trading terminal look' },
  { value: 'light', label: 'Light', description: 'Bright background for daytime use' },
]

const TIME_FORMAT_SAMPLE_MS = new Date(2026, 4, 20, 23, 20, 0).getTime()

const TIME_FORMAT_OPTIONS: { value: TimeFormat; label: string; description: string }[] = [
  {
    value: '24h',
    label: '24-hour',
    description: `Example: ${formatDisplayDateTime(TIME_FORMAT_SAMPLE_MS, '24h')}`,
  },
  {
    value: '12h',
    label: '12-hour',
    description: `Example: ${formatDisplayDateTime(TIME_FORMAT_SAMPLE_MS, '12h')}`,
  },
]

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme()
  const { timeFormat, setTimeFormat } = useTimeFormat()
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  async function handleGlobalReset() {
    const confirmed = confirm(
      'Reset all application data?\n\n' +
        'This will delete trade history, open positions, paper accounts, balance snapshots, ' +
        'and candle snapshots. The engine will stop and a fresh default paper account ($100) will be created.\n\n' +
        'Chart display preferences and legacy browser storage will also be cleared.\n\n' +
        'This cannot be undone.',
    )
    if (!confirmed) return

    setResetBusy(true)
    setResetError(null)
    try {
      await api('/api/reset', { method: 'POST' })
      clearClientTradingState()
      notifyGlobalReset()
      onClose()
    } catch (e) {
      setResetError(e instanceof Error ? e.message : 'Reset failed')
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setResetError(null)
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-md gap-0 p-0" showClose={false}>
        <DialogHeader>
          <div className="min-w-0 pr-10">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Application preferences and data management.
            </DialogDescription>
          </div>
          <DialogClose>Close</DialogClose>
        </DialogHeader>

        <DialogBody className="space-y-6">
          <section>
            <h3 className="text-sm font-medium text-foreground">Appearance</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Choose the interface color theme.
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Theme">
              {THEME_OPTIONS.map((option) => {
                const selected = theme === option.value
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant="outline"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTheme(option.value)}
                    className={cn(
                      'h-auto w-full flex-col items-start justify-start gap-0.5 whitespace-normal px-4 py-3 text-left font-normal',
                      selected
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                        : 'bg-background hover:border-muted-foreground/40',
                    )}
                  >
                    <span className="block font-medium text-foreground">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                      {option.description}
                    </span>
                  </Button>
                )
              })}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-medium text-foreground">Date &amp; time</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              English month names with 12- or 24-hour clock (saved in this browser).
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Time format">
              {TIME_FORMAT_OPTIONS.map((option) => {
                const selected = timeFormat === option.value
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant="outline"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTimeFormat(option.value)}
                    className={cn(
                      'h-auto w-full flex-col items-start justify-start gap-0.5 whitespace-normal px-4 py-3 text-left font-normal',
                      selected
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                        : 'bg-background hover:border-muted-foreground/40',
                    )}
                  >
                    <span className="block font-medium text-foreground">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                      {option.description}
                    </span>
                  </Button>
                )
              })}
            </div>
          </section>

          <Alert variant="destructive" className="flex flex-col gap-3">
            <div className="space-y-1">
              <AlertTitle>Data</AlertTitle>
              <AlertDescription>
                Erase trading history, demo paper accounts, positions, and related server
                data. Creates a single new default paper account and stops the engine.
              </AlertDescription>
            </div>
            {resetError ? (
              <p className="text-sm text-destructive" role="alert">
                {resetError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              disabled={resetBusy}
              onClick={() => void handleGlobalReset()}
              className="h-9 w-full justify-center border-destructive/50 bg-destructive text-primary-foreground hover:bg-destructive/90"
            >
              {resetBusy ? 'Resetting…' : 'Reset all data'}
            </Button>
          </Alert>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
