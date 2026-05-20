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

export interface EngineSettings {
  tradingMode: string
  isRunning: boolean
  betStakeUsd: number
  commissionPercent: number
  activePaperAccountId: number | null
  activePaperAccountName: string | null
  activePaperBalance: number | null
  updatedAt: string
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

export interface ConnectivityStatus {
  binance: string
  polymarketMarketWs: string
  polymarketClob: string
  engineConfigured: boolean
}
