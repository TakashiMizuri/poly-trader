import type { ReactNode } from 'react'

import { Badge, type badgeVariants } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { VariantProps } from 'class-variance-authority'

export function Panel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <Card className={cn(className)}>{children}</Card>
}

export { Skeleton }

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string
  value: ReactNode
  hint?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card px-4 py-3',
        className,
      )}
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-primary">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function AccountMetricsBar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <Panel
      className={cn(
        'flex min-h-0 min-w-0 max-w-full flex-wrap items-stretch divide-y divide-border sm:flex-nowrap sm:divide-x sm:divide-y-0',
        className,
      )}
    >
      {children}
    </Panel>
  )
}

export function AccountMetric({
  label,
  value,
  hint,
  badge,
  className,
}: {
  label: string
  value: ReactNode
  hint?: string
  badge?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col justify-center px-4 py-3 sm:min-w-[7.5rem]',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {badge}
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums text-primary sm:text-xl">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function PageCard({
  title,
  children,
  action,
  className,
  contentClassName,
  fill,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
  className?: string
  contentClassName?: string
  fill?: boolean
}) {
  return (
    <Card
      className={cn(
        'max-w-full min-w-0 overflow-hidden',
        fill && 'flex h-full min-h-0 flex-col',
        className,
      )}
    >
      <CardHeader className="h-11 shrink-0 flex-row items-center justify-between space-y-0 border-b px-4 py-0">
        <CardTitle className="min-w-0 truncate text-sm">{title}</CardTitle>
        {action ? <CardAction className="flex items-center">{action}</CardAction> : null}
      </CardHeader>
      <CardContent
        className={cn(
          'px-3 py-2',
          fill && 'flex min-h-0 flex-1 flex-col overflow-hidden',
          contentClassName,
        )}
      >
        {children}
      </CardContent>
    </Card>
  )
}

export type StatusBadgeTone = NonNullable<
  VariantProps<typeof badgeVariants>['variant']
>

export function StatusBadge({
  children,
  tone = 'neutral',
  title,
  className,
}: {
  children: ReactNode
  tone?: StatusBadgeTone
  title?: string
  className?: string
}) {
  return (
    <Badge variant={tone} title={title} className={className}>
      {children}
    </Badge>
  )
}
