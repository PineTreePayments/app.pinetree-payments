import { Shift4RestApiError } from "./errors"

const SHIFT4_MINOR_UNIT_CURRENCIES = new Set(["USD", "CAD"])

type Shift4AmountSerializationOptions = {
  /** Shift4 requires an explicit zero tax component even when no tax applies. */
  allowZero?: boolean
}

/** Serialize authoritative integer minor units to Shift4's major-unit amount. */
export function minorUnitsToShift4Amount(
  amountMinor: number,
  currency: string,
  options: Shift4AmountSerializationOptions = {}
): number {
  const normalizedCurrency = String(currency).trim().toUpperCase()
  if (!SHIFT4_MINOR_UNIT_CURRENCIES.has(normalizedCurrency)) {
    throw new Shift4RestApiError(
      `Shift4 amount serialization supports USD and CAD, not ${normalizedCurrency || "an empty currency"}.`,
      { diagnostics: {} }
    )
  }
  const minimum = options.allowZero ? 0 : 1
  if (!Number.isSafeInteger(amountMinor) || amountMinor < minimum) {
    throw new Shift4RestApiError(
      options.allowZero
        ? "A Shift4 amount component must be a non-negative safe integer in minor units."
        : "A Shift4 transaction amount must be a positive safe integer in minor units.",
      { diagnostics: {} }
    )
  }

  const whole = Math.floor(amountMinor / 100)
  const fraction = String(amountMinor % 100).padStart(2, "0")
  return Number(`${whole}.${fraction}`)
}
