import type { TimeFormat } from '@/lib/timeFormat'

/** Fixed locale so UI dates stay English regardless of browser language. */
export const DISPLAY_LOCALE = 'en-US' as const

export function displayDateTimeOptions(timeFormat: TimeFormat): Intl.DateTimeFormatOptions {
  return {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: timeFormat === '12h',
  }
}

export function displayTimeOptions(timeFormat: TimeFormat): Intl.DateTimeFormatOptions {
  return {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: timeFormat === '12h',
  }
}

export function formatDisplayDateTime(tsMs: number, timeFormat: TimeFormat): string {
  return new Date(tsMs).toLocaleString(DISPLAY_LOCALE, displayDateTimeOptions(timeFormat))
}

export function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString(DISPLAY_LOCALE, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDisplayTime(date: Date, timeFormat: TimeFormat): string {
  return date.toLocaleTimeString(DISPLAY_LOCALE, displayTimeOptions(timeFormat))
}

const marketSlotTimeOptions = (timeFormat: TimeFormat): Intl.DateTimeFormatOptions => ({
  hour: '2-digit',
  minute: '2-digit',
  hour12: timeFormat === '12h',
})

/** Compact date+time range for Polymarket window titles, e.g. `May 20, 12:35 PM–12:40 PM`. */
export function formatDisplayMarketWindowSlot(
  startMs: number,
  endMs: number,
  timeFormat: TimeFormat,
): string {
  const start = new Date(startMs)
  const end = new Date(endMs)
  const datePart = start.toLocaleDateString(DISPLAY_LOCALE, {
    month: 'short',
    day: 'numeric',
  })
  const endDatePart = end.toLocaleDateString(DISPLAY_LOCALE, {
    month: 'short',
    day: 'numeric',
  })
  const startTime = start.toLocaleTimeString(DISPLAY_LOCALE, marketSlotTimeOptions(timeFormat))
  const endTime = end.toLocaleTimeString(DISPLAY_LOCALE, marketSlotTimeOptions(timeFormat))
  if (datePart === endDatePart) {
    return `${datePart}, ${startTime}–${endTime}`
  }
  return `${datePart}, ${startTime} – ${endDatePart}, ${endTime}`
}
