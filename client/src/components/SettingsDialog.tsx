import { useEffect, useRef } from 'react'
import { useTheme } from '@/context/ThemeContext'
import type { Theme } from '@/lib/theme'

const THEME_OPTIONS: { value: Theme; label: string; description: string }[] = [
  { value: 'dark', label: 'Dark', description: 'Default trading terminal look' },
  { value: 'light', label: 'Light', description: 'Bright background for daytime use' },
]

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[min(100%,28rem)] max-h-[85vh] overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50 open:flex open:flex-col animate-in fade-in zoom-in-95 duration-200"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold">Settings</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Application preferences. More options will appear here later.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          aria-label="Close settings"
        >
          Close
        </button>
      </div>

      <div className="overflow-y-auto px-5 py-4">
        <section>
          <h3 className="text-sm font-medium text-foreground">Appearance</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Choose the interface color theme.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map((option) => {
              const selected = theme === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTheme(option.value)}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                    selected
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                      : 'border-border bg-background hover:border-muted-foreground/40'
                  }`}
                >
                  <span className="block font-medium text-foreground">{option.label}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </dialog>
  )
}

