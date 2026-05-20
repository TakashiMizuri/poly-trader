import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import type { BalanceResponse, EngineSettings, PaperAccount } from '@/api/client'
import { api } from '@/api/client'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  settings: EngineSettings
  balance: BalanceResponse | null
  onUpdated: () => void
}

function formatUsd(amount: number) {
  return `$${amount.toFixed(2)}`
}

export function PaperTradingSettingsDialog({
  open,
  onClose,
  settings,
  balance,
  onUpdated,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [accounts, setAccounts] = useState<PaperAccount[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBalance, setNewBalance] = useState('100')
  const [resetBalance, setResetBalance] = useState('')

  const activeId = settings.activePaperAccountId
  const activeAccount = accounts.find((a) => a.id === activeId)

  const currentBalance =
    balance?.paperBalance ??
    activeAccount?.balance ??
    settings.activePaperBalance ??
    null

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await api<PaperAccount[]>('/api/paper-accounts'))
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadAccounts()
    setShowCreate(false)
  }, [open, loadAccounts, activeId])

  useEffect(() => {
    if (!open) return
    if (accounts.length === 0) {
      setShowCreate(true)
    }
  }, [open, accounts.length])

  useEffect(() => {
    if (!open || activeAccount == null) return
    setResetBalance(String(activeAccount.initialBalance))
  }, [open, activeAccount?.id, activeAccount?.initialBalance])

  async function update(patch: Record<string, unknown>) {
    setBusy(true)
    try {
      await api<EngineSettings>('/api/engine', {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      onUpdated()
    } finally {
      setBusy(false)
    }
  }

  async function createAccount() {
    setBusy(true)
    try {
      const created = await api<PaperAccount>('/api/paper-accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim() || 'Paper account',
          initialBalance: Number(newBalance) || 100,
        }),
      })
      await update({
        tradingMode: 'Paper',
        activePaperAccountId: created.id,
      })
      setShowCreate(false)
      setNewName('')
      setNewBalance('100')
      await loadAccounts()
    } finally {
      setBusy(false)
    }
  }

  async function resetAccount() {
    if (activeId == null) return
    const amount = Number(resetBalance)
    if (!Number.isFinite(amount) || amount <= 0) return

    const label =
      balance?.paperAccountName ??
      settings.activePaperAccountName ??
      'this account'
    const confirmed = confirm(
      `Reset "${label}" to $${amount.toFixed(2)}?\n\n` +
        'Current balance will be set to this amount and it will become the new starting balance.',
    )
    if (!confirmed) return

    setBusy(true)
    try {
      await api(`/api/paper-accounts/${activeId}/reset`, {
        method: 'POST',
        body: JSON.stringify({ initialBalance: amount }),
      })
      onUpdated()
      await loadAccounts()
    } finally {
      setBusy(false)
    }
  }

  const hasAccount = activeId != null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-md gap-0 p-0" showClose={false}>
        <DialogHeader>
          <div className="min-w-0 pr-10">
            <DialogTitle>Paper trading</DialogTitle>
            <DialogDescription>
              Simulated orders at live Polymarket prices.
            </DialogDescription>
          </div>
          <DialogClose>Close</DialogClose>
        </DialogHeader>

        <DialogBody className="space-y-6">
          {hasAccount ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Balance
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {currentBalance != null ? formatUsd(currentBalance) : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Starting
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {activeAccount != null
                    ? formatUsd(activeAccount.initialBalance)
                    : '—'}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-background px-4 py-3 text-center text-sm text-muted-foreground">
              No paper account selected. Create one below to start simulating
              trades.
            </div>
          )}

          <section>
            <h3 className="text-sm font-medium text-foreground">Account</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Switch between demo accounts or add a new one.
            </p>

            <div className="mt-3 flex gap-2">
              <Select
                value={activeId != null ? String(activeId) : null}
                onValueChange={(v) =>
                  update({ activePaperAccountId: Number(v) })
                }
                disabled={busy || accounts.length === 0}
              >
                <SelectTrigger
                  id="paper-account-select"
                  className="min-w-0 flex-1"
                >
                  <SelectValue placeholder="No accounts" />
                </SelectTrigger>
                <SelectContent align="start">
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name} — {formatUsd(a.balance)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setShowCreate((v) => !v)}
                className="shrink-0 gap-1.5"
                aria-expanded={showCreate}
              >
                <Plus className="size-3.5" aria-hidden />
                {showCreate ? 'Cancel' : 'New'}
              </Button>
            </div>

            {showCreate ? (
              <div className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="paper-new-name">Name</Label>
                    <Input
                      id="paper-new-name"
                      type="text"
                      placeholder="Paper account"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="paper-new-balance">Starting balance</Label>
                    <NumberInput
                      id="paper-new-balance"
                      min={1}
                      step={1}
                      prefix="$"
                      value={newBalance}
                      onChange={(e) => setNewBalance(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="success"
                  size="sm"
                  disabled={busy}
                  onClick={() => void createAccount()}
                  className="w-full"
                >
                  Create & select
                </Button>
              </div>
            ) : null}
          </section>

          <section
            className={cn(!hasAccount && 'pointer-events-none opacity-50')}
          >
            <h3 className="text-sm font-medium text-foreground">
              Reset balance
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Set the balance to a new amount. That value becomes the starting
              balance for future resets.
            </p>

            <div className="mt-3 space-y-2">
              <div className="space-y-1.5">
                <Label htmlFor="paper-reset-balance">New starting balance</Label>
                <NumberInput
                  id="paper-reset-balance"
                  min={1}
                  step={1}
                  prefix="$"
                  value={resetBalance}
                  onChange={(e) => setResetBalance(e.target.value)}
                  disabled={busy || !hasAccount}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !hasAccount}
                onClick={() => void resetAccount()}
                className="w-full"
              >
                Reset to amount
              </Button>
            </div>
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
