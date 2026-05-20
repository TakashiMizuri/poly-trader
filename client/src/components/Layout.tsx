import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { HeaderConnectivity } from '@/components/HeaderConnectivity'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Button } from '@/components/ui/button'
import { formatDisplayDate, formatDisplayTime } from '@/lib/displayLocale'
import { useTimeFormat } from '@/context/TimeFormatContext'

export function Layout() {
  const { timeFormat } = useTimeFormat()
  const [now, setNow] = useState(() => new Date())
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="flex items-stretch justify-between gap-3 px-3 py-2 sm:px-4 md:px-5">
          <div className="min-w-0 shrink-0">
            <h1 className="logo-glow-primary truncate text-lg font-semibold text-primary sm:text-xl">
              Poly Trader
            </h1>
            <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
              BTC 5m {'\u00b7'} Polymarket
            </p>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 items-stretch justify-end gap-2 sm:gap-3">
            <HeaderConnectivity />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              className="shrink-0 self-center"
              aria-label="Settings"
              title="Settings"
            >
              <Settings className="size-[18px]" aria-hidden />
            </Button>
            <div className="hidden shrink-0 self-center text-right text-xs tabular-nums text-muted-foreground lg:block">
              <div>{formatDisplayDate(now)}</div>
              <div>{formatDisplayTime(now, timeFormat)}</div>
            </div>
          </div>
        </div>
      </header>
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
