import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { SettingsDialog } from '@/components/SettingsDialog'

export function Layout() {
  const [now, setNow] = useState(() => new Date())
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-card">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h1 className="logo-glow-primary text-xl font-semibold text-primary sm:text-2xl">
              Poly Trader
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              BTC 5m {'\u00b7'} Polymarket
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
            >
              Settings
            </button>
            <div className="text-right text-sm tabular-nums text-muted-foreground">
              <div>{now.toLocaleDateString()}</div>
              <div>{now.toLocaleTimeString()}</div>
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
