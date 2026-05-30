const API_BASE = import.meta.env.VITE_API_URL ?? ''
const TOKEN_KEY = 'poly-trader-api-token'

export function getStoredToken(): string {
  const baked = import.meta.env.VITE_API_TOKEN
  if (typeof baked === 'string' && baked.trim()) {
    return baked.trim()
  }
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setStoredToken(token: string) {
  const t = token.trim()
  if (t) {
    localStorage.setItem(TOKEN_KEY, t)
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
}

function getToken(): string | null {
  const t = getStoredToken()
  return t || null
}

/** True when the API rejects unauthenticated requests (WEB_API_TOKEN is set on the server). */
export async function isApiAuthRequired(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/engine`)
    return res.status === 401
  } catch {
    return false
  }
}

export async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { headers })
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition')
  const match = disposition?.match(/filename="?([^";]+)"?/)
  const filename = match?.[1] ?? fallbackFilename

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
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
  autoRedeemEnabled: boolean
  liveEntryOrderMode: 'Limit' | 'Market' | string
  updatedAt: string
}

export type LiveEntryOrderMode = 'Limit' | 'Market' | 'LimitElseMarket'

export function normalizeLiveEntryOrderMode(mode: string): LiveEntryOrderMode {
  const v = String(mode).trim().toLowerCase()
  if (v === 'market') return 'Market'
  if (v === 'limitelsemarket' || v === 'limit-market') return 'LimitElseMarket'
  return 'Limit'
}

export interface LimitEntryPreview {
  tradingMode: string
  liveEntryOrderMode: string
  balanceUsd: number | null
  referenceBid: number | null
  marketReferenceBid: number | null
  bidIsCustom: boolean
  bidUnavailableReason: string | null
  minOrderShares: number
  clobMinStakeUsd: number | null
  requestedStakeUsd: number
  effectiveStakeUsd: number
  canTrade: boolean
  willBump: boolean
  usesMarketFallback: boolean
  blockReason: string | null
  minBalanceOneTradeUsd: number | null
  minBalanceConfiguredUsd: number | null
  stakePercent: number | null
  stakeUsd: number | null
  maxBetStakeUsd: number | null
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
  clobConfigured?: boolean
  mode: string
  activePaperAccountId: number | null
  commissionPercent?: number
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

export interface LiveStatus {
  clobConfigured: boolean
  liveBalanceUsd: number | null
  canTrade: boolean
}

export type TradeStatisticsPeriod = 'all' | 'day' | 'week' | 'month' | '90d'

export interface TradeStatisticsSkipBreakdown {
  reason: string
  count: number
  category: 'Skipped' | 'Error' | string
  shareOfTotal: number
}

export interface TradeStatistics {
  period: string
  fromCandleTime: number | null
  toCandleTime: number
  mode: string
  paperAccountId: number
  totalEvents: number
  tradesOpened: number
  tradesSettled: number
  tradesOpen: number
  won: number
  lost: number
  winRate: number | null
  /** Mean |PnL|/stake on winning settled trades. */
  avgWinPayoutRatio: number | null
  totalPnlUsd: number
  skippedCount: number
  errorCount: number
  skipBreakdown: TradeStatisticsSkipBreakdown[]
}
