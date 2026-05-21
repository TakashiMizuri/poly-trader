import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  getStoredToken,
  isApiAuthRequired,
  setStoredToken,
} from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type Phase = 'checking' | 'gate' | 'app'

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [draft, setDraft] = useState('')

  const resolveAccess = useCallback(async () => {
    const stored = getStoredToken().trim()
    if (stored) {
      const headers = { Authorization: `Bearer ${stored}` }
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL ?? ''}/api/engine`,
          { headers },
        )
        if (res.ok) {
          setPhase('app')
          return
        }
        if (res.status === 401) {
          setStoredToken('')
        }
      } catch {
        setPhase('app')
        return
      }
    }

    const required = await isApiAuthRequired()
    setPhase(required ? 'gate' : 'app')
  }, [])

  useEffect(() => {
    void resolveAccess()
  }, [resolveAccess])

  if (phase === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Connecting…</p>
      </div>
    )
  }

  if (phase === 'gate') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md border border-border shadow-2xl">
          <CardHeader className="px-6 pt-6 pb-2">
            <CardTitle className="text-2xl font-semibold text-primary">
              Poly Trader
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <p className="text-sm text-muted-foreground">
              Enter your{' '}
              <code className="font-mono text-xs text-primary">WEB_API_TOKEN</code>{' '}
              from <code className="font-mono text-xs">.env</code>. Stored in this
              browser only.
            </p>
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                const t = draft.trim()
                if (!t) return
                setStoredToken(t)
                setPhase('app')
              }}
            >
              <Input
                type="password"
                placeholder="API token"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoComplete="off"
              />
              <Button type="submit" disabled={!draft.trim()} className="w-full">
                Connect
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <>{children}</>
}
