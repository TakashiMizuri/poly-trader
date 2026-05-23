export type LiveLogEntry = {
  timestamp: string
  level: string
  message: string
  sourceContext?: string | null
  exception?: string | null
}
