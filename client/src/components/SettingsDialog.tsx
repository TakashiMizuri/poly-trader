import { useEffect, useState } from 'react'
import type { EngineSettings } from '@/api/client'
import { api } from '@/api/client'
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
import type { TimeFormat } from '@/lib/timeFormat'
import { clearClientTradingState, notifyGlobalReset } from '@/lib/appReset'
import type { Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div>
      <p className="text-xs font-medium text-foreground">{label}</p>
      <div
        className="mt-1.5 flex rounded-md border border-border bg-background p-0.5"
        role="radiogroup"
        aria-label={label}
      >
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            size="xs"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 px-2 text-xs',
              value === option.value
                ? 'bg-primary/15 text-primary hover:bg-primary/20'
                : 'text-muted-foreground',
            )}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
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

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setAutoRedeemLoading(true)
    setAutoRedeemError(null)
    void api<EngineSettings>('/api/engine')
      .then((settings) => {
        if (!cancelled) setAutoRedeemEnabled(settings.autoRedeemEnabled)
      })
      .catch((e) => {
        if (!cancelled) {
          setAutoRedeemError(
            e instanceof Error ? e.message : 'Could not load engine settings',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setAutoRedeemLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

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
        e instanceof Error ? e.message : 'Could not update auto-redeem',
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
          e instanceof Error ? e.message : 'Could not switch to Live mode',
        )
      }
      return
    }
    setPaperTradingEnabled(true)
  }

  async function handleGlobalReset() {
    const confirmed = confirm(
      'Reset all application data? Trades, positions, snapshots, and logs are erased; the engine stops. Chart overlays are kept.',
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
      <DialogContent className="max-w-sm gap-0 p-0" showClose={false}>
        <DialogHeader>
          <div className="min-w-0 pr-10">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>App preferences.</DialogDescription>
          </div>
          <DialogClose>Close</DialogClose>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Segmented<Theme>
              label="Theme"
              value={theme}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
              onChange={setTheme}
            />
            <Segmented<TimeFormat>
              label="Clock"
              value={timeFormat}
              options={[
                { value: '24h', label: '24h' },
                { value: '12h', label: '12h' },
              ]}
              onChange={setTimeFormat}
            />
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-foreground">Trading</p>
            <Label className="cursor-pointer items-center gap-2.5 py-1">
              <Checkbox
                checked={paperTradingEnabled}
                onCheckedChange={(checked) =>
                  void handlePaperTradingToggle(checked === true)
                }
              />
              <span className="text-sm">Paper trading UI</span>
            </Label>
            {paperModeError ? (
              <p className="text-xs text-destructive" role="alert">
                {paperModeError}
              </p>
            ) : null}

            <Label
              className={cn(
                'cursor-pointer items-center gap-2.5 py-1',
                autoRedeemLoading && 'pointer-events-none opacity-60',
              )}
            >
              <Checkbox
                checked={autoRedeemEnabled}
                disabled={autoRedeemLoading}
                onCheckedChange={(checked) =>
                  void handleAutoRedeemToggle(checked === true)
                }
              />
              <span className="text-sm">Auto-redeem winners</span>
            </Label>
            {autoRedeemError ? (
              <p className="text-xs text-destructive" role="alert">
                {autoRedeemError}
              </p>
            ) : null}
          </div>

          <Alert variant="destructive" className="gap-2 py-3">
            <AlertTitle className="text-sm">Reset data</AlertTitle>
            <AlertDescription className="text-xs">
              Deletes history and stops the engine.
            </AlertDescription>
            {resetError ? (
              <p className="text-xs text-destructive" role="alert">
                {resetError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={resetBusy}
              onClick={() => void handleGlobalReset()}
              className="h-8 w-full"
            >
              {resetBusy ? 'Resetting…' : 'Reset all data'}
            </Button>
          </Alert>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
