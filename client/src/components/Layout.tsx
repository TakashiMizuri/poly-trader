import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { HeaderConnectivity } from '@/components/HeaderConnectivity'
import { LiveLogsSidebar } from '@/components/LiveLogsSidebar'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Button } from '@/components/ui/button'
import { formatDisplayDate, formatDisplayTime } from '@/lib/displayLocale'
import { useTimeFormat } from '@/context/TimeFormatContext'

export function Layout() {
  const { timeFormat, useLocalTime } = useTimeFormat()
  const [now, setNow] = useState(() => new Date())
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex h-screen w-full max-w-full flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4 md:px-5">
          <div className="min-w-0 shrink">
            <h1 className="logo-glow-primary truncate text-lg font-semibold text-primary sm:text-xl">
              Poly Trader
            </h1>
            <p className="truncate text-[10px] text-muted-foreground sm:text-xs">
              BTC 5m {'\u00b7'} Polymarket
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <HeaderConnectivity />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              className="size-8 shrink-0"
              aria-label="Settings"
              title="Settings"
            >
              <Settings className="size-[18px]" aria-hidden />
            </Button>
            <div className="hidden shrink-0 text-right text-xs tabular-nums text-muted-foreground lg:block">
              <div>{formatDisplayDate(now, useLocalTime)}</div>
              <div>{formatDisplayTime(now, timeFormat, useLocalTime)}</div>
            </div>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:overflow-hidden lg:pb-0">
          <Outlet />
        </main>
        <LiveLogsSidebar />
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
