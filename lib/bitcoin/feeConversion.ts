/**
 * Single source of truth for converting PineTree's USD platform fee into
 * satoshis. Used by every Bitcoin/Lightning fee path (NWC post-payment
 * collection, Speed application-fee requests) so the rounding rule can never
 * drift between them.
 *
 * Rounding rule: always round UP to the next whole satoshi. A configured,
 * nonzero USD fee must never collapse to 0 sats - that produces exactly the
 * "fee record created, amount zero" defect this module exists to prevent.
 */

export const SATS_PER_BTC = 100_000_000

export function convertUsdFeeToSats(feeUsd: number, btcPriceUsd: number): number {
  if (!Number.isFinite(feeUsd) || feeUsd < 0) {
    throw new Error("Invalid USD fee amount")
  }
  if (!Number.isFinite(btcPriceUsd) || btcPriceUsd <= 0) {
    throw new Error("BTC price unavailable - cannot convert fee to sats")
  }
  if (feeUsd === 0) return 0

  const sats = Math.ceil((feeUsd / btcPriceUsd) * SATS_PER_BTC)
  // Deterministic floor: never let a nonzero fee round down to zero sats.
  return Math.max(sats, 1)
}
