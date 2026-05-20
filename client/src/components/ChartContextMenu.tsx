import { useEffect, useRef } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ChartContextMenuAnchor {
  x: number
  y: number
}

interface ChartContextMenuProps {
  anchor: ChartContextMenuAnchor
  containerRef: React.RefObject<HTMLElement | null>
  onChartSettings: () => void
  onClose: () => void
}

export function ChartContextMenu({
  anchor,
  containerRef,
  onChartSettings,
  onClose,
}: ChartContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      onClose()
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const bounds = containerRef.current?.getBoundingClientRect()
  const menuWidth = 200
  const menuHeight = 44
  let left = anchor.x
  let top = anchor.y
  if (bounds) {
    left = Math.min(Math.max(8, left), bounds.width - menuWidth - 8)
    top = Math.min(Math.max(8, top), bounds.height - menuHeight - 8)
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      className={cn(
        'absolute z-30 min-w-[12.5rem] overflow-hidden rounded-lg border border-border',
        'bg-popover p-1 text-popover-foreground shadow-lg',
        'animate-in fade-in zoom-in-95 duration-150',
      )}
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        role="menuitem"
        className="h-auto w-full justify-start gap-2 px-2 py-2.5 text-sm font-normal"
        onClick={() => {
          onChartSettings()
          onClose()
        }}
      >
        <Settings className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        Chart settings
      </Button>
    </div>
  )
}
