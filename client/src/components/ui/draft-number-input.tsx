import { useEffect, useState } from 'react'

import { NumberInput } from '@/components/ui/number-input'

type DraftNumberInputProps = Omit<
  React.ComponentProps<typeof NumberInput>,
  'value' | 'onChange' | 'defaultValue'
> & {
  value: number | null
  onCommit: (value: number | null) => void
  /** When true, empty input commits as `null`. Otherwise empty reverts. */
  allowEmpty?: boolean
  /** Parse integers instead of floats. */
  integer?: boolean
  formatCommitted?: (value: number) => string
}

function defaultFormat(value: number): string {
  return String(value)
}

function parseDraft(
  raw: string,
  integer: boolean,
): number | null | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = integer ? Number.parseInt(trimmed, 10) : Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

function DraftNumberInput({
  value,
  onCommit,
  allowEmpty = false,
  integer = false,
  formatCommitted = defaultFormat,
  onBlur,
  onKeyDown,
  ...props
}: DraftNumberInputProps) {
  const formatDisplay = (v: number | null) =>
    v == null ? '' : formatCommitted(v)

  const [draft, setDraft] = useState(() => formatDisplay(value))

  useEffect(() => {
    setDraft(formatDisplay(value))
  }, [value])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (allowEmpty) {
        setDraft('')
        if (value !== null) onCommit(null)
        return
      }
      setDraft(formatDisplay(value))
      return
    }

    const parsed = parseDraft(draft, integer)
    if (parsed === undefined) {
      setDraft(formatDisplay(value))
      return
    }

    setDraft(formatDisplay(parsed))
    if (parsed !== value) onCommit(parsed)
  }

  return (
    <NumberInput
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit()
        onBlur?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          ;(e.target as HTMLInputElement).blur()
        }
        onKeyDown?.(e)
      }}
      {...props}
    />
  )
}

export { DraftNumberInput }
