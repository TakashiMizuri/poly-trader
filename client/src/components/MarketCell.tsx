import { useEffect, useState } from 'react'
import { BTC_5M_MARKET_IMAGE_URL } from '@/constants/marketData'
import { cn } from '@/lib/utils'

export function MarketCell({
  title,
  imageUrl,
  subtitle,
  compact = false,
  className,
}: {
  title: string | null
  imageUrl?: string | null
  /** e.g. `BTC 5m · live` — shown under the market title when not compact. */
  subtitle?: string | null
  compact?: boolean
  className?: string
}) {
  const displayTitle = title?.trim() || 'Unknown market'
  const resolvedSrc = imageUrl?.trim() || BTC_5M_MARKET_IMAGE_URL
  const [src, setSrc] = useState(resolvedSrc)

  useEffect(() => {
    setSrc(resolvedSrc)
  }, [resolvedSrc])

  return (
    <div className={cn('flex min-w-0 items-center', compact ? 'gap-1.5' : 'gap-2', className)}>
      <img
        src={src}
        alt=""
        width={compact ? 24 : 32}
        height={compact ? 24 : 32}
        className={cn(
          'shrink-0 rounded-md bg-muted object-cover',
          compact ? 'h-6 w-6' : 'h-8 w-8',
        )}
        loading="lazy"
        decoding="async"
        onError={() => {
          if (src !== BTC_5M_MARKET_IMAGE_URL) {
            setSrc(BTC_5M_MARKET_IMAGE_URL)
          }
        }}
      />
      <div className="min-w-0">
        <p
          className={cn(
            'truncate font-medium text-foreground',
            compact ? 'text-xs leading-tight' : undefined,
          )}
          title={displayTitle}
        >
          {displayTitle}
        </p>
        {!compact && subtitle ? (
          <p
            className="truncate text-xs font-medium text-muted-foreground"
            title={subtitle}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  )
}
