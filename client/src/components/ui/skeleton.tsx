import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

function Skeleton({
  className,
  shimmer = true,
  ...props
}: ComponentProps<'div'> & { shimmer?: boolean }) {
  return (
    <div
      data-slot="skeleton"
      className={cn('relative overflow-hidden rounded-md bg-muted', className)}
      aria-hidden
      {...props}
    >
      {shimmer ? <div className="absolute inset-0 animate-shimmer opacity-60" /> : null}
    </div>
  )
}

export { Skeleton }
