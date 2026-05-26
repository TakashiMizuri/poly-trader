import type { Time } from 'lightweight-charts'
import type { TimeFormat } from '@/lib/timeFormat'

/** Fixed locale so UI dates stay English regardless of browser language. */
export const DISPLAY_LOCALE = 'en-US' as const

export function resolveDisplayTimeZone(useLocalTime: boolean): string | undefined {
  return useLocalTime ? undefined : 'UTC'
}

function withDisplayTimeZone(
  options: Intl.DateTimeFormatOptions,
  useLocalTime: boolean,
): Intl.DateTimeFormatOptions {
  const timeZone = resolveDisplayTimeZone(useLocalTime)
  return timeZone ? { ...options, timeZone } : options
}

export function displayDateTimeOptions(
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): Intl.DateTimeFormatOptions {
  return withDisplayTimeZone(
    {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: timeFormat === '12h',
    },
    useLocalTime,
  )
}

export function displayTimeOptions(
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): Intl.DateTimeFormatOptions {
  return withDisplayTimeZone(
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: timeFormat === '12h',
    },
    useLocalTime,
  )
}

export function displayLogTimeOptions(
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): Intl.DateTimeFormatOptions {
  return withDisplayTimeZone(
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: timeFormat === '12h',
    },
    useLocalTime,
  )
}

export function formatDisplayDateTime(
  tsMs: number,
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): string {
  return new Date(tsMs).toLocaleString(
    DISPLAY_LOCALE,
    displayDateTimeOptions(timeFormat, useLocalTime),
  )
}

export function formatDisplayDate(date: Date, useLocalTime: boolean): string {
  return date.toLocaleDateString(
    DISPLAY_LOCALE,
    withDisplayTimeZone(
      {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      },
      useLocalTime,
    ),
  )
}

export function formatDisplayTime(
  date: Date,
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): string {
  return date.toLocaleTimeString(
    DISPLAY_LOCALE,
    displayTimeOptions(timeFormat, useLocalTime),
  )
}

export function formatDisplayLogTime(
  iso: string,
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString(
    DISPLAY_LOCALE,
    displayLogTimeOptions(timeFormat, useLocalTime),
  )
}

const marketSlotTimeOptions = (
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): Intl.DateTimeFormatOptions =>
  withDisplayTimeZone(
    {
      hour: '2-digit',
      minute: '2-digit',
      hour12: timeFormat === '12h',
    },
    useLocalTime,
  )

/** Compact date+time range for Polymarket window titles, e.g. `May 20, 12:35 PM–12:40 PM`. */
export function formatDisplayMarketWindowSlot(
  startMs: number,
  endMs: number,
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): string {
  const start = new Date(startMs)
  const end = new Date(endMs)
  const dateOpts = withDisplayTimeZone(
    { month: 'short', day: 'numeric' },
    useLocalTime,
  )
  const datePart = start.toLocaleDateString(DISPLAY_LOCALE, dateOpts)
  const endDatePart = end.toLocaleDateString(DISPLAY_LOCALE, dateOpts)
  const timeOpts = marketSlotTimeOptions(timeFormat, useLocalTime)
  const startTime = start.toLocaleTimeString(DISPLAY_LOCALE, timeOpts)
  const endTime = end.toLocaleTimeString(DISPLAY_LOCALE, timeOpts)
  if (datePart === endDatePart) {
    return `${datePart}, ${startTime}–${endTime}`
  }
  return `${datePart}, ${startTime} – ${endDatePart}, ${endTime}`
}

/**
 * lightweight-charts treats bar times as UTC. When showing local labels, map UTC
 * components to a Date the formatter can render in the browser timezone.
 */
export function chartHorzTimeToDisplayDate(tsSec: number, useLocalTime: boolean): Date {
  const utc = new Date(tsSec * 1000)
  if (!useLocalTime) return utc
  return new Date(
    utc.getUTCFullYear(),
    utc.getUTCMonth(),
    utc.getUTCDate(),
    utc.getUTCHours(),
    utc.getUTCMinutes(),
    utc.getUTCSeconds(),
    utc.getUTCMilliseconds(),
  )
}

function horzTimeToUnixSeconds(time: Time): number | null {
  if (typeof time === 'number' && Number.isFinite(time)) return time
  if (typeof time === 'object' && time != null && 'year' in time) {
    const { year, month, day } = time
    return Date.UTC(year, month - 1, day) / 1000
  }
  return null
}

export function formatChartHorzTimeLabel(
  time: Time,
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): string {
  const tsSec = horzTimeToUnixSeconds(time)
  if (tsSec == null) return ''
  const date = chartHorzTimeToDisplayDate(tsSec, useLocalTime)
  return date.toLocaleString(
    DISPLAY_LOCALE,
    displayDateTimeOptions(timeFormat, useLocalTime),
  )
}

export function formatChartHorzTickLabel(
  time: Time,
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): string {
  const tsSec = horzTimeToUnixSeconds(time)
  if (tsSec == null) return ''
  const date = chartHorzTimeToDisplayDate(tsSec, useLocalTime)
  return date.toLocaleTimeString(
    DISPLAY_LOCALE,
    displayTimeOptions(timeFormat, useLocalTime),
  )
}

export function buildChartTimeLocalization(
  timeFormat: TimeFormat,
  useLocalTime: boolean,
): {
  localization: {
    locale: string
    timeFormatter?: (time: Time) => string
  }
  timeScale: {
    tickMarkFormatter?: (time: Time) => string
  }
} {
  if (!useLocalTime) {
    return {
      localization: { locale: DISPLAY_LOCALE, timeFormatter: undefined },
      timeScale: { tickMarkFormatter: undefined },
    }
  }
  return {
    localization: {
      locale: DISPLAY_LOCALE,
      timeFormatter: (time: Time) => formatChartHorzTimeLabel(time, timeFormat, true),
    },
    timeScale: {
      tickMarkFormatter: (time: Time) => formatChartHorzTickLabel(time, timeFormat, true),
    },
  }
}
