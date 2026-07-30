/**
 * Shift4 date/time formatting.
 *
 * Shift4 requires `dateTime` on the access-token exchange and on every
 * transaction request, in ISO 8601 WITH the timezone offset
 * (`yyyy-mm-ddThh:mm:ss.nnn+hh:mm`), expressed as the MERCHANT'S LOCAL time.
 *
 * `Date.prototype.toISOString()` is not usable: it always emits `Z`, which is a
 * UTC instant rather than merchant-local time with an offset. The offset is
 * therefore composed explicitly here.
 *
 * This lives in its own module because both the credentials and transactions
 * paths need it; importing it from either one would couple them for no reason.
 */

export function formatShift4DateTime(date: Date, timeZone?: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || undefined,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value
  }

  // Some runtimes report hour "24" for midnight under hour12:false.
  const hour = parts.hour === "24" ? "00" : parts.hour
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0")

  // Derive the zone's offset by comparing the wall-clock reading to the instant.
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
    date.getMilliseconds()
  )
  const offsetMinutes = Math.round((asUtc - date.getTime()) / 60_000)
  const sign = offsetMinutes < 0 ? "-" : "+"
  const absolute = Math.abs(offsetMinutes)
  const offsetHours = String(Math.floor(absolute / 60)).padStart(2, "0")
  const offsetRemainder = String(absolute % 60).padStart(2, "0")

  return (
    `${parts.year}-${parts.month}-${parts.day}` +
    `T${hour}:${parts.minute}:${parts.second}.${milliseconds}` +
    `${sign}${offsetHours}:${offsetRemainder}`
  )
}
