const API_BASE = import.meta.env.VITE_API_URL ?? ''

function getToken(): string | null {
  return import.meta.env.VITE_API_TOKEN ?? localStorage.getItem('api_token')
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

export type BetStakeMode = 'percent' | 'fixed' | 'Percent' | 'Fixed'

export interface EngineSettings {
  tradingMode: string
  isRunning: boolean
  /** Draft stake (UI); applied to engine on start or while engine is stopped. */
  betStakeMode: BetStakeMode
  betStakeUsd: number
  betStakePercent: number
  maxBetStakeUsd: number | null
  /** Stake sizing used by the running engine until restart. */
  activeBetStakeMode: BetStakeMode
  activeBetStakeUsd: number
  activeBetStakePercent: number
  activeMaxBetStakeUsd: number | null
  hasPendingStakeChanges: boolean
  commissionPercent: number
  activePaperAccountId: number | null
  activePaperAccountName: string | null
  activePaperBalance: number | null
  updatedAt: string
}

export function normalizeBetStakeMode(mode: BetStakeMode): 'percent' | 'fixed' {
  return String(mode).toLowerCase() === 'fixed' ? 'fixed' : 'percent'
}

export interface PaperAccount {
  id: number
  name: string
  initialBalance: number
  balance: number
  isArchived: boolean
  createdAt: string
  updatedAt: string
  isActive: boolean
}

export interface MarketWindow {
  active: boolean
  title?: string
  slug?: string
  startAt?: string
  endAt?: string
  now?: string
  progressPercent?: number
}

export interface BalanceResponse {
  paperBalance: number | null
  paperAccountId: number | null
  paperAccountName: string | null
  liveBalance: number | null
  mode: string
  activePaperAccountId: number | null
}

export type CheckStatus = 'ok' | 'warn' | 'error' | 'idle'

export interface ConnectivityCheck {
  id: string
  label: string
  status: CheckStatus
  detail?: string
}

export interface ConnectivityResponse {
  checks: ConnectivityCheck[]
  checkedAt: string
}
