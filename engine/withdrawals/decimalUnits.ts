/**
 * Decimal-safe base-unit helpers for wallet/sweep asset amounts (ETH 18dp,
 * SOL 9dp/lamports, USDC 6dp, BTC 8dp). Same algorithm as
 * engine/wallet/walletMoney.ts and engine/withdrawals/walletWithdrawals.ts's
 * parseSolanaUnits, extended to cover the additional assets those modules
 * don't. Shared by withdrawalFeeEstimate.ts, walletSweepEvaluation.ts, and
 * walletSweepExecution.ts so decimal-string arithmetic (Max calculations,
 * threshold comparisons, queued-sweep amounts) never touches floating point.
 */

export const ASSET_DECIMALS: Record<string, number> = { ETH: 18, USDC: 6, SOL: 9, BTC: 8 }

export function toBaseUnits(decimal: string | number, asset: string): bigint {
  const raw = String(decimal ?? "0").trim()
  const normalized = raw.startsWith(".") ? `0${raw}` : raw || "0"
  if (!/^\d+(\.\d+)?$/.test(normalized)) return BigInt(0)
  const decimals = ASSET_DECIMALS[asset] ?? 0
  const [whole, fraction = ""] = normalized.split(".")
  if (fraction.length > decimals) {
    return BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0")
  }
  return BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt(fraction.padEnd(decimals, "0") || "0")
}

export function fromBaseUnits(baseUnits: bigint, asset: string): string {
  const decimals = ASSET_DECIMALS[asset] ?? 0
  if (decimals === 0) return baseUnits.toString()
  const divisor = BigInt(10) ** BigInt(decimals)
  const negative = baseUnits < BigInt(0)
  const abs = negative ? -baseUnits : baseUnits
  const whole = abs / divisor
  const fraction = (abs % divisor).toString().padStart(decimals, "0").replace(/0+$/, "")
  const value = fraction ? `${whole}.${fraction}` : whole.toString()
  return negative ? `-${value}` : value
}

export function clampNonNegative(value: bigint): bigint {
  return value < BigInt(0) ? BigInt(0) : value
}
