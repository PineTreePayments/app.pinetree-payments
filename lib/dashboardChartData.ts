export type OverviewChartRange = "7D" | "30D" | "90D" | "ALL"

export type OverviewChartInputPoint = {
  date: string
  volume: number
}

export type NormalizedOverviewChartPoint = {
  date: string
  label: string
  volume: number
}

export type NormalizedOverviewChartData = {
  points: NormalizedOverviewChartPoint[]
  maxValue: number
  activeDayCount: number
  isEmpty: boolean
}

const DAYS_BY_RANGE: Record<Exclude<OverviewChartRange, "ALL">, number> = {
  "7D": 7,
  "30D": 30,
  "90D": 90
}

function parseDate(value: string) {
  const trimmed = String(value || "").trim()
  if (!trimmed) return null

  const date = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00Z`)
    : new Date(trimmed)

  if (Number.isNaN(date.getTime())) return null
  return date
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function labelForDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(date)
}

function rangeBounds(
  datedPoints: Array<{ date: Date; volume: number }>,
  range: OverviewChartRange,
  now: Date
) {
  if (range !== "ALL") {
    const end = startOfUtcDay(now)
    const start = addDays(end, -(DAYS_BY_RANGE[range] - 1))
    return { start, end }
  }

  if (!datedPoints.length) {
    const end = startOfUtcDay(now)
    return { start: addDays(end, -6), end }
  }

  const sorted = datedPoints
    .map((point) => startOfUtcDay(point.date).getTime())
    .sort((a, b) => a - b)

  return {
    start: new Date(sorted[0]),
    end: new Date(sorted[sorted.length - 1])
  }
}

export function normalizeOverviewChartData(
  input: OverviewChartInputPoint[],
  range: OverviewChartRange,
  now = new Date()
): NormalizedOverviewChartData {
  const datedPoints = input
    .map((point) => {
      const date = parseDate(point.date)
      if (!date) return null
      return {
        date,
        volume: Number.isFinite(Number(point.volume)) ? Number(point.volume) : 0
      }
    })
    .filter((point): point is { date: Date; volume: number } => Boolean(point))

  const { start, end } = rangeBounds(datedPoints, range, now)
  const volumeByDay = new Map<string, number>()

  for (const point of datedPoints) {
    const date = startOfUtcDay(point.date)
    if (date < start || date > end) continue
    const key = toDateKey(date)
    volumeByDay.set(key, (volumeByDay.get(key) || 0) + point.volume)
  }

  const points: NormalizedOverviewChartPoint[] = []
  for (let cursor = startOfUtcDay(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const key = toDateKey(cursor)
    points.push({
      date: key,
      label: labelForDate(cursor),
      volume: volumeByDay.get(key) || 0
    })
  }

  const maxVolume = Math.max(0, ...points.map((point) => point.volume))
  const maxValue = maxVolume > 0 ? Math.ceil(maxVolume * 1.2 * 100) / 100 : 1
  const activeDayCount = points.filter((point) => point.volume > 0).length

  return {
    points,
    maxValue,
    activeDayCount,
    isEmpty: activeDayCount === 0
  }
}
