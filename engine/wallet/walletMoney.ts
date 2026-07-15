/**
 * Decimal-safe money helpers for PineTree wallet-management amounts. All
 * storage and provider-facing values are integer base units (never a
 * float) - mirrors the existing convention in
 * engine/withdrawals/walletWithdrawals.ts (parseSolanaUnits) and the
 * bigint sats columns in merchant_lightning_sweeps.
 *
 * This is PineTree's own supported-asset and base-unit-precision policy for
 * wallet management, not any single provider's contract - a provider
 * adapter is expected to work in terms of these same base units.
 */

export const WALLET_SUPPORTED_ASSETS = ["SATS", "USDT", "USDC"] as const
export type WalletAsset = (typeof WALLET_SUPPORTED_ASSETS)[number]

const ASSET_DECIMALS: Record<WalletAsset, number> = {
  SATS: 0,
  USDT: 6,
  USDC: 6,
}

export function isSupportedWalletAsset(value: string): value is WalletAsset {
  return (WALLET_SUPPORTED_ASSETS as readonly string[]).includes(value)
}

export function getWalletAssetDecimals(asset: string): number {
  return isSupportedWalletAsset(asset) ? ASSET_DECIMALS[asset] : 0
}

/**
 * Parses a user-supplied decimal amount string into an integer base-unit
 * bigint. Rejects zero, negative, scientific notation, non-numeric input,
 * and amounts with more fractional digits than the asset supports. Returns
 * null (never throws, never guesses) for anything invalid.
 */
export function parseWalletAmountToBaseUnits(value: string, asset: WalletAsset): bigint | null {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  if (/[eE]/.test(raw)) return null
  if (raw.startsWith("-")) return null

  const normalized = raw.startsWith(".") ? `0${raw}` : raw
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null

  const decimals = getWalletAssetDecimals(asset)
  const [whole, fraction = ""] = normalized.split(".")
  if (fraction.length > decimals) return null

  const baseUnits = BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt(fraction.padEnd(decimals, "0") || "0")
  if (baseUnits <= BigInt(0)) return null
  return baseUnits
}

export function formatWalletBaseUnitsAsDecimal(baseUnits: bigint | string, asset: string): string {
  const decimals = getWalletAssetDecimals(asset)
  const value = typeof baseUnits === "bigint" ? baseUnits : BigInt(baseUnits)
  if (decimals === 0) return value.toString()

  const divisor = BigInt(10) ** BigInt(decimals)
  const whole = value / divisor
  const fraction = (value % divisor).toString().padStart(decimals, "0").replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : whole.toString()
}
