/**
 * Bridge (by Stripe) - decimal amounts at the provider boundary.
 *
 * Bridge expresses amounts as DECIMAL STRINGS. PineTree therefore never sends
 * a JavaScript number to Bridge and never treats a float as authoritative
 * financial data: `0.1 + 0.2` is not `0.3`, and a stablecoin settlement
 * instruction cannot be allowed to inherit that error.
 *
 * These helpers are the only sanctioned way to produce or read a Bridge
 * amount. They are in place ahead of Bridge payment creation so that the rule
 * is enforced at the boundary from the first payment call rather than
 * retrofitted.
 */

/** A canonical decimal amount string, e.g. "10.00" or "0.123456". */
export type BridgeDecimalAmount = string

const DECIMAL_PATTERN = /^\d{1,18}(\.\d{1,18})?$/

/**
 * Validate a decimal amount string as received from, or destined for, Bridge.
 *
 * Rejects exponent notation, signs, whitespace, and anything a float could
 * have introduced.
 */
export function assertBridgeDecimalAmount(value: string, label = "amount"): BridgeDecimalAmount {
  const normalized = String(value ?? "").trim()
  if (!DECIMAL_PATTERN.test(normalized)) {
    throw new Error(`Bridge ${label} must be a plain decimal string, e.g. "10.00".`)
  }
  return normalized
}

/**
 * Convert an integer minor-unit amount into a Bridge decimal string.
 *
 * Uses integer arithmetic and string assembly only - the value never passes
 * through a floating-point division.
 */
export function bridgeDecimalFromMinorUnits(minorUnits: number, decimals = 2): BridgeDecimalAmount {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new Error("Bridge amounts must be derived from a non-negative safe integer minor-unit value.")
  }
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("Bridge decimal precision must be an integer between 0 and 18.")
  }
  if (decimals === 0) return String(minorUnits)

  const digits = String(minorUnits).padStart(decimals + 1, "0")
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = digits.slice(digits.length - decimals)
  return `${whole}.${fraction}`
}

/**
 * Convert a Bridge decimal string back into integer minor units.
 *
 * Parsing is string-based for the same reason: a `Number()` round trip would
 * make the float the authority.
 */
export function bridgeMinorUnitsFromDecimal(value: string, decimals = 2): number {
  const normalized = assertBridgeDecimalAmount(value)
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("Bridge decimal precision must be an integer between 0 and 18.")
  }

  const [whole, fraction = ""] = normalized.split(".")
  if (fraction.length > decimals) {
    throw new Error(`Bridge amount has more precision than the ${decimals}-decimal asset allows.`)
  }

  const scaled = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "")
  const minorUnits = Number(scaled)
  if (!Number.isSafeInteger(minorUnits)) {
    throw new Error("Bridge amount exceeds the safe integer range for minor units.")
  }
  return minorUnits
}
