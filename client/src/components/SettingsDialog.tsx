import { useEffect, useState } from 'react'
import type { EngineSettings, LiveEntryOrderMode } from '@/api/client'
import { api, normalizeLiveEntryOrderMode } from '@/api/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { usePaperTrading } from '@/context/PaperTradingContext'
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

const LIVE_ENTRY_ORDER_OPTIONS: {
  value: LiveEntryOrderMode
  label: string
  description: string
}[] = [
  {
    value: 'Limit',
    label: 'Limit',
    description:
      'Post-only limit at the best bid (0% fee). Two waves: full stake, then remainder.',
  },
  {
    value: 'Market',
    label: 'Market',
    description: 'IOC taker buy at the ask (legacy; pays taker fees).',
  },
]

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
  const { paperTradingEnabled, setPaperTradingEnabled } = usePaperTrading()
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [paperModeError, setPaperModeError] = useState<string | null>(null)
  const [autoRedeemEnabled, setAutoRedeemEnabled] = useState(true)
  const [autoRedeemLoading, setAutoRedeemLoading] = useState(false)
  const [autoRedeemError, setAutoRedeemError] = useState<string | null>(null)
  const [liveEntryOrderMode, setLiveEntryOrderMode] =
    useState<LiveEntryOrderMode>('Limit')
  const [liveEntryOrderLoading, setLiveEntryOrderLoading] = useState(false)
  const [liveEntryOrderError, setLiveEntryOrderError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setAutoRedeemLoading(true)
    setAutoRedeemError(null)
    setLiveEntryOrderLoading(true)
    setLiveEntryOrderError(null)
    void api<EngineSettings>('/api/engine')
      .then((settings) => {
        if (!cancelled) {
          setAutoRedeemEnabled(settings.autoRedeemEnabled)
          setLiveEntryOrderMode(normalizeLiveEntryOrderMode(settings.liveEntryOrderMode))
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setAutoRedeemError(
            e instanceof Error ? e.message : 'Could not load engine settings',
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAutoRedeemLoading(false)
          setLiveEntryOrderLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleLiveEntryOrderModeChange(mode: LiveEntryOrderMode) {
    setLiveEntryOrderError(null)
    const previous = liveEntryOrderMode
    setLiveEntryOrderMode(mode)
    try {
      const settings = await api<EngineSettings>('/api/engine', {
        method: 'PUT',
        body: JSON.stringify({ liveEntryOrderMode: mode }),
      })
      setLiveEntryOrderMode(normalizeLiveEntryOrderMode(settings.liveEntryOrderMode))
    } catch (e) {
      setLiveEntryOrderMode(previous)
      setLiveEntryOrderError(
        e instanceof Error ? e.message : 'Could not update entry order mode',
      )
    }
  }

  async function handleAutoRedeemToggle(enabled: boolean) {
    setAutoRedeemError(null)
    const previous = autoRedeemEnabled
    setAutoRedeemEnabled(enabled)
    try {
      const settings = await api<EngineSettings>('/api/engine', {
        method: 'PUT',
        body: JSON.stringify({ autoRedeemEnabled: enabled }),
      })
      setAutoRedeemEnabled(settings.autoRedeemEnabled)
    } catch (e) {
      setAutoRedeemEnabled(previous)
      setAutoRedeemError(
        e instanceof Error ? e.message : 'Could not update auto-redeem setting',
      )
    }
  }

  async function handlePaperTradingToggle(enabled: boolean) {
    setPaperModeError(null)
    if (!enabled) {
      try {
        await api('/api/engine', {
          method: 'PUT',
          body: JSON.stringify({ tradingMode: 'Live', isRunning: false }),
        })
        setPaperTradingEnabled(false)
      } catch (e) {
        setPaperModeError(
          e instanceof Error ? e.message : 'Could not switch engine to Live mode',
        )
      }
      return
    }
    setPaperTradingEnabled(true)
  }

  async function handleGlobalReset() {
    const confirmed = confirm(
      paperTradingEnabled
        ? 'Reset all application data?\n\n' +
            'This will delete trade history, open positions, paper accounts, balance snapshots, ' +
            'candle snapshots, and backend log files. The engine will stop and a fresh default paper account ($100) will be created.\n\n' +
            'Chart settings (overlays) are kept.\n\n' +
            'This cannot be undone.'
        : 'Reset all application data?\n\n' +
            'This will delete trade history, open positions, balance snapshots, candle snapshots, ' +
            'and backend log files. The engine will stop.\n\n' +
            'Chart settings (overlays) are kept.\n\n' +
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

          <section>
            <h3 className="text-sm font-medium text-foreground">Trading</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Paper mode simulates fills at live Polymarket prices without spending
              USDC.
            </p>

            <Label
              className={cn(
                'mt-3 cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:border-muted-foreground/40',
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={paperTradingEnabled}
                onCheckedChange={(checked) =>
                  void handlePaperTradingToggle(checked === true)
                }
              />
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Включить paper-торговлю
                </span>
                <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                  When off, paper balance, accounts, and Paper engine mode are hidden.
                </span>
              </span>
            </Label>
            {paperModeError ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {paperModeError}
              </p>
            ) : null}

            <p className="mt-4 text-sm font-medium text-foreground">
              Live entry order type
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Applies to the next live entry while the engine is running.
            </p>
            <div
              className={cn(
                'mt-2 grid gap-2 sm:grid-cols-2',
                liveEntryOrderLoading && 'pointer-events-none opacity-60',
              )}
              role="radiogroup"
              aria-label="Live entry order type"
            >
              {LIVE_ENTRY_ORDER_OPTIONS.map((option) => {
                const selected = liveEntryOrderMode === option.value
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant="outline"
                    role="radio"
                    aria-checked={selected}
                    disabled={liveEntryOrderLoading}
                    onClick={() => void handleLiveEntryOrderModeChange(option.value)}
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
            {liveEntryOrderError ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {liveEntryOrderError}
              </p>
            ) : null}

            <Label
              className={cn(
                'mt-3 cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:border-muted-foreground/40',
                autoRedeemLoading && 'pointer-events-none opacity-60',
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={autoRedeemEnabled}
                disabled={autoRedeemLoading}
                onCheckedChange={(checked) =>
                  void handleAutoRedeemToggle(checked === true)
                }
              />
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Auto-redeem winning positions
                </span>
                <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                  When on, redeems resolved live winners on-chain (background poll
                  every 2 minutes and ~15s after each win). Turn off to redeem manually
                  in the Polymarket UI.
                </span>
              </span>
            </Label>
            {autoRedeemError ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {autoRedeemError}
              </p>
            ) : null}
          </section>

          <Alert variant="destructive" className="flex flex-col gap-3">
            <div className="space-y-1">
              <AlertTitle>Data</AlertTitle>
              <AlertDescription>
                {paperTradingEnabled
                  ? 'Erase trading history, demo paper accounts, positions, and related server data. Creates a single new default paper account and stops the engine.'
                  : 'Erase trading history, positions, and related server data. Stops the engine.'}
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
