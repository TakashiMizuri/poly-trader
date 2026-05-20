import { useCallback, useEffect, useState } from 'react'
import type { EngineSettings, PaperAccount } from '@/api/client'
import { api } from '@/api/client'

interface Props {
  settings: EngineSettings | null
  onUpdated: () => void
}

export function EngineControls({ settings, onUpdated }: Props) {
  const [busy, setBusy] = useState(false)
  const [accounts, setAccounts] = useState<PaperAccount[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBalance, setNewBalance] = useState('100')

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await api<PaperAccount[]>('/api/paper-accounts'))
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts, settings?.activePaperAccountId])

  if (!settings) return null

  const isPaper = settings.tradingMode === 'Paper'

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

  async function resetAccount(id: number) {
    if (!confirm('Reset this paper account balance to its initial value?')) return
    setBusy(true)
    try {
      await api(`/api/paper-accounts/${id}/reset`, { method: 'POST' })
      onUpdated()
      await loadAccounts()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-[#1e2633] bg-[#12161e] p-4">
      <h2 className="mb-4 text-lg font-medium">Trading</h2>

      <div className="mb-4 flex rounded-lg border border-[#1e2633] p-0.5">
        {(['Paper', 'Live'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={busy}
            onClick={() => update({ tradingMode: mode })}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              settings.tradingMode === mode
                ? mode === 'Paper'
                  ? 'bg-[#3dd6c6]/20 text-[#3dd6c6]'
                  : 'bg-amber-500/20 text-amber-400'
                : 'text-[#9ca3af] hover:text-[#e8eaed]'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {isPaper && (
        <div className="mb-4 space-y-2">
          <label className="block text-sm text-[#9ca3af]">
            Paper account
            <select
              disabled={busy}
              value={settings.activePaperAccountId ?? ''}
              onChange={(e) =>
                update({ activePaperAccountId: Number(e.target.value) })
              }
              className="mt-1 w-full rounded-lg border border-[#1e2633] bg-[#0c0f14] px-3 py-2 text-[#e8eaed]"
            >
              {accounts.length === 0 && (
                <option value="">No accounts</option>
              )}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — ${a.balance.toFixed(2)}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowCreate((v) => !v)}
              className="rounded-lg border border-[#1e2633] px-3 py-1.5 text-xs text-[#e8eaed]"
            >
              {showCreate ? 'Cancel' : 'New account'}
            </button>
            {settings.activePaperAccountId != null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => resetAccount(settings.activePaperAccountId!)}
                className="rounded-lg border border-[#1e2633] px-3 py-1.5 text-xs text-[#9ca3af]"
              >
                Reset balance
              </button>
            )}
          </div>

          {showCreate && (
            <div className="space-y-2 rounded-lg border border-[#1e2633] bg-[#0c0f14] p-3">
              <input
                type="text"
                placeholder="Account name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-lg border border-[#1e2633] bg-[#12161e] px-3 py-2 text-sm text-[#e8eaed]"
              />
              <input
                type="number"
                min={1}
                step={1}
                placeholder="Initial balance"
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
                className="w-full rounded-lg border border-[#1e2633] bg-[#12161e] px-3 py-2 text-sm text-[#e8eaed]"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void createAccount()}
                className="w-full rounded-lg bg-[#3dd6c6]/20 py-2 text-sm font-medium text-[#3dd6c6]"
              >
                Create & select
              </button>
            </div>
          )}

          <p className="text-xs text-[#6b7280]">
            Paper mode uses live Polymarket prices; orders are simulated only.
          </p>
        </div>
      )}

      {settings.tradingMode === 'Live' && (
        <p className="mb-4 text-xs text-amber-400/90">
          Live mode places real orders on Polymarket when credentials are configured.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || (isPaper && !settings.activePaperAccountId)}
          onClick={() => update({ isRunning: !settings.isRunning })}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            settings.isRunning
              ? 'bg-red-500/20 text-red-400'
              : 'bg-[#3dd6c6]/20 text-[#3dd6c6]'
          }`}
        >
          {settings.isRunning ? 'Stop engine' : 'Start engine'}
        </button>
      </div>

      <label className="mt-4 block text-sm text-[#9ca3af]">
        Bet stake (USD)
        <input
          type="number"
          min={0.1}
          step={0.1}
          defaultValue={settings.betStakeUsd}
          onBlur={(e) => update({ betStakeUsd: Number(e.target.value) })}
          className="mt-1 w-full rounded-lg border border-[#1e2633] bg-[#0c0f14] px-3 py-2 text-[#e8eaed]"
        />
      </label>
    </div>
  )
}
