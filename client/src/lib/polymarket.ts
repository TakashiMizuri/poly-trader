const POLYMARKET_WEB_BASE = 'https://polymarket.com'

export function polymarketMarketUrl(slug: string | null | undefined): string | null {
  const trimmed = slug?.trim()
  if (!trimmed) return null
  return `${POLYMARKET_WEB_BASE}/market/${encodeURIComponent(trimmed)}`
}
