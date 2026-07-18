export const DEFAULT_REPORT_TIME_ZONE = "UTC"
export const MAX_CUSTOM_REPORT_DAYS = 366

export type ReportPeriodType =
  | "today"
  | "yesterday"
  | "weekly"
  | "month"
  | "tax"
  | "year"
  | "transactions"
  | "custom"
  | "end_of_day"

type LocalDate = { year: number; month: number; day: number }

export function normalizeTimeZone(value: string | null | undefined): string {
  const candidate = String(value || "").trim()
  if (!candidate) return DEFAULT_REPORT_TIME_ZONE
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date(0))
    return candidate
  } catch {
    return DEFAULT_REPORT_TIME_ZONE
  }
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0)
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  }
}

function offsetAt(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone)
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  ) - Math.floor(date.getTime() / 1000) * 1000
}

/** Convert a merchant-local wall-clock value to its UTC instant. */
export function localDateTimeToUtc(
  local: LocalDate & { hour?: number; minute?: number; second?: number; millisecond?: number },
  timeZone: string
): Date {
  const normalizedZone = normalizeTimeZone(timeZone)
  const wallClockUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour || 0,
    local.minute || 0,
    local.second || 0,
    local.millisecond || 0
  )
  let candidate = new Date(wallClockUtc)
  // Two passes handle offsets on the other side of a DST boundary. Reporting
  // boundaries are midnight, so ambiguous repeated-hour behavior is avoided.
  for (let pass = 0; pass < 2; pass++) {
    candidate = new Date(wallClockUtc - offsetAt(candidate, normalizedZone))
  }
  return candidate
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  }
}

function parseDateOnly(value: string): LocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  const checked = new Date(Date.UTC(date.year, date.month - 1, date.day))
  if (
    checked.getUTCFullYear() !== date.year ||
    checked.getUTCMonth() + 1 !== date.month ||
    checked.getUTCDate() !== date.day
  ) return null
  return date
}

function utcDayOfWeek(local: LocalDate) {
  return new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()
}

export type ResolvedReportRange = {
  startDate: string
  endDate: string
  timeZone: string
  isInProgress: boolean
}

export function resolveMerchantReportRange(input: {
  type: ReportPeriodType
  timeZone?: string | null
  startDate?: string | null
  endDate?: string | null
  now?: Date
}): ResolvedReportRange {
  const timeZone = normalizeTimeZone(input.timeZone)
  const now = input.now && Number.isFinite(input.now.getTime()) ? input.now : new Date()

  if (Boolean(input.startDate) !== Boolean(input.endDate)) {
    throw new Error("Both report start and end dates are required")
  }

  if (input.type === "custom" && (!input.startDate || !input.endDate)) {
    throw new Error("Custom reports require a start and end date")
  }

  if (input.startDate && input.endDate) {
    const localStart = parseDateOnly(input.startDate)
    const localEnd = parseDateOnly(input.endDate)
    if (/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) && !localStart) {
      throw new Error("Invalid report start date")
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) && !localEnd) {
      throw new Error("Invalid report end date")
    }
    const start = localStart
      ? localDateTimeToUtc(localStart, timeZone)
      : new Date(input.startDate)
    const end = localEnd
      ? new Date(localDateTimeToUtc(addLocalDays(localEnd, 1), timeZone).getTime() - 1)
      : new Date(input.endDate)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
      throw new Error("Invalid report date range")
    }
    if (localStart && localEnd) {
      const inclusiveDays = Math.round(
        (Date.UTC(localEnd.year, localEnd.month - 1, localEnd.day) -
          Date.UTC(localStart.year, localStart.month - 1, localStart.day)) /
          86_400_000
      ) + 1
      if (inclusiveDays > MAX_CUSTOM_REPORT_DAYS) {
        throw new Error(`Report date ranges cannot exceed ${MAX_CUSTOM_REPORT_DAYS} days`)
      }
    }
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      timeZone,
      isInProgress: end.getTime() >= now.getTime(),
    }
  }

  const current = zonedParts(now, timeZone)
  const today: LocalDate = { year: current.year, month: current.month, day: current.day }
  let startLocal = today
  let end = now
  let isInProgress = true

  if (input.type === "yesterday") {
    startLocal = addLocalDays(today, -1)
    end = new Date(localDateTimeToUtc(today, timeZone).getTime() - 1)
    isInProgress = false
  } else if (input.type === "weekly") {
    // Monday through Sunday unless a future merchant locale preference is
    // introduced. Sunday (0) therefore steps back six days.
    const weekday = utcDayOfWeek(today)
    startLocal = addLocalDays(today, -(weekday === 0 ? 6 : weekday - 1))
  } else if (input.type === "year") {
    startLocal = { year: today.year, month: 1, day: 1 }
  } else if (input.type === "month" || input.type === "tax" || input.type === "transactions") {
    startLocal = { year: today.year, month: today.month, day: 1 }
  }

  return {
    startDate: localDateTimeToUtc(startLocal, timeZone).toISOString(),
    endDate: end.toISOString(),
    timeZone,
    isInProgress,
  }
}

export function formatInMerchantTimeZone(value: string, timeZone: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  const parts = zonedParts(date, normalizeTimeZone(timeZone))
  const pad = (number: number) => String(number).padStart(2, "0")
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
}
